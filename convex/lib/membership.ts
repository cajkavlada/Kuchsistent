import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The membership check every Convex function relies on (#11). Call
 * `requireMember(ctx)` first in any function that reads or writes Household
 * data, and scope everything to the returned `household`.
 */

export type Member = {
  userId: Id<"users">;
  household: Id<"households">;
  membership: Doc<"memberships">;
};

export async function requireUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  return userId;
}

export async function membershipOf(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
): Promise<Doc<"memberships"> | null> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function memberOf(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
): Promise<Member> {
  const membership = await membershipOf(ctx, userId);
  if (membership === null) {
    throw new ConvexError({ code: "NOT_A_MEMBER" });
  }
  return { userId, household: membership.household, membership };
}

/** Signed-in Member of a Household, or throws. */
export async function requireMember(ctx: QueryCtx): Promise<Member> {
  return await memberOf(ctx, await requireUserId(ctx));
}

/** Throws unless `doc` belongs to the caller's Household. */
export function assertSameHousehold(
  member: Member,
  doc: { household: Id<"households"> } | null,
): asserts doc is { household: Id<"households"> } {
  if (doc === null || doc.household !== member.household) {
    throw new ConvexError({ code: "NOT_FOUND" });
  }
}
