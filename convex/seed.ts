import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Runs once on each fresh Convex preview backend (`--preview-run` in
 * vercel.json). Preview backends start empty; later tickets add sample data
 * here so a PR can be demoed without setup. Sample Recipes need a Household,
 * so they're added when a tester founds one (`lib/sampleData.ts`).
 */
export const preview = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Turn on the fake test sign-in (testLogin.ts) on this preview backend.
    if ((await ctx.db.query("testMode").first()) === null) {
      await ctx.db.insert("testMode", { enabled: true });
    }
    console.log("Preview backend ready: test sign-in enabled.");
    return null;
  },
});
