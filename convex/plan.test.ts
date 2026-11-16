import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { memberOf, type Member } from "./lib/membership";
import { addFor, rangeFor, removeFor, setPortionsFor } from "./plan";

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", "a@example.com,b@example.com");
});
afterEach(() => vi.unstubAllEnvs());

async function newMember(t: T, email = "a@example.com", portions = 3): Promise<Member> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, emailVerified: true });
    await createHouseholdFor(ctx, userId, portions);
    return await memberOf(ctx, userId);
  });
}

async function addRecipe(
  t: T,
  member: Member,
  over: { name?: string; status?: "draft" | "confirmed"; archived?: boolean } = {},
): Promise<Id<"recipes">> {
  return await t.run((ctx) =>
    ctx.db.insert("recipes", {
      household: member.household,
      name: over.name ?? "Guláš",
      category: "main",
      status: over.status ?? "confirmed",
      archived: over.archived ?? false,
      steps: [],
    }),
  );
}

const range = (t: T, m: Member, from: string, to: string) =>
  t.run((ctx) => rangeFor(ctx, m, { from, to }));

describe("addFor", () => {
  test("places a confirmed Recipe with the Household default Portions", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const recipeId = await addRecipe(t, m, { name: "Svíčková" });
    await t.run((ctx) => addFor(ctx, m, { date: "2026-11-17", slot: "lunch", recipeId }));
    const plan = await range(t, m, "2026-11-16", "2026-11-22");
    expect(plan.defaultPortions).toBe(3);
    expect(plan.meals).toHaveLength(1);
    expect(plan.meals[0]).toMatchObject({
      date: "2026-11-17",
      slot: "lunch",
      order: 0,
      portions: 3,
      recipe: { _id: recipeId, name: "Svíčková" },
    });
  });

  test("a slot holds several items, in order", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const a = await addRecipe(t, m, { name: "A" });
    const b = await addRecipe(t, m, { name: "B" });
    const day = { date: "2026-11-17" };
    await t.run((ctx) => addFor(ctx, m, { ...day, slot: "dinner", recipeId: a }));
    await t.run((ctx) => addFor(ctx, m, { ...day, slot: "lunch", recipeId: b }));
    await t.run((ctx) => addFor(ctx, m, { ...day, slot: "dinner", recipeId: b }));
    const { meals } = await range(t, m, "2026-11-17", "2026-11-17");
    const dinner = meals.filter((x) => x.slot === "dinner");
    expect(dinner.map((x) => [x.recipe.name, x.order])).toEqual([["A", 0], ["B", 1]]);
    expect(meals.find((x) => x.slot === "lunch")?.order).toBe(0);
  });

  test("draft and archived Recipes can't be newly planned", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    for (const over of [{ status: "draft" as const }, { archived: true }]) {
      const recipeId = await addRecipe(t, m, over);
      await expect(
        t.run((ctx) => addFor(ctx, m, { date: "2026-11-17", slot: "lunch", recipeId })),
      ).rejects.toThrow(/NOT_PLANNABLE/);
    }
  });

  test("an archived Recipe still backs meals planned earlier", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const recipeId = await addRecipe(t, m, { name: "Medovník" });
    await t.run((ctx) => addFor(ctx, m, { date: "2026-11-17", slot: "lunch", recipeId }));
    await t.run((ctx) => ctx.db.patch("recipes", recipeId, { archived: true }));
    const { meals } = await range(t, m, "2026-11-17", "2026-11-17");
    expect(meals[0].recipe.name).toBe("Medovník");
  });

  test("rejects a bad date", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const recipeId = await addRecipe(t, m);
    await expect(
      t.run((ctx) => addFor(ctx, m, { date: "2026-02-30", slot: "lunch", recipeId })),
    ).rejects.toThrow(/INVALID_DATE/);
  });

  test("another Household's Recipe can't be planned", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t, "a@example.com");
    const b = await newMember(t, "b@example.com");
    const recipeId = await addRecipe(t, b);
    await expect(
      t.run((ctx) => addFor(ctx, a, { date: "2026-11-17", slot: "lunch", recipeId })),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("rangeFor", () => {
  test("returns only the Household's meals within the range", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t, "a@example.com");
    const b = await newMember(t, "b@example.com");
    const ra = await addRecipe(t, a);
    const rb = await addRecipe(t, b);
    for (const date of ["2026-11-15", "2026-11-16", "2026-11-22", "2026-11-23"]) {
      await t.run((ctx) => addFor(ctx, a, { date, slot: "lunch", recipeId: ra }));
    }
    await t.run((ctx) => addFor(ctx, b, { date: "2026-11-18", slot: "lunch", recipeId: rb }));
    const { meals } = await range(t, a, "2026-11-16", "2026-11-22");
    expect(meals.map((x) => x.date)).toEqual(["2026-11-16", "2026-11-22"]);
  });

  test("rejects backwards or too long ranges", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    await expect(range(t, m, "2026-11-20", "2026-11-19")).rejects.toThrow(/INVALID_DATE/);
    await expect(range(t, m, "2026-01-01", "2026-12-31")).rejects.toThrow(/INVALID_DATE/);
  });
});

describe("setPortionsFor / removeFor", () => {
  test("changes Portions within limits", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const recipeId = await addRecipe(t, m);
    const mealId = await t.run((ctx) =>
      addFor(ctx, m, { date: "2026-11-17", slot: "lunch", recipeId }),
    );
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId, portions: 6 }));
    expect((await t.run((ctx) => ctx.db.get("plannedMeals", mealId)))?.portions).toBe(6);
    for (const portions of [0, 21, 2.5]) {
      await expect(
        t.run((ctx) => setPortionsFor(ctx, m, { mealId, portions })),
      ).rejects.toThrow(/INVALID_PORTIONS/);
    }
  });

  test("removes a Planned Meal", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const recipeId = await addRecipe(t, m);
    const mealId = await t.run((ctx) =>
      addFor(ctx, m, { date: "2026-11-17", slot: "lunch", recipeId }),
    );
    await t.run((ctx) => removeFor(ctx, m, { mealId }));
    expect((await range(t, m, "2026-11-17", "2026-11-17")).meals).toEqual([]);
  });

  test("another Household's meal can't be changed or removed", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t, "a@example.com");
    const b = await newMember(t, "b@example.com");
    const recipeId = await addRecipe(t, b);
    const mealId = await t.run((ctx) =>
      addFor(ctx, b, { date: "2026-11-17", slot: "lunch", recipeId }),
    );
    await expect(
      t.run((ctx) => setPortionsFor(ctx, a, { mealId, portions: 2 })),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(t.run((ctx) => removeFor(ctx, a, { mealId }))).rejects.toThrow(/NOT_FOUND/);
  });
});

test("public functions require sign-in", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(api.plan.range, { from: "2026-11-16", to: "2026-11-22" }),
  ).rejects.toThrow(/UNAUTHENTICATED/);
});

test("a test user's new Household gets sample Recipes only in test mode", async () => {
  const t = convexTest(schema, modules);
  const count = (household: Id<"households">) =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("recipes")
          .withIndex("by_household_status", (q) =>
            q.eq("household", household).eq("status", "confirmed"),
          )
          .collect()
      ).length,
    );
  const real = await newMember(t, "a@example.com");
  expect(await count(real.household)).toBe(0);
  await t.run((ctx) => ctx.db.insert("testMode", { enabled: true }));
  const tester = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { emailVerified: false, testUser: true });
    return await createHouseholdFor(ctx, userId, 2);
  });
  expect(await count(tester)).toBeGreaterThan(3);
});
