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
import { MAX_SERVINGS } from "./lib/extraction";
import {
  cleanIngredientName,
  defaultProposal,
  ingredientKey,
  vFreshnessClass,
  vMeasureKind,
  vProposal,
  vStoreSection,
  type Proposal,
} from "./lib/ingredients";
import { mapLines } from "./lib/matching";
import { assertSameHousehold, requireMember, type Member } from "./lib/membership";

/**
 * Recipe capture (#17): upload photos, read them into a Draft Recipe with an
 * AI model (`extractNode.run`), review the summary and save a confirmed Recipe.
 * Lines are matched to Household Ingredients (#19); new Ingredients the AI
 * proposes wait in the check queue and are created on save.
 */

export const MAX_PHOTOS = 10;
const MAX_NAME = 200;
const MAX_RAW = 300;
const MAX_UNIT = 30;
const MAX_STEP = 5000;
const MAX_STEPS = 100;
const MAX_LINES = 200;
/** A reading run older than this counts as lost and may be retried. */
export const STALE_EXTRACTION_MS = 15 * 60 * 1000;

const vCategory = v.union(v.literal("main"), v.literal("special"));
/** A line as edited in the line sheet; `ingredientName` "" leaves it unmapped. */
const vDraftLine = v.object({
  raw: v.string(),
  amount: v.optional(v.number()),
  unit: v.optional(v.string()),
  ingredientName: v.optional(v.string()),
  optional: v.optional(v.boolean()),
});
/** A line as read by the AI, before matching. */
const vReadLine = v.object({
  raw: v.string(),
  amount: v.optional(v.number()),
  unit: v.optional(v.string()),
  name: v.optional(v.string()),
  optional: v.optional(v.boolean()),
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

type LineInput = {
  raw: string;
  amount?: number;
  unit?: string;
  ingredientName?: string;
  optional?: boolean;
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
  if (sibling?.proposed) return { proposed: { ...sibling.proposed, name: cleanIngredientName(name) } };
  return { proposed: { ...defaultProposal(name, unit), approved: false } };
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
  lines: { raw: string; amount?: number; unit?: string; optional?: boolean }[],
) {
  for (const old of await linesOf(ctx, recipeId)) {
    await ctx.db.delete("ingredientLines", old._id);
  }
  for (const [order, line] of lines.entries()) {
    await ctx.db.insert("ingredientLines", { recipe: recipeId, order, ...line });
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

/** Shared by `createDraft`; exported for tests. */
export async function createDraftFor(
  ctx: MutationCtx,
  member: Member,
  storageIds: Id<"_storage">[],
): Promise<Id<"recipes">> {
if (storageIds.length === 0 || storageIds.length > MAX_PHOTOS) {
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
const recipeId = await ctx.db.insert("recipes", {
  household: member.household,
  name: "",
  category: "main",
  status: "draft",
  archived: false,
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
  const e = recipe.extraction;
  const lost = e?.state === "pending" && Date.now() - e.startedAt > STALE_EXTRACTION_MS;
  if (recipe.status !== "draft" || !(e?.state === "failed" || lost)) {
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

/**
 * Writes the AI's reading into the draft (lines replace any earlier ones) and
 * moves on to the "Páruji suroviny" stage. Returns the Household's Ingredient
 * names for matching, or null if this run is no longer current.
 */
export const applyExtraction = internalMutation({
  args: {
    recipeId: v.id("recipes"),
    startedAt: v.number(),
    model: v.string(),
    draft: v.object({
      name: v.string(),
      baseServings: v.optional(v.number()),
      steps: v.array(v.string()),
      lines: v.array(vReadLine),
    }),
  },
  returns: v.union(v.null(), v.object({ catalogue: v.array(v.string()) })),
  handler: async (ctx, { recipeId, startedAt, model, draft }) => {
    const recipe = await ctx.db.get("recipes", recipeId);
    // Discarded meanwhile, or superseded by a retry: drop this result.
    if (!isCurrentRun(recipe, startedAt)) return null;
    await ctx.db.patch("recipes", recipeId, {
      name: draft.name.slice(0, MAX_NAME),
      baseServings: draft.baseServings,
      steps: draft.steps.slice(0, MAX_STEPS).map((s) => s.slice(0, MAX_STEP)),
      extraction: { state: "pending", stage: "match", model, startedAt },
    });
    await replaceLines(
      ctx,
      recipeId,
      draft.lines.slice(0, MAX_LINES).map((l) => ({
        raw: l.raw.slice(0, MAX_RAW),
        amount: l.amount,
        unit: l.unit?.slice(0, MAX_UNIT),
        optional: l.optional ?? false,
      })),
    );
    const catalogue = await catalogueOf(ctx, recipe!.household);
    return { catalogue: catalogue.map((i) => i.name) };
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
        proposed: m.proposed ? { ...m.proposed, approved: false } : undefined,
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

// ---------- reading for the UI ----------

async function firstPhotoUrl(ctx: QueryCtx, recipeId: Id<"recipes">) {
  const photo = await ctx.db
    .query("recipePhotos")
    .withIndex("by_recipe", (q) => q.eq("recipe", recipeId))
    .first();
  return photo ? await ctx.storage.getUrl(photo.storageId) : null;
}

/** The library: confirmed Recipes (A–Z) and drafts in progress (newest first). */
export const library = query({
  args: {},
  handler: async (ctx) => {
    const { household } = await requireMember(ctx);
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
      photoUrl: await firstPhotoUrl(ctx, r._id),
    });
    const confirmed = (await byStatus("confirmed")).filter((r) => !r.archived);
    confirmed.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    const drafts = (await byStatus("draft")).reverse();
    return {
      recipes: await Promise.all(confirmed.map(summary)),
      drafts: await Promise.all(drafts.map(summary)),
    };
  },
});

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
      ingredient: ing ? { _id: ing._id, name: ing.name } : null,
      proposed: !ing && l.proposed ? l.proposed : null,
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
      })),
    );
    const lines = await lineViewsFor(ctx, member, recipeId);
    const e = recipe.extraction;
    return {
      _id: recipe._id,
      name: recipe.name,
      category: recipe.category,
      status: recipe.status,
      archived: recipe.archived,
      baseServings: recipe.baseServings,
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
    };
  },
});

// ---------- review edits ----------

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
  return await ctx.db.insert("ingredientLines", {
    recipe: recipeId,
    order,
    ...clean,
    optional: line.optional ?? false,
    ...(await mappingForName(ctx, member, recipeId, line.ingredientName ?? "", clean.unit)),
  });
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
  const patch: Partial<Doc<"ingredientLines">> = { raw, amount, unit };
  if (line.optional !== undefined) patch.optional = line.optional;
  if (line.ingredientName !== undefined) {
    const current = await currentName(ctx, old);
    // Keep the mapping (and an approved proposal) unless the name changed.
    if (ingredientKey(line.ingredientName) !== ingredientKey(current)) {
      const m = await mappingForName(ctx, member, old.recipe, line.ingredientName, unit);
      patch.ingredient = m.ingredient;
      patch.proposed = m.proposed;
    }
  }
  await ctx.db.patch("ingredientLines", lineId, patch);
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
  await loadEditableLine(ctx, member, lineId);
  await ctx.db.delete("ingredientLines", lineId);
  return null;
}

// ---------- the check queue: "Nová surovina" ----------

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
 * "✓ Přidat surovinu": accepts the (possibly edited) new Ingredient for every
 * line of the draft that proposes it. A name that already exists maps the
 * lines to that Ingredient instead.
 */
export const approveNewIngredient = mutation({
  args: { lineId: v.id("ingredientLines"), proposal: vProposal },
  returns: v.null(),
  handler: async (ctx, args) => approveNewIngredientFor(ctx, await requireMember(ctx), args),
});

export async function approveNewIngredientFor(
  ctx: MutationCtx,
  member: Member,
  { lineId, proposal }: { lineId: Id<"ingredientLines">; proposal: Proposal },
): Promise<null> {
  const line = await loadEditableLine(ctx, member, lineId);
  if (!line.proposed) throw new ConvexError({ code: "NOT_NEW" });
  const name = cleanIngredientName(proposal.name);
  if (!name) throw new ConvexError({ code: "INVALID_INGREDIENT" });
  const existing = (await catalogueByKey(ctx, member.household)).get(ingredientKey(name));
  for (const l of await sameProposal(ctx, line)) {
    await ctx.db.patch(
      "ingredientLines",
      l._id,
      existing
        ? { ingredient: existing._id, proposed: undefined }
        : { ingredient: undefined, proposed: { ...proposal, name, approved: true } },
    );
  }
  return null;
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
  return null;
}

// ---------- save / discard ----------

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
  if (!recipe.name.trim()) throw new ConvexError({ code: "NAME_REQUIRED" });
  const byKey = new Map(
    (await catalogueOf(ctx, member.household)).map((i) => [ingredientKey(i.name), i._id]),
  );
  const lines = await linesOf(ctx, recipeId);
  // The check queue must be empty: every proposed Ingredient approved.
  for (const l of lines) {
    if (l.proposed && !l.proposed.approved && !byKey.has(ingredientKey(l.proposed.name))) {
      throw new ConvexError({ code: "QUEUE_NOT_EMPTY" });
    }
  }
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
  await ctx.db.patch("recipes", recipeId, {
    status: "confirmed",
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
  for (const line of await linesOf(ctx, recipeId)) {
    await ctx.db.delete("ingredientLines", line._id);
  }
  for (const photo of await photosOf(ctx, recipeId)) {
    await ctx.db.delete("recipePhotos", photo._id);
    await ctx.storage.delete(photo.storageId);
  }
  // A reading run still in flight finds the recipe gone and stops.
  await ctx.db.delete("recipes", recipeId);
  return null;
}
