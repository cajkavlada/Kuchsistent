import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
});
