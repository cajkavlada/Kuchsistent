import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { validatePortions } from "./households";
import { daysBetween, isCalendarDay } from "./lib/dates";
import { assertSameHousehold, requireMember, type Member } from "./lib/membership";

/**
 * The day plan (#23, decisions #8 and #5): Planned Meals in Lunch and Dinner,
 * one day at a time. Leftover Portions and Specials come in later tickets.
 */

/** The longest date range one `range` call may read (the day strip is shorter). */
export const MAX_RANGE_DAYS = 70;

const vPlannableSlot = v.union(v.literal("lunch"), v.literal("dinner"));
export type PlannableSlot = "lunch" | "dinner";

function checkDay(date: string): void {
  if (!isCalendarDay(date)) throw new ConvexError({ code: "INVALID_DATE" });
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

async function mealsOn(ctx: QueryCtx, household: Id<"households">, date: string) {
  return await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_date", (q) => q.eq("household", household).eq("date", date))
    .collect();
}

// ---------- reading ----------

/**
 * Planned Meals from `from` to `to` (inclusive), with their Recipe's name,
 * plus the Household default Portions. Feeds both the day strip and the day.
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
  const household = await ctx.db.get("households", member.household);
  if (household === null) throw new ConvexError({ code: "NOT_FOUND" });
  const rows = await ctx.db
    .query("plannedMeals")
    .withIndex("by_household_date", (q) =>
      q.eq("household", member.household).gte("date", from).lte("date", to),
    )
    .collect();
  const names = new Map<Id<"recipes">, string>();
  const meals = [];
  for (const m of rows) {
    if (!names.has(m.recipe)) {
      const recipe = await ctx.db.get("recipes", m.recipe);
      names.set(m.recipe, recipe?.name ?? "");
    }
    meals.push({
      _id: m._id,
      date: m.date,
      slot: m.slot,
      order: m.order,
      portions: m.portions,
      occasion: m.occasion,
      recipe: { _id: m.recipe, name: names.get(m.recipe)! },
    });
  }
  meals.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  return { defaultPortions: household.defaultPortions, meals };
}

// ---------- changes ----------

/** "+ Přidat" / "Naplánovat": a confirmed Recipe goes last into a Meal Slot. */
export const add = mutation({
  args: { date: v.string(), slot: vPlannableSlot, recipeId: v.id("recipes") },
  returns: v.id("plannedMeals"),
  handler: async (ctx, args) => addFor(ctx, await requireMember(ctx), args),
});

export async function addFor(
  ctx: MutationCtx,
  member: Member,
  { date, slot, recipeId }: { date: string; slot: PlannableSlot; recipeId: Id<"recipes"> },
): Promise<Id<"plannedMeals">> {
  checkDay(date);
  const recipe = await ctx.db.get("recipes", recipeId);
  assertSameHousehold(member, recipe);
  const r = recipe as Doc<"recipes">;
  // Only confirmed, non-archived Recipes can be newly planned (#5).
  if (r.status !== "confirmed" || r.archived) {
    throw new ConvexError({ code: "NOT_PLANNABLE" });
  }
  const household = await ctx.db.get("households", member.household);
  if (household === null) throw new ConvexError({ code: "NOT_FOUND" });
  const inSlot = (await mealsOn(ctx, member.household, date)).filter((m) => m.slot === slot);
  const order = inSlot.reduce((max, m) => Math.max(max, m.order + 1), 0);
  return await ctx.db.insert("plannedMeals", {
    household: member.household,
    date,
    slot,
    order,
    recipe: recipeId,
    portions: household.defaultPortions,
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

/** "Odebrat z plánu": deletes the Planned Meal (no meal status, #5). */
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
  await ctx.db.delete("plannedMeals", mealId);
  return null;
}
