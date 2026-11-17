import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { MAX_PHOTOS, checkQueue } from "./lib/checks";
import { MAX_SERVINGS } from "./lib/extraction";
import {
  cleanIngredientName,
  defaultProposal,
  ingredientKey,
  vFreshnessClass,
  vMeasureKind,
  vStoreSection,
  type Proposal,
} from "./lib/ingredients";
import { mapLines } from "./lib/matching";
import { assertSameHousehold, requireMember, type Member } from "./lib/membership";
import { regenerateShopping } from "./shopping";

/**
 * Recipe capture (#17): upload photos, read them into a Draft Recipe with an
 * AI model (`extractNode.run`), review the summary and save a confirmed Recipe.
 * Lines are matched to Household Ingredients (#19); new Ingredients the AI
 * proposes are shown with a "nová" badge, editable in the line sheet, and
 * created on save. Before saving, the check queue (#20, `lib/checks.ts`)
 * must be empty: "Recept pokračuje" (add pages and read again), "Pro kolik
 * osob?", "Nejisté čtení" and "Řádek bez suroviny".
 *
 * Edge flows (#21): a failed reading can be retried, retaken, filled in by
 * hand (the photo stays) or discarded; "✎ Ručně" starts a draft with no
 * photo; a photo holding several recipes becomes one draft per recipe,
 * sharing the photo, after the user picks which to keep.
 */

const MAX_NAME = 200;
const MAX_RAW = 300;
const MAX_UNIT = 30;
const MAX_STEP = 5000;
const MAX_STEPS = 100;
const MAX_LINES = 200;
/** Most recipes taken from one photo (a spread usually holds two). */
export const MAX_SPREAD = 6;
/** A reading run older than this counts as lost and may be retried. */
export const STALE_EXTRACTION_MS = 15 * 60 * 1000;

const vCategory = v.union(v.literal("main"), v.literal("special"));
/**
 * A line as edited in the line sheet; `ingredientName` "" leaves it unmapped.
 * `newIngredient` sets the details of the new Ingredient the line proposes.
 */
const vNewIngredientFields = v.object({
  freshnessClass: vFreshnessClass,
  storeSection: vStoreSection,
  measureKind: vMeasureKind,
});
const vDraftLine = v.object({
  raw: v.string(),
  amount: v.optional(v.number()),
  unit: v.optional(v.string()),
  ingredientName: v.optional(v.string()),
  optional: v.optional(v.boolean()),
  newIngredient: v.optional(vNewIngredientFields),
});
/** A line as read by the AI, before matching. */
const vReadLine = v.object({
  raw: v.string(),
  amount: v.optional(v.number()),
  unit: v.optional(v.string()),
  name: v.optional(v.string()),
  optional: v.optional(v.boolean()),
  uncertain: v.optional(v.boolean()),
});
/** One recipe as read by the AI; `pageSide` says where it sits on the photo. */
const vReadDraft = v.object({
  name: v.string(),
  baseServings: v.optional(v.number()),
  steps: v.array(v.string()),
  lines: v.array(vReadLine),
  continuesOffPage: v.optional(v.boolean()),
  pageSide: v.optional(v.string()),
});
const vLineToMatch = v.object({ name: v.string(), unit: v.optional(v.string()), raw: v.string() });
const vMatchResult = v.object({
  items: v.array(
    v.object({
      n: v.number(),
      existing: v.string(),
      name: v.string(),
      freshnessClass: vFreshnessClass,
      storeSection: vStoreSection,
      measureKind: vMeasureKind,
    }),
  ),
});

// ---------- validation helpers ----------

function cleanName(name: string): string {
  const value = name.trim();
  if (value.length > MAX_NAME) throw new ConvexError({ code: "INVALID_NAME" });
  return value;
}

function checkServings(servings: number | undefined): number | undefined {
  if (servings === undefined) return undefined;
  if (!Number.isInteger(servings) || servings < 1 || servings > MAX_SERVINGS) {
    throw new ConvexError({ code: "INVALID_PORTIONS" });
  }
  return servings;
}

type NewIngredientFields = Omit<Proposal, "name">;
type LineInput = {
  raw: string;
  amount?: number;
  unit?: string;
  ingredientName?: string;
  optional?: boolean;
  newIngredient?: NewIngredientFields;
};

function cleanLine(line: LineInput) {
  const raw = line.raw.trim();
  const unit = line.unit?.trim() || undefined;
  if (!raw || raw.length > MAX_RAW || (unit && unit.length > MAX_UNIT)) {
    throw new ConvexError({ code: "INVALID_LINE" });
  }
  if (line.amount !== undefined && !(Number.isFinite(line.amount) && line.amount >= 0)) {
    throw new ConvexError({ code: "INVALID_LINE" });
  }
  return { raw, amount: line.amount, unit };
}

// ---------- Ingredients ----------

async function catalogueOf(ctx: QueryCtx, household: Id<"households">) {
  return await ctx.db
    .query("ingredients")
    .withIndex("by_household", (q) => q.eq("household", household))
    .collect();
}

/** Household Ingredients by matching key. */
async function catalogueByKey(ctx: QueryCtx, household: Id<"households">) {
  return new Map((await catalogueOf(ctx, household)).map((i) => [ingredientKey(i.name), i]));
}

type Mapping = { ingredient?: Id<"ingredients">; proposed?: Doc<"ingredientLines">["proposed"] };

/**
 * Where a line typed in the line sheet points: an existing Ingredient, the
 * proposal another line of this recipe already carries, or a fresh guess.
 */
async function mappingForName(
  ctx: QueryCtx,
  member: Member,
  recipeId: Id<"recipes">,
  name: string,
  unit: string | undefined,
): Promise<Mapping> {
  const key = ingredientKey(name);
  if (!key) return {};
  const existing = (await catalogueByKey(ctx, member.household)).get(key);
  if (existing) return { ingredient: existing._id };
  const sibling = (await linesOf(ctx, recipeId)).find(
    (l) => l.proposed && ingredientKey(l.proposed.name) === key,
  );
  if (sibling?.proposed) {
    const { freshnessClass, storeSection, measureKind } = sibling.proposed;
    return { proposed: { name: cleanIngredientName(name), freshnessClass, storeSection, measureKind } };
  }
  return { proposed: defaultProposal(name, unit) };
}

function cleanSteps(steps: string[]): string[] {
  const out = steps.map((s) => s.trim()).filter(Boolean);
  if (out.length > MAX_STEPS || out.some((s) => s.length > MAX_STEP)) {
    throw new ConvexError({ code: "INVALID_STEPS" });
  }
  return out;
}

// ---------- loading helpers ----------

async function loadRecipe(
  ctx: QueryCtx,
  member: Member,
  recipeId: Id<"recipes">,
): Promise<Doc<"recipes">> {
const recipe = await ctx.db.get("recipes", recipeId);
assertSameHousehold(member, recipe);
return recipe as Doc<"recipes">;
}

/** A recipe whose fields may be edited now (not while the AI is reading it). */
async function loadEditable(
  ctx: QueryCtx,
  member: Member,
  recipeId: Id<"recipes">,
): Promise<Doc<"recipes">> {
const recipe = await loadRecipe(ctx, member, recipeId);
if (recipe.archived) throw new ConvexError({ code: "NOT_FOUND" });
if (recipe.extraction?.state === "pending") {
  throw new ConvexError({ code: "EXTRACTION_PENDING" });
}
return recipe;
}

async function photosOf(ctx: QueryCtx, recipeId: Id<"recipes">) {
  return await ctx.db
    .query("recipePhotos")
    .withIndex("by_recipe", (q) => q.eq("recipe", recipeId))
    .collect();
}

async function linesOf(ctx: QueryCtx, recipeId: Id<"recipes">) {
  return await ctx.db
    .query("ingredientLines")
    .withIndex("by_recipe", (q) => q.eq("recipe", recipeId))
    .collect();
}

async function replaceLines(
  ctx: MutationCtx,
  recipeId: Id<"recipes">,
  lines: { raw: string; amount?: number; unit?: string; optional?: boolean; uncertain?: boolean }[],
) {
  for (const old of await linesOf(ctx, recipeId)) {
    await ctx.db.delete("ingredientLines", old._id);
  }
  for (const [order, line] of lines.entries()) {
    await ctx.db.insert("ingredientLines", { recipe: recipeId, order, ...line });
  }
}

/**
 * Deletes a draft's photo rows, and each file unless another draft from the
 * same spread still shows it.
 */
async function deletePhotos(ctx: MutationCtx, recipeId: Id<"recipes">) {
  for (const photo of await photosOf(ctx, recipeId)) {
    await ctx.db.delete("recipePhotos", photo._id);
    const other = await ctx.db
      .query("recipePhotos")
      .withIndex("by_storage", (q) => q.eq("storageId", photo.storageId))
      .first();
    if (other === null) await ctx.storage.delete(photo.storageId);
  }
}

async function scheduleExtraction(ctx: MutationCtx, recipeId: Id<"recipes">) {
  const startedAt = Date.now();
  await ctx.db.patch("recipes", recipeId, {
    extraction: { state: "pending", stage: "read", startedAt },
  });
  await ctx.scheduler.runAfter(0, internal.extractNode.run, { recipeId, startedAt });
}

// ---------- capture ----------

/** Step 1 of an upload: a short-lived URL the phone POSTs the JPEG to. */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireMember(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * New pages for a recipe that already has `existing` photos: 1+ uploaded
 * files, no duplicates, none used by another photo, at most MAX_PHOTOS in all.
 */
async function checkNewPhotos(ctx: QueryCtx, storageIds: Id<"_storage">[], existing = 0) {
  if (storageIds.length === 0 || existing + storageIds.length > MAX_PHOTOS) {
    throw new ConvexError({ code: "INVALID_PHOTOS" });
  }
  if (new Set(storageIds).size !== storageIds.length) {
    throw new ConvexError({ code: "INVALID_PHOTOS" });
  }
  for (const storageId of storageIds) {
    const file = await ctx.db.system.get("_storage", storageId);
    const used = await ctx.db
      .query("recipePhotos")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (file === null || used !== null) {
      throw new ConvexError({ code: "INVALID_PHOTOS" });
    }
  }
}

/** Shared by `createDraft`; exported for tests. */
export async function createDraftFor(
  ctx: MutationCtx,
  member: Member,
  storageIds: Id<"_storage">[],
): Promise<Id<"recipes">> {
await checkNewPhotos(ctx, storageIds);
const recipeId = await ctx.db.insert("recipes", {
  household: member.household,
  name: "",
  category: "main",
  status: "draft",
  archived: false,
  favourite: false,
  steps: [],
});
for (const [order, storageId] of storageIds.entries()) {
  await ctx.db.insert("recipePhotos", { recipe: recipeId, storageId, order });
}
await scheduleExtraction(ctx, recipeId);
return recipeId;
}

/** "Přečíst recept": the uploaded pages become one Draft Recipe being read. */
export const createDraft = mutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.id("recipes"),
  handler: async (ctx, { storageIds }) => {
    const member = await requireMember(ctx);
    return await createDraftFor(ctx, member, storageIds);
  },
});

/**
 * "Vyfotit další stránku" (#20): appends pages to a Draft Recipe and reads
 * the whole recipe again from all its pages. The new reading replaces the
 * draft's name, servings, lines and steps.
 */
export const addPages = mutation({
  args: { recipeId: v.id("recipes"), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, args) => addPagesFor(ctx, await requireMember(ctx), args),
});

export async function addPagesFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, storageIds }: { recipeId: Id<"recipes">; storageIds: Id<"_storage">[] },
): Promise<null> {
  const recipe = await loadEditable(ctx, member, recipeId);
  if (recipe.status !== "draft") throw new ConvexError({ code: "NOT_A_DRAFT" });
  const photos = await photosOf(ctx, recipeId);
  await checkNewPhotos(ctx, storageIds, photos.length);
  let order = photos.length ? photos[photos.length - 1].order + 1 : 0;
  for (const storageId of storageIds) {
    await ctx.db.insert("recipePhotos", { recipe: recipeId, storageId, order: order++ });
  }
  await ctx.db.patch("recipes", recipeId, { continuesOffPage: undefined });
  await scheduleExtraction(ctx, recipeId);
  return null;
}

/** "✎ Ručně": an empty draft with no photo, filled in on the summary. */
export const createManual = mutation({
  args: {},
  returns: v.id("recipes"),
  handler: async (ctx) => createManualFor(ctx, await requireMember(ctx)),
});

export async function createManualFor(ctx: MutationCtx, member: Member): Promise<Id<"recipes">> {
  return await ctx.db.insert("recipes", {
    household: member.household,
    name: "",
    category: "main",
    status: "draft",
    archived: false,
    favourite: false,
    steps: [],
  });
}

/** A reading run that failed, or has been pending so long it counts as lost. */
function readingStuck(recipe: Doc<"recipes">): boolean {
  const e = recipe.extraction;
  return (
    e?.state === "failed" ||
    (e?.state === "pending" && Date.now() - e.startedAt > STALE_EXTRACTION_MS)
  );
}

/**
 * "Vyplnit ručně (fotka zůstane u receptu)": stop waiting for the AI and open
 * the summary to fill in by hand. A late result of the lost run is dropped.
 */
export const fillManually = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => fillManuallyFor(ctx, await requireMember(ctx), args),
});

export async function fillManuallyFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  const recipe = await loadRecipe(ctx, member, recipeId);
  if (recipe.status !== "draft" || !readingStuck(recipe)) {
    throw new ConvexError({ code: "CANNOT_RETRY" });
  }
  await ctx.db.patch("recipes", recipeId, { extraction: undefined });
  return null;
}

/** Read the photos again after a failed (or lost) reading run. */
export const retryExtraction = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => retryExtractionFor(ctx, await requireMember(ctx), args),
});

export async function retryExtractionFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  const recipe = await loadRecipe(ctx, member, recipeId);
  if (recipe.status !== "draft" || !readingStuck(recipe)) {
    throw new ConvexError({ code: "CANNOT_RETRY" });
  }
  if ((await photosOf(ctx, recipeId)).length === 0) {
    throw new ConvexError({ code: "INVALID_PHOTOS" });
  }
  await scheduleExtraction(ctx, recipeId);
  return null;
}

// ---------- reading (internal, called by extractNode.run) ----------

export const extractionInput = internalQuery({
  args: { recipeId: v.id("recipes"), startedAt: v.number() },
  returns: v.union(v.null(), v.array(v.id("_storage"))),
  handler: async (ctx, { recipeId, startedAt }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    if (!isCurrentRun(recipe, startedAt)) return null;
    return (await photosOf(ctx, recipeId)).map((p) => p.storageId);
  },
});

function isCurrentRun(recipe: Doc<"recipes"> | null, startedAt: number): boolean {
  return (
    recipe !== null &&
    recipe.extraction?.state === "pending" &&
    recipe.extraction.startedAt === startedAt
  );
}

type ReadDraft = {
  name: string;
  baseServings?: number;
  steps: string[];
  lines: { raw: string; amount?: number; unit?: string; optional?: boolean; uncertain?: boolean }[];
  continuesOffPage?: boolean;
  pageSide?: string;
};

/** The draft's fields and lines as read; the run moves on to matching. */
async function writeReading(
  ctx: MutationCtx,
  recipeId: Id<"recipes">,
  draft: ReadDraft,
  extraction: Doc<"recipes">["extraction"],
) {
  await ctx.db.patch("recipes", recipeId, {
    name: draft.name.slice(0, MAX_NAME),
    baseServings: draft.baseServings,
    // A new reading asks again: "Nevím" was about the earlier pages.
    servingsUnknown: undefined,
    continuesOffPage: draft.continuesOffPage || undefined,
    steps: draft.steps.slice(0, MAX_STEPS).map((s) => s.slice(0, MAX_STEP)),
    extraction,
  });
  await replaceLines(
    ctx,
    recipeId,
    draft.lines.slice(0, MAX_LINES).map((l) => ({
      raw: l.raw.slice(0, MAX_RAW),
      amount: l.amount,
      unit: l.unit?.slice(0, MAX_UNIT),
      optional: l.optional ?? false,
      ...(l.uncertain ? { uncertain: true } : {}),
    })),
  );
}

/** Which recipe of a new reading is the one a spread draft stands for. */
function sameRecipeIndex(spread: NonNullable<Doc<"recipes">["spread"]>, drafts: ReadDraft[]) {
  const bySide = drafts.findIndex((d) => d.pageSide && d.pageSide === spread.pageSide);
  if (bySide >= 0) return bySide;
  return spread.index < drafts.length ? spread.index : 0;
}

/**
 * Writes the AI's reading into the draft (lines replace any earlier ones) and
 * moves on to the "Páruji suroviny" stage. `others` are further recipes on
 * the same photo: on a first reading each becomes its own draft sharing the
 * photo, and the user then picks which to keep (#21). Re-reading a draft
 * from a spread keeps to its own recipe. Returns the drafts written (with
 * the index of their recipe in `[draft, ...others]`) and the Household's
 * Ingredient names for matching, or null if this run is no longer current.
 */
export const applyExtraction = internalMutation({
  args: {
    recipeId: v.id("recipes"),
    startedAt: v.number(),
    model: v.string(),
    draft: vReadDraft,
    others: v.optional(v.array(vReadDraft)),
    /** 0-based indexes of the photos that show the finished food (#58). */
    covers: v.optional(v.array(v.number())),
  },
  returns: v.union(
    v.null(),
    v.object({
      catalogue: v.array(v.string()),
      written: v.array(v.object({ recipeId: v.id("recipes"), index: v.number() })),
    }),
  ),
  handler: async (ctx, { recipeId, startedAt, model, draft, others = [], covers = [] }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    // Discarded meanwhile, or superseded by a retry: drop this result.
    if (!isCurrentRun(recipe, startedAt)) return null;
    // The photos were sent in this order; a new reading decides covers afresh.
    for (const [index, photo] of (await photosOf(ctx, recipeId)).entries()) {
      const cover = covers.includes(index) || undefined;
      if (cover !== photo.cover) await ctx.db.patch("recipePhotos", photo._id, { cover });
    }
    const drafts = [draft, ...others].slice(0, MAX_SPREAD);
    const extraction = { state: "pending" as const, stage: "match" as const, model, startedAt };
    const written: { recipeId: Id<"recipes">; index: number }[] = [];
    if (recipe!.spread) {
      const index = sameRecipeIndex(recipe!.spread, drafts);
      await writeReading(ctx, recipeId, drafts[index], extraction);
      written.push({ recipeId, index });
    } else {
      // Only a first reading splits; a re-read of a reviewed draft (lines
      // already there) stays one recipe.
      const split = drafts.length > 1 && (await linesOf(ctx, recipeId)).length === 0;
      await writeReading(ctx, recipeId, drafts[0], extraction);
      written.push({ recipeId, index: 0 });
      if (split) {
        const spreadOf = (index: number) => ({
          group: recipeId,
          index,
          pageSide: drafts[index].pageSide,
          choosing: true,
        });
        await ctx.db.patch("recipes", recipeId, { spread: spreadOf(0) });
        const photos = await photosOf(ctx, recipeId);
        for (let index = 1; index < drafts.length; index++) {
          const sibling = await ctx.db.insert("recipes", {
            household: recipe!.household,
            name: "",
            category: recipe!.category,
            status: "draft",
            archived: false,
            steps: [],
            spread: spreadOf(index),
          });
          for (const p of photos) {
            await ctx.db.insert("recipePhotos", {
              recipe: sibling,
              storageId: p.storageId,
              order: p.order,
              cover: p.cover,
            });
          }
          await writeReading(ctx, sibling, drafts[index], extraction);
          written.push({ recipeId: sibling, index });
        }
      }
    }
    const catalogue = await catalogueOf(ctx, recipe!.household);
    return { catalogue: catalogue.map((i) => i.name), written };
  },
});

/**
 * Maps the read lines to Household Ingredients and finishes the reading run.
 * `lines` are the lines as read, in order; `items` the ones sent to the model
 * and `result` its answer (null when matching failed: default guesses).
 */
export const applyMatching = internalMutation({
  args: {
    recipeId: v.id("recipes"),
    startedAt: v.number(),
    lines: v.array(vLineToMatch),
    items: v.array(vLineToMatch),
    result: v.union(v.null(), vMatchResult),
  },
  returns: v.null(),
  handler: async (ctx, { recipeId, startedAt, lines, items, result }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    if (!isCurrentRun(recipe, startedAt)) return null;
    const catalogue = await catalogueOf(ctx, recipe!.household);
    const mappings = mapLines(lines, catalogue, items, result);
    const stored = await linesOf(ctx, recipeId);
    for (const line of stored) {
      const m = mappings[line.order];
      if (!m) continue;
      await ctx.db.patch("ingredientLines", line._id, {
        ingredient: m.ingredient,
        proposed: m.proposed,
      });
    }
    await ctx.db.patch("recipes", recipeId, {
      extraction: { state: "done", model: recipe!.extraction!.model, startedAt },
    });
    return null;
  },
});

export const failExtraction = internalMutation({
  args: { recipeId: v.id("recipes"), startedAt: v.number(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { recipeId, startedAt, error }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    if (!isCurrentRun(recipe, startedAt)) return null;
    await ctx.db.patch("recipes", recipeId, {
      extraction: { state: "failed", error: error.slice(0, 1000), startedAt },
    });
    return null;
  },
});

// ---------- several recipes on one photo ----------

/** The drafts read from the same photo as a spread `group`, in reading order. */
async function spreadDrafts(ctx: QueryCtx, household: Id<"households">, group: Id<"recipes">) {
  const drafts = await ctx.db
    .query("recipes")
    .withIndex("by_household_status", (q) => q.eq("household", household).eq("status", "draft"))
    .collect();
  return drafts
    .filter((r) => r.spread?.group === group)
    .sort((a, b) => a.spread!.index - b.spread!.index);
}

/**
 * "Na fotce je víc receptů": keeps the picked drafts from the photo and
 * discards the rest (the photo stays while any kept draft shows it). Returns
 * the first kept draft, to review first, or null when none was kept.
 */
export const chooseFromPhoto = mutation({
  args: { recipeId: v.id("recipes"), keep: v.array(v.id("recipes")) },
  returns: v.union(v.null(), v.id("recipes")),
  handler: async (ctx, args) => chooseFromPhotoFor(ctx, await requireMember(ctx), args),
});

export async function chooseFromPhotoFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, keep }: { recipeId: Id<"recipes">; keep: Id<"recipes">[] },
): Promise<Id<"recipes"> | null> {
  const recipe = await loadRecipe(ctx, member, recipeId);
  if (recipe.status !== "draft" || !recipe.spread?.choosing) {
    throw new ConvexError({ code: "ALREADY_CHOSEN" });
  }
  const group = await spreadDrafts(ctx, member.household, recipe.spread.group);
  const ids = new Set(group.map((r) => r._id));
  if (keep.some((id) => !ids.has(id))) throw new ConvexError({ code: "NOT_FOUND" });
  const kept = new Set(keep);
  let first: Id<"recipes"> | null = null;
  for (const r of group) {
    if (kept.has(r._id)) {
      await ctx.db.patch("recipes", r._id, { spread: { ...r.spread!, choosing: false } });
      first ??= r._id;
    } else {
      await deleteDraft(ctx, r._id);
    }
  }
  return first;
}

// ---------- reading for the UI ----------

/** The Recipe's thumbnail: its Cover Photo (#58), else the first page. */
async function thumbnailUrl(ctx: QueryCtx, recipeId: Id<"recipes">) {
  const photos = await photosOf(ctx, recipeId);
  const photo = photos.find((p) => p.cover) ?? photos[0];
  return photo ? await ctx.storage.getUrl(photo.storageId) : null;
}

/**
 * Every date the Household planned each Recipe on, ascending. Cooking History
 * is derived from these on the client: dates before today were cooked, the
 * rest are coming up (#12). Leftover Portions live in their own table, so
 * they never count as a cooking.
 */
async function mealDatesByRecipe(ctx: QueryCtx, household: Id<"households">) {
  const meals = await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_date", (q) => q.eq("household", household))
    .collect();
  const out = new Map<Id<"recipes">, string[]>();
  for (const m of meals) {
    const dates = out.get(m.recipe);
    if (dates) dates.push(m.date);
    else out.set(m.recipe, [m.date]);
  }
  return out;
}

/** Distinct Ingredient names a Recipe uses (a proposal counts by its name). */
function ingredientNamesOf(
  lines: Doc<"ingredientLines">[],
  names: Map<Id<"ingredients">, string>,
): string[] {
  const out = new Set<string>();
  for (const l of lines) {
    const name = (l.ingredient && names.get(l.ingredient)) || l.proposed?.name;
    if (name) out.add(name);
  }
  return [...out];
}

/**
 * The library (#25): confirmed, non-archived Recipes (A–Z) with what the
 * shelves, search and ingredient filter need, and drafts (newest first),
 * which stay under "Rozpracované" and never reach the shelves.
 */
export const library = query({
  args: {},
  handler: async (ctx) => libraryFor(ctx, (await requireMember(ctx)).household),
});

export async function libraryFor(ctx: QueryCtx, household: Id<"households">) {
  const byStatus = (status: "draft" | "confirmed") =>
    ctx.db
      .query("recipes")
      .withIndex("by_household_status", (q) =>
        q.eq("household", household).eq("status", status),
      )
      .collect();
  const summary = async (r: Doc<"recipes">) => ({
    _id: r._id,
    _creationTime: r._creationTime,
    name: r.name,
    category: r.category,
    baseServings: r.baseServings,
    extractionState: r.extraction?.state ?? null,
    choosing: r.spread?.choosing ?? false,
    photoUrl: await thumbnailUrl(ctx, r._id),
  });
  const names = new Map(
    (await catalogueOf(ctx, household)).map((i) => [i._id, i.name] as const),
  );
  const dates = await mealDatesByRecipe(ctx, household);
  const confirmed = (await byStatus("confirmed")).filter((r) => !r.archived);
  confirmed.sort((a, b) => a.name.localeCompare(b.name, "cs"));
  const drafts = (await byStatus("draft")).filter((r) => !r.archived).reverse();
  return {
    recipes: await Promise.all(
      confirmed.map(async (r) => ({
        ...(await summary(r)),
        favourite: r.favourite ?? false,
        ingredients: ingredientNamesOf(await linesOf(ctx, r._id), names),
        mealDates: dates.get(r._id) ?? [],
      })),
    ),
    drafts: await Promise.all(drafts.map(summary)),
  };
}

/**
 * Ingredient Lines for the UI, each with its Ingredient or the proposed new
 * one. A proposal whose name now exists in the Household (another Recipe
 * added it meanwhile) shows as that Ingredient: it is never new again.
 */
export async function lineViewsFor(ctx: QueryCtx, member: Member, recipeId: Id<"recipes">) {
  const catalogue = await catalogueOf(ctx, member.household);
  const byId = new Map(catalogue.map((i) => [i._id, i]));
  const byKey = new Map(catalogue.map((i) => [ingredientKey(i.name), i]));
  return (await linesOf(ctx, recipeId)).map((l) => {
    const ing =
      (l.ingredient && byId.get(l.ingredient)) ||
      (l.proposed ? byKey.get(ingredientKey(l.proposed.name)) : undefined);
    return {
      _id: l._id,
      raw: l.raw,
      amount: l.amount,
      unit: l.unit,
      optional: l.optional ?? false,
      uncertain: l.uncertain ?? false,
      ingredient: ing ? { _id: ing._id, name: ing.name } : null,
      proposed:
        !ing && l.proposed
          ? {
              name: l.proposed.name,
              freshnessClass: l.proposed.freshnessClass,
              storeSection: l.proposed.storeSection,
              measureKind: l.proposed.measureKind,
            }
          : null,
    };
  });
}

/** One Recipe with its photos and Ingredient Lines; null if not found. */
export const get = query({
  args: { recipeId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const recipeId = ctx.db.normalizeId("recipes", args.recipeId);
    if (recipeId === null) return null;
    const recipe = await ctx.db.get("recipes", recipeId);
    if (recipe === null || recipe.household !== member.household) return null;
    const photos = await Promise.all(
      (await photosOf(ctx, recipeId)).map(async (p) => ({
        _id: p._id,
        url: await ctx.storage.getUrl(p.storageId),
        cover: p.cover ?? false,
      })),
    );
    const lines = await lineViewsFor(ctx, member, recipeId);
    const meals = await ctx.db
      .query("plannedMeals")
      .withIndex("by_household_recipe_date", (q) =>
        q.eq("household", member.household).eq("recipe", recipeId),
      )
      .collect();
    const e = recipe.extraction;
    // Drafts still waiting from the same photo, for the chooser and "Další z fotky".
    const fromPhoto = recipe.spread
      ? await Promise.all(
          (await spreadDrafts(ctx, member.household, recipe.spread.group)).map(async (r) => ({
              _id: r._id,
              name: r.name,
              pageSide: r.spread!.pageSide ?? null,
              lineCount: (await linesOf(ctx, r._id)).length,
              extractionState: r.extraction?.state ?? null,
              choosing: r.spread!.choosing,
            })),
        )
      : [];
    return {
      _id: recipe._id,
      _creationTime: recipe._creationTime,
      name: recipe.name,
      category: recipe.category,
      status: recipe.status,
      archived: recipe.archived,
      favourite: recipe.favourite ?? false,
      /** Planned Meal dates, ascending: the Cooking History source (#12). */
      mealDates: meals.map((m) => m.date),
      baseServings: recipe.baseServings,
      servingsUnknown: recipe.servingsUnknown ?? false,
      continuesOffPage: recipe.continuesOffPage ?? false,
      steps: recipe.steps,
      extraction: e
        ? {
            state: e.state,
            stage: e.stage ?? "read",
            model: e.model,
            error: e.error,
            stale: e.state === "pending" && Date.now() - e.startedAt > STALE_EXTRACTION_MS,
          }
        : null,
      photos,
      lines,
      spread: recipe.spread
        ? { choosing: recipe.spread.choosing, pageSide: recipe.spread.pageSide ?? null, drafts: fromPhoto }
        : null,
    };
  },
});

// ---------- review edits ----------

/**
 * "Použít jako náhled" (#58): makes a photo the Recipe's only Cover Photo, or
 * (`cover: false`) turns it back into a page. Fixes the AI's guess.
 */
export const setCoverPhoto = mutation({
  args: { photoId: v.id("recipePhotos"), cover: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => setCoverPhotoFor(ctx, await requireMember(ctx), args),
});

export async function setCoverPhotoFor(
  ctx: MutationCtx,
  member: Member,
  { photoId, cover }: { photoId: Id<"recipePhotos">; cover: boolean },
): Promise<null> {
  const photo = await ctx.db.get("recipePhotos", photoId);
  if (photo === null) throw new ConvexError({ code: "NOT_FOUND" });
  await loadEditable(ctx, member, photo.recipe);
  for (const p of await photosOf(ctx, photo.recipe)) {
    const next = (p._id === photoId ? cover : p.cover && !cover) || undefined;
    if (next !== p.cover) await ctx.db.patch("recipePhotos", p._id, { cover: next });
  }
  return null;
}

/** Basics sheet: name, category and portions (unset = the book gives none). */
export const updateBasics = mutation({
  args: {
    recipeId: v.id("recipes"),
    name: v.string(),
    category: vCategory,
    baseServings: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => updateBasicsFor(ctx, await requireMember(ctx), args),
});

export async function updateBasicsFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, name, category, baseServings }: { recipeId: Id<"recipes">; name: string; category: "main" | "special"; baseServings?: number },
): Promise<null> {
  await loadEditable(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, {
    name: cleanName(name),
    category,
    baseServings: checkServings(baseServings),
  });
  await afterRecipeEdit(ctx, member, recipeId);
  return null;
}

/** "Pro kolik osob?": a number chip sets the servings. */
export const setServings = mutation({
  args: { recipeId: v.id("recipes"), baseServings: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => setServingsFor(ctx, await requireMember(ctx), args),
});

export async function setServingsFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, baseServings }: { recipeId: Id<"recipes">; baseServings: number },
): Promise<null> {
  await loadEditable(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, { baseServings: checkServings(baseServings) });
  return null;
}

/**
 * Answers a recipe-level check without changing the recipe: "Nevím – nechat
 * výchozí" (`servings`) or "Ne, je to celé" (`continues`).
 */
export const dismissCheck = mutation({
  args: {
    recipeId: v.id("recipes"),
    check: v.union(v.literal("servings"), v.literal("continues")),
  },
  returns: v.null(),
  handler: async (ctx, args) => dismissCheckFor(ctx, await requireMember(ctx), args),
});

export async function dismissCheckFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, check }: { recipeId: Id<"recipes">; check: "servings" | "continues" },
): Promise<null> {
  const recipe = await loadEditable(ctx, member, recipeId);
  if (recipe.status !== "draft") throw new ConvexError({ code: "NOT_A_DRAFT" });
  await ctx.db.patch(
    "recipes",
    recipeId,
    check === "servings" ? { servingsUnknown: true } : { continuesOffPage: undefined },
  );
  return null;
}

export const updateSteps = mutation({
  args: { recipeId: v.id("recipes"), steps: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => updateStepsFor(ctx, await requireMember(ctx), args),
});

export async function updateStepsFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, steps }: { recipeId: Id<"recipes">; steps: string[] },
): Promise<null> {
  await loadEditable(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, { steps: cleanSteps(steps) });
  return null;
}

/** "+ Surovina". */
export const addLine = mutation({
  args: { recipeId: v.id("recipes"), line: vDraftLine },
  returns: v.id("ingredientLines"),
  handler: async (ctx, args) => addLineFor(ctx, await requireMember(ctx), args),
});

export async function addLineFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, line }: { recipeId: Id<"recipes">; line: LineInput },
): Promise<Id<"ingredientLines">> {
  await loadEditable(ctx, member, recipeId);
  const lines = await linesOf(ctx, recipeId);
  if (lines.length >= MAX_LINES) throw new ConvexError({ code: "INVALID_LINE" });
  const order = lines.length ? lines[lines.length - 1].order + 1 : 0;
  const clean = cleanLine(line);
  const lineId = await ctx.db.insert("ingredientLines", {
    recipe: recipeId,
    order,
    ...clean,
    optional: line.optional ?? false,
    ...(await mappingForName(ctx, member, recipeId, line.ingredientName ?? "", clean.unit)),
  });
  if (line.newIngredient) await setNewIngredient(ctx, lineId, line.newIngredient);
  await afterRecipeEdit(ctx, member, recipeId);
  return lineId;
}

/** A confirmed Recipe may be planned: its edits change the shopping list (#7). */
async function afterRecipeEdit(ctx: MutationCtx, member: Member, recipeId: Id<"recipes">) {
  const recipe = await ctx.db.get("recipes", recipeId);
  if (recipe?.status === "confirmed") await regenerateShopping(ctx, member.household);
}

async function loadEditableLine(
  ctx: QueryCtx,
  member: Member,
  lineId: Id<"ingredientLines">,
) {
  const line = await ctx.db.get("ingredientLines", lineId);
  if (line === null) throw new ConvexError({ code: "NOT_FOUND" });
  await loadEditable(ctx, member, line.recipe);
  return line;
}

export const updateLine = mutation({
  args: { lineId: v.id("ingredientLines"), line: vDraftLine },
  returns: v.null(),
  handler: async (ctx, args) => updateLineFor(ctx, await requireMember(ctx), args),
});

export async function updateLineFor(
  ctx: MutationCtx,
  member: Member,
  { lineId, line }: { lineId: Id<"ingredientLines">; line: LineInput },
): Promise<null> {
  const old = await loadEditableLine(ctx, member, lineId);
  const { raw, amount, unit } = cleanLine(line);
  // Saving a line means a person has looked at it: "✓ Takhle je to správně".
  const patch: Partial<Doc<"ingredientLines">> = { raw, amount, unit, uncertain: undefined };
  if (line.optional !== undefined) patch.optional = line.optional;
  if (line.ingredientName !== undefined) {
    const current = await currentName(ctx, old);
    // Keep the mapping (and an edited proposal) unless the name changed.
    if (ingredientKey(line.ingredientName) !== ingredientKey(current)) {
      const m = await mappingForName(ctx, member, old.recipe, line.ingredientName, unit);
      patch.ingredient = m.ingredient;
      patch.proposed = m.proposed;
    }
  }
  await ctx.db.patch("ingredientLines", lineId, patch);
  if (line.newIngredient) await setNewIngredient(ctx, lineId, line.newIngredient);
  await afterRecipeEdit(ctx, member, old.recipe);
  return null;
}

export const deleteLine = mutation({
  args: { lineId: v.id("ingredientLines") },
  returns: v.null(),
  handler: async (ctx, args) => deleteLineFor(ctx, await requireMember(ctx), args),
});

export async function deleteLineFor(
  ctx: MutationCtx,
  member: Member,
  { lineId }: { lineId: Id<"ingredientLines"> },
): Promise<null> {
  const line = await loadEditableLine(ctx, member, lineId);
  await ctx.db.delete("ingredientLines", lineId);
  await afterRecipeEdit(ctx, member, line.recipe);
  return null;
}

// ---------- new Ingredients ----------

/** The Ingredient name a line points at now (existing or proposed). */
async function currentName(ctx: QueryCtx, line: Doc<"ingredientLines">): Promise<string> {
  if (line.ingredient) return (await ctx.db.get("ingredients", line.ingredient))?.name ?? "";
  return line.proposed?.name ?? "";
}

/** Draft lines that carry the same proposed Ingredient as `line`. */
async function sameProposal(ctx: QueryCtx, line: Doc<"ingredientLines">) {
  if (!line.proposed) return [];
  const key = ingredientKey(line.proposed.name);
  return (await linesOf(ctx, line.recipe)).filter(
    (l) => l.proposed && ingredientKey(l.proposed.name) === key,
  );
}

/**
 * Sets the details of the new Ingredient a line proposes, on every line of
 * the draft proposing the same name. No-op if the line maps to an existing one.
 */
async function setNewIngredient(
  ctx: MutationCtx,
  lineId: Id<"ingredientLines">,
  fields: NewIngredientFields,
) {
  const line = await ctx.db.get("ingredientLines", lineId);
  if (!line?.proposed) return;
  for (const l of await sameProposal(ctx, line)) {
    await ctx.db.patch("ingredientLines", l._id, {
      proposed: {
        name: l.proposed!.name,
        freshnessClass: fields.freshnessClass,
        storeSection: fields.storeSection,
        measureKind: fields.measureKind,
      },
    });
  }
}

/**
 * "Je to vlastně jiná surovina…": maps the line (and the draft's other lines
 * proposing the same new Ingredient) to an existing Household Ingredient.
 */
export const mapToIngredient = mutation({
  args: { lineId: v.id("ingredientLines"), ingredientId: v.id("ingredients") },
  returns: v.null(),
  handler: async (ctx, args) => mapToIngredientFor(ctx, await requireMember(ctx), args),
});

export async function mapToIngredientFor(
  ctx: MutationCtx,
  member: Member,
  { lineId, ingredientId }: { lineId: Id<"ingredientLines">; ingredientId: Id<"ingredients"> },
): Promise<null> {
  const line = await loadEditableLine(ctx, member, lineId);
  const ingredient = await ctx.db.get("ingredients", ingredientId);
  assertSameHousehold(member, ingredient);
  const targets = line.proposed ? await sameProposal(ctx, line) : [line];
  for (const l of targets) {
    await ctx.db.patch("ingredientLines", l._id, { ingredient: ingredientId, proposed: undefined });
  }
  await afterRecipeEdit(ctx, member, line.recipe);
  return null;
}

// ---------- save / discard ----------

/** New Ingredients the lines propose are created (once per name) and mapped. */
async function createProposedIngredients(
  ctx: MutationCtx,
  member: Member,
  recipeId: Id<"recipes">,
): Promise<void> {
  const lines = await linesOf(ctx, recipeId);
  const byKey = new Map(
    (await catalogueOf(ctx, member.household)).map((i) => [ingredientKey(i.name), i._id]),
  );
  // New Ingredients are created on save, once per name.
  for (const l of lines) {
    if (!l.proposed) continue;
    const key = ingredientKey(l.proposed.name);
    let id = byKey.get(key);
    if (id === undefined) {
      const { name, freshnessClass, storeSection, measureKind } = l.proposed;
      id = await ctx.db.insert("ingredients", {
        household: member.household,
        name: cleanIngredientName(name),
        freshnessClass,
        storeSection,
        measureKind,
        plenty: false,
        neverBuy: false,
      });
      byKey.set(key, id);
    }
    await ctx.db.patch("ingredientLines", l._id, { ingredient: id, proposed: undefined });
  }
}

/** "Uložit recept": the draft becomes a confirmed Recipe; photos stay with it. */
export const confirm = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => confirmFor(ctx, await requireMember(ctx), args),
});

export async function confirmFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  const recipe = await loadEditable(ctx, member, recipeId);
  if (recipe.status !== "draft") throw new ConvexError({ code: "NOT_A_DRAFT" });
  if (recipe.extraction?.state === "failed") {
    throw new ConvexError({ code: "EXTRACTION_FAILED" });
  }
  if (recipe.spread?.choosing) throw new ConvexError({ code: "CHOOSE_FIRST" });
  if (!recipe.name.trim()) throw new ConvexError({ code: "NAME_REQUIRED" });
  const lines = await linesOf(ctx, recipeId);
  const checks = checkQueue(
    recipe,
    lines.map((l) => ({ _id: l._id, uncertain: l.uncertain, hasIngredient: !!(l.ingredient || l.proposed) })),
  );
  if (checks.length > 0) throw new ConvexError({ code: "CHECKS_PENDING" });
  await createProposedIngredients(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, {
    status: "confirmed",
    servingsUnknown: undefined,
    continuesOffPage: undefined,
    steps: cleanSteps(recipe.steps),
  });
  return null;
}

/** "Zahodit": deletes a Draft Recipe with its lines and photo files. */
export const discard = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => discardFor(ctx, await requireMember(ctx), args),
});

export async function discardFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  const recipe = await loadRecipe(ctx, member, recipeId);
  if (recipe.status !== "draft") throw new ConvexError({ code: "NOT_A_DRAFT" });
  await deleteDraft(ctx, recipeId);
  return null;
}

async function deleteDraft(ctx: MutationCtx, recipeId: Id<"recipes">) {
  for (const line of await linesOf(ctx, recipeId)) {
    await ctx.db.delete("ingredientLines", line._id);
  }
  await deletePhotos(ctx, recipeId);
  // A reading run still in flight finds the recipe gone and stops.
  await ctx.db.delete("recipes", recipeId);
}

// ---------- library actions (#25) ----------

async function loadConfirmed(
  ctx: QueryCtx,
  member: Member,
  recipeId: Id<"recipes">,
): Promise<Doc<"recipes">> {
  const recipe = await loadRecipe(ctx, member, recipeId);
  if (recipe.archived) throw new ConvexError({ code: "NOT_FOUND" });
  if (recipe.status !== "confirmed") throw new ConvexError({ code: "NOT_CONFIRMED" });
  return recipe;
}

/** The ★ toggle in the detail sheet; shared by the whole Household. */
export const setFavourite = mutation({
  args: { recipeId: v.id("recipes"), favourite: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => setFavouriteFor(ctx, await requireMember(ctx), args),
});

export async function setFavouriteFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId, favourite }: { recipeId: Id<"recipes">; favourite: boolean },
): Promise<null> {
  await loadConfirmed(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, { favourite });
  return null;
}

/**
 * "Upravit recept" → "Hotovo": edits to a confirmed Recipe are saved as they
 * are made; this creates any new Ingredients the edited lines propose.
 */
export const saveEdits = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => saveEditsFor(ctx, await requireMember(ctx), args),
});

export async function saveEditsFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  const recipe = await loadConfirmed(ctx, member, recipeId);
  if (!recipe.name.trim()) throw new ConvexError({ code: "NAME_REQUIRED" });
  await createProposedIngredients(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, { steps: cleanSteps(recipe.steps) });
  return null;
}

/**
 * "Archivovat": hidden from the library and the picker; Planned Meals that
 * already use it keep pointing to it (#5).
 */
export const archive = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => archiveFor(ctx, await requireMember(ctx), args),
});

export async function archiveFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  await loadConfirmed(ctx, member, recipeId);
  await ctx.db.patch("recipes", recipeId, { archived: true, favourite: false });
  return null;
}

/** "Smazat úplně": a hard delete, only for a Recipe that was never planned (#5). */
export const deleteForever = mutation({
  args: { recipeId: v.id("recipes") },
  returns: v.null(),
  handler: async (ctx, args) => deleteForeverFor(ctx, await requireMember(ctx), args),
});

export async function deleteForeverFor(
  ctx: MutationCtx,
  member: Member,
  { recipeId }: { recipeId: Id<"recipes"> },
): Promise<null> {
  await loadConfirmed(ctx, member, recipeId);
  const planned = await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_recipe_date", (q) =>
      q.eq("household", member.household).eq("recipe", recipeId),
    )
    .first();
  if (planned !== null) throw new ConvexError({ code: "WAS_PLANNED" });
  for (const line of await linesOf(ctx, recipeId)) {
    await ctx.db.delete("ingredientLines", line._id);
  }
  await deletePhotos(ctx, recipeId);
  await ctx.db.delete("recipes", recipeId);
  return null;
}
