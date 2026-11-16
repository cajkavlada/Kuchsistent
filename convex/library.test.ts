import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { memberOf, type Member } from "./lib/membership";
import { addFor } from "./plan";
import {
  archiveFor,
  deleteForeverFor,
  libraryFor,
  saveEditsFor,
  setFavouriteFor,
  updateLineFor,
} from "./recipes";

/** The recipe library (#25): favourites, history source, archiving, edits. */

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", "a@example.com,b@example.com");
});
afterEach(() => vi.unstubAllEnvs());

async function newMember(t: T, email = "a@example.com"): Promise<Member> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, emailVerified: true });
    await createHouseholdFor(ctx, userId, 2);
    return await memberOf(ctx, userId);
  });
}

async function addRecipe(
  t: T,
  member: Member,
  over: { name?: string; status?: "draft" | "confirmed"; archived?: boolean; ingredients?: string[] } = {},
): Promise<Id<"recipes">> {
  return await t.run(async (ctx) => {
    const recipe = await ctx.db.insert("recipes", {
      household: member.household,
      name: over.name ?? "Guláš",
      category: "main",
      status: over.status ?? "confirmed",
      archived: over.archived ?? false,
      steps: ["Uvaříme."],
    });
    for (const [order, name] of (over.ingredients ?? []).entries()) {
      const ingredient = await ctx.db.insert("ingredients", {
        household: member.household,
        name,
        freshnessClass: "longLife",
        storeSection: "other",
        measureKind: "weight",
        plenty: false,
        neverBuy: false,
      });
      await ctx.db.insert("ingredientLines", { recipe, order, raw: name, ingredient });
    }
    return recipe;
  });
}

const libraryOf = (t: T, m: Member) => t.run((ctx) => libraryFor(ctx, m.household));

const plan = (t: T, m: Member, recipeId: Id<"recipes">, date: string) =>
  t.run((ctx) => addFor(ctx, m, { date, slot: "lunch", recipeId }));

describe("library", () => {
  test("confirmed Recipes carry favourite, Ingredient names and Planned Meal dates", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const gulas = await addRecipe(t, m, { name: "Guláš", ingredients: ["hovězí", "cibule"] });
    await addRecipe(t, m, { name: "Archivovaný", archived: true });
    await addRecipe(t, m, { name: "Koncept", status: "draft" });
    await plan(t, m, gulas, "2026-11-20");
    await plan(t, m, gulas, "2026-10-01");
    await t.run((ctx) => setFavouriteFor(ctx, m, { recipeId: gulas, favourite: true }));

    const lib = await libraryOf(t, m);
    expect(lib.recipes.map((r) => r.name)).toEqual(["Guláš"]);
    expect(lib.recipes[0]).toMatchObject({
      favourite: true,
      ingredients: ["hovězí", "cibule"],
      mealDates: ["2026-10-01", "2026-11-20"],
    });
    expect(lib.drafts.map((r) => r.name)).toEqual(["Koncept"]);
  });
});

describe("setFavourite", () => {
  test("is shared by the Household and only for confirmed Recipes", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addRecipe(t, m);
    await t.run((ctx) => setFavouriteFor(ctx, m, { recipeId: id, favourite: true }));
    expect((await t.run((ctx) => ctx.db.get("recipes", id)))!.favourite).toBe(true);
    await t.run((ctx) => setFavouriteFor(ctx, m, { recipeId: id, favourite: false }));
    expect((await t.run((ctx) => ctx.db.get("recipes", id)))!.favourite).toBe(false);

    const draft = await addRecipe(t, m, { status: "draft" });
    await expect(
      t.run((ctx) => setFavouriteFor(ctx, m, { recipeId: draft, favourite: true })),
    ).rejects.toThrow(/NOT_CONFIRMED/);
  });

  test("another Household's Recipe is not found", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t, "a@example.com");
    const b = await newMember(t, "b@example.com");
    const id = await addRecipe(t, a);
    await expect(
      t.run((ctx) => setFavouriteFor(ctx, b, { recipeId: id, favourite: true })),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("archive", () => {
  test("hides the Recipe from the library and picker but keeps its meals", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addRecipe(t, m);
    const meal = await plan(t, m, id, "2026-11-20");
    await t.run((ctx) => archiveFor(ctx, m, { recipeId: id }));

    expect((await libraryOf(t, m)).recipes).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("plannedMeals", meal))).not.toBeNull();
    await expect(plan(t, m, id, "2026-11-21")).rejects.toThrow(/NOT_PLANNABLE/);
    await expect(t.run((ctx) => archiveFor(ctx, m, { recipeId: id }))).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("deleteForever", () => {
  test("deletes a never-planned Recipe with its lines and photos", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addRecipe(t, m, { ingredients: ["cibule"] });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1])])));
    await t.run((ctx) => ctx.db.insert("recipePhotos", { recipe: id, storageId, order: 0 }));

    await t.run((ctx) => deleteForeverFor(ctx, m, { recipeId: id }));
    await t.run(async (ctx) => {
      expect(await ctx.db.get("recipes", id)).toBeNull();
      expect(await ctx.db.query("ingredientLines").collect()).toEqual([]);
      expect(await ctx.db.query("recipePhotos").collect()).toEqual([]);
      expect(await ctx.storage.get(storageId)).toBeNull();
      // The Ingredient itself stays in the Household.
      expect(await ctx.db.query("ingredients").collect()).toHaveLength(1);
    });
  });

  test("refuses a Recipe that was ever planned", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addRecipe(t, m);
    await plan(t, m, id, "2025-01-01");
    await expect(t.run((ctx) => deleteForeverFor(ctx, m, { recipeId: id }))).rejects.toThrow(
      /WAS_PLANNED/,
    );
  });
});

describe("saveEdits", () => {
  test("creates the new Ingredient an edited line proposes", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addRecipe(t, m, { ingredients: ["cibule"] });
    const line = await t.run(async (ctx) => (await ctx.db.query("ingredientLines").first())!._id);
    await t.run((ctx) =>
      updateLineFor(ctx, m, { lineId: line, line: { raw: "2 stroužky česneku", ingredientName: "česnek" } }),
    );
    await t.run((ctx) => saveEditsFor(ctx, m, { recipeId: id }));
    const lib = await libraryOf(t, m);
    expect(lib.recipes[0].ingredients).toEqual(["česnek"]);
    await t.run(async (ctx) => {
      const l = await ctx.db.get("ingredientLines", line);
      expect(l!.proposed).toBeUndefined();
      expect(l!.ingredient).toBeDefined();
    });
  });

  test("only for confirmed Recipes", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const draft = await addRecipe(t, m, { status: "draft" });
    await expect(t.run((ctx) => saveEditsFor(ctx, m, { recipeId: draft }))).rejects.toThrow(
      /NOT_CONFIRMED/,
    );
  });
});
