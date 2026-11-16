import { v } from "convex/values";
import { query } from "./_generated/server";
import { vFreshnessClass, vMeasureKind, vStoreSection } from "./lib/ingredients";
import { requireMember } from "./lib/membership";

/** Household Ingredients (#6), A–Z; the catalogue the check queue maps lines to. */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("ingredients"),
      name: v.string(),
      freshnessClass: vFreshnessClass,
      storeSection: vStoreSection,
      measureKind: vMeasureKind,
    }),
  ),
  handler: async (ctx) => {
    const { household } = await requireMember(ctx);
    const all = await ctx.db
      .query("ingredients")
      .withIndex("by_household", (q) => q.eq("household", household))
      .collect();
    all.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    return all.map(({ _id, name, freshnessClass, storeSection, measureKind }) => ({
      _id,
      name,
      freshnessClass,
      storeSection,
      measureKind,
    }));
  },
});
