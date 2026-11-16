import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vFreshnessClass,
  vFreshnessDays,
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

  /** Core data model (#5). Unnamed. */
  households: defineTable({
    defaultPortions: v.number(),
    /** Freshness Class day limits this Household changed from the defaults (#6, #22). */
    freshnessDays: v.optional(vFreshnessDays),
    /** Days between default Shopping Trips (#7); unset = 2. */
    tripIntervalDays: v.optional(v.number()),
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
    /**
     * Favourite Recipe (#25): one ★ for the whole Household. Optional only so
     * Recipes saved before #25 stay valid; unset means not a favourite.
     */
    favourite: v.optional(v.boolean()),
    /**
     * Servings the book's amounts are for; unset when the book gives none
     * (counts as the Household default, never scaled, until filled in).
     */
    baseServings: v.optional(v.number()),
    /** Draft only: "Nevím – nechat výchozí" answered the "Pro kolik osob?" check (#20). */
    servingsUnknown: v.optional(v.boolean()),
    /** Draft only: the model reports the recipe goes on past the photos (#20). */
    continuesOffPage: v.optional(v.boolean()),
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
    /**
     * Set when one photo held several recipes (#21): each became its own draft
     * sharing the photo. `group` is the draft the photo was taken for (it may
     * have been discarded since), `index` the recipe's place in the reading.
     * While `choosing`, the user still picks which of them to keep.
     */
    spread: v.optional(
      v.object({
        group: v.id("recipes"),
        index: v.number(),
        pageSide: v.optional(v.string()),
        choosing: v.boolean(),
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
    /** Draft only: the model wasn't sure of this reading ("Nejisté čtení", #20). */
    uncertain: v.optional(v.boolean()),
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

  /**
   * A Planned Meal (#5): a Recipe in a Meal Slot on a Prague day
   * (`YYYY-MM-DD`). A slot holds 1..n items in `order`. `occasion` is for
   * Specials only. Points to the live Recipe (no snapshot).
   */
  plannedMeals: defineTable({
    household: v.id("households"),
    date: v.string(),
    slot: v.union(v.literal("lunch"), v.literal("dinner"), v.literal("special")),
    order: v.number(),
    recipe: v.id("recipes"),
    portions: v.number(),
    occasion: v.optional(v.string()),
  })
    .index("by_household_date", ["household", "date"])
    .index("by_household_recipe_date", ["household", "recipe", "date"]),

  /**
   * A Leftover Portion (#5, #24): a later Lunch/Dinner covered by cooking
   * `sourceMeal` (a Lunch/Dinner Planned Meal) bigger. Shares `order` with the
   * Planned Meals of its Meal Slot. Deleted with its source meal.
   */
  leftoverPortions: defineTable({
    household: v.id("households"),
    sourceMeal: v.id("plannedMeals"),
    date: v.string(),
    slot: v.union(v.literal("lunch"), v.literal("dinner")),
    order: v.number(),
    portions: v.number(),
  })
    .index("by_household_date", ["household", "date"])
    .index("by_source", ["sourceMeal", "date"]),

  /**
   * A Shopping Trip (#5, #7): a dated in-store run or Rohlík delivery on a
   * Prague day. Default trips are created by regeneration (`convex/shopping.ts`).
   */
  shoppingTrips: defineTable({
    household: v.id("households"),
    date: v.string(),
    kind: v.union(v.literal("store"), v.literal("rohlik")),
    status: v.union(v.literal("planned"), v.literal("done")),
  }).index("by_household_date", ["household", "date"]),

  /**
   * A Shopping Item on a trip (#5, #7). Generated items carry the Planned
   * Meals that need them (`sourceMeals`) and are rewritten by regeneration
   * while unchecked; Manual Shopping Items have no Ingredient or sources.
   * `amount`/`unit` is the total in a base unit (g, ml, ks) or a unit that
   * doesn't convert; `moreAmounts` holds clashing kinds ("+ 1 hrnek", #6).
   * No amount = vague ("—"). Checked items are frozen (#28): `topUp` marks
   * an item bought on top of them when the need rose (amount = the
   * difference, `note` "navýšení: …"); `note` "už nepotřeba…" marks a checked
   * item whose meals need less or nothing now.
   */
  shoppingItems: defineTable({
    household: v.id("households"),
    trip: v.id("shoppingTrips"),
    ingredient: v.optional(v.id("ingredients")),
    label: v.string(),
    amount: v.optional(v.number()),
    unit: v.optional(v.string()),
    moreAmounts: v.optional(v.array(v.object({ amount: v.number(), unit: v.string() }))),
    checked: v.boolean(),
    manual: v.boolean(),
    sourceMeals: v.array(v.id("plannedMeals")),
    pinned: v.boolean(),
    /** Every line it comes from is an Optional Line ("volitelné", #29); unset = no. */
    optional: v.optional(v.boolean()),
    note: v.optional(v.string()),
    topUp: v.optional(v.boolean()),
  })
    .index("by_household", ["household"])
    .index("by_trip", ["trip"]),
});
