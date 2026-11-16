import { ConvexError, v } from "convex/values";
import { vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import { internalMutation } from "./_generated/server";
import { isTestMode } from "./lib/testMode";

const vGoogleMethod = v.object({
  name: v.literal("google"),
  profile: vGoogleProfile,
});

/** Runs once per Google account: create the app user. */
export const createUserGoogle = internalMutation({
  args: { method: vGoogleMethod },
  returns: v.id("users"),
  handler: async (ctx, { method }) => {
    const p = method.profile;
    return await ctx.db.insert("users", {
      name: p.name,
      email: p.email,
      emailVerified: p.emailVerified,
      image: p.picture,
    });
  },
});

/** Runs on every Google sign-in: keep name and photo in sync with Google. */
export const onSignInGoogle = internalMutation({
  args: { method: vGoogleMethod, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { method, userId }) => {
    const p = method.profile;
    await ctx.db.patch("users", userId, {
      name: p.name,
      email: p.email,
      emailVerified: p.emailVerified,
      image: p.picture,
    });
    return null;
  },
});

/**
 * Preview-only test sign-in: create a fake user. Throwing here aborts the
 * sign-up, so without `testMode` (i.e. on production) no account is made.
 */
export const createUserTest = internalMutation({
  args: {
    method: v.object({ name: v.literal("usernamePassword"), profile: v.object({}) }),
  },
  returns: v.id("users"),
  handler: async (ctx) => {
    if (!(await isTestMode(ctx))) {
      throw new ConvexError({ code: "TEST_LOGIN_DISABLED" });
    }
    return await ctx.db.insert("users", {
      name: "Tester",
      emailVerified: false,
      testUser: true,
    });
  },
});
