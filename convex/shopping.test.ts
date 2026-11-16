import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { memberOf, type Member } from "./lib/membership";
import type { MeasureKind } from "./lib/ingredients";
import { addFor, removeFor, setPortionsFor } from "./plan";
import { listFor, regenerateShopping, setCheckedFor } from "./shopping";

type T = ReturnType<typeof convexTest>;
const TODAY = "2026-11-16";

beforeEach(() => {
  vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", "a@example.com,b@example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function newMember(t: T, email = "a@example.com", portions = 4): Promise<Member> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, emailVerified: true });
    await createHouseholdFor(ctx, userId, portions);
    return await memberOf(ctx, userId);
  });
}

async function ingredient(
  t: T,
  m: Member,
  name: string,
  over: { measureKind?: MeasureKind; storeSection?: "produce" | "meatFish" | "pantry"; neverBuy?: boolean } = {},
): Promise<Id<"ingredients">> {
  return await t.run((ctx) =>
    ctx.db.insert("ingredients", {
      household: m.household,
      name,
      freshnessClass: "longLife",
      storeSection: over.storeSection ?? "pantry",
      measureKind: over.measureKind ?? "weight",
      plenty: false,
      neverBuy: over.neverBuy ?? false,
    }),
  );
}

async function recipe(
  t: T,
  m: Member,
  lines: { ingredient: Id<"ingredients">; amount?: number; unit?: string }[],
  baseServings?: number,
): Promise<Id<"recipes">> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("recipes", {
      household: m.household,
      name: "Guláš",
      category: "main",
      status: "confirmed",
      archived: false,
      baseServings,
      steps: [],
    });
    let order = 0;
    for (const l of lines) {
      await ctx.db.insert("ingredientLines", { recipe: id, order: order++, raw: "x", ...l });
    }
    return id;
  });
}

async function meal(
  t: T,
  m: Member,
  recipeId: Id<"recipes">,
  date: string,
  portions = 4,
  slot: "lunch" | "dinner" = "lunch",
): Promise<Id<"plannedMeals">> {
  return await t.run((ctx) =>
    ctx.db.insert("plannedMeals", { household: m.household, date, slot, order: 0, recipe: recipeId, portions }),
  );
}

const regen = (t: T, m: Member, today = TODAY) =>
  t.run((ctx) => regenerateShopping(ctx, m.household, today));
const list = (t: T, m: Member, today = TODAY) => t.run((ctx) => listFor(ctx, m, today));
const allItems = (t: T) => t.run((ctx) => ctx.db.query("shoppingItems").collect());

describe("regenerateShopping", () => {
  test("creates trips every 2 days up to the last meal and assigns each meal to the latest one before it", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const onion = await ingredient(t, m, "cibule", { measureKind: "count", storeSection: "produce" });
    const r = await recipe(t, m, [
      { ingredient: beef, amount: 600, unit: "g" },
      { ingredient: onion, amount: 2 },
    ], 4);
    const m1 = await meal(t, m, r, "2026-11-16");
    const m2 = await meal(t, m, r, "2026-11-17", 6);
    const m3 = await meal(t, m, r, "2026-11-19");
    await regen(t, m);

    const { trips } = await list(t, m);
    expect(trips.map((x) => [x.date, x.kind, x.status])).toEqual([
      ["2026-11-16", "store", "planned"],
      ["2026-11-18", "store", "planned"],
    ]);
    // Trip 1 serves meals on 16 and 17 (merged), trip 2 the meal on 19.
    const first = trips[0].items.map((i) => [i.label, i.amount, i.unit, i.storeSection]);
    expect(first).toEqual(
      expect.arrayContaining([
        ["hovězí", 1500, "g", "pantry"],
        ["cibule", 5, "ks", "produce"],
      ]),
    );
    expect(trips[0].items).toHaveLength(2);
    expect(trips[1].items.map((i) => [i.label, i.amount])).toEqual(
      expect.arrayContaining([
        ["hovězí", 600],
        ["cibule", 2],
      ]),
    );
    const beefItem = (await allItems(t)).find((i) => i.label === "hovězí" && i.amount === 1500)!;
    expect(new Set(beefItem.sourceMeals)).toEqual(new Set([m1, m2]));
    expect((await allItems(t)).find((i) => i.amount === 600)!.sourceMeals).toEqual([m3]);
  });

  test("never refills gaps and only extends beyond the last trip", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const salt = await ingredient(t, m, "sůl");
    const r = await recipe(t, m, [{ ingredient: salt }]);
    await meal(t, m, r, "2026-11-20");
    await regen(t, m);
    const before = (await list(t, m)).trips.map((x) => x.date);
    expect(before).toEqual(["2026-11-16", "2026-11-18", "2026-11-20"]);
    // Delete the middle trip: it stays deleted.
    await t.run(async (ctx) => {
      const trip = (await ctx.db.query("shoppingTrips").collect()).find((x) => x.date === "2026-11-18")!;
      await ctx.db.delete("shoppingTrips", trip._id);
    });
    await meal(t, m, r, "2026-11-23");
    await regen(t, m);
    expect((await list(t, m)).trips.map((x) => x.date)).toEqual(["2026-11-16", "2026-11-20", "2026-11-22"]);
    // A vague amount is listed without one.
    const [salty] = (await list(t, m)).trips[1].items;
    expect(salty.label).toBe("sůl");
    expect(salty.amount).toBeUndefined();
  });

  test("updates unchecked items when the plan changes and removes items no longer needed", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const flour = await ingredient(t, m, "mouka");
    const water = await ingredient(t, m, "voda", { measureKind: "volume", neverBuy: true });
    const r = await recipe(t, m, [
      { ingredient: flour, amount: 1, unit: "hrnek" },
      { ingredient: flour, amount: 500, unit: "g" },
      { ingredient: water, amount: 1, unit: "l" },
    ], 4);
    const id = await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    let items = await allItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "mouka", amount: 500, unit: "g", moreAmounts: [{ amount: 1, unit: "hrnek" }] });
    const itemId = items[0]._id;

    await t.run((ctx) => ctx.db.patch("plannedMeals", id, { portions: 8 }));
    await regen(t, m);
    items = await allItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ _id: itemId, amount: 1000, moreAmounts: [{ amount: 2, unit: "hrnek" }] });

    await t.run((ctx) => ctx.db.delete("plannedMeals", id));
    await regen(t, m);
    expect(await allItems(t)).toHaveLength(0);
  });

  test("checked items are kept and cover their meals; manual items are untouched", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const r = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }], 4);
    const id = await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    const [item] = await allItems(t);
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: item._id, checked: true }));
    await t.run((ctx) =>
      ctx.db.insert("shoppingItems", {
        household: m.household,
        trip: item.trip,
        label: "toaletní papír",
        checked: false,
        manual: true,
        sourceMeals: [],
        pinned: false,
      }),
    );
    await t.run((ctx) => ctx.db.patch("plannedMeals", id, { portions: 6 }));
    await regen(t, m);
    const items = await allItems(t);
    expect(items.map((i) => [i.label, i.amount, i.checked])).toEqual(
      expect.arrayContaining([
        ["hovězí", 500, true],
        ["toaletní papír", undefined, false],
      ]),
    );
    expect(items).toHaveLength(2);
  });

  test("is a no-op when nothing changed", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const r = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }]);
    await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    const before = await allItems(t);
    await regen(t, m);
    expect(await allItems(t)).toEqual(before);
  });

  test("respects the Household trip interval", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    await t.run((ctx) => ctx.db.patch("households", m.household, { tripIntervalDays: 3 }));
    const salt = await ingredient(t, m, "sůl");
    await meal(t, m, await recipe(t, m, [{ ingredient: salt }]), "2026-11-22");
    await regen(t, m);
    expect((await list(t, m)).trips.map((x) => x.date)).toEqual(["2026-11-16", "2026-11-19", "2026-11-22"]);
  });
});

describe("plan changes regenerate automatically", () => {
  test("add, portions and remove update the list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T09:00:00Z"));
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const r = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }], 4);
    const id = await t.run((ctx) => addFor(ctx, m, { date: "2026-11-18", slot: "dinner", recipeId: r }));
    expect((await allItems(t)).map((i) => i.amount)).toEqual([500]);
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId: id, portions: 6 }));
    expect((await allItems(t)).map((i) => i.amount)).toEqual([750]);
    await t.run((ctx) => removeFor(ctx, m, { mealId: id }));
    expect(await allItems(t)).toHaveLength(0);
  });
});

describe("listFor", () => {
  test("hides past trips with nothing left", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    await meal(t, m, await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }]), "2026-11-16");
    await regen(t, m);
    const [item] = await allItems(t);
    expect((await list(t, m, "2026-11-17")).trips).toHaveLength(1);
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: item._id, checked: true }));
    expect((await list(t, m, "2026-11-17")).trips).toHaveLength(0);
    expect((await list(t, m, "2026-11-16")).trips).toHaveLength(1);
  });
});

describe("setChecked", () => {
  test("sets rather than toggles, and ignores other Households' and deleted items", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const other = await newMember(t, "b@example.com");
    const beef = await ingredient(t, m, "hovězí");
    await meal(t, m, await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }]), "2026-11-17");
    await regen(t, m);
    const [item] = await allItems(t);
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: item._id, checked: true }));
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: item._id, checked: true }));
    expect((await allItems(t))[0].checked).toBe(true);
    await t.run((ctx) => setCheckedFor(ctx, other, { itemId: item._id, checked: false }));
    expect((await allItems(t))[0].checked).toBe(true);
    await t.run((ctx) => ctx.db.delete("shoppingItems", item._id));
    await expect(t.run((ctx) => setCheckedFor(ctx, m, { itemId: item._id, checked: false }))).resolves.toBeNull();
  });

  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.shopping.list, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});
