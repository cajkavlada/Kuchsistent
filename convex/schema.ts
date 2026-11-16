import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vFreshnessClass,
  vMeasureKind,
  vProposal,
  vStoreSection,
} from "./lib/ingredients";

export default defineSchema({
  /** A person, as their Google account. Auth sessions live in the auth component. */
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerified: v.boolean(),
    image: v.optional(v.string()),
    /** A fake account from the preview-only test sign-in (see testLogin.ts). */
    testUser: v.optional(v.boolean()),
  }),

  /** Core data model (#5). Unnamed; usualShoppingDays arrives with shopping. */
  households: defineTable({
    defaultPortions: v.number(),
  }),

  /** A user belongs to exactly one Household (#11). */
  memberships: defineTable({
    userId: v.id("users"),
    household: v.id("households"),
  })
    .index("by_user", ["userId"])
    .index("by_household", ["household"]),

  /**
   * One row `{ enabled: true }` turns on the fake test sign-in. Only
   * `seed:preview` writes it, and that runs only on Vercel preview backends,
   * so production never has it.
   */
  testMode: defineTable({ enabled: v.boolean() }),

  /**
   * A single-use, 7-day link + short code for joining a Household (#11).
   * `code` is stored in display form, e.g. "K7M-2QX".
   */
  invites: defineTable({
    household: v.id("households"),
    code: v.string(),
    createdBy: v.id("users"),
    expiresAt: v.number(),
    usedBy: v.optional(v.id("users")),
    usedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_household", ["household"]),

  /**
   * A Recipe (#5). Starts as a Draft Recipe while the AI reads its photos
   * (`extraction`) and the user reviews it; becomes `confirmed` on save.
   */
  recipes: defineTable({
    household: v.id("households"),
    name: v.string(),
    category: v.union(v.literal("main"), v.literal("special")),
    status: v.union(v.literal("draft"), v.literal("confirmed")),
    archived: v.boolean(),
    /** Servings the book's amounts are for; unset when the book gives none. */
    baseServings: v.optional(v.number()),
    steps: v.array(v.string()),
    notes: v.optional(v.string()),
    source: v.optional(v.object({ book: v.string(), page: v.string() })),
    extraction: v.optional(
      v.object({
        state: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
        /** Model that produced the draft, e.g. `claude-sonnet-5-5`. */
        model: v.optional(v.string()),
        error: v.optional(v.string()),
        /** When this reading run was scheduled; identifies the run. */
        startedAt: v.number(),
        /** While pending: reading the photos, then matching Ingredients (#19). */
        stage: v.optional(v.union(v.literal("read"), v.literal("match"))),
      }),
    ),
  }).index("by_household_status", ["household", "status"]),

  /** A Recipe Photo: the resized JPEG of a cookbook page, kept with the Recipe. */
  recipePhotos: defineTable({
    recipe: v.id("recipes"),
    storageId: v.id("_storage"),
    order: v.number(),
  })
    .index("by_recipe", ["recipe", "order"])
    .index("by_storage", ["storageId"]),

  /**
   * An Ingredient Line as printed (`raw`), plus the parsed amount and unit
   * (kept as written, e.g. `dkg`), mapped to a Household Ingredient (#19).
   * On a Draft Recipe a line may instead carry `proposed`: a new Ingredient
   * the AI guessed (editable in the line sheet), created when the Recipe is saved.
   */
  ingredientLines: defineTable({
    recipe: v.id("recipes"),
    order: v.number(),
    raw: v.string(),
    amount: v.optional(v.number()),
    unit: v.optional(v.string()),
    ingredient: v.optional(v.id("ingredients")),
    /** Optional Line ("případně", "na ozdobu"); unset on lines saved before #19. */
    optional: v.optional(v.boolean()),
    proposed: v.optional(
      v.object({
        ...vProposal.fields,
        /** Unused: new Ingredients no longer need approving. Drop once no draft carries it. */
        approved: v.optional(v.boolean()),
      }),
    ),
  })
    .index("by_recipe", ["recipe", "order"])
    .index("by_ingredient", ["ingredient"]),

  /** A Household Ingredient (#6): the canonical thing you buy. */
  ingredients: defineTable({
    household: v.id("households"),
    name: v.string(),
    freshnessClass: vFreshnessClass,
    storeSection: vStoreSection,
    measureKind: vMeasureKind,
    plenty: v.boolean(),
    neverBuy: v.boolean(),
  }).index("by_household", ["household"]),
});
