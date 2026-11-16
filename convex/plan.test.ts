import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { memberOf, type Member } from "./lib/membership";
import {
  addFor,
  addLeftoverFor,
  rangeFor,
  removeFor,
  removeLeftoverFor,
  setLeftoverPortionsFor,
  setOccasionFor,
  setPortionsFor,
} from "./plan";

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

describe("Specials", () => {
  test("a day holds several Specials with their Occasion", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const cake = await addRecipe(t, m, { name: "Dort" });
    const date = "2026-11-21";
    await t.run((ctx) =>
      addFor(ctx, m, { date, slot: "special", recipeId: cake, occasion: "  Ondra – narozeniny " }),
    );
    await t.run((ctx) => addFor(ctx, m, { date, slot: "special", recipeId: cake, occasion: "" }));
    await t.run((ctx) => addFor(ctx, m, { date, slot: "lunch", recipeId: cake, occasion: "x" }));
    const { meals } = await range(t, m, date, date);
    const specials = meals.filter((x) => x.slot === "special");
    expect(specials.map((x) => [x.order, x.occasion])).toEqual([
      [0, "Ondra – narozeniny"],
      [1, undefined],
    ]);
    expect(meals.find((x) => x.slot === "lunch")?.occasion).toBeUndefined();
  });

  test("the Occasion can be edited, only on a Special", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const r = await addRecipe(t, m);
    const sp = await t.run((ctx) =>
      addFor(ctx, m, { date: "2026-11-21", slot: "special", recipeId: r }),
    );
    await t.run((ctx) => setOccasionFor(ctx, m, { mealId: sp, occasion: "Vánoce" }));
    expect((await t.run((ctx) => ctx.db.get("plannedMeals", sp)))?.occasion).toBe("Vánoce");
    await t.run((ctx) => setOccasionFor(ctx, m, { mealId: sp, occasion: " " }));
    expect((await t.run((ctx) => ctx.db.get("plannedMeals", sp)))?.occasion).toBeUndefined();
    await expect(
      t.run((ctx) => setOccasionFor(ctx, m, { mealId: sp, occasion: "x".repeat(81) })),
    ).rejects.toThrow(/INVALID_OCCASION/);
    const lunch = await t.run((ctx) =>
      addFor(ctx, m, { date: "2026-11-21", slot: "lunch", recipeId: r }),
    );
    await expect(
      t.run((ctx) => setOccasionFor(ctx, m, { mealId: lunch, occasion: "x" })),
    ).rejects.toThrow(/NOT_A_SPECIAL/);
  });
});

describe("Leftover Portions", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const m = await newMember(t, "a@example.com", 4);
    const recipeId = await addRecipe(t, m, { name: "Guláš" });
    const mealId = await t.run((ctx) =>
      addFor(ctx, m, { date: "2026-11-17", slot: "dinner", recipeId }),
    );
    return { t, m, recipeId, mealId };
  }

  test("covers a later slot with the Household default Portions", async () => {
    const { t, m, recipeId, mealId } = await setup();
    const id = await t.run((ctx) =>
      addLeftoverFor(ctx, m, { mealId, date: "2026-11-18", slot: "lunch" }),
    );
    const { leftovers } = await range(t, m, "2026-11-18", "2026-11-18");
    expect(leftovers).toEqual([
      {
        _id: id,
        date: "2026-11-18",
        slot: "lunch",
        order: 0,
        portions: 4,
        source: {
          _id: mealId,
          date: "2026-11-17",
          slot: "dinner",
          recipe: { _id: recipeId, name: "Guláš" },
        },
      },
    ]);
  });

  test("is idempotent per target slot", async () => {
    const { t, m, mealId } = await setup();
    const args = { mealId, date: "2026-11-19", slot: "dinner" as const };
    const a = await t.run((ctx) => addLeftoverFor(ctx, m, args));
    const b = await t.run((ctx) => addLeftoverFor(ctx, m, args));
    expect(b).toBe(a);
  });

  test("only a later Lunch/Dinner, never from a Special", async () => {
    const { t, m, recipeId, mealId } = await setup();
    for (const [date, slot] of [
      ["2026-11-17", "dinner"],
      ["2026-11-17", "lunch"],
      ["2026-11-16", "dinner"],
    ] as const) {
      await expect(
        t.run((ctx) => addLeftoverFor(ctx, m, { mealId, date, slot })),
      ).rejects.toThrow(/INVALID_LEFTOVER/);
    }
    const sp = await t.run((ctx) =>
      addFor(ctx, m, { date: "2026-11-17", slot: "special", recipeId }),
    );
    await expect(
      t.run((ctx) => addLeftoverFor(ctx, m, { mealId: sp, date: "2026-11-18", slot: "lunch" })),
    ).rejects.toThrow(/INVALID_LEFTOVER/);
  });

  test("shares the slot order with Planned Meals", async () => {
    const { t, m, recipeId, mealId } = await setup();
    const date = "2026-11-18";
    await t.run((ctx) => addFor(ctx, m, { date, slot: "lunch", recipeId }));
    await t.run((ctx) => addLeftoverFor(ctx, m, { mealId, date, slot: "lunch" }));
    await t.run((ctx) => addFor(ctx, m, { date, slot: "lunch", recipeId }));
    const { meals, leftovers } = await range(t, m, date, date);
    expect(meals.map((x) => x.order)).toEqual([0, 2]);
    expect(leftovers.map((x) => x.order)).toEqual([1]);
  });

  test("range includes a meal's leftovers past the range, and leftovers whose meal is before it", async () => {
    const { t, m, mealId } = await setup();
    await t.run((ctx) => addLeftoverFor(ctx, m, { mealId, date: "2026-11-20", slot: "lunch" }));
    const meal = await range(t, m, "2026-11-17", "2026-11-17");
    expect(meal.leftovers.map((l) => l.date)).toEqual(["2026-11-20"]);
    const later = await range(t, m, "2026-11-20", "2026-11-20");
    expect(later.meals).toEqual([]);
    expect(later.leftovers[0].source._id).toBe(mealId);
  });

  test("Portions change within limits; Zrušit removes it", async () => {
    const { t, m, mealId } = await setup();
    const leftoverId = await t.run((ctx) =>
      addLeftoverFor(ctx, m, { mealId, date: "2026-11-18", slot: "lunch" }),
    );
    await t.run((ctx) => setLeftoverPortionsFor(ctx, m, { leftoverId, portions: 2 }));
    expect((await t.run((ctx) => ctx.db.get("leftoverPortions", leftoverId)))?.portions).toBe(2);
    await expect(
      t.run((ctx) => setLeftoverPortionsFor(ctx, m, { leftoverId, portions: 0 })),
    ).rejects.toThrow(/INVALID_PORTIONS/);
    await t.run((ctx) => removeLeftoverFor(ctx, m, { leftoverId }));
    await t.run((ctx) => removeLeftoverFor(ctx, m, { leftoverId })); // already gone is fine
    expect((await range(t, m, "2026-11-17", "2026-11-18")).leftovers).toEqual([]);
  });

  test("removing the meal removes its Leftover Portions", async () => {
    const { t, m, mealId } = await setup();
    await t.run((ctx) => addLeftoverFor(ctx, m, { mealId, date: "2026-11-18", slot: "lunch" }));
    await t.run((ctx) => addLeftoverFor(ctx, m, { mealId, date: "2026-11-19", slot: "dinner" }));
    await t.run((ctx) => removeFor(ctx, m, { mealId }));
    const left = await t.run((ctx) => ctx.db.query("leftoverPortions").collect());
    expect(left).toEqual([]);
  });

  test("another Household's meal or leftover can't be touched", async () => {
    const { t, m, mealId } = await setup();
    const other = await newMember(t, "b@example.com");
    const leftoverId = await t.run((ctx) =>
      addLeftoverFor(ctx, m, { mealId, date: "2026-11-18", slot: "lunch" }),
    );
    await expect(
      t.run((ctx) => addLeftoverFor(ctx, other, { mealId, date: "2026-11-18", slot: "dinner" })),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      t.run((ctx) => setLeftoverPortionsFor(ctx, other, { leftoverId, portions: 2 })),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      t.run((ctx) => removeLeftoverFor(ctx, other, { leftoverId })),
    ).rejects.toThrow(/NOT_FOUND/);
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
