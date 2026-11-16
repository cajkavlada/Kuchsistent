import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { today as pragueToday, type CalendarDay } from "./lib/dates";
import type { StoreSection } from "./lib/ingredients";
import { requireMember, type Member } from "./lib/membership";
import {
  DEFAULT_TRIP_INTERVAL_DAYS,
  newTripDates,
  scaleFactor,
  totalOf,
  tripFor,
  type Need,
  type Part,
} from "./lib/shopping";

/**
 * The shopping list (#27; decisions #5, #6, #7, #10, #13): Shopping Trips and
 * their Shopping Items, regenerated from the Planned Meals whenever the plan
 * changes. Frozen-tick deltas, Leftover Portions and Specials come in #28.
 */

// ---------- regeneration ----------

type Desired = {
  trip: Id<"shoppingTrips">;
  ingredient: Id<"ingredients">;
  label: string;
  parts: Part[];
  sourceMeals: Id<"plannedMeals">[];
};

const itemKey = (trip: Id<"shoppingTrips">, ingredient: Id<"ingredients"> | undefined) =>
  `${trip}|${ingredient ?? ""}`;

/**
 * Recalculates the Household's list from every Planned Meal from `today` on:
 * creates the missing default trips, then rewrites the unchecked generated
 * items to match. Checked, pinned and manual items are left alone; a checked
 * item covers its source meals' need for its Ingredient.
 */
export async function regenerateShopping(
  ctx: MutationCtx,
  household: Id<"households">,
  today: CalendarDay = pragueToday(),
): Promise<void> {
  const doc = await ctx.db.get("households", household);
  if (doc === null) return;
  const interval = doc.tripIntervalDays ?? DEFAULT_TRIP_INTERVAL_DAYS;

  const meals = await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_date", (q) => q.eq("household", household).gte("date", today))
    .collect();

  // Index order: date, then creation time, so the first trip of a day comes first.
  const trips = await ctx.db
    .query("shoppingTrips")
    .withIndex("by_household_date", (q) => q.eq("household", household))
    .collect();
  const lastMeal = meals.length ? meals[meals.length - 1].date : undefined;
  for (const date of newTripDates(trips.map((t) => t.date), lastMeal, today, interval)) {
    const id = await ctx.db.insert("shoppingTrips", { household, date, kind: "store", status: "planned" });
    trips.push((await ctx.db.get("shoppingTrips", id))!);
  }

  const items = await ctx.db
    .query("shoppingItems")
    .withIndex("by_household", (q) => q.eq("household", household))
    .collect();
  const covered = new Set<string>();
  for (const i of items) {
    if (!i.checked || i.manual || !i.ingredient) continue;
    for (const m of i.sourceMeals) covered.add(`${m}|${i.ingredient}`);
  }

  const recipes = new Map<Id<"recipes">, Doc<"recipes"> | null>();
  const lines = new Map<Id<"recipes">, Doc<"ingredientLines">[]>();
  const ingredients = new Map<Id<"ingredients">, Doc<"ingredients"> | null>();
  const needs = new Map<string, { trip: Id<"shoppingTrips">; ingredient: Doc<"ingredients">; needs: Need[]; meals: Set<Id<"plannedMeals">> }>();

  for (const meal of meals) {
    const trip = tripFor(trips, meal, today);
    if (!trip) continue;
    if (!recipes.has(meal.recipe)) {
      recipes.set(meal.recipe, await ctx.db.get("recipes", meal.recipe));
      lines.set(
        meal.recipe,
        await ctx.db
          .query("ingredientLines")
          .withIndex("by_recipe", (q) => q.eq("recipe", meal.recipe))
          .collect(),
      );
    }
    const recipe = recipes.get(meal.recipe);
    if (!recipe) continue;
    const scale = scaleFactor(meal.portions, recipe.baseServings);
    for (const line of lines.get(meal.recipe)!) {
      if (!line.ingredient) continue;
      if (!ingredients.has(line.ingredient)) {
        ingredients.set(line.ingredient, await ctx.db.get("ingredients", line.ingredient));
      }
      const ingredient = ingredients.get(line.ingredient);
      if (!ingredient || ingredient.household !== household || ingredient.neverBuy) continue;
      if (covered.has(`${meal._id}|${ingredient._id}`)) continue;
      const key = itemKey(trip._id, ingredient._id);
      const entry = needs.get(key) ?? { trip: trip._id, ingredient, needs: [], meals: new Set() };
      entry.needs.push({ amount: line.amount, unit: line.unit, scale });
      entry.meals.add(meal._id);
      needs.set(key, entry);
    }
  }

  const desired = new Map<string, Desired>();
  for (const [key, e] of needs) {
    desired.set(key, {
      trip: e.trip,
      ingredient: e.ingredient._id,
      label: e.ingredient.name,
      parts: totalOf(e.ingredient.measureKind, e.needs),
      sourceMeals: [...e.meals],
    });
  }

  for (const item of items) {
    if (item.manual || item.checked || item.pinned) continue;
    const key = itemKey(item.trip, item.ingredient);
    const want = desired.get(key);
    if (!want) {
      await ctx.db.delete("shoppingItems", item._id);
      continue;
    }
    desired.delete(key);
    const fields = itemFields(want);
    if (!sameFields(item, fields)) await ctx.db.patch("shoppingItems", item._id, fields);
  }
  for (const want of desired.values()) {
    await ctx.db.insert("shoppingItems", {
      household,
      trip: want.trip,
      ingredient: want.ingredient,
      ...itemFields(want),
      checked: false,
      manual: false,
      pinned: false,
    });
  }
}

function itemFields(d: Desired) {
  const [first, ...more] = d.parts;
  return {
    label: d.label,
    amount: first?.amount,
    unit: first?.unit,
    moreAmounts: more.length ? more : undefined,
    sourceMeals: d.sourceMeals,
  };
}

function sameFields(item: Doc<"shoppingItems">, f: ReturnType<typeof itemFields>): boolean {
  return (
    item.label === f.label &&
    item.amount === f.amount &&
    item.unit === f.unit &&
    JSON.stringify(item.moreAmounts ?? null) === JSON.stringify(f.moreAmounts ?? null) &&
    JSON.stringify(item.sourceMeals) === JSON.stringify(f.sourceMeals)
  );
}

/**
 * Opening Nákup brings the list up to date (e.g. after midnight); a no-op
 * when nothing changed.
 */
export const refresh = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { household } = await requireMember(ctx);
    await regenerateShopping(ctx, household);
    return null;
  },
});

// ---------- reading ----------

/** Nákup: trips from today on (and older ones with something left), each with its items. */
export const list = query({
  args: {},
  handler: async (ctx) => listFor(ctx, await requireMember(ctx)),
});

export async function listFor(ctx: QueryCtx, member: Member, today: CalendarDay = pragueToday()) {
  const trips = await ctx.db
    .query("shoppingTrips")
    .withIndex("by_household_date", (q) => q.eq("household", member.household))
    .collect();
  const sections = new Map<Id<"ingredients">, StoreSection>();
  const result = [];
  for (const trip of trips) {
    const rows = await ctx.db
      .query("shoppingItems")
      .withIndex("by_trip", (q) => q.eq("trip", trip._id))
      .collect();
    if (trip.date < today && rows.every((i) => i.checked)) continue;
    const items = [];
    for (const i of rows) {
      let storeSection: StoreSection = "other";
      if (i.ingredient) {
        if (!sections.has(i.ingredient)) {
          const ing = await ctx.db.get("ingredients", i.ingredient);
          sections.set(i.ingredient, ing?.storeSection ?? "other");
        }
        storeSection = sections.get(i.ingredient)!;
      }
      items.push({
        _id: i._id,
        label: i.label,
        amount: i.amount,
        unit: i.unit,
        moreAmounts: i.moreAmounts,
        checked: i.checked,
        manual: i.manual,
        storeSection,
      });
    }
    result.push({ _id: trip._id, date: trip.date, kind: trip.kind, status: trip.status, items });
  }
  return { today, trips: result };
}

// ---------- ticking ----------

/**
 * Ticks or unticks an item. Sets the state rather than toggling, so a resent
 * tick is harmless (#13); a tick for an item that's gone is dropped.
 */
export const setChecked = mutation({
  args: { itemId: v.id("shoppingItems"), checked: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => setCheckedFor(ctx, await requireMember(ctx), args),
});

export async function setCheckedFor(
  ctx: MutationCtx,
  member: Member,
  { itemId, checked }: { itemId: Id<"shoppingItems">; checked: boolean },
): Promise<null> {
  const item = await ctx.db.get("shoppingItems", itemId);
  if (item === null || item.household !== member.household) return null;
  if (item.checked !== checked) await ctx.db.patch("shoppingItems", itemId, { checked });
  return null;
}
