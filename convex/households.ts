import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { mayCreateHousehold } from "./lib/config";
import { addSampleRecipes } from "./lib/sampleData";
import { isTestMode } from "./lib/testMode";
import { membershipOf, requireMember, requireUserId } from "./lib/membership";
import { regenerateShopping } from "./shopping";
import {
  MAX_FRESHNESS_DAYS,
  MIN_FRESHNESS_DAYS,
  defaultFreshnessDays,
  freshnessTable,
  vFreshnessClass,
  type FreshnessClass,
} from "./lib/ingredients";

/**
 * Where the signed-in person stands, for routing after sign-in:
 * no Household yet (with or without the right to create one), or a Member.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get("users", userId);
    if (user === null) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const membership = await membershipOf(ctx, userId);
    return {
      user: { name: user.name, email: user.email, image: user.image },
      household: membership?.household ?? null,
      mayCreateHousehold:
        membership === null && (await userMayCreateHousehold(ctx, user)),
    };
  },
});

/** The caller's Household. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const { household } = await requireMember(ctx);
    const doc = await ctx.db.get("households", household);
    if (doc === null) throw new ConvexError({ code: "NOT_FOUND" });
    return {
      _id: doc._id,
      defaultPortions: doc.defaultPortions,
      freshness: freshnessTable(doc.freshnessDays),
    };
  },
});

/** Allowlisted Google email, or a fake test user on a preview backend. */
async function userMayCreateHousehold(
  ctx: Pick<QueryCtx, "db">,
  user: Doc<"users">,
): Promise<boolean> {
  if (mayCreateHousehold(user.email, user.emailVerified)) return true;
  return user.testUser === true && (await isTestMode(ctx));
}

/** "Členové": every Member of the caller's Household, as their Google name + photo. */
export const members = query({
  args: {},
  handler: async (ctx) => {
    const { household, userId } = await requireMember(ctx);
    return await membersOf(ctx, household, userId);
  },
});

/** Shared by `members`; exported for tests. */
export async function membersOf(
  ctx: Pick<QueryCtx, "db">,
  household: Id<"households">,
  me: Id<"users">,
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_household", (q) => q.eq("household", household))
    .collect();
  const result = [];
  for (const m of memberships) {
    const user = await ctx.db.get("users", m.userId);
    if (user === null) continue;
    result.push({
      _id: user._id,
      name: user.name ?? user.email ?? "",
      image: user.image ?? null,
      isMe: user._id === me,
    });
  }
  return result;
}

/** Edit default Portions in settings; all Members may. */
export const setDefaultPortions = mutation({
  args: { defaultPortions: v.number() },
  returns: v.null(),
  handler: async (ctx, { defaultPortions }) => {
    const { household } = await requireMember(ctx);
    validatePortions(defaultPortions);
    await ctx.db.patch("households", household, { defaultPortions });
    await regenerateShopping(ctx, household);
    return null;
  },
});

/**
 * "Čerstvost" in settings (#22): a Freshness Class's day limit for this
 * Household; `null` = no limit. Setting the default drops the override.
 */
export const setFreshnessDays = mutation({
  args: { freshnessClass: vFreshnessClass, days: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await requireMember(ctx);
    return await setFreshnessDaysFor(ctx, household, args);
  },
});

export async function setFreshnessDaysFor(
  ctx: MutationCtx,
  household: Id<"households">,
  { freshnessClass, days }: { freshnessClass: FreshnessClass; days: number | null },
): Promise<null> {
  if (
    days !== null &&
    (!Number.isInteger(days) || days < MIN_FRESHNESS_DAYS || days > MAX_FRESHNESS_DAYS)
  ) {
    throw new ConvexError({ code: "INVALID_DAYS" });
  }
  const doc = await ctx.db.get("households", household);
  if (doc === null) throw new ConvexError({ code: "NOT_FOUND" });
  const freshnessDays = { ...doc.freshnessDays };
  if (days === defaultFreshnessDays(freshnessClass)) delete freshnessDays[freshnessClass];
  else freshnessDays[freshnessClass] = days;
  await ctx.db.patch("households", household, {
    freshnessDays: Object.keys(freshnessDays).length > 0 ? freshnessDays : undefined,
  });
  await regenerateShopping(ctx, household);
  return null;
}

export const MIN_PORTIONS = 1;
export const MAX_PORTIONS = 20;

export function validatePortions(portions: number): void {
  if (
    !Number.isInteger(portions) ||
    portions < MIN_PORTIONS ||
    portions > MAX_PORTIONS
  ) {
    throw new ConvexError({ code: "INVALID_PORTIONS" });
  }
}

/** Shared by `create`; exported for tests. */
export async function createHouseholdFor(
  ctx: MutationCtx,
  userId: Id<"users">,
  defaultPortions: number,
): Promise<Id<"households">> {
  validatePortions(defaultPortions);
  const user = await ctx.db.get("users", userId);
  if (user === null) throw new ConvexError({ code: "UNAUTHENTICATED" });
  if ((await membershipOf(ctx, userId)) !== null) {
    throw new ConvexError({ code: "ALREADY_A_MEMBER" });
  }
  if (!(await userMayCreateHousehold(ctx, user))) {
    throw new ConvexError({ code: "NOT_ALLOWED_TO_CREATE" });
  }
  const household = await ctx.db.insert("households", { defaultPortions });
  await ctx.db.insert("memberships", { userId, household });
  // Preview backends only: give testers Recipes to plan right away.
  if (user.testUser === true && (await isTestMode(ctx))) {
    await addSampleRecipes(ctx, household);
  }
  return household;
}

/** "Založit domácnost": only for emails on HOUSEHOLD_CREATOR_EMAILS. */
export const create = mutation({
  args: { defaultPortions: v.number() },
  returns: v.id("households"),
  handler: async (ctx, { defaultPortions }) => {
    const userId = await requireUserId(ctx);
    return await createHouseholdFor(ctx, userId, defaultPortions);
  },
});
