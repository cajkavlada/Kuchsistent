import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { memberOf, type Member } from "./lib/membership";
import {
  addLineFor,
  approveNewIngredientFor,
  confirmFor,
  lineViewsFor,
  mapToIngredientFor,
  createDraftFor,
  deleteLineFor,
  discardFor,
  retryExtractionFor,
  updateBasicsFor,
  updateLineFor,
  updateStepsFor,
} from "./recipes";

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", "a@example.com,b@example.com");
  // Keep the scheduled reading action (real AI calls) from running.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function newMember(t: T, email = "a@example.com"): Promise<Member> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, emailVerified: true });
    await createHouseholdFor(ctx, userId, 2);
    return await memberOf(ctx, userId);
  });
}

async function storePhoto(t: T): Promise<Id<"_storage">> {
  return await t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })),
  );
}

async function startedAt(t: T, recipeId: Id<"recipes">): Promise<number> {
  const recipe = await t.run((ctx) => ctx.db.get("recipes", recipeId));
  return recipe!.extraction!.startedAt;
}

const DRAFT = {
  name: "Kuře na paprice",
  baseServings: 4,
  steps: ["Osmahneme cibuli.", "Podusíme."],
  lines: [
    { raw: "10 dkg cibule", amount: 10, unit: "dkg" },
    { raw: "sůl" },
  ],
};

type ReadLine = (typeof DRAFT.lines)[number] & { name?: string; optional?: boolean };
type MatchResult = {
  items: {
    n: number;
    existing: string;
    name: string;
    freshnessClass: "veryFresh" | "meat" | "chilled" | "produce" | "longLife";
    storeSection: "produce" | "meatFish" | "dairyEggs" | "pantry" | "spices" | "other";
    measureKind: "weight" | "volume" | "count";
  }[];
} | null;

/**
 * A draft that the AI has finished reading and matching. `items` are the
 * lines sent to the matching model and `result` its answer.
 */
async function readDraft(
  t: T,
  member: Member,
  {
    model = "claude-sonnet-5-5",
    lines = DRAFT.lines as ReadLine[],
    items,
    result = null,
  }: { model?: string; lines?: ReadLine[]; items?: ReadLine[]; result?: MatchResult } = {},
) {
  const photo = await storePhoto(t);
  const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
  const run = await startedAt(t, recipeId);
  const applied = await t.mutation(internal.recipes.applyExtraction, {
    recipeId,
    startedAt: run,
    model,
    draft: { ...DRAFT, lines },
  });
  const toMatch = (l: ReadLine) => ({ name: l.name ?? "", unit: l.unit, raw: l.raw });
  await t.mutation(internal.recipes.applyMatching, {
    recipeId,
    startedAt: run,
    lines: lines.map(toMatch),
    items: (items ?? lines.filter((l) => l.name && !applied!.catalogue.includes(l.name))).map(toMatch),
    result,
  });
  return { recipeId, photo };
}

const linesOf = (t: T, recipeId: Id<"recipes">) =>
  t.run((ctx) =>
    ctx.db
      .query("ingredientLines")
      .withIndex("by_recipe", (q) => q.eq("recipe", recipeId))
      .collect(),
  );

describe("capture", () => {
  test("photos become one Draft Recipe being read, and the reading action is scheduled", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const [p1, p2] = [await storePhoto(t), await storePhoto(t)];
    const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [p1, p2]));
    await t.run(async (ctx) => {
      const recipe = await ctx.db.get("recipes", recipeId);
      expect(recipe).toMatchObject({
        household: member.household,
        status: "draft",
        category: "main",
        archived: false,
        extraction: { state: "pending" },
      });
      const photos = await ctx.db
        .query("recipePhotos")
        .withIndex("by_recipe", (q) => q.eq("recipe", recipeId))
        .collect();
      expect(photos.map((p) => [p.storageId, p.order])).toEqual([[p1, 0], [p2, 1]]);
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      expect(jobs.map((j) => [j.name, j.args[0]])).toEqual([
        ["extractNode:run", { recipeId, startedAt: recipe!.extraction!.startedAt }],
      ]);
    });
  });

  test("rejects no photos, duplicates, missing files and photos already in use", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const photo = await storePhoto(t);
    const gone = await storePhoto(t);
    await t.run((ctx) => ctx.storage.delete(gone));
    for (const ids of [[], [photo, photo], [gone]]) {
      await expect(t.run((ctx) => createDraftFor(ctx, member, ids))).rejects.toThrow(
        /INVALID_PHOTOS/,
      );
    }
    await t.run((ctx) => createDraftFor(ctx, member, [photo]));
    await expect(t.run((ctx) => createDraftFor(ctx, member, [photo]))).rejects.toThrow(
      /INVALID_PHOTOS/,
    );
  });

  test("public functions reject callers who are not signed in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.recipes.generateUploadUrl, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.recipes.library, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.recipes.get, { recipeId: "x" })).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe("reading", () => {
  test("the result fills the draft, keeps lines as printed and records the model", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const { recipeId } = await readDraft(t, member, { model: "gemini-3.8-flash" });
    const recipe = await t.run((ctx) => ctx.db.get("recipes", recipeId));
    expect(recipe).toMatchObject({
      name: "Kuře na paprice",
      baseServings: 4,
      steps: DRAFT.steps,
      status: "draft",
      extraction: { state: "done", model: "gemini-3.8-flash" },
    });
    const lines = await linesOf(t, recipeId);
    expect(lines.map((l) => [l.order, l.raw, l.amount, l.unit])).toEqual([
      [0, "10 dkg cibule", 10, "dkg"],
      [1, "sůl", undefined, undefined],
    ]);
  });

  test("a stale run (superseded or discarded draft) changes nothing", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const photo = await storePhoto(t);
    const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
    const run = await startedAt(t, recipeId);
    await t.mutation(internal.recipes.applyExtraction, {
      recipeId, startedAt: run - 1, model: "old", draft: DRAFT,
    });
    expect((await t.run((ctx) => ctx.db.get("recipes", recipeId)))!.extraction!.state).toBe("pending");
    expect(await t.query(internal.recipes.extractionInput, { recipeId, startedAt: run })).toEqual([photo]);
    await t.run((ctx) => discardFor(ctx, member, { recipeId }));
    expect(await t.query(internal.recipes.extractionInput, { recipeId, startedAt: run })).toBeNull();
    await t.mutation(internal.recipes.applyExtraction, { recipeId, startedAt: run, model: "m", draft: DRAFT });
    expect(await t.run((ctx) => ctx.db.get("recipes", recipeId))).toBeNull();
  });

  test("a failed reading can be retried; not while it is still running", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const photo = await storePhoto(t);
    const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
    await expect(t.run((ctx) => retryExtractionFor(ctx, member, { recipeId }))).rejects.toThrow(
      /CANNOT_RETRY/,
    );
    const first = await startedAt(t, recipeId);
    await t.mutation(internal.recipes.failExtraction, { recipeId, startedAt: first, error: "boom" });
    expect((await t.run((ctx) => ctx.db.get("recipes", recipeId)))!.extraction).toMatchObject({
      state: "failed",
      error: "boom",
    });
    await expect(t.run((ctx) => confirmFor(ctx, member, { recipeId }))).rejects.toThrow(
      /EXTRACTION_FAILED/,
    );
    vi.setSystemTime(Date.now() + 1000);
    await t.run((ctx) => retryExtractionFor(ctx, member, { recipeId }));
    const recipe = await t.run((ctx) => ctx.db.get("recipes", recipeId));
    expect(recipe!.extraction!.state).toBe("pending");
    expect(recipe!.extraction!.startedAt).toBeGreaterThan(first);
  });

  test("a lost run (pending for too long) can be retried", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const photo = await storePhoto(t);
    const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    await t.run((ctx) => retryExtractionFor(ctx, member, { recipeId }));
  });
});

describe("review and save", () => {
  test("nothing can be edited while the AI is reading", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const photo = await storePhoto(t);
    const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
    await expect(
      t.run((ctx) => updateStepsFor(ctx, member, { recipeId, steps: ["x"] })),
    ).rejects.toThrow(/EXTRACTION_PENDING/);
    await expect(t.run((ctx) => confirmFor(ctx, member, { recipeId }))).rejects.toThrow(
      /EXTRACTION_PENDING/,
    );
  });

  test("basics, lines and steps can be edited", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const { recipeId } = await readDraft(t, member);
    await t.run((ctx) =>
      updateBasicsFor(ctx, member, { recipeId, name: "  Svíčková ", category: "special" }),
    );
    const [first, second] = await linesOf(t, recipeId);
    await t.run((ctx) =>
      updateLineFor(ctx, member, { lineId: first._id, line: { raw: "15 dkg cibule", amount: 15, unit: " dkg " } }),
    );
    await t.run((ctx) => deleteLineFor(ctx, member, { lineId: second._id }));
    await t.run((ctx) =>
      addLineFor(ctx, member, { recipeId, line: { raw: "2 stroužky česneku", amount: 2, unit: "stroužky" } }),
    );
    await t.run((ctx) => updateStepsFor(ctx, member, { recipeId, steps: [" Krok 1 ", "", "Krok 2"] }));
    const recipe = await t.run((ctx) => ctx.db.get("recipes", recipeId));
    expect(recipe).toMatchObject({ name: "Svíčková", category: "special", steps: ["Krok 1", "Krok 2"] });
    expect(recipe!.baseServings).toBeUndefined();
    expect((await linesOf(t, recipeId)).map((l) => [l.order, l.raw, l.amount, l.unit])).toEqual([
      [0, "15 dkg cibule", 15, "dkg"],
      [1, "2 stroužky česneku", 2, "stroužky"],
    ]);
  });

  test.each([
    ["empty line", { raw: "  " }],
    ["negative amount", { raw: "x", amount: -1 }],
  ])("rejects an invalid line: %s", async (_label, line) => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const { recipeId } = await readDraft(t, member);
    await expect(t.run((ctx) => addLineFor(ctx, member, { recipeId, line }))).rejects.toThrow(
      /INVALID_LINE/,
    );
  });

  test.each([0, 2.5, 51])("rejects portions %s", async (baseServings) => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const { recipeId } = await readDraft(t, member);
    await expect(
      t.run((ctx) => updateBasicsFor(ctx, member, { recipeId, name: "x", category: "main", baseServings })),
    ).rejects.toThrow(/INVALID_PORTIONS/);
  });

  test("saving needs a name, then confirms the Recipe and keeps its photo", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const { recipeId, photo } = await readDraft(t, member);
    await t.run((ctx) => updateBasicsFor(ctx, member, { recipeId, name: " ", category: "main" }));
    await expect(t.run((ctx) => confirmFor(ctx, member, { recipeId }))).rejects.toThrow(/NAME_REQUIRED/);
    await t.run((ctx) => updateBasicsFor(ctx, member, { recipeId, name: "Kuře", category: "main", baseServings: 4 }));
    await t.run((ctx) => confirmFor(ctx, member, { recipeId }));
    await t.run(async (ctx) => {
      expect((await ctx.db.get("recipes", recipeId))!.status).toBe("confirmed");
      expect(await ctx.storage.getUrl(photo)).not.toBeNull();
    });
    await expect(t.run((ctx) => confirmFor(ctx, member, { recipeId }))).rejects.toThrow(/NOT_A_DRAFT/);
    await expect(t.run((ctx) => discardFor(ctx, member, { recipeId }))).rejects.toThrow(/NOT_A_DRAFT/);
  });

  test("discarding a draft deletes its lines, photos and files", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const { recipeId, photo } = await readDraft(t, member);
    await t.run((ctx) => discardFor(ctx, member, { recipeId }));
    await t.run(async (ctx) => {
      expect(await ctx.db.get("recipes", recipeId)).toBeNull();
      expect(await ctx.db.query("ingredientLines").collect()).toEqual([]);
      expect(await ctx.db.query("recipePhotos").collect()).toEqual([]);
      expect(await ctx.storage.getUrl(photo)).toBeNull();
    });
  });

  test("another Household's recipe is not found", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t, "a@example.com");
    const b = await newMember(t, "b@example.com");
    const { recipeId } = await readDraft(t, a);
    const [line] = await linesOf(t, recipeId);
    await expect(t.run((ctx) => confirmFor(ctx, b, { recipeId }))).rejects.toThrow(/NOT_FOUND/);
    await expect(t.run((ctx) => discardFor(ctx, b, { recipeId }))).rejects.toThrow(/NOT_FOUND/);
    await expect(t.run((ctx) => deleteLineFor(ctx, b, { lineId: line._id }))).rejects.toThrow(/NOT_FOUND/);
    await expect(t.run((ctx) => retryExtractionFor(ctx, b, { recipeId }))).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("matching Ingredients and the check queue", () => {
  const LINES: ReadLine[] = [
    { raw: "10 dkg cibule", amount: 10, unit: "dkg", name: "cibule" },
    { raw: "5 dkg sádla", amount: 5, unit: "dkg", name: "sádlo" },
    { raw: "trochu sádla na pánev", name: "Sádlo" },
    { raw: "případně petrželka", name: "petrželka", optional: true },
    { raw: "voda" },
  ];
  const SADLO = {
    n: 1,
    existing: "",
    name: "sádlo",
    freshnessClass: "chilled" as const,
    storeSection: "meatFish" as const,
    measureKind: "weight" as const,
  };
  const { n: _n, existing: _e, ...PROPOSAL } = SADLO;

  async function withCatalogue(t: T, member: Member, names: string[]) {
    return await t.run(async (ctx) => {
      const ids: Id<"ingredients">[] = [];
      for (const name of names) {
        ids.push(
          await ctx.db.insert("ingredients", {
            household: member.household,
            name,
            freshnessClass: "produce",
            storeSection: "produce",
            measureKind: "weight",
            plenty: false,
            neverBuy: false,
          }),
        );
      }
      return ids;
    });
  }

  const view = (t: T, member: Member, recipeId: Id<"recipes">) =>
    t.run((ctx) => lineViewsFor(ctx, member, recipeId));
  const ingredientsOf = (t: T, member: Member) =>
    t.run((ctx) =>
      ctx.db
        .query("ingredients")
        .withIndex("by_household", (q) => q.eq("household", member.household))
        .collect(),
    );

  test("reading goes through the 'match' stage before it is done", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const photo = await storePhoto(t);
    const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
    const run = await startedAt(t, recipeId);
    const stage = async () => (await t.run((ctx) => ctx.db.get("recipes", recipeId)))!.extraction;
    expect(await stage()).toMatchObject({ state: "pending", stage: "read" });
    await withCatalogue(t, member, ["cibule"]);
    const applied = await t.mutation(internal.recipes.applyExtraction, {
      recipeId, startedAt: run, model: "m", draft: { ...DRAFT, lines: LINES },
    });
    expect(applied).toEqual({ catalogue: ["cibule"] });
    expect(await stage()).toMatchObject({ state: "pending", stage: "match", model: "m" });
    await t.mutation(internal.recipes.applyMatching, {
      recipeId, startedAt: run, lines: [], items: [], result: null,
    });
    expect(await stage()).toMatchObject({ state: "done", model: "m" });
  });

  test("lines map to existing Ingredients or carry the proposed new one; optional is kept", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const [cibule] = await withCatalogue(t, member, ["cibule"]);
    const { recipeId } = await readDraft(t, member, {
      lines: LINES,
      items: [LINES[1], LINES[3]],
      result: { items: [{ ...SADLO, n: 0 }] },
    });
    const lines = await view(t, member, recipeId);
    expect(lines.map((l) => [l.ingredient?._id ?? null, l.proposed?.name ?? null, l.optional])).toEqual([
      [cibule, null, false],
      [null, "sádlo", false],
      [null, "sádlo", false],
      [null, "petrželka", true],
      [null, null, false],
    ]);
    // The model's guess for sádlo; a default guess for petrželka (no answer).
    expect(lines[1].proposed).toMatchObject({ freshnessClass: "chilled", storeSection: "meatFish", measureKind: "weight", approved: false });
    expect(lines[3].proposed).toMatchObject({ freshnessClass: "longLife", storeSection: "other", measureKind: "count" });
  });

  test("saving needs every new Ingredient approved, then creates each once", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    await withCatalogue(t, member, ["cibule"]);
    const { recipeId } = await readDraft(t, member, {
      lines: LINES,
      items: [LINES[1], LINES[3]],
      result: { items: [{ ...SADLO, n: 0 }] },
    });
    await expect(t.run((ctx) => confirmFor(ctx, member, { recipeId }))).rejects.toThrow(/QUEUE_NOT_EMPTY/);
    const [, sadlo, , petrzelka] = await view(t, member, recipeId);
    // Approving one line approves the other line proposing the same Ingredient.
    await t.run((ctx) =>
      approveNewIngredientFor(ctx, member, {
        lineId: sadlo._id,
        proposal: { name: "sádlo", freshnessClass: "chilled", storeSection: "deli", measureKind: "weight" },
      }),
    );
    expect((await view(t, member, recipeId))[2].proposed).toMatchObject({ approved: true, storeSection: "deli" });
    await expect(t.run((ctx) => confirmFor(ctx, member, { recipeId }))).rejects.toThrow(/QUEUE_NOT_EMPTY/);
    await t.run((ctx) =>
      approveNewIngredientFor(ctx, member, {
        lineId: petrzelka._id,
        proposal: { name: " petrželka ", freshnessClass: "produce", storeSection: "produce", measureKind: "count" },
      }),
    );
    await t.run((ctx) => confirmFor(ctx, member, { recipeId }));
    const all = await ingredientsOf(t, member);
    expect(all.map((i) => [i.name, i.freshnessClass, i.storeSection, i.measureKind, i.plenty, i.neverBuy])).toEqual([
      ["cibule", "produce", "produce", "weight", false, false],
      ["sádlo", "chilled", "deli", "weight", false, false],
      ["petrželka", "produce", "produce", "count", false, false],
    ]);
    const saved = await linesOf(t, recipeId);
    expect(saved.map((l) => all.find((i) => i._id === l.ingredient)?.name ?? null)).toEqual([
      "cibule", "sádlo", "sádlo", "petrželka", null,
    ]);
    expect(saved.every((l) => l.proposed === undefined)).toBe(true);
  });

  test("once a saved Recipe adds an Ingredient it is never new again in the Household", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const opts = { lines: [LINES[1]], items: [LINES[1]], result: { items: [{ ...SADLO, n: 0 }] } };
    const first = await readDraft(t, member, opts);
    const second = await readDraft(t, member, opts);
    const [line] = await view(t, member, first.recipeId);
    await t.run((ctx) => approveNewIngredientFor(ctx, member, { lineId: line._id, proposal: PROPOSAL }));
    await t.run((ctx) => confirmFor(ctx, member, { recipeId: first.recipeId }));
    const [sadlo] = await ingredientsOf(t, member);
    // The other draft, read before the save, now shows sádlo as existing and may be saved.
    const [other] = await view(t, member, second.recipeId);
    expect(other.ingredient).toEqual({ _id: sadlo._id, name: "sádlo" });
    expect(other.proposed).toBeNull();
    await t.run((ctx) => confirmFor(ctx, member, { recipeId: second.recipeId }));
    expect(await ingredientsOf(t, member)).toHaveLength(1);
    // And a new reading maps it in code.
    const third = await readDraft(t, member, opts);
    expect((await view(t, member, third.recipeId))[0].ingredient?._id).toBe(sadlo._id);
  });

  test("'Je to vlastně jiná surovina…' maps the lines to an existing Ingredient", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const other = await newMember(t, "b@example.com");
    const [vepr] = await withCatalogue(t, member, ["vepřové sádlo"]);
    const [foreign] = await withCatalogue(t, other, ["sádlo"]);
    const { recipeId } = await readDraft(t, member, { lines: [LINES[1], LINES[2]] });
    const [line] = await view(t, member, recipeId);
    await expect(
      t.run((ctx) => mapToIngredientFor(ctx, member, { lineId: line._id, ingredientId: foreign })),
    ).rejects.toThrow(/NOT_FOUND/);
    await t.run((ctx) => mapToIngredientFor(ctx, member, { lineId: line._id, ingredientId: vepr }));
    expect((await view(t, member, recipeId)).map((l) => l.ingredient?._id)).toEqual([vepr, vepr]);
    await t.run((ctx) => confirmFor(ctx, member, { recipeId }));
    expect(await ingredientsOf(t, member)).toHaveLength(1);
  });

  test("approving under an existing name maps to it instead of creating a duplicate", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const [cibule] = await withCatalogue(t, member, ["cibule"]);
    const { recipeId } = await readDraft(t, member, { lines: [{ raw: "1 cibulka", name: "cibulka" }] });
    const [line] = await view(t, member, recipeId);
    await t.run((ctx) =>
      approveNewIngredientFor(ctx, member, { lineId: line._id, proposal: { ...PROPOSAL, name: "Cibule" } }),
    );
    expect((await view(t, member, recipeId))[0].ingredient?._id).toBe(cibule);
  });

  test("the line sheet sets the Ingredient by name and toggles optional", async () => {
    const t = convexTest(schema, modules);
    const member = await newMember(t);
    const [cibule] = await withCatalogue(t, member, ["cibule"]);
    const { recipeId } = await readDraft(t, member, { lines: [LINES[0], LINES[4]] });
    const [, voda] = await view(t, member, recipeId);
    // Same name: mapping kept. New name: a proposal awaiting review.
    await t.run((ctx) =>
      updateLineFor(ctx, member, { lineId: voda._id, line: { raw: "1 l vody", amount: 1, unit: "l", ingredientName: "voda", optional: true } }),
    );
    let lines = await view(t, member, recipeId);
    expect(lines[1]).toMatchObject({ optional: true, ingredient: null, proposed: { name: "voda", measureKind: "volume", approved: false } });
    await t.run((ctx) =>
      updateLineFor(ctx, member, { lineId: voda._id, line: { raw: "1 l vody", amount: 1, unit: "l", ingredientName: "Cibule " } }),
    );
    lines = await view(t, member, recipeId);
    expect(lines[1]).toMatchObject({ optional: true, ingredient: { _id: cibule }, proposed: null });
    // "+ Surovina" with a name another line already proposes shares that proposal.
    await t.run((ctx) =>
      addLineFor(ctx, member, { recipeId, line: { raw: "sůl", ingredientName: "sůl" } }),
    );
    const salt = (await view(t, member, recipeId))[2];
    await t.run((ctx) => approveNewIngredientFor(ctx, member, { lineId: salt._id, proposal: { ...PROPOSAL, name: "sůl" } }));
    await t.run((ctx) => addLineFor(ctx, member, { recipeId, line: { raw: "špetka soli", ingredientName: "sůl" } }));
    expect((await view(t, member, recipeId))[3].proposed).toMatchObject({ name: "sůl", approved: true });
    await t.run((ctx) => confirmFor(ctx, member, { recipeId }));
  });
});
