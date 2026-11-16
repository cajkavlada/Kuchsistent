import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Runs once on each fresh Convex preview backend (`--preview-run` in
 * vercel.json). Preview backends start empty; later tickets add sample data
 * here (Recipes, a plan) so a PR can be demoed without setup.
 */
export const preview = internalMutation({
  args: {},
  returns: v.null(),
  handler: async () => {
    console.log("Preview backend ready (nothing to seed yet).");
    return null;
  },
});
