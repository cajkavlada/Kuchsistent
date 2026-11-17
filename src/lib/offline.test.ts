import { describe, expect, test } from "vitest";
import {
  applyTicks,
  keepAfterError,
  listFromSaved,
  parseSavedList,
  parseTicks,
  SAVED_LIST_VERSION,
  savedAtLabel,
  signOutQuestion,
  snapshotOf,
  withoutTick,
  withTick,
  type ShoppingData,
} from "./offline";

function item(id: string, checked = false) {
  return {
    _id: id,
    label: id,
    checked,
    manual: false,
    pinned: false,
    topUp: false,
    storeSection: "other",
    plenty: false,
    optional: false,
    fresh: null,
  };
}

const data = {
  today: "2026-11-16",
  trips: [
    { _id: "t1", date: "2026-11-16", kind: "store", status: "planned", lock: null, items: [item("a"), item("b", true)] },
    { _id: "t2", date: "2026-11-14", kind: "store", status: "done", lock: null, items: [item("c")] },
  ],
} as unknown as ShoppingData;

describe("saved copy", () => {
  test("keeps only trips not marked done, and reads back", () => {
    const saved = snapshotOf(data, 1000);
    expect(saved.trips.map((t) => t._id)).toEqual(["t1"]);
    expect(parseSavedList(JSON.stringify(saved))).toEqual(saved);
    expect(listFromSaved(saved, "2026-11-18")).toEqual({ today: "2026-11-18", trips: saved.trips });
  });

  test("ignores a missing, broken or outdated copy", () => {
    expect(parseSavedList(null)).toBeNull();
    expect(parseSavedList("{")).toBeNull();
    expect(parseSavedList(JSON.stringify({ v: SAVED_LIST_VERSION + 1, savedAt: 1, trips: [] }))).toBeNull();
  });
});

describe("tick queue", () => {
  test("a tick sets the state; confirming an older send keeps the newer tick", () => {
    let ticks = withTick({}, "a", true, 1);
    ticks = withTick(ticks, "a", false, 2);
    expect(withoutTick(ticks, "a", 1)).toBe(ticks);
    expect(withoutTick(ticks, "a", 2)).toEqual({});
  });

  test("pending ticks show over the list", () => {
    const shown = applyTicks(data, withTick(withTick({}, "a", true, 1), "b", false, 2));
    expect(shown.trips[0].items.map((i) => i.checked)).toEqual([true, false]);
    expect(applyTicks(data, {})).toBe(data);
  });

  test("reads back only well-formed ticks", () => {
    expect(parseTicks(JSON.stringify({ a: { checked: true, seq: 3 }, b: { checked: "x" } }))).toEqual({
      a: { checked: true, seq: 3 },
    });
    expect(parseTicks("[]")).toEqual({});
    expect(parseTicks("nope")).toEqual({});
  });

  test("only an expired session keeps a failed tick", () => {
    expect(keepAfterError("UNAUTHENTICATED")).toBe(true);
    expect(keepAfterError("NOT_A_MEMBER")).toBe(false);
    expect(keepAfterError(undefined)).toBe(false);
  });
});

describe("labels", () => {
  test("time of the copy, with the day when it's not today", () => {
    const at = Date.UTC(2026, 10, 16, 13, 5); // 14:05 in Prague
    expect(savedAtLabel(at, at + 60_000)).toBe("14:05");
    expect(savedAtLabel(at, at + 86_400_000)).toBe("16. 11. 14:05");
  });

  test("sign-out question", () => {
    expect(signOutQuestion(1)).toBe("1 odškrtnutí se ještě neuložilo – opravdu odhlásit?");
    expect(signOutQuestion(3)).toBe("3 odškrtnutí se ještě neuložila – opravdu odhlásit?");
    expect(signOutQuestion(5)).toBe("5 odškrtnutí se ještě neuložilo – opravdu odhlásit?");
  });
});
