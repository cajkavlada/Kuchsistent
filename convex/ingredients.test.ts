import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor, setFreshnessDaysFor } from "./households";
import { catalogueFor, mergeFor, updateFor, type IngredientEdit } from "./ingredients";
import { freshnessDaysFor, freshnessTable } from "./lib/ingredients";
import { memberOf, type Member } from "./lib/membership";

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

async function addIngredient(t: T, m: Member, name: string): Promise<Id<"ingredients">> {
  return await t.run((ctx) =>
    ctx.db.insert("ingredients", {
      household: m.household,
      name,
      freshnessClass: "longLife",
      storeSection: "other",
      measureKind: "count",
      plenty: false,
      neverBuy: false,
    }),
  );
}

/** A confirmed Recipe whose lines use the given Ingredients. */
async function addRecipe(t: T, m: Member, ingredients: Id<"ingredients">[]) {
  return await t.run(async (ctx) => {
    const recipe = await ctx.db.insert("recipes", {
      household: m.household,
      name: "Recept",
      category: "main",
      status: "confirmed",
      archived: false,
      steps: [],
    });
    for (const [order, ingredient] of ingredients.entries()) {
      await ctx.db.insert("ingredientLines", { recipe, order, raw: "x", ingredient });
    }
    return recipe;
  });
}

const edit = (name: string, more: Partial<IngredientEdit> = {}): IngredientEdit => ({
  name,
  freshnessClass: "produce",
  storeSection: "produce",
  measureKind: "weight",
  neverBuy: false,
  ...more,
});

describe("catalogue", () => {
  test("lists the Household's Ingredients A–Z with how many Recipes use them", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t);
    const b = await newMember(t, "b@example.com");
    const cibule = await addIngredient(t, a, "cibule");
    await addIngredient(t, a, "česnek");
    await addIngredient(t, a, "brambory");
    await addIngredient(t, b, "cizí");
    await addRecipe(t, a, [cibule, cibule]);
    await addRecipe(t, a, [cibule]);
    const list = await t.run((ctx) => catalogueFor(ctx, a));
    expect(list.map((i) => [i.name, i.recipeCount])).toEqual([
      ["brambory", 0],
      ["cibule", 2],
      ["česnek", 0],
    ]);
  });

  test("needs a signed-in Member", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.ingredients.catalogue, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe("update", () => {
  test("renames, re-classes and marks Never Buy", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addIngredient(t, m, "Voda ");
    await t.run((ctx) =>
      updateFor(ctx, m, id, edit("  voda  z kohoutku ", { neverBuy: true, measureKind: "volume" })),
    );
    const doc = await t.run((ctx) => ctx.db.get("ingredients", id));
    expect(doc).toMatchObject({
      name: "voda z kohoutku",
      freshnessClass: "produce",
      storeSection: "produce",
      measureKind: "volume",
      neverBuy: true,
    });
    await t.run((ctx) => updateFor(ctx, m, id, edit("voda z kohoutku")));
    expect((await t.run((ctx) => ctx.db.get("ingredients", id)))?.neverBuy).toBe(false);
  });

  test("a name may change case, but not clash with another Ingredient", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const id = await addIngredient(t, m, "cibule");
    await addIngredient(t, m, "Česnek");
    await t.run((ctx) => updateFor(ctx, m, id, edit("Cibule")));
    await expect(t.run((ctx) => updateFor(ctx, m, id, edit(" česnek")))).rejects.toThrow(
      /INGREDIENT_NAME_TAKEN/,
    );
    await expect(t.run((ctx) => updateFor(ctx, m, id, edit("  ")))).rejects.toThrow(
      /INGREDIENT_NAME_REQUIRED/,
    );
    await expect(t.run((ctx) => updateFor(ctx, m, id, edit("x".repeat(101))))).rejects.toThrow(
      /INGREDIENT_NAME_TOO_LONG/,
    );
  });

  test("another Household's Ingredient is not found", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t);
    const b = await newMember(t, "b@example.com");
    const theirs = await addIngredient(t, b, "cibule");
    await expect(t.run((ctx) => updateFor(ctx, a, theirs, edit("x")))).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("merge", () => {
  test("moves every Ingredient Line to the survivor and removes the other", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const cibule = await addIngredient(t, m, "cibule");
    const dupe = await addIngredient(t, m, "cibule žlutá");
    const sul = await addIngredient(t, m, "sůl");
    const r1 = await addRecipe(t, m, [dupe, sul]);
    await addRecipe(t, m, [cibule, dupe]);
    await t.run((ctx) => mergeFor(ctx, m, { from: dupe, into: cibule }));
    await t.run(async (ctx) => {
      expect(await ctx.db.get("ingredients", dupe)).toBeNull();
      const lines = await ctx.db.query("ingredientLines").collect();
      expect(lines.filter((l) => l.ingredient === dupe)).toHaveLength(0);
      expect(lines.filter((l) => l.ingredient === cibule)).toHaveLength(3);
      const first = lines.filter((l) => l.recipe === r1).map((l) => l.ingredient);
      expect(first).toEqual([cibule, sul]);
    });
    const list = await t.run((ctx) => catalogueFor(ctx, m));
    expect(list.map((i) => [i.name, i.recipeCount])).toEqual([
      ["cibule", 2],
      ["sůl", 1],
    ]);
  });

  test("refuses merging into itself or across Households", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t);
    const b = await newMember(t, "b@example.com");
    const mine = await addIngredient(t, a, "cibule");
    const theirs = await addIngredient(t, b, "cibule");
    await expect(t.run((ctx) => mergeFor(ctx, a, { from: mine, into: mine }))).rejects.toThrow(
      /MERGE_SAME/,
    );
    await expect(t.run((ctx) => mergeFor(ctx, a, { from: theirs, into: mine }))).rejects.toThrow(
      /NOT_FOUND/,
    );
    await expect(t.run((ctx) => mergeFor(ctx, a, { from: mine, into: theirs }))).rejects.toThrow(
      /NOT_FOUND/,
    );
    expect(await t.run((ctx) => ctx.db.get("ingredients", theirs))).not.toBeNull();
  });
});

describe("Freshness days", () => {
  test("defaults until the Household overrides a class", () => {
    expect(freshnessDaysFor(undefined, "meat")).toBe(2);
    expect(freshnessDaysFor(undefined, "longLife")).toBeNull();
    expect(freshnessDaysFor({ meat: 3, longLife: 30 }, "meat")).toBe(3);
    expect(freshnessDaysFor({ produce: null }, "produce")).toBeNull();
    expect(freshnessTable(undefined).map((f) => f.days)).toEqual([1, 2, 5, 5, null]);
  });

  test("setFreshnessDays stores overrides and drops them when back at the default", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const days = async () =>
      (await t.run((ctx) => ctx.db.get("households", m.household)))?.freshnessDays;
    await t.run((ctx) => setFreshnessDaysFor(ctx, m.household, { freshnessClass: "meat", days: 3 }));
    await t.run((ctx) =>
      setFreshnessDaysFor(ctx, m.household, { freshnessClass: "longLife", days: 30 }),
    );
    expect(await days()).toEqual({ meat: 3, longLife: 30 });
    await t.run((ctx) => setFreshnessDaysFor(ctx, m.household, { freshnessClass: "meat", days: 2 }));
    await t.run((ctx) =>
      setFreshnessDaysFor(ctx, m.household, { freshnessClass: "longLife", days: null }),
    );
    expect(await days()).toBeUndefined();
    await t.run((ctx) =>
      setFreshnessDaysFor(ctx, m.household, { freshnessClass: "chilled", days: null }),
    );
    expect(await days()).toEqual({ chilled: null });
  });

  test("rejects days outside 1–60 or not whole", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    for (const bad of [0, 61, 1.5]) {
      await expect(
        t.run((ctx) => setFreshnessDaysFor(ctx, m.household, { freshnessClass: "meat", days: bad })),
      ).rejects.toThrow(/INVALID_DAYS/);
    }
  });
});
