import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";
import { assertSameHousehold, memberOf } from "./lib/membership";

const ALLOWED = "vlada@example.com";

beforeEach(() => {
  vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", ` ${ALLOWED.toUpperCase()} , other@example.com`);
});
afterEach(() => vi.unstubAllEnvs());

async function addUser(
  t: ReturnType<typeof convexTest>,
  email: string,
  emailVerified = true,
): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", { email, emailVerified, name: email }),
  );
}

describe("createHouseholdFor", () => {
  test("allowlisted email creates a Household and its membership", async () => {
    const t = convexTest(schema, modules);
    const userId = await addUser(t, ALLOWED);
    const household = await t.run((ctx) => createHouseholdFor(ctx, userId, 2));
    await t.run(async (ctx) => {
      expect((await ctx.db.get("households", household))?.defaultPortions).toBe(2);
      const member = await memberOf(ctx, userId);
      expect(member.household).toBe(household);
    });
  });

  test("email not on the allowlist is rejected", async () => {
    const t = convexTest(schema, modules);
    const userId = await addUser(t, "stranger@example.com");
    await expect(
      t.run((ctx) => createHouseholdFor(ctx, userId, 2)),
    ).rejects.toThrow(/NOT_ALLOWED_TO_CREATE/);
  });

  test("unverified email is rejected even when allowlisted", async () => {
    const t = convexTest(schema, modules);
    const userId = await addUser(t, ALLOWED, false);
    await expect(
      t.run((ctx) => createHouseholdFor(ctx, userId, 2)),
    ).rejects.toThrow(/NOT_ALLOWED_TO_CREATE/);
  });

  test("a person belongs to exactly one Household", async () => {
    const t = convexTest(schema, modules);
    const userId = await addUser(t, ALLOWED);
    await t.run((ctx) => createHouseholdFor(ctx, userId, 2));
    await expect(
      t.run((ctx) => createHouseholdFor(ctx, userId, 3)),
    ).rejects.toThrow(/ALREADY_A_MEMBER/);
  });

  test.each([0, -1, 2.5, 21])("rejects default Portions %s", async (portions) => {
    const t = convexTest(schema, modules);
    const userId = await addUser(t, ALLOWED);
    await expect(
      t.run((ctx) => createHouseholdFor(ctx, userId, portions)),
    ).rejects.toThrow(/INVALID_PORTIONS/);
  });
});

describe("membership helper", () => {
  test("rejects a signed-in person without a Household", async () => {
    const t = convexTest(schema, modules);
    const userId = await addUser(t, "stranger@example.com");
    await expect(t.run((ctx) => memberOf(ctx, userId))).rejects.toThrow(
      /NOT_A_MEMBER/,
    );
  });

  test("rejects documents from another Household", async () => {
    const t = convexTest(schema, modules);
    const a = await addUser(t, ALLOWED);
    const b = await addUser(t, "other@example.com");
    const ha = await t.run((ctx) => createHouseholdFor(ctx, a, 2));
    const hb = await t.run((ctx) => createHouseholdFor(ctx, b, 2));
    await t.run(async (ctx) => {
      const member = await memberOf(ctx, a);
      expect(() => assertSameHousehold(member, { household: ha })).not.toThrow();
      expect(() => assertSameHousehold(member, { household: hb })).toThrow(/NOT_FOUND/);
      expect(() => assertSameHousehold(member, null)).toThrow(/NOT_FOUND/);
    });
  });

  test("public functions reject callers who are not signed in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.households.me, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.households.current, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      t.mutation(api.households.create, { defaultPortions: 2 }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });
});
