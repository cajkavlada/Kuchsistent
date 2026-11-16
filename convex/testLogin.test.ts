import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor } from "./households";

const METHOD = { method: { name: "usernamePassword" as const, profile: {} } };

beforeEach(() => vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", "vlada@example.com"));
afterEach(() => vi.unstubAllEnvs());

describe("preview test sign-in", () => {
  test("without test mode (production) no test account can be created", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.users.createUserTest, METHOD)).rejects.toThrow(
      /TEST_LOGIN_DISABLED/,
    );
    expect(await t.query(api.testLogin.enabled, {})).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  test("seed:preview turns test mode on, idempotently", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.preview, {});
    await t.mutation(internal.seed.preview, {});
    expect(await t.query(api.testLogin.enabled, {})).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("testMode").collect())).toHaveLength(1);
  });

  test("in test mode a test user is created and may create a Household", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.preview, {});
    const userId = await t.mutation(internal.users.createUserTest, METHOD);
    const user = await t.run((ctx) => ctx.db.get("users", userId));
    expect(user).toMatchObject({ testUser: true, emailVerified: false });
    await t.run((ctx) => createHouseholdFor(ctx, userId, 2));
  });

  test("a leftover test user cannot create a Household once test mode is off", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Tester", emailVerified: false, testUser: true }),
    );
    await expect(t.run((ctx) => createHouseholdFor(ctx, userId, 2))).rejects.toThrow(
      /NOT_ALLOWED_TO_CREATE/,
    );
  });

  test("setName needs a signed-in caller", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.testLogin.setName, { name: "Tester A" })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });
});
