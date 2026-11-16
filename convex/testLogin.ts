import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/membership";
import { isTestMode } from "./lib/testMode";

/**
 * Fake test sign-in for Vercel preview deploys, where Google sign-in can't
 * complete. `seed:preview` turns on `testMode`; production never has it, so
 * there `users.createUserTest` refuses every sign-up and no test account can
 * exist. The client signs in with fixed usernames (tester-a, tester-b, …).
 */

/** Shown on the sign-in screen only when true. No sign-in needed. */
export const enabled = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await isTestMode(ctx),
});

/** Give a fresh test user a readable name ("Tester A"). */
export const setName = mutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get("users", userId);
    if (user?.testUser !== true || !(await isTestMode(ctx))) {
      throw new ConvexError({ code: "TEST_LOGIN_DISABLED" });
    }
    const trimmed = name.trim().slice(0, 40);
    if (trimmed) await ctx.db.patch("users", userId, { name: trimmed });
    return null;
  },
});
