import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { today as pragueToday, type CalendarDay } from "./lib/dates";
import { freshnessDaysFor, type FreshnessClass, type StoreSection } from "./lib/ingredients";
import { assertSameHousehold, requireMember, type Member } from "./lib/membership";
import {
  DEFAULT_TRIP_INTERVAL_DAYS,
  diffParts,
  formatParts,
  freshnessWarning,
  NOT_NEEDED,
  newTripDates,
  portionsPhrase,
  sumParts,
  TOP_UP,
  scaleFactor,
  totalOf,
  tripFor,
  type Need,
  type Part,
} from "./lib/shopping";

/**
 * The shopping list (#27, #28; decisions #5, #6, #7, #10, #13): Shopping Trips
 * and their Shopping Items, regenerated from the Planned Meals (with their
 * Leftover Portions) whenever anything they depend on changes. Plenty,
 * Optional Lines, freshness warnings and the item sheet are #29.
 */

// ---------- regeneration ----------

type Desired = {
  trip: Id<"shoppingTrips">;
  ingredient: Id<"ingredients">;
  label: string;
  parts: Part[];
  sourceMeals: Id<"plannedMeals">[];
  topUp: boolean;
  note?: string;
  optional: boolean;
};

/** `optional`: every line of the meal's Recipe for this Ingredient is an Optional Line. */
type MealNeed = { ingredient: Doc<"ingredients">; needs: Need[]; optional: boolean };

const itemKey = (
  trip: Id<"shoppingTrips">,
  ingredient: Id<"ingredients"> | undefined,
  topUp: boolean | undefined,
) => `${trip}|${ingredient ?? ""}|${topUp ? "+" : ""}`;

const partsOf = (i: Doc<"shoppingItems">): Part[] =>
  i.amount !== undefined && i.unit !== undefined
    ? [{ amount: i.amount, unit: i.unit }, ...(i.moreAmounts ?? [])]
    : [];

/**
 * Recalculates the Household's list from every Planned Meal from `today` on
 * (#7, #28): creates the missing default trips, then rewrites the unchecked
 * generated items to match.
 *
 * - A meal needs its Recipe scaled to its Portions plus its Leftover Portions.
 * - Checked items are frozen and cover their source meals' need for their
 *   Ingredient. When that need rises, a top-up item is added for the
 *   difference; when it drops, the checked item gets an "už nepotřeba" note.
 * - Unchecked items on past trips move to the meal's trip or are dropped.
 * - Manual and pinned items are never touched.
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
  const ahead = new Map(meals.map((m) => [m._id, m]));

  // A Leftover Portion is always later than its meal, so these are all of them.
  const leftovers = new Map<Id<"plannedMeals">, number>();
  for (const l of await ctx.db
    .query("leftoverPortions")
    .withIndex("by_household_date", (q) => q.eq("household", household).gte("date", today))
    .collect()) {
    leftovers.set(l.sourceMeal, (leftovers.get(l.sourceMeal) ?? 0) + l.portions);
  }
  const cookPortions = async (meal: Doc<"plannedMeals">) => {
    if (meal.date >= today) return meal.portions + (leftovers.get(meal._id) ?? 0);
    const own = await ctx.db
      .query("leftoverPortions")
      .withIndex("by_source", (q) => q.eq("sourceMeal", meal._id))
      .collect();
    return meal.portions + own.reduce((s, l) => s + l.portions, 0);
  };

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
  // With no open trip from today on before the meal (e.g. a meal today right
  // after yesterday's trip), its items stay on the latest earlier one.
  const tripOf = (meal: Doc<"plannedMeals">) => tripFor(trips, meal, today) ?? tripFor(trips, meal, "");

  const recipes = new Map<Id<"recipes">, Doc<"recipes"> | null>();
  const lines = new Map<Id<"recipes">, Doc<"ingredientLines">[]>();
  const ingredients = new Map<Id<"ingredients">, Doc<"ingredients"> | null>();
  const mealNeeds = new Map<Id<"plannedMeals">, Map<Id<"ingredients">, MealNeed>>();
  const needsOf = async (meal: Doc<"plannedMeals">) => {
    const cached = mealNeeds.get(meal._id);
    if (cached) return cached;
    const out = new Map<Id<"ingredients">, MealNeed>();
    mealNeeds.set(meal._id, out);
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
    if (!recipe) return out;
    const scale = scaleFactor(await cookPortions(meal), recipe.baseServings);
    for (const line of lines.get(meal.recipe)!) {
      if (!line.ingredient) continue;
      if (!ingredients.has(line.ingredient)) {
        ingredients.set(line.ingredient, await ctx.db.get("ingredients", line.ingredient));
      }
      const ingredient = ingredients.get(line.ingredient);
      if (!ingredient || ingredient.household !== household || ingredient.neverBuy) continue;
      const e = out.get(ingredient._id) ?? { ingredient, needs: [], optional: true };
      e.needs.push({ amount: line.amount, unit: line.unit, scale });
      e.optional &&= line.optional === true;
      out.set(ingredient._id, e);
    }
    return out;
  };

  const items = await ctx.db
    .query("shoppingItems")
    .withIndex("by_household", (q) => q.eq("household", household))
    .collect();
  const desired = new Map<string, Desired>();
  const topUpWhy = new Map<string, Set<string>>();

  // Frozen ticks: checked items of one Ingredient that share a source meal
  // together cover all their meals (e.g. the original and its top-up).
  const covered = new Set<string>();
  for (const group of coverageGroups(items)) {
    const ing = group.ingredient;
    for (const m of group.meals) covered.add(`${m}|${ing}`);
    const existing: Doc<"plannedMeals">[] = [];
    for (const id of group.meals) {
      const meal = ahead.get(id) ?? (await ctx.db.get("plannedMeals", id));
      if (meal) existing.push(meal);
    }
    const live = existing.filter((m) => m.date >= today);
    // Bought for meals that are all behind us: history, leave it be.
    if (live.length === 0 && existing.length > 0) continue;

    const needs: Need[] = [];
    let needed = false;
    let ingredient: Doc<"ingredients"> | undefined;
    for (const meal of existing) {
      const e = (await needsOf(meal)).get(ing);
      if (!e) continue;
      needed = true;
      ingredient = e.ingredient;
      needs.push(...e.needs);
    }
    if (!needed || !ingredient || live.length === 0) {
      await setNotNeeded(ctx, group.items, group.items, NOT_NEEDED);
      continue;
    }
    const have = sumParts(group.items.flatMap(partsOf));
    const { more, less } = diffParts(totalOf(ingredient.measureKind, needs), have);
    // A partial drop is told on the latest purchase only.
    const latest = group.items.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
    await setNotNeeded(ctx, group.items, [latest], less.length ? `${NOT_NEEDED}: ${formatParts(less)}` : undefined);
    if (more.length === 0) continue;

    const first = live.reduce((a, b) => (b.date < a.date ? b : a));
    const trip = tripOf(first);
    if (!trip) continue;
    const key = itemKey(trip._id, ing, true);
    const d = desired.get(key) ?? {
      trip: trip._id,
      ingredient: ing,
      label: ingredient.name,
      parts: [],
      sourceMeals: [],
      topUp: true,
      optional: false,
    };
    d.parts = sumParts([...d.parts, ...more]);
    d.sourceMeals = [...new Set([...d.sourceMeals, ...live.map((m) => m._id)])];
    const why = topUpWhy.get(key) ?? new Set();
    for (const meal of live) {
      const name = recipes.get(meal.recipe)?.name;
      if (name) why.add(`${name} na ${portionsPhrase(await cookPortions(meal))}`);
    }
    topUpWhy.set(key, why);
    d.note = `${TOP_UP}: ${[...why].join(", ")}`;
    desired.set(key, d);
  }

  // Everything not covered by a tick goes to its meal's trip.
  const needs = new Map<
    string,
    {
      trip: Id<"shoppingTrips">;
      ingredient: Doc<"ingredients">;
      needs: Need[];
      meals: Set<Id<"plannedMeals">>;
      optional: boolean;
    }
  >();
  for (const meal of meals) {
    const trip = tripOf(meal);
    if (!trip) continue;
    for (const [ing, e] of await needsOf(meal)) {
      if (covered.has(`${meal._id}|${ing}`)) continue;
      const key = itemKey(trip._id, ing, false);
      const entry = needs.get(key) ?? {
        trip: trip._id,
        ingredient: e.ingredient,
        needs: [],
        meals: new Set(),
        optional: true,
      };
      entry.needs.push(...e.needs);
      entry.meals.add(meal._id);
      // "volitelné" only while every line behind the item is optional.
      entry.optional &&= e.optional;
      needs.set(key, entry);
    }
  }
  for (const [key, e] of needs) {
    desired.set(key, {
      trip: e.trip,
      ingredient: e.ingredient._id,
      label: e.ingredient.name,
      parts: totalOf(e.ingredient.measureKind, e.needs),
      sourceMeals: [...e.meals],
      topUp: false,
      optional: e.optional,
    });
  }

  for (const item of items) {
    if (item.manual || item.checked || item.pinned) continue;
    const key = itemKey(item.trip, item.ingredient, item.topUp);
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

/**
 * Checked generated items grouped per Ingredient so that items sharing a
 * source meal end up together, with all the meals they cover.
 */
function coverageGroups(items: Doc<"shoppingItems">[]) {
  const frozen = items.filter((i) => i.checked && !i.manual && i.ingredient !== undefined);
  const parent = frozen.map((_, n) => n);
  const find = (n: number): number => (parent[n] === n ? n : (parent[n] = find(parent[n])));
  const byMeal = new Map<string, number>();
  frozen.forEach((i, n) => {
    for (const m of i.sourceMeals) {
      const key = `${m}|${i.ingredient}`;
      const other = byMeal.get(key);
      if (other === undefined) byMeal.set(key, n);
      else parent[find(n)] = find(other);
    }
  });
  const groups = new Map<number, { ingredient: Id<"ingredients">; items: Doc<"shoppingItems">[]; meals: Set<Id<"plannedMeals">> }>();
  frozen.forEach((i, n) => {
    const root = find(n);
    const g = groups.get(root) ?? { ingredient: i.ingredient!, items: [], meals: new Set() };
    g.items.push(i);
    for (const m of i.sourceMeals) g.meals.add(m);
    groups.set(root, g);
  });
  // Items without source meals (none today) cover nothing and get no note.
  return [...groups.values()].filter((g) => g.meals.size > 0);
}

/**
 * Puts `note` (an "už nepotřeba" note, or none) on `target` and clears an
 * older "už nepotřeba" note from the rest of the group. Other notes (a
 * ticked top-up's "navýšení") stay unless replaced.
 */
async function setNotNeeded(
  ctx: MutationCtx,
  group: Doc<"shoppingItems">[],
  target: Doc<"shoppingItems">[],
  note: string | undefined,
) {
  for (const i of group) {
    const want = target.includes(i) ? note : undefined;
    if (want === undefined && !i.note?.startsWith(NOT_NEEDED)) continue;
    if (i.note !== want) await ctx.db.patch("shoppingItems", i._id, { note: want });
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
    note: d.note,
    topUp: d.topUp || undefined,
    optional: d.optional || undefined,
  };
}

function sameFields(item: Doc<"shoppingItems">, f: ReturnType<typeof itemFields>): boolean {
  return (
    item.label === f.label &&
    item.amount === f.amount &&
    item.unit === f.unit &&
    item.note === f.note &&
    JSON.stringify(item.moreAmounts ?? null) === JSON.stringify(f.moreAmounts ?? null) &&
    JSON.stringify(item.sourceMeals) === JSON.stringify(f.sourceMeals) &&
    (item.optional ?? undefined) === f.optional
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

/**
 * Nákup: trips from today on (and older ones with something left), each with
 * its items, their marks (Plenty, volitelné, notes) and freshness warnings (#29).
 */
export const list = query({
  args: {},
  handler: async (ctx) => listFor(ctx, await requireMember(ctx)),
});

export async function listFor(ctx: QueryCtx, member: Member, today: CalendarDay = pragueToday()) {
  const household = await ctx.db.get("households", member.household);
  const trips = await ctx.db
    .query("shoppingTrips")
    .withIndex("by_household_date", (q) => q.eq("household", member.household))
    .collect();
  const cache = lookups(ctx);
  const result = [];
  for (const trip of trips) {
    const rows = await ctx.db
      .query("shoppingItems")
      .withIndex("by_trip", (q) => q.eq("trip", trip._id))
      .collect();
    if (trip.date < today && rows.every((i) => i.checked)) continue;
    const items = [];
    for (const i of rows) {
      const ing = i.ingredient ? await cache.ingredient(i.ingredient) : null;
      const plenty = !i.manual && ing?.plenty === true;
      items.push({
        _id: i._id,
        ingredient: i.ingredient,
        label: i.label,
        amount: i.amount,
        unit: i.unit,
        moreAmounts: i.moreAmounts,
        checked: i.checked,
        manual: i.manual,
        note: i.note,
        topUp: i.topUp ?? false,
        storeSection: (ing?.storeSection ?? "other") as StoreSection,
        plenty,
        optional: i.optional === true,
        fresh:
          i.checked || plenty || !ing
            ? null
            : await warningFor(cache, household?.freshnessDays, ing.freshnessClass, trip.date, i.sourceMeals),
      });
    }
    result.push({ _id: trip._id, date: trip.date, kind: trip.kind, status: trip.status, items });
  }
  return { today, trips: result };
}

/** Per-request caches of Ingredients and Planned Meals. */
function lookups(ctx: QueryCtx) {
  const ingredients = new Map<Id<"ingredients">, Doc<"ingredients"> | null>();
  const meals = new Map<Id<"plannedMeals">, Doc<"plannedMeals"> | null>();
  return {
    async ingredient(id: Id<"ingredients">) {
      if (!ingredients.has(id)) ingredients.set(id, await ctx.db.get("ingredients", id));
      return ingredients.get(id)!;
    },
    async meal(id: Id<"plannedMeals">) {
      if (!meals.has(id)) meals.set(id, await ctx.db.get("plannedMeals", id));
      return meals.get(id)!;
    },
  };
}

async function warningFor(
  cache: ReturnType<typeof lookups>,
  overrides: Doc<"households">["freshnessDays"],
  freshnessClass: FreshnessClass,
  tripDate: CalendarDay,
  sourceMeals: Id<"plannedMeals">[],
) {
  const dates: CalendarDay[] = [];
  for (const id of sourceMeals) {
    const meal = await cache.meal(id);
    if (meal) dates.push(meal.date);
  }
  return freshnessWarning(tripDate, dates, freshnessDaysFor(overrides, freshnessClass));
}

/**
 * The item sheet (#10, #29): what, where and when to buy, why ("Proč to
 * kupuju": the Planned Meals behind it), its freshness warning, notes and
 * marks. Null once the item is gone (e.g. regenerated away while open).
 */
export const item = query({
  args: { itemId: v.id("shoppingItems") },
  handler: async (ctx, { itemId }) => itemFor(ctx, await requireMember(ctx), itemId),
});

export async function itemFor(ctx: QueryCtx, member: Member, itemId: Id<"shoppingItems">) {
  const i = await ctx.db.get("shoppingItems", itemId);
  if (i === null || i.household !== member.household) return null;
  const trip = await ctx.db.get("shoppingTrips", i.trip);
  if (trip === null) return null;
  const household = await ctx.db.get("households", member.household);
  const cache = lookups(ctx);
  const ing = i.ingredient ? await cache.ingredient(i.ingredient) : null;
  const sources = [];
  for (const id of i.sourceMeals) {
    const meal = await cache.meal(id);
    if (!meal) continue;
    const recipe = await ctx.db.get("recipes", meal.recipe);
    const leftovers = await ctx.db
      .query("leftoverPortions")
      .withIndex("by_source", (q) => q.eq("sourceMeal", meal._id))
      .collect();
    sources.push({
      _id: meal._id,
      recipeName: recipe?.name ?? "Smazaný recept",
      date: meal.date,
      slot: meal.slot,
      portions: meal.portions,
      /** Leftover Portions cooked with it (#24), counted in the amount. */
      leftoverPortions: leftovers.reduce((n, l) => n + l.portions, 0),
      occasion: meal.occasion,
    });
  }
  sources.sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
  const plenty = !i.manual && ing?.plenty === true;
  const freshDays = ing ? freshnessDaysFor(household?.freshnessDays, ing.freshnessClass) : null;
  return {
    _id: i._id,
    label: i.label,
    amount: i.amount,
    unit: i.unit,
    moreAmounts: i.moreAmounts,
    checked: i.checked,
    manual: i.manual,
    topUp: i.topUp ?? false,
    optional: i.optional === true,
    note: i.note,
    /** "už nepotřeba" for the whole item (not just part of it): it can be deleted. */
    notNeeded: i.note === NOT_NEEDED,
    trip: { _id: trip._id, date: trip.date, kind: trip.kind },
    ingredient: ing
      ? {
          _id: ing._id,
          name: ing.name,
          storeSection: ing.storeSection,
          freshnessClass: ing.freshnessClass,
          freshnessDays: freshDays,
          plenty: ing.plenty,
        }
      : null,
    plenty,
    fresh:
      i.checked || plenty || !ing
        ? null
        : freshnessWarning(trip.date, sources.map((s) => s.date), freshDays),
    sources,
  };
}

// ---------- removing ----------

/**
 * "Smazat" on the item sheet (#29): removes an item whose meals no longer
 * need any of it (note exactly "už nepotřeba", #28). An item that's only
 * partly unneeded ("už nepotřeba: 200 g") still covers a meal and stays.
 */
export const removeItem = mutation({
  args: { itemId: v.id("shoppingItems") },
  returns: v.null(),
  handler: async (ctx, { itemId }) => removeItemFor(ctx, await requireMember(ctx), itemId),
});

export async function removeItemFor(
  ctx: MutationCtx,
  member: Member,
  itemId: Id<"shoppingItems">,
): Promise<null> {
  const item = await ctx.db.get("shoppingItems", itemId);
  if (item === null) return null; // already gone: nothing to do
  assertSameHousehold(member, item);
  if (item.note !== NOT_NEEDED) throw new ConvexError({ code: "ITEM_NOT_REMOVABLE" });
  await ctx.db.delete("shoppingItems", itemId);
  return null;
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
