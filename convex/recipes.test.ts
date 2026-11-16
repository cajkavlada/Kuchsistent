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
  confirmFor,
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

/** A draft that the AI has finished reading. */
async function readDraft(t: T, member: Member, model = "claude-sonnet-5-5") {
  const photo = await storePhoto(t);
  const recipeId = await t.run((ctx) => createDraftFor(ctx, member, [photo]));
  await t.mutation(internal.recipes.applyExtraction, {
    recipeId,
    startedAt: await startedAt(t, recipeId),
    model,
    draft: DRAFT,
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
    const { recipeId } = await readDraft(t, member, "gemini-3.8-flash");
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
