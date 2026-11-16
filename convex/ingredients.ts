import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { regenerateShopping } from "./shopping";
import {
  MAX_INGREDIENT_NAME,
  cleanIngredientName,
  ingredientKey,
  vFreshnessClass,
  vMeasureKind,
  vStoreSection,
  type FreshnessClass,
  type MeasureKind,
  type StoreSection,
} from "./lib/ingredients";
import { assertSameHousehold, requireMember, type Member } from "./lib/membership";

async function householdIngredients(ctx: QueryCtx, household: Id<"households">) {
  const all = await ctx.db
    .query("ingredients")
    .withIndex("by_household", (q) => q.eq("household", household))
    .collect();
  all.sort((a, b) => a.name.localeCompare(b.name, "cs"));
  return all;
}

async function linesOfIngredient(ctx: QueryCtx, ingredient: Id<"ingredients">) {
  return await ctx.db
    .query("ingredientLines")
    .withIndex("by_ingredient", (q) => q.eq("ingredient", ingredient))
    .collect();
}

/** Household Ingredients (#6), A–Z; what recipe review maps lines to. */
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
    return (await householdIngredients(ctx, household)).map(
      ({ _id, name, freshnessClass, storeSection, measureKind }) => ({
        _id,
        name,
        freshnessClass,
        storeSection,
        measureKind,
      }),
    );
  },
});

const vCatalogueItem = v.object({
  _id: v.id("ingredients"),
  name: v.string(),
  freshnessClass: vFreshnessClass,
  storeSection: vStoreSection,
  measureKind: vMeasureKind,
  neverBuy: v.boolean(),
  /** How many Recipes use it (any status). */
  recipeCount: v.number(),
});

/** Settings → "Suroviny" (#22): every Household Ingredient, A–Z, with its use. */
export const catalogue = query({
  args: {},
  returns: v.array(vCatalogueItem),
  handler: async (ctx) => catalogueFor(ctx, await requireMember(ctx)),
});

export async function catalogueFor(ctx: QueryCtx, member: Member) {
  const result = [];
  for (const i of await householdIngredients(ctx, member.household)) {
    const recipes = new Set((await linesOfIngredient(ctx, i._id)).map((l) => l.recipe));
    result.push({
      _id: i._id,
      name: i.name,
      freshnessClass: i.freshnessClass,
      storeSection: i.storeSection,
      measureKind: i.measureKind,
      neverBuy: i.neverBuy,
      recipeCount: recipes.size,
    });
  }
  return result;
}

export type IngredientEdit = {
  name: string;
  freshnessClass: FreshnessClass;
  storeSection: StoreSection;
  measureKind: MeasureKind;
  neverBuy: boolean;
};

/** Rename, re-class or mark Never Buy (#22). Names stay unique per Household. */
export const update = mutation({
  args: {
    ingredientId: v.id("ingredients"),
    name: v.string(),
    freshnessClass: vFreshnessClass,
    storeSection: vStoreSection,
    measureKind: vMeasureKind,
    neverBuy: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { ingredientId, ...edit }) =>
    updateFor(ctx, await requireMember(ctx), ingredientId, edit),
});

export async function updateFor(
  ctx: MutationCtx,
  member: Member,
  ingredientId: Id<"ingredients">,
  edit: IngredientEdit,
): Promise<null> {
  const ingredient = await ctx.db.get("ingredients", ingredientId);
  assertSameHousehold(member, ingredient);
  if (edit.name.trim().length > MAX_INGREDIENT_NAME) {
    throw new ConvexError({ code: "INGREDIENT_NAME_TOO_LONG" });
  }
  const name = cleanIngredientName(edit.name);
  if (!name) throw new ConvexError({ code: "INGREDIENT_NAME_REQUIRED" });
  const key = ingredientKey(name);
  const clash = (await householdIngredients(ctx, member.household)).find(
    (i) => i._id !== ingredientId && ingredientKey(i.name) === key,
  );
  if (clash) throw new ConvexError({ code: "INGREDIENT_NAME_TAKEN" });
  await ctx.db.patch("ingredients", ingredientId, {
    name,
    freshnessClass: edit.freshnessClass,
    storeSection: edit.storeSection,
    measureKind: edit.measureKind,
    neverBuy: edit.neverBuy,
  });
  // Name, Measure Kind and Never Buy change the shopping list (#7).
  await regenerateShopping(ctx, member.household);
  return null;
}

/**
 * Merge duplicates (#6, #22): every Ingredient Line of `from` moves to
 * `into` (the survivor keeps its own name and marks), then `from` is deleted.
 */
export const merge = mutation({
  args: { from: v.id("ingredients"), into: v.id("ingredients") },
  returns: v.null(),
  handler: async (ctx, args) => mergeFor(ctx, await requireMember(ctx), args),
});

export async function mergeFor(
  ctx: MutationCtx,
  member: Member,
  { from, into }: { from: Id<"ingredients">; into: Id<"ingredients"> },
): Promise<null> {
  if (from === into) throw new ConvexError({ code: "MERGE_SAME" });
  assertSameHousehold(member, await ctx.db.get("ingredients", from));
  assertSameHousehold(member, await ctx.db.get("ingredients", into));
  for (const line of await linesOfIngredient(ctx, from)) {
    await ctx.db.patch("ingredientLines", line._id, { ingredient: into });
  }
  // Shopping Items follow too, so ticked ones keep covering their meals (#28).
  const items = await ctx.db
    .query("shoppingItems")
    .withIndex("by_household", (q) => q.eq("household", member.household))
    .collect();
  for (const item of items) {
    if (item.ingredient === from) await ctx.db.patch("shoppingItems", item._id, { ingredient: into });
  }
  await ctx.db.delete("ingredients", from);
  await regenerateShopping(ctx, member.household);
  return null;
}
