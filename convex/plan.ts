import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { validatePortions } from "./households";
import { daysBetween, isCalendarDay } from "./lib/dates";
import { assertSameHousehold, requireMember, type Member } from "./lib/membership";
import { isLaterSlot, type MainSlot, type MealSlot } from "./lib/slots";

/**
 * The day plan (#23, #24; decisions #8 and #5): Planned Meals in Lunch,
 * Dinner and Specials, one day at a time, plus Leftover Portions that cover a
 * later Lunch/Dinner from an earlier meal.
 */

/** The longest date range one `range` call may read (the day strip is shorter). */
export const MAX_RANGE_DAYS = 70;

/** Longest Occasion text ("Ondra – narozeniny"). */
export const MAX_OCCASION_LENGTH = 80;

const vMealSlot = v.union(v.literal("lunch"), v.literal("dinner"), v.literal("special"));
const vMainSlot = v.union(v.literal("lunch"), v.literal("dinner"));

function checkDay(date: string): void {
  if (!isCalendarDay(date)) throw new ConvexError({ code: "INVALID_DATE" });
}

/** Trimmed Occasion, or undefined when empty. */
function cleanOccasion(occasion: string | undefined): string | undefined {
  const text = occasion?.trim() ?? "";
  if (text.length > MAX_OCCASION_LENGTH) throw new ConvexError({ code: "INVALID_OCCASION" });
  return text === "" ? undefined : text;
}

async function loadMeal(
  ctx: QueryCtx,
  member: Member,
  mealId: Id<"plannedMeals">,
): Promise<Doc<"plannedMeals">> {
  const meal = await ctx.db.get("plannedMeals", mealId);
  assertSameHousehold(member, meal);
  return meal as Doc<"plannedMeals">;
}

async function loadLeftover(
  ctx: QueryCtx,
  member: Member,
  leftoverId: Id<"leftoverPortions">,
): Promise<Doc<"leftoverPortions">> {
  const leftover = await ctx.db.get("leftoverPortions", leftoverId);
  assertSameHousehold(member, leftover);
  return leftover as Doc<"leftoverPortions">;
}

async function leftoversOf(ctx: QueryCtx, mealId: Id<"plannedMeals">) {
  return await ctx.db
    .query("leftoverPortions")
    .withIndex("by_source", (q) => q.eq("sourceMeal", mealId))
    .collect();
}

/** The `order` for a new item at the end of a Meal Slot (Planned Meals and Leftovers share it). */
async function nextOrder(
  ctx: QueryCtx,
  household: Id<"households">,
  date: string,
  slot: MealSlot,
): Promise<number> {
  const meals = await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_date", (q) => q.eq("household", household).eq("date", date))
    .collect();
  const leftovers = await ctx.db
    .query("leftoverPortions")
    .withIndex("by_household_date", (q) => q.eq("household", household).eq("date", date))
    .collect();
  return [...meals, ...leftovers]
    .filter((x) => x.slot === slot)
    .reduce((max, x) => Math.max(max, x.order + 1), 0);
}

async function defaultPortionsOf(ctx: QueryCtx, member: Member): Promise<number> {
  const household = await ctx.db.get("households", member.household);
  if (household === null) throw new ConvexError({ code: "NOT_FOUND" });
  return household.defaultPortions;
}

// ---------- reading ----------

/**
 * Planned Meals from `from` to `to` (inclusive) with their Recipe's name, the
 * Leftover Portions that touch the range (dated in it, or fed by a meal in
 * it) with their source meal, and the Household default Portions. Feeds both
 * the day strip and the day.
 */
export const range = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    return await rangeFor(ctx, member, args);
  },
});

export async function rangeFor(
  ctx: QueryCtx,
  member: Member,
  { from, to }: { from: string; to: string },
) {
  checkDay(from);
  checkDay(to);
  const span = daysBetween(from, to);
  if (span < 0 || span >= MAX_RANGE_DAYS) throw new ConvexError({ code: "INVALID_DATE" });
  const defaultPortions = await defaultPortionsOf(ctx, member);
  const rows = await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_date", (q) =>
      q.eq("household", member.household).gte("date", from).lte("date", to),
    )
    .collect();

  const names = new Map<Id<"recipes">, string>();
  async function nameOf(recipeId: Id<"recipes">): Promise<string> {
    if (!names.has(recipeId)) {
      const recipe = await ctx.db.get("recipes", recipeId);
      names.set(recipeId, recipe?.name ?? "");
    }
    return names.get(recipeId)!;
  }

  const meals = [];
  for (const m of rows) {
    meals.push({
      _id: m._id,
      date: m.date,
      slot: m.slot,
      order: m.order,
      portions: m.portions,
      occasion: m.occasion,
      recipe: { _id: m.recipe, name: await nameOf(m.recipe) },
    });
  }
  meals.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  // Leftovers dated in the range, plus later ones fed by meals in the range
  // (for "uvařit N" and the "Uvařit i na:" chips).
  const leftoverRows = new Map<Id<"leftoverPortions">, Doc<"leftoverPortions">>();
  const inRange = await ctx.db
    .query("leftoverPortions")
    .withIndex("by_household_date", (q) =>
      q.eq("household", member.household).gte("date", from).lte("date", to),
    )
    .collect();
  for (const l of inRange) leftoverRows.set(l._id, l);
  for (const m of rows) {
    if (m.slot === "special") continue;
    for (const l of await leftoversOf(ctx, m._id)) leftoverRows.set(l._id, l);
  }
  const sources = new Map(rows.map((m) => [m._id, m]));
  const leftovers = [];
  for (const l of leftoverRows.values()) {
    let source = sources.get(l.sourceMeal) ?? null;
    if (source === null) source = await ctx.db.get("plannedMeals", l.sourceMeal);
    if (source === null) continue; // removed together; never left behind
    leftovers.push({
      _id: l._id,
      date: l.date,
      slot: l.slot,
      order: l.order,
      portions: l.portions,
      source: {
        _id: source._id,
        date: source.date,
        slot: source.slot as MainSlot,
        recipe: { _id: source.recipe, name: await nameOf(source.recipe) },
      },
    });
  }
  leftovers.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  return { defaultPortions, meals, leftovers };
}

// ---------- Planned Meals ----------

/**
 * "+ Přidat" / "+ Přidat jídlo" / "Naplánovat": a confirmed Recipe goes last
 * into a Meal Slot. A Special may carry an Occasion.
 */
export const add = mutation({
  args: {
    date: v.string(),
    slot: vMealSlot,
    recipeId: v.id("recipes"),
    occasion: v.optional(v.string()),
  },
  returns: v.id("plannedMeals"),
  handler: async (ctx, args) => addFor(ctx, await requireMember(ctx), args),
});

export async function addFor(
  ctx: MutationCtx,
  member: Member,
  {
    date,
    slot,
    recipeId,
    occasion,
  }: { date: string; slot: MealSlot; recipeId: Id<"recipes">; occasion?: string },
): Promise<Id<"plannedMeals">> {
  checkDay(date);
  const recipe = await ctx.db.get("recipes", recipeId);
  assertSameHousehold(member, recipe);
  const r = recipe as Doc<"recipes">;
  // Only confirmed, non-archived Recipes can be newly planned (#5).
  if (r.status !== "confirmed" || r.archived) {
    throw new ConvexError({ code: "NOT_PLANNABLE" });
  }
  const portions = await defaultPortionsOf(ctx, member);
  const order = await nextOrder(ctx, member.household, date, slot);
  return await ctx.db.insert("plannedMeals", {
    household: member.household,
    date,
    slot,
    order,
    recipe: recipeId,
    portions,
    ...(slot === "special" && { occasion: cleanOccasion(occasion) }),
  });
}

/** The Portions stepper on a Planned Meal card and in its detail sheet. */
export const setPortions = mutation({
  args: { mealId: v.id("plannedMeals"), portions: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => setPortionsFor(ctx, await requireMember(ctx), args),
});

export async function setPortionsFor(
  ctx: MutationCtx,
  member: Member,
  { mealId, portions }: { mealId: Id<"plannedMeals">; portions: number },
): Promise<null> {
  await loadMeal(ctx, member, mealId);
  validatePortions(portions);
  await ctx.db.patch("plannedMeals", mealId, { portions });
  return null;
}

/** The Occasion field in a Special's detail sheet. */
export const setOccasion = mutation({
  args: { mealId: v.id("plannedMeals"), occasion: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => setOccasionFor(ctx, await requireMember(ctx), args),
});

export async function setOccasionFor(
  ctx: MutationCtx,
  member: Member,
  { mealId, occasion }: { mealId: Id<"plannedMeals">; occasion: string },
): Promise<null> {
  const meal = await loadMeal(ctx, member, mealId);
  if (meal.slot !== "special") throw new ConvexError({ code: "NOT_A_SPECIAL" });
  await ctx.db.patch("plannedMeals", mealId, { occasion: cleanOccasion(occasion) });
  return null;
}

/** "Odebrat z plánu": deletes the Planned Meal and its Leftover Portions (no meal status, #5). */
export const remove = mutation({
  args: { mealId: v.id("plannedMeals") },
  returns: v.null(),
  handler: async (ctx, args) => removeFor(ctx, await requireMember(ctx), args),
});

export async function removeFor(
  ctx: MutationCtx,
  member: Member,
  { mealId }: { mealId: Id<"plannedMeals"> },
): Promise<null> {
  await loadMeal(ctx, member, mealId);
  for (const l of await leftoversOf(ctx, mealId)) await ctx.db.delete("leftoverPortions", l._id);
  await ctx.db.delete("plannedMeals", mealId);
  return null;
}

// ---------- Leftover Portions ----------

/**
 * "Uvařit i na:" chip turned on: the meal also covers a later Lunch/Dinner.
 * Idempotent: returns the existing Leftover Portion when there is one.
 */
export const addLeftover = mutation({
  args: { mealId: v.id("plannedMeals"), date: v.string(), slot: vMainSlot },
  returns: v.id("leftoverPortions"),
  handler: async (ctx, args) => addLeftoverFor(ctx, await requireMember(ctx), args),
});

export async function addLeftoverFor(
  ctx: MutationCtx,
  member: Member,
  { mealId, date, slot }: { mealId: Id<"plannedMeals">; date: string; slot: MainSlot },
): Promise<Id<"leftoverPortions">> {
  checkDay(date);
  const meal = await loadMeal(ctx, member, mealId);
  // Only a later Lunch/Dinner; Specials never feed Leftovers (#8).
  if (!isLaterSlot(meal, { date, slot })) throw new ConvexError({ code: "INVALID_LEFTOVER" });
  const existing = (await leftoversOf(ctx, mealId)).find(
    (l) => l.date === date && l.slot === slot,
  );
  if (existing) return existing._id;
  return await ctx.db.insert("leftoverPortions", {
    household: member.household,
    sourceMeal: mealId,
    date,
    slot,
    order: await nextOrder(ctx, member.household, date, slot),
    portions: await defaultPortionsOf(ctx, member),
  });
}

/** A Leftover Portion's own Portions stepper. */
export const setLeftoverPortions = mutation({
  args: { leftoverId: v.id("leftoverPortions"), portions: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => setLeftoverPortionsFor(ctx, await requireMember(ctx), args),
});

export async function setLeftoverPortionsFor(
  ctx: MutationCtx,
  member: Member,
  { leftoverId, portions }: { leftoverId: Id<"leftoverPortions">; portions: number },
): Promise<null> {
  await loadLeftover(ctx, member, leftoverId);
  validatePortions(portions);
  await ctx.db.patch("leftoverPortions", leftoverId, { portions });
  return null;
}

/** "Zrušit" on a Leftover Portion card, or its chip turned off. */
export const removeLeftover = mutation({
  args: { leftoverId: v.id("leftoverPortions") },
  returns: v.null(),
  handler: async (ctx, args) => removeLeftoverFor(ctx, await requireMember(ctx), args),
});

export async function removeLeftoverFor(
  ctx: MutationCtx,
  member: Member,
  { leftoverId }: { leftoverId: Id<"leftoverPortions"> },
): Promise<null> {
  // Already gone (the other Member cancelled it) is fine.
  const leftover = await ctx.db.get("leftoverPortions", leftoverId);
  if (leftover === null) return null;
  assertSameHousehold(member, leftover);
  await ctx.db.delete("leftoverPortions", leftoverId);
  return null;
}
