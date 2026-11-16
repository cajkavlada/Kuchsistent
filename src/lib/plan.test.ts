import { describe, expect, test } from "vitest";
import { dayLabel, searchKey, stripDays } from "./plan";

describe("dayLabel", () => {
  test("Czech weekday and date", () => {
    expect(dayLabel("2026-11-16")).toBe("Po 16. 11.");
    expect(dayLabel("2026-11-22")).toBe("Ne 22. 11.");
    expect(dayLabel("2027-01-05")).toBe("Út 5. 1.");
  });
});

describe("stripDays", () => {
  test("a week back to four weeks ahead of today", () => {
    const days = stripDays("2026-11-16", "2026-11-18");
    expect(days[0]).toBe("2026-11-09");
    expect(days.at(-1)).toBe("2026-12-13");
    expect(days).toHaveLength(35);
  });

  test("follows a selected day far from today, starting on a Monday", () => {
    const days = stripDays("2026-11-16", "2027-02-10");
    expect(days).toContain("2027-02-10");
    expect(days[0]).toBe("2027-02-01");
    expect(days).toHaveLength(35);
  });

  test("crosses DST and month ends", () => {
    const days = stripDays("2026-10-20", "2026-10-20");
    expect(days).toContain("2026-10-25");
    expect(days).toContain("2026-11-01");
    expect(new Set(days).size).toBe(days.length);
  });
});

test("searchKey ignores case and diacritics", () => {
  expect(searchKey(" Svíčková ")).toBe("svickova");
  expect(searchKey("ČOČKA")).toBe("cocka");
});
