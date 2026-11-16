import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { generateInviteCode, normalizeInviteCode } from "./lib/inviteCode";
import {
  memberOf,
  membershipOf,
  requireMember,
  requireUserId,
} from "./lib/membership";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Shared by `create`; exported for tests. */
export async function createInviteFor(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  const { household } = await memberOf(ctx, userId);
  let code = generateInviteCode();
  // Codes are random over ~887M values; retry on the rare collision.
  while (
    (await ctx.db
      .query("invites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first()) !== null
  ) {
    code = generateInviteCode();
  }
  const expiresAt = now + INVITE_TTL_MS;
  await ctx.db.insert("invites", { household, code, createdBy: userId, expiresAt });
  return { code, expiresAt };
}

/** "Pozvat do domácnosti": any Member may invite. */
export const create = mutation({
  args: {},
  returns: v.object({ code: v.string(), expiresAt: v.number() }),
  handler: async (ctx) => {
    const { userId } = await requireMember(ctx);
    return await createInviteFor(ctx, userId);
  },
});

/** Shared by `redeem`; exported for tests. */
export async function redeemInviteFor(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: string,
  now: number = Date.now(),
): Promise<Id<"households">> {
  if ((await ctx.db.get("users", userId)) === null) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  if ((await membershipOf(ctx, userId)) !== null) {
    throw new ConvexError({ code: "ALREADY_A_MEMBER" });
  }
  const code = normalizeInviteCode(input);
  const invite =
    code === null
      ? null
      : await ctx.db
          .query("invites")
          .withIndex("by_code", (q) => q.eq("code", code))
          .unique();
  if (invite === null) throw new ConvexError({ code: "INVITE_NOT_FOUND" });
  if (invite.usedBy !== undefined) throw new ConvexError({ code: "INVITE_USED" });
  if (invite.expiresAt <= now) throw new ConvexError({ code: "INVITE_EXPIRED" });
  if ((await ctx.db.get("households", invite.household)) === null) {
    throw new ConvexError({ code: "INVITE_NOT_FOUND" });
  }
  await ctx.db.patch("invites", invite._id, { usedBy: userId, usedAt: now });
  await ctx.db.insert("memberships", { userId, household: invite.household });
  return invite.household;
}

/** Join a Household with an Invite code or link. */
export const redeem = mutation({
  args: { code: v.string() },
  returns: v.id("households"),
  handler: async (ctx, { code }) => {
    const userId = await requireUserId(ctx);
    return await redeemInviteFor(ctx, userId, code);
  },
});
