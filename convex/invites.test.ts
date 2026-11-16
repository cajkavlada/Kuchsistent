import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { createHouseholdFor, membersOf } from "./households";
import { INVITE_TTL_MS, createInviteFor, redeemInviteFor } from "./invites";
import { memberOf } from "./lib/membership";
import {
  CODE_ALPHABET,
  generateInviteCode,
  normalizeInviteCode,
} from "./lib/inviteCode";

const CREATOR = "vlada@example.com";
const NOW = Date.UTC(2026, 10, 16, 12);

beforeEach(() => vi.stubEnv("HOUSEHOLD_CREATOR_EMAILS", CREATOR));
afterEach(() => vi.unstubAllEnvs());

type T = ReturnType<typeof convexTest>;

async function addUser(t: T, email: string, image?: string): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", { email, emailVerified: true, name: email.split("@")[0], image }),
  );
}

async function setup() {
  const t = convexTest(schema, modules);
  const creator = await addUser(t, CREATOR, "https://photo/vlada");
  const household = await t.run((ctx) => createHouseholdFor(ctx, creator, 2));
  const guest = await addUser(t, "jana@example.com");
  const { code } = await t.run((ctx) => createInviteFor(ctx, creator, NOW));
  return { t, creator, household, guest, code };
}

describe("invite codes", () => {
  test("generated codes look like K7M-2QX and use the safe alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
      for (const ch of code.replace("-", "")) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  test.each([
    ["K7M-2QX", "K7M-2QX"],
    [" k7m2qx ", "K7M-2QX"],
    ["k7m 2qx", "K7M-2QX"],
    ["https://kuchsistent.vercel.app/pozvanka/K7M-2QX", "K7M-2QX"],
    ["https://kuchsistent.vercel.app/pozvanka/k7m-2qx?x=1", "K7M-2QX"],
    ["K7M-2Q", null],
    ["K7M-2Q0", null], // 0 is not in the alphabet
    ["", null],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });
});

describe("createInviteFor", () => {
  test("any Member creates a 7-day Invite for their Household", async () => {
    const { t, creator, household, code } = await setup();
    await t.run(async (ctx) => {
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      expect(invite).toMatchObject({
        household,
        createdBy: creator,
        expiresAt: NOW + INVITE_TTL_MS,
      });
      expect(invite?.usedBy).toBeUndefined();
    });
  });

  test("a person without a Household cannot invite", async () => {
    const { t, guest } = await setup();
    await expect(t.run((ctx) => createInviteFor(ctx, guest, NOW))).rejects.toThrow(
      /NOT_A_MEMBER/,
    );
  });
});

describe("redeemInviteFor", () => {
  test("joins the Household and marks the Invite used", async () => {
    const { t, guest, household, code } = await setup();
    const joined = await t.run((ctx) =>
      redeemInviteFor(ctx, guest, code.toLowerCase().replace("-", ""), NOW + 1000),
    );
    expect(joined).toBe(household);
    await t.run(async (ctx) => {
      expect((await memberOf(ctx, guest)).household).toBe(household);
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      expect(invite).toMatchObject({ usedBy: guest, usedAt: NOW + 1000 });
    });
  });

  test("Invites are single-use", async () => {
    const { t, guest, code } = await setup();
    const third = await addUser(t, "petr@example.com");
    await t.run((ctx) => redeemInviteFor(ctx, guest, code, NOW));
    await expect(t.run((ctx) => redeemInviteFor(ctx, third, code, NOW))).rejects.toThrow(
      /INVITE_USED/,
    );
  });

  test("Invites expire after 7 days", async () => {
    const { t, guest, code } = await setup();
    await expect(
      t.run((ctx) => redeemInviteFor(ctx, guest, code, NOW + INVITE_TTL_MS)),
    ).rejects.toThrow(/INVITE_EXPIRED/);
    // Still valid just before.
    await t.run((ctx) => redeemInviteFor(ctx, guest, code, NOW + INVITE_TTL_MS - 1));
  });

  test("unknown or malformed codes are rejected", async () => {
    const { t, guest } = await setup();
    await expect(t.run((ctx) => redeemInviteFor(ctx, guest, "AAA-AAA", NOW))).rejects.toThrow(
      /INVITE_NOT_FOUND/,
    );
    await expect(t.run((ctx) => redeemInviteFor(ctx, guest, "nonsense", NOW))).rejects.toThrow(
      /INVITE_NOT_FOUND/,
    );
  });

  test("a person who already has a Household cannot redeem", async () => {
    const { t, creator, code } = await setup();
    await expect(t.run((ctx) => redeemInviteFor(ctx, creator, code, NOW))).rejects.toThrow(
      /ALREADY_A_MEMBER/,
    );
    // The Invite stays unused.
    await t.run(async (ctx) => {
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      expect(invite?.usedBy).toBeUndefined();
    });
  });

  test("the joined Member can invite too (all Members are equal)", async () => {
    const { t, guest, household, code } = await setup();
    await t.run((ctx) => redeemInviteFor(ctx, guest, code, NOW));
    const second = await t.run((ctx) => createInviteFor(ctx, guest, NOW));
    await t.run(async (ctx) => {
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_code", (q) => q.eq("code", second.code))
        .unique();
      expect(invite?.household).toBe(household);
    });
  });
});

describe("members", () => {
  test("lists every Member with Google name and photo", async () => {
    const { t, creator, guest, household, code } = await setup();
    await t.run((ctx) => redeemInviteFor(ctx, guest, code, NOW));
    const list = await t.run((ctx) => membersOf(ctx, household, guest));
    expect(list).toEqual([
      { _id: creator, name: "vlada", image: "https://photo/vlada", isMe: false },
      { _id: guest, name: "jana", image: null, isMe: true },
    ]);
  });
});

describe("public functions", () => {
  test("reject callers who are not signed in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.invites.create, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.mutation(api.invites.redeem, { code: "K7M-2QX" })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
    await expect(t.query(api.households.members, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      t.mutation(api.households.setDefaultPortions, { defaultPortions: 3 }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });
});
