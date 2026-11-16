import { describe, expect, test } from "vitest";
import { isLaterSlot, laterSlots } from "./slots";

describe("laterSlots", () => {
  test("alternates Lunch and Dinner across days", () => {
    expect(laterSlots({ date: "2026-11-30", slot: "lunch" }, 3)).toEqual([
      { date: "2026-11-30", slot: "dinner" },
      { date: "2026-12-01", slot: "lunch" },
      { date: "2026-12-01", slot: "dinner" },
    ]);
    expect(laterSlots({ date: "2026-11-17", slot: "dinner" }, 1)).toEqual([
      { date: "2026-11-18", slot: "lunch" },
    ]);
  });
});

describe("isLaterSlot", () => {
  const src = { date: "2026-11-17", slot: "lunch" as const };
  test("only a later Lunch/Dinner", () => {
    expect(isLaterSlot(src, { date: "2026-11-17", slot: "dinner" })).toBe(true);
    expect(isLaterSlot(src, { date: "2026-11-18", slot: "lunch" })).toBe(true);
    expect(isLaterSlot(src, { date: "2026-11-17", slot: "lunch" })).toBe(false);
    expect(isLaterSlot(src, { date: "2026-11-16", slot: "dinner" })).toBe(false);
  });
  test("never with Specials", () => {
    expect(isLaterSlot(src, { date: "2026-11-18", slot: "special" })).toBe(false);
    expect(isLaterSlot({ date: "2026-11-17", slot: "special" }, { date: "2026-11-18", slot: "lunch" })).toBe(false);
  });
});
