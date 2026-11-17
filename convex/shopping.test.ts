import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { memberOf, type Member } from "./lib/membership";
import type { FreshnessClass, MeasureKind } from "./lib/ingredients";
import {
  addFor,
  addLeftoverFor,
  removeFor,
  removeLeftoverFor,
  setLeftoverPortionsFor,
  setPortionsFor,
} from "./plan";
import { mergeFor, setPlentyFor } from "./ingredients";
import {
  addManualItemFor,
  addTripFor,
  deleteTripFor,
  itemFor,
  listFor,
  moveItemFor,
  moveTripFor,
  regenerateShopping,
  removeItemFor,
  setCheckedFor,
  setTripKindFor,
  setTripStatusFor,
} from "./shopping";
import { setTripIntervalFor } from "./households";
import { NOT_NEEDED } from "./lib/shopping";

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
  over: {
    measureKind?: MeasureKind;
    storeSection?: "produce" | "meatFish" | "pantry";
    neverBuy?: boolean;
    freshnessClass?: FreshnessClass;
    plenty?: boolean;
  } = {},
): Promise<Id<"ingredients">> {
  return await t.run((ctx) =>
    ctx.db.insert("ingredients", {
      household: m.household,
      name,
      freshnessClass: over.freshnessClass ?? "longLife",
      storeSection: over.storeSection ?? "pantry",
      measureKind: over.measureKind ?? "weight",
      plenty: over.plenty ?? false,
      neverBuy: over.neverBuy ?? false,
    }),
  );
}

async function recipe(
  t: T,
  m: Member,
  lines: { ingredient: Id<"ingredients">; amount?: number; unit?: string; optional?: boolean }[],
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
  slot: "lunch" | "dinner" | "special" = "lunch",
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
    expect(items.map((i) => [i.label, i.amount, i.checked, i.topUp ?? false])).toEqual(
      expect.arrayContaining([
        ["hovězí", 500, true, false],
        ["hovězí", 250, false, true],
        ["toaletní papír", undefined, false, false],
      ]),
    );
    expect(items).toHaveLength(3);
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

describe("frozen ticks, leftovers and Specials (#28)", () => {
  async function setup(t: T) {
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const r = await recipe(t, m, [{ ingredient: beef, amount: 1000, unit: "g" }], 4);
    return { m, beef, r };
  }
  const tick = async (t: T, m: Member, label: string) => {
    for (const i of await allItems(t)) {
      if (i.label === label && !i.checked) await t.run((ctx) => setCheckedFor(ctx, m, { itemId: i._id, checked: true }));
    }
  };
  const rows = async (t: T) =>
    (await allItems(t)).map((i) => ({ amount: i.amount, checked: i.checked, topUp: i.topUp ?? false, note: i.note }));

  test("a risen need adds a top-up for the difference with a green note; ticking it settles", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const id = await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    await tick(t, m, "hovězí");
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId: id, portions: 6 }));
    expect(await rows(t)).toEqual([
      { amount: 1000, checked: true, topUp: false, note: undefined },
      { amount: 500, checked: false, topUp: true, note: "navýšení: Guláš na 6 porcí" },
    ]);
    // More still: the unticked top-up grows instead of a second one.
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId: id, portions: 8 }));
    expect((await rows(t))[1]).toMatchObject({ amount: 1000, note: "navýšení: Guláš na 8 porcí" });
    // Ticked top-up and original together cover the meal.
    await tick(t, m, "hovězí");
    await regen(t, m);
    expect(await allItems(t)).toHaveLength(2);
    // Back to 6: the latest purchase says how much is extra.
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId: id, portions: 6 }));
    const after = await rows(t);
    expect(after).toHaveLength(2);
    expect(after[0].note).toBeUndefined();
    expect(after[1].note).toBe("už nepotřeba: 500 g");
  });

  test("a dropped need or a removed meal leaves the checked item with a red note", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const id = await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    await tick(t, m, "hovězí");
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId: id, portions: 2 }));
    expect(await rows(t)).toEqual([{ amount: 1000, checked: true, topUp: false, note: "už nepotřeba: 500 g" }]);
    await t.run((ctx) => setPortionsFor(ctx, m, { mealId: id, portions: 4 }));
    expect((await rows(t))[0].note).toBeUndefined();
    await t.run((ctx) => removeFor(ctx, m, { mealId: id }));
    expect(await rows(t)).toEqual([{ amount: 1000, checked: true, topUp: false, note: "už nepotřeba" }]);
  });

  test("an Ingredient removed from the Recipe makes its checked item not needed", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    await tick(t, m, "hovězí");
    await t.run(async (ctx) => {
      for (const l of await ctx.db.query("ingredientLines").collect()) await ctx.db.delete("ingredientLines", l._id);
    });
    await regen(t, m);
    expect((await rows(t))[0].note).toBe("už nepotřeba");
  });

  test("checked items bought for past meals are left alone", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const id = await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    await tick(t, m, "hovězí");
    await t.run((ctx) => ctx.db.patch("plannedMeals", id, { portions: 8 }));
    await regen(t, m, "2026-11-18");
    expect(await rows(t)).toEqual([{ amount: 1000, checked: true, topUp: false, note: undefined }]);
  });

  test("Leftover Portions add to the source meal's amount and regenerate on every change", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const id = await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    const lo = await t.run((ctx) => addLeftoverFor(ctx, m, { mealId: id, date: "2026-11-18", slot: "lunch" }));
    // Household default is 4 portions: cooked for 8, on the trip before the source meal.
    let items = await allItems(t);
    expect(items.map((i) => [i.amount, i.sourceMeals])).toEqual([[2000, [id]]]);
    await t.run((ctx) => setLeftoverPortionsFor(ctx, m, { leftoverId: lo, portions: 2 }));
    expect((await allItems(t))[0].amount).toBe(1500);
    await tick(t, m, "hovězí");
    await t.run((ctx) => setLeftoverPortionsFor(ctx, m, { leftoverId: lo, portions: 4 }));
    items = await allItems(t);
    expect(items.find((i) => i.topUp)).toMatchObject({ amount: 500, note: "navýšení: Guláš na 8 porcí" });
    await t.run((ctx) => removeLeftoverFor(ctx, m, { leftoverId: lo }));
    expect((await rows(t)).map((x) => x.note)).toEqual(["už nepotřeba: 500 g"]);
  });

  test("Specials are assigned like Lunch (not to a Rohlík trip that day)", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("shoppingTrips", { household: m.household, date: "2026-11-16", kind: "store", status: "planned" });
      await ctx.db.insert("shoppingTrips", { household: m.household, date: "2026-11-18", kind: "rohlik", status: "planned" });
    });
    await meal(t, m, r, "2026-11-18", 4, "special");
    await regen(t, m);
    const trips = await t.run((ctx) => ctx.db.query("shoppingTrips").collect());
    const [item] = await allItems(t);
    expect(trips.find((x) => x._id === item.trip)!.date).toBe("2026-11-16");
  });

  test("unchecked items on a past trip move on if their meal is ahead, and are dropped if not", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const onion = await ingredient(t, m, "cibule", { measureKind: "count" });
    const r2 = await recipe(t, m, [{ ingredient: onion, amount: 1 }], 4);
    await meal(t, m, r2, "2026-11-16");
    await meal(t, m, r, "2026-11-19");
    await regen(t, m, "2026-11-16");
    expect((await allItems(t)).map((i) => i.label).sort()).toEqual(["cibule", "hovězí"]);
    // Two days later, nothing bought: the onion's meal is past, the beef moves to the trip on 18.
    await regen(t, m, "2026-11-18");
    const items = await allItems(t);
    expect(items.map((i) => i.label)).toEqual(["hovězí"]);
    const trip = await t.run((ctx) => ctx.db.get("shoppingTrips", items[0].trip));
    expect(trip!.date).toBe("2026-11-18");
  });

  test("merging Ingredients carries checked items along", async () => {
    const t = convexTest(schema, modules);
    const { m, beef, r } = await setup(t);
    const beef2 = await ingredient(t, m, "hovězí maso");
    await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    await tick(t, m, "hovězí");
    await t.run((ctx) => mergeFor(ctx, m, { from: beef, into: beef2 }));
    const items = await allItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ingredient: beef2, checked: true });
    expect(items[0].note).toBeUndefined();
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

  test("a late tick (#13) applies to the item after regeneration moved it to another trip", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    await meal(t, m, await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }]), "2026-11-19");
    await regen(t, m);
    const [before] = await allItems(t);
    const trip = await t.run((ctx) => ctx.db.get("shoppingTrips", before.trip));
    // Meanwhile the other phone moves that trip past the meal: the item flows to an earlier trip.
    await t.run((ctx) => moveTripFor(ctx, m, { tripId: trip!._id, date: "2026-11-21" }, TODAY));
    const [after] = await allItems(t);
    expect(after._id).toBe(before._id);
    expect(after.trip).not.toBe(before.trip);
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: before._id, checked: true }));
    expect((await allItems(t))[0].checked).toBe(true);
  });

  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.shopping.list, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe("marks, warnings and the item sheet (#29)", () => {
  test("an item is 'volitelné' only when every line behind it is optional", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const parsley = await ingredient(t, m, "petržel", { measureKind: "count" });
    const lemon = await ingredient(t, m, "citron", { measureKind: "count" });
    const garnish = await recipe(t, m, [
      { ingredient: parsley, amount: 1, optional: true },
      { ingredient: lemon, amount: 1, optional: true },
    ]);
    const main = await recipe(t, m, [{ ingredient: lemon, amount: 2 }]);
    await meal(t, m, garnish, "2026-11-16");
    await meal(t, m, main, "2026-11-17");
    await regen(t, m);
    const items = (await list(t, m)).trips[0].items;
    expect(items.find((i) => i.label === "petržel")!.optional).toBe(true);
    expect(items.find((i) => i.label === "citron")).toMatchObject({ optional: false, amount: 3 });
  });

  test("warns when a trip is earlier than the Freshness Class allows; checked, Plenty and unlimited don't", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    await t.run((ctx) => ctx.db.patch("households", m.household, { tripIntervalDays: 4 }));
    const beef = await ingredient(t, m, "hovězí", { freshnessClass: "meat", storeSection: "meatFish" });
    const rice = await ingredient(t, m, "rýže");
    const r = await recipe(t, m, [
      { ingredient: beef, amount: 500, unit: "g" },
      { ingredient: rice, amount: 200, unit: "g" },
    ]);
    await meal(t, m, r, "2026-11-17");
    await meal(t, m, r, "2026-11-19");
    await regen(t, m);
    // One trip on 16 (next is 20): beef for the 19th is 3 days early, meat lasts 2.
    let [trip] = (await list(t, m)).trips;
    expect(trip.date).toBe("2026-11-16");
    expect(trip.items.find((i) => i.label === "hovězí")!.fresh).toEqual({ gap: 3, max: 2 });
    expect(trip.items.find((i) => i.label === "rýže")!.fresh).toBeNull();

    // The Household's own limit counts: meat without a limit → no warning.
    await t.run((ctx) => ctx.db.patch("households", m.household, { freshnessDays: { meat: null } }));
    [trip] = (await list(t, m)).trips;
    expect(trip.items.find((i) => i.label === "hovězí")!.fresh).toBeNull();
    await t.run((ctx) => ctx.db.patch("households", m.household, { freshnessDays: { meat: 3 } }));
    [trip] = (await list(t, m)).trips;
    expect(trip.items.find((i) => i.label === "hovězí")!.fresh).toBeNull();
    await t.run((ctx) => ctx.db.patch("households", m.household, { freshnessDays: undefined }));

    const beefItem = trip.items.find((i) => i.label === "hovězí")!;
    await t.run((ctx) => setPlentyFor(ctx, m, beef, true));
    [trip] = (await list(t, m)).trips;
    expect(trip.items.find((i) => i.label === "hovězí")).toMatchObject({ plenty: true, fresh: null });
    await t.run((ctx) => setPlentyFor(ctx, m, beef, false));
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: beefItem._id, checked: true }));
    [trip] = (await list(t, m)).trips;
    expect(trip.items.find((i) => i.label === "hovězí")!.fresh).toBeNull();
  });

  test("Plenty is a standing mark on the Ingredient: every trip shows it, 'Dochází' clears it", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const salt = await ingredient(t, m, "sůl", { plenty: true });
    const r = await recipe(t, m, [{ ingredient: salt, amount: 5, unit: "g" }]);
    await meal(t, m, r, "2026-11-16");
    await meal(t, m, r, "2026-11-18");
    await regen(t, m);
    let trips = (await list(t, m)).trips;
    expect(trips).toHaveLength(2);
    // Plenty items are still on the list (in the "Máme dost" box), on every trip.
    expect(trips.map((x) => x.items.map((i) => [i.label, i.plenty]))).toEqual([
      [["sůl", true]],
      [["sůl", true]],
    ]);
    await t.run((ctx) => setPlentyFor(ctx, m, salt, false));
    trips = (await list(t, m)).trips;
    expect(trips.flatMap((x) => x.items.map((i) => i.plenty))).toEqual([false, false]);
    expect((await t.run((ctx) => ctx.db.get("ingredients", salt)))!.plenty).toBe(false);
  });

  test("setPlenty refuses another Household's Ingredient", async () => {
    const t = convexTest(schema, modules);
    const a = await newMember(t, "a@example.com");
    const b = await newMember(t, "b@example.com");
    const salt = await ingredient(t, a, "sůl");
    await expect(t.run((ctx) => setPlentyFor(ctx, b, salt, true))).rejects.toThrow();
  });

  test("Never Buy Ingredients never appear", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const water = await ingredient(t, m, "voda", { measureKind: "volume", neverBuy: true });
    const r = await recipe(t, m, [{ ingredient: water, amount: 1, unit: "l" }]);
    await meal(t, m, r, "2026-11-16");
    await regen(t, m);
    expect((await list(t, m)).trips.flatMap((x) => x.items)).toEqual([]);
  });

  test("the item sheet lists the meals behind an item and its trip", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí", { freshnessClass: "meat", storeSection: "meatFish" });
    const r = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }], 4);
    await meal(t, m, r, "2026-11-17", 6, "dinner");
    await meal(t, m, r, "2026-11-16", 4, "lunch");
    await regen(t, m);
    const [i] = await allItems(t);
    const sheet = await t.run((ctx) => itemFor(ctx, m, i._id));
    expect(sheet).toMatchObject({
      label: "hovězí",
      amount: 1250,
      unit: "g",
      trip: { date: "2026-11-16", kind: "store" },
      ingredient: { name: "hovězí", storeSection: "meatFish", freshnessClass: "meat", freshnessDays: 2, plenty: false },
      notNeeded: false,
      fresh: null,
    });
    expect(sheet!.sources.map((s) => [s.recipeName, s.date, s.slot, s.portions])).toEqual([
      ["Guláš", "2026-11-16", "lunch", 4],
      ["Guláš", "2026-11-17", "dinner", 6],
    ]);
    // Leftovers cooked with a meal show beside it.
    const lunch = sheet!.sources[0]._id;
    await t.run((ctx) =>
      ctx.db.insert("leftoverPortions", {
        household: m.household,
        sourceMeal: lunch,
        date: "2026-11-17",
        slot: "lunch",
        order: 1,
        portions: 2,
      }),
    );
    const after = await t.run((ctx) => itemFor(ctx, m, i._id));
    expect(after!.sources.map((s) => s.leftoverPortions)).toEqual([2, 0]);
    // Not visible to another Household.
    const other = await newMember(t, "b@example.com");
    expect(await t.run((ctx) => itemFor(ctx, other, i._id))).toBeNull();
  });

  test("'Smazat' removes an 'už nepotřeba' item and nothing else", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const r = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }]);
    await meal(t, m, r, "2026-11-16");
    await regen(t, m);
    const [i] = await allItems(t);
    await expect(t.run((ctx) => removeItemFor(ctx, m, i._id))).rejects.toThrow(/ITEM_NOT_REMOVABLE/);
    // Only partly unneeded: it still covers a meal, so it stays.
    await t.run((ctx) => ctx.db.patch("shoppingItems", i._id, { checked: true, note: `${NOT_NEEDED}: 200 g` }));
    await expect(t.run((ctx) => removeItemFor(ctx, m, i._id))).rejects.toThrow(/ITEM_NOT_REMOVABLE/);

    await t.run((ctx) => ctx.db.patch("shoppingItems", i._id, { checked: true, note: NOT_NEEDED }));
    expect(await t.run((ctx) => itemFor(ctx, m, i._id))).toMatchObject({ notNeeded: true, note: NOT_NEEDED });
    const other = await newMember(t, "b@example.com");
    await expect(t.run((ctx) => removeItemFor(ctx, other, i._id))).rejects.toThrow();
    await t.run((ctx) => removeItemFor(ctx, m, i._id));
    expect(await allItems(t)).toHaveLength(0);
    // A second tap after it's gone is harmless.
    await t.run((ctx) => removeItemFor(ctx, m, i._id));
  });
});

describe("trip management (#30)", () => {
  const trips = (t: T) => t.run((ctx) => ctx.db.query("shoppingTrips").collect());
  const tripOn = async (t: T, date: string) => (await trips(t)).find((x) => x.date === date)!;

  async function setup(t: T) {
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const r = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }], 4);
    return { m, beef, r };
  }

  test("manual items go on open trips only and are never touched by regeneration", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    const trip = await tripOn(t, "2026-11-16");
    await expect(
      t.run((ctx) => addManualItemFor(ctx, m, { tripId: trip._id, label: "  " }, TODAY)),
    ).rejects.toThrow(/INVALID_LABEL/);
    const id = await t.run((ctx) =>
      addManualItemFor(ctx, m, { tripId: trip._id, label: "  toaletní   papír " }, TODAY),
    );
    await regen(t, m);
    const row = (await list(t, m)).trips[0].items.find((i) => i._id === id)!;
    expect(row).toMatchObject({ label: "toaletní papír", manual: true, storeSection: "other", plenty: false });
    // Another Household can't add to it.
    const other = await newMember(t, "b@example.com");
    await expect(
      t.run((ctx) => addManualItemFor(ctx, other, { tripId: trip._id, label: "x" }, TODAY)),
    ).rejects.toThrow(/NOT_FOUND/);
    // A done trip takes no new items.
    await t.run((ctx) => setTripStatusFor(ctx, m, { tripId: trip._id, status: "done" }, TODAY));
    await expect(
      t.run((ctx) => addManualItemFor(ctx, m, { tripId: trip._id, label: "jar" }, TODAY)),
    ).rejects.toThrow(/TRIP_DONE/);
    // "Smazat" removes a manual item, ticked or not.
    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: id, checked: true }));
    await t.run((ctx) => removeItemFor(ctx, m, id));
    expect((await allItems(t)).some((i) => i._id === id)).toBe(false);
  });

  test("a moved item is pinned, keeps updating its amount and survives regeneration", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const id = await meal(t, m, r, "2026-11-19");
    await regen(t, m);
    // Trips 16 and 18; the meal on 19 goes to 18.
    let [item] = await allItems(t);
    const t16 = await tripOn(t, "2026-11-16");
    const t18 = await tripOn(t, "2026-11-18");
    expect(item.trip).toBe(t18._id);

    await t.run((ctx) => moveItemFor(ctx, m, { itemId: item._id, tripId: t16._id }, TODAY));
    [item] = await allItems(t);
    expect(item).toMatchObject({ trip: t16._id, pinned: true, amount: 500 });

    await t.run((ctx) => ctx.db.patch("plannedMeals", id, { portions: 8 }));
    await regen(t, m);
    const items = await allItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ _id: item._id, trip: t16._id, pinned: true, amount: 1000 });
    expect((await list(t, m)).trips[0].items[0].pinned).toBe(true);
  });

  test("moving to a trip after the meal is refused; the sheet marks it 'až po jídle'", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-17", 4, "lunch");
    await meal(t, m, r, "2026-11-20");
    await regen(t, m);
    const t16 = await tripOn(t, "2026-11-16");
    const t18 = await tripOn(t, "2026-11-18");
    const item = (await allItems(t)).find((i) => i.trip === t16._id)!;
    await expect(
      t.run((ctx) => moveItemFor(ctx, m, { itemId: item._id, tripId: t18._id }, TODAY)),
    ).rejects.toThrow(/TRIP_AFTER_MEAL/);
    const sheet = await t.run((ctx) => itemFor(ctx, m, item._id, TODAY));
    expect(sheet!.targets.map((x) => [x.date, x.current, x.block])).toEqual([
      ["2026-11-16", true, null],
      ["2026-11-18", false, "afterMeal"],
      ["2026-11-20", false, "afterMeal"],
    ]);
  });

  test("a pinned item is unpinned and re-flowed when its trip no longer serves the meal", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-19");
    await regen(t, m);
    const t16 = await tripOn(t, "2026-11-16");
    const t18 = await tripOn(t, "2026-11-18");
    const [item] = await allItems(t);
    await t.run((ctx) => moveItemFor(ctx, m, { itemId: item._id, tripId: t16._id }, TODAY));
    // Move the pinned trip past the meal: the item flows back to the latest trip before it.
    await t.run((ctx) => moveTripFor(ctx, m, { tripId: t16._id, date: "2026-11-21" }, TODAY));
    const items = await allItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ trip: t18._id, pinned: false, amount: 500 });
  });

  test("a pinned item is re-flowed when its meal is gone", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    const a = await meal(t, m, r, "2026-11-19");
    await meal(t, m, r, "2026-11-21");
    await regen(t, m);
    const t16 = await tripOn(t, "2026-11-16");
    const item = (await allItems(t)).find((i) => i.sourceMeals.includes(a))!;
    await t.run((ctx) => moveItemFor(ctx, m, { itemId: item._id, tripId: t16._id }, TODAY));
    await t.run((ctx) => ctx.db.delete("plannedMeals", a));
    await regen(t, m);
    const items = await allItems(t);
    expect(items.every((i) => !i.pinned && i.trip !== t16._id)).toBe(true);
    expect(items).toHaveLength(1);
  });

  test("a Rohlík trip serves Dinner on its day but not Lunch", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-18", 4, "lunch");
    await meal(t, m, r, "2026-11-18", 4, "dinner");
    await regen(t, m);
    const t18 = await tripOn(t, "2026-11-18");
    await t.run((ctx) => setTripKindFor(ctx, m, { tripId: t18._id, kind: "rohlik" }, TODAY));
    const { trips: listed } = await list(t, m);
    expect(listed.map((x) => [x.date, x.kind, x.items.map((i) => i.amount)])).toEqual([
      ["2026-11-16", "store", [500]],
      ["2026-11-18", "rohlik", [500]],
    ]);
  });

  test("an added trip takes items; a second trip on a day gets only manual and moved ones", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-17");
    await regen(t, m);
    expect((await trips(t)).map((x) => x.date)).toEqual(["2026-11-16"]);
    await expect(
      t.run((ctx) => addTripFor(ctx, m, { date: "2026-11-15", kind: "store" }, TODAY)),
    ).rejects.toThrow(/DATE_PAST/);
    await expect(
      t.run((ctx) => addTripFor(ctx, m, { date: "2026-02-30", kind: "store" }, TODAY)),
    ).rejects.toThrow(/INVALID_DATE/);

    const t17 = await t.run((ctx) => addTripFor(ctx, m, { date: "2026-11-17", kind: "rohlik" }, TODAY));
    // Rohlík on 17 can't serve Lunch on 17: the item stays on 16.
    expect((await allItems(t)).map((i) => i.trip)).toEqual([(await tripOn(t, "2026-11-16"))._id]);
    await t.run((ctx) => setTripKindFor(ctx, m, { tripId: t17, kind: "store" }, TODAY));
    expect((await allItems(t)).map((i) => i.trip)).toEqual([t17]);

    const second = await t.run((ctx) => addTripFor(ctx, m, { date: "2026-11-17", kind: "store" }, TODAY));
    expect((await allItems(t)).map((i) => i.trip)).toEqual([t17]);
    const [item] = await allItems(t);
    await t.run((ctx) => moveItemFor(ctx, m, { itemId: item._id, tripId: second }, TODAY));
    await regen(t, m);
    expect(await allItems(t)).toMatchObject([{ trip: second, pinned: true }]);
  });

  test("a deleted trip stays deleted; moving and deleting need nothing ticked", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-16");
    await meal(t, m, r, "2026-11-18");
    await regen(t, m);
    const t16 = await tripOn(t, "2026-11-16");
    const t18 = await tripOn(t, "2026-11-18");
    await t.run((ctx) => addManualItemFor(ctx, m, { tripId: t18._id, label: "jar" }, TODAY));
    await t.run((ctx) => deleteTripFor(ctx, m, { tripId: t18._id }, TODAY));
    // The last trip isn't recreated; its meal falls back to the trip before.
    expect((await trips(t)).map((x) => x.date)).toEqual(["2026-11-16"]);
    const items = await allItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ trip: t16._id, amount: 1000 });

    await t.run((ctx) => setCheckedFor(ctx, m, { itemId: items[0]._id, checked: true }));
    await expect(
      t.run((ctx) => moveTripFor(ctx, m, { tripId: t16._id, date: "2026-11-17" }, TODAY)),
    ).rejects.toThrow(/TRIP_HAS_CHECKED/);
    await expect(t.run((ctx) => deleteTripFor(ctx, m, { tripId: t16._id }, TODAY))).rejects.toThrow(
      /TRIP_HAS_CHECKED/,
    );
    expect((await list(t, m)).trips[0].lock).toBe("checked");
    // A past trip can't be moved either.
    await expect(
      t.run((ctx) => moveTripFor(ctx, m, { tripId: t16._id, date: "2026-11-20" }, "2026-11-17")),
    ).rejects.toThrow(/TRIP_PAST/);
  });

  test("a done trip keeps its unticked items but takes no new ones", async () => {
    const t = convexTest(schema, modules);
    const m = await newMember(t);
    const beef = await ingredient(t, m, "hovězí");
    const onion = await ingredient(t, m, "cibule", { measureKind: "count" });
    const r1 = await recipe(t, m, [{ ingredient: beef, amount: 500, unit: "g" }], 4);
    const r2 = await recipe(t, m, [{ ingredient: onion, amount: 1 }], 4);
    const id = await meal(t, m, r1, "2026-11-19");
    await regen(t, m);
    const t18 = await tripOn(t, "2026-11-18");
    await t.run((ctx) => setTripStatusFor(ctx, m, { tripId: t18._id, status: "done" }, TODAY));
    // The unbought beef stays on the done trip and still follows the plan.
    await t.run((ctx) => ctx.db.patch("plannedMeals", id, { portions: 8 }));
    await meal(t, m, r2, "2026-11-19");
    await regen(t, m);
    const items = await allItems(t);
    expect(items.find((i) => i.label === "hovězí")).toMatchObject({ trip: t18._id, amount: 1000, pinned: false });
    // New onions go to the open trip before it.
    expect(items.find((i) => i.label === "cibule")!.trip).toBe((await tripOn(t, "2026-11-16"))._id);
    await expect(
      t.run((ctx) =>
        moveItemFor(ctx, m, { itemId: items.find((i) => i.label === "cibule")!._id, tripId: t18._id }, TODAY),
      ),
    ).rejects.toThrow(/TRIP_DONE/);
    // Reopened, it takes items again.
    await t.run((ctx) => setTripStatusFor(ctx, m, { tripId: t18._id, status: "planned" }, TODAY));
    expect((await allItems(t)).every((i) => i.trip === t18._id)).toBe(true);
  });

  test("changing the trip interval affects only trips created afterwards", async () => {
    const t = convexTest(schema, modules);
    const { m, r } = await setup(t);
    await meal(t, m, r, "2026-11-18");
    await regen(t, m);
    expect((await trips(t)).map((x) => x.date)).toEqual(["2026-11-16", "2026-11-18"]);
    await expect(t.run((ctx) => setTripIntervalFor(ctx, m.household, 0))).rejects.toThrow(/INVALID_DAYS/);
    await t.run((ctx) => setTripIntervalFor(ctx, m.household, 4));
    await meal(t, m, r, "2026-11-23");
    await regen(t, m);
    expect((await trips(t)).map((x) => x.date)).toEqual(["2026-11-16", "2026-11-18", "2026-11-22"]);
  });
});
