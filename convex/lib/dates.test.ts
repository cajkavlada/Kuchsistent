import { describe, expect, test } from "vitest";
import { addDays, daysBetween, isCalendarDay, toCalendarDay, weekday } from "./dates";

describe("Prague calendar days", () => {
  test("late evening UTC is already the next day in Prague", () => {
    // 2026-11-16 23:30 UTC = 2026-11-17 00:30 CET
    expect(toCalendarDay(Date.UTC(2026, 10, 16, 23, 30))).toBe("2026-11-17");
    // Summer time: 2026-07-01 22:30 UTC = 2026-07-02 00:30 CEST
    expect(toCalendarDay(Date.UTC(2026, 6, 1, 22, 30))).toBe("2026-07-02");
    expect(toCalendarDay(Date.UTC(2026, 6, 1, 21, 30))).toBe("2026-07-01");
  });

  test("date math across DST changes and month ends", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-28", "2026-04-04")).toBe(7);
  });

  test("weekday is ISO (Monday = 1)", () => {
    expect(weekday("2026-11-16")).toBe(1);
    expect(weekday("2026-11-22")).toBe(7);
  });

  test("validates the YYYY-MM-DD format", () => {
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-2-3")).toBe(false);
  });
});
