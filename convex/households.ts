import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { mayCreateHousehold } from "./lib/config";
import { isTestMode } from "./lib/testMode";
import { membershipOf, requireMember, requireUserId } from "./lib/membership";

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
    return { _id: doc._id, defaultPortions: doc.defaultPortions };
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
