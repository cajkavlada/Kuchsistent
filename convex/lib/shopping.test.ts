import { describe, expect, test } from "vitest";
import {
  canServe,
  diffParts,
  freshnessWarning,
  portionsPhrase,
  sumParts,
  formatPart,
  formatParts,
  newTripDates,
  scaleFactor,
  totalOf,
  tripFor,
  type TripLike,
} from "./shopping";

describe("totalOf", () => {
  test("sums same-kind units in the base unit", () => {
    expect(
      totalOf("weight", [
        { amount: 50, unit: "dkg", scale: 1 },
        { amount: 0.3, unit: "kg", scale: 1 },
        { amount: 200, unit: "g", scale: 1 },
      ]),
    ).toEqual([{ amount: 1000, unit: "g" }]);
    expect(
      totalOf("volume", [
        { amount: 2, unit: "lžíce", scale: 1 },
        { amount: 1, unit: "dl", scale: 1 },
        { amount: 1, unit: "lžička", scale: 1 },
      ]),
    ).toEqual([{ amount: 140, unit: "ml" }]);
  });

  test("scales, rounding counts up and weights to 10 g", () => {
    expect(totalOf("count", [{ amount: 1, unit: undefined, scale: 1.5 }])).toEqual([
      { amount: 2, unit: "ks" },
    ]);
    expect(totalOf("weight", [{ amount: 800, unit: "g", scale: 0.75 * 1.01 }])).toEqual([
      { amount: 610, unit: "g" },
    ]);
    expect(totalOf("volume", [{ amount: 1, unit: "lžička", scale: 1 }])).toEqual([
      { amount: 5, unit: "ml" },
    ]);
  });

  test("clashing kinds stay side by side", () => {
    const parts = totalOf("weight", [
      { amount: 1, unit: "hrnek", scale: 1 },
      { amount: 500, unit: "g", scale: 1 },
    ]);
    expect(parts).toEqual([
      { amount: 500, unit: "g" },
      { amount: 1, unit: "hrnek" },
    ]);
    expect(formatParts(parts)).toBe("500 g + 1 hrnek");
  });

  test("unknown units keep their name; vague lines add nothing", () => {
    expect(
      totalOf("count", [
        { amount: 2, unit: "stroužky", scale: 1.5 },
        { amount: undefined, unit: undefined, scale: 1 },
      ]),
    ).toEqual([{ amount: 3, unit: "stroužky" }]);
    expect(totalOf("weight", [{ amount: undefined, unit: "špetka", scale: 2 }])).toEqual([]);
    expect(formatParts([])).toBe("—");
  });
});

test("scaleFactor: unstated servings never scale", () => {
  expect(scaleFactor(6, 4)).toBe(1.5);
  expect(scaleFactor(6, undefined)).toBe(1);
});

test("formatPart", () => {
  expect(formatPart({ amount: 1200, unit: "g" })).toBe("1,2 kg");
  expect(formatPart({ amount: 350, unit: "ml" })).toBe("350 ml");
  expect(formatPart({ amount: 1500, unit: "ml" })).toBe("1,5 l");
  expect(formatPart({ amount: 3, unit: "ks" })).toBe("3 ks");
});

describe("newTripDates", () => {
  test("first trips start today, every interval days up to the last meal", () => {
    expect(newTripDates([], "2026-11-21", "2026-11-16", 2)).toEqual([
      "2026-11-16",
      "2026-11-18",
      "2026-11-20",
    ]);
  });

  test("only beyond the last existing trip; gaps are never refilled", () => {
    expect(newTripDates(["2026-11-16", "2026-11-22"], "2026-11-25", "2026-11-16", 2)).toEqual([
      "2026-11-24",
    ]);
    expect(newTripDates(["2026-11-22"], "2026-11-20", "2026-11-16", 2)).toEqual([]);
  });

  test("restarts today when the last trip is in the past", () => {
    expect(newTripDates(["2026-11-01"], "2026-11-17", "2026-11-16", 2)).toEqual(["2026-11-16"]);
  });

  test("nothing without future meals", () => {
    expect(newTripDates([], undefined, "2026-11-16", 2)).toEqual([]);
  });
});

describe("tripFor", () => {
  const trip = (date: string, over: Partial<TripLike> = {}): TripLike & { id: string } => ({
    id: date + (over.kind ?? ""),
    date,
    kind: "store",
    status: "planned",
    ...over,
  });

  test("latest trip on or before the meal", () => {
    const trips = [trip("2026-11-16"), trip("2026-11-18"), trip("2026-11-20")];
    expect(tripFor(trips, { date: "2026-11-19", slot: "dinner" }, "2026-11-16")?.date).toBe("2026-11-18");
    expect(tripFor(trips, { date: "2026-11-18", slot: "lunch" }, "2026-11-16")?.date).toBe("2026-11-18");
    expect(tripFor(trips, { date: "2026-11-15", slot: "lunch" }, "2026-11-16")).toBeUndefined();
  });

  test("with two trips on one day the first is used", () => {
    const a = { ...trip("2026-11-18"), id: "a" };
    const b = { ...trip("2026-11-18"), id: "b" };
    expect(tripFor([trip("2026-11-16"), a, b], { date: "2026-11-19", slot: "lunch" }, "2026-11-16")?.id).toBe("a");
  });

  test("skips past and done trips", () => {
    const trips = [trip("2026-11-14"), trip("2026-11-16"), trip("2026-11-18", { status: "done" })];
    expect(tripFor(trips, { date: "2026-11-19", slot: "lunch" }, "2026-11-16")?.date).toBe("2026-11-16");
    expect(tripFor([trip("2026-11-14")], { date: "2026-11-19", slot: "lunch" }, "2026-11-16")).toBeUndefined();
  });

  test("a Rohlík trip on the day serves Dinner, not Lunch", () => {
    const r = trip("2026-11-18", { kind: "rohlik" });
    expect(canServe(r, { date: "2026-11-18", slot: "lunch" })).toBe(false);
    expect(canServe(r, { date: "2026-11-18", slot: "special" })).toBe(false);
    expect(canServe(r, { date: "2026-11-18", slot: "dinner" })).toBe(true);
    expect(tripFor([trip("2026-11-16"), r], { date: "2026-11-18", slot: "lunch" }, "2026-11-16")?.date).toBe(
      "2026-11-16",
    );
  });
});

describe("diffParts", () => {
  test("rise and drop in base units across units of one kind", () => {
    expect(diffParts([{ amount: 1500, unit: "g" }], [{ amount: 1, unit: "kg" }])).toEqual({
      more: [{ amount: 500, unit: "g" }],
      less: [],
    });
    expect(diffParts([{ amount: 500, unit: "g" }], [{ amount: 1000, unit: "g" }])).toEqual({
      more: [],
      less: [{ amount: 500, unit: "g" }],
    });
  });
  test("a new clashing kind is all more; a kind no longer needed is all less", () => {
    expect(diffParts([{ amount: 500, unit: "g" }, { amount: 1, unit: "hrnek" }], [{ amount: 500, unit: "g" }])).toEqual({
      more: [{ amount: 250, unit: "ml" }],
      less: [],
    });
    expect(diffParts([{ amount: 2, unit: "ks" }], [{ amount: 2, unit: "ks" }, { amount: 100, unit: "g" }])).toEqual({
      more: [],
      less: [{ amount: 100, unit: "g" }],
    });
  });
  test("vague purchases cover anything; vague needs are covered by anything", () => {
    expect(diffParts([{ amount: 5, unit: "g" }], [])).toEqual({ more: [], less: [] });
    expect(diffParts([], [{ amount: 5, unit: "g" }])).toEqual({ more: [], less: [] });
  });
});

test("sumParts adds amounts of one kind", () => {
  expect(sumParts([{ amount: 1, unit: "kg" }, { amount: 500, unit: "g" }, { amount: 2, unit: "ks" }])).toEqual([
    { amount: 1500, unit: "g" },
    { amount: 2, unit: "ks" },
  ]);
});

test("portionsPhrase", () => {
  expect([1, 3, 6, 1.5].map(portionsPhrase)).toEqual(["1 porci", "3 porce", "6 porcí", "1,5 porcí"]);
});

test("freshnessWarning: furthest meal more days away than the class allows", () => {
  expect(freshnessWarning("2026-11-16", ["2026-11-17", "2026-11-19"], 2)).toEqual({ gap: 3, max: 2 });
  expect(freshnessWarning("2026-11-16", ["2026-11-18"], 2)).toBeNull();
  expect(freshnessWarning("2026-11-16", ["2026-11-30"], null)).toBeNull();
  expect(freshnessWarning("2026-11-16", [], 1)).toBeNull();
});
