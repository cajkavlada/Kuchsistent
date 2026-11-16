import { expect, test } from "vitest";
import {
  everyDays,
  shoppingError,
  freshBadge,
  freshCount,
  freshExplanation,
  groupBySection,
  itemAmount,
  noteTone,
  progress,
  splitPlenty,
  type ListItem,
} from "./shopping";

const item = (label: string, storeSection: ListItem["storeSection"], checked = false): ListItem => ({
  label,
  storeSection,
  checked,
});

test("groups by Store Section in walking order, ticked items last", () => {
  const groups = groupBySection([
    item("sůl", "spices"),
    item("mrkev", "produce", true),
    item("cibule", "produce"),
    item("brambory", "produce"),
    item("hovězí", "meatFish", true),
  ]);
  expect(groups.map((g) => [g.label, g.left, g.items.map((i) => i.label)])).toEqual([
    ["Ovoce a zelenina", 2, ["brambory", "cibule", "mrkev"]],
    ["Maso a ryby", 0, ["hovězí"]],
    ["Koření a dochucovadla", 1, ["sůl"]],
  ]);
});

test("itemAmount", () => {
  expect(itemAmount({ amount: 1200, unit: "g" })).toBe("1,2 kg");
  expect(itemAmount({ amount: 500, unit: "g", moreAmounts: [{ amount: 1, unit: "hrnek" }] })).toBe(
    "500 g + 1 hrnek",
  );
  expect(itemAmount({})).toBe("—");
});

test("progress", () => {
  expect(progress([{ checked: true }, { checked: false }, { checked: false }])).toEqual({
    done: 1,
    total: 3,
    left: 2,
  });
});

test("top-ups show what they add; notes get their tone", () => {
  expect(itemAmount({ amount: 500, unit: "g", topUp: true })).toBe("+500 g");
  expect(itemAmount({ amount: 500, unit: "g", moreAmounts: [{ amount: 1, unit: "ks" }], topUp: true })).toBe(
    "+500 g +1 ks",
  );
  expect(noteTone("už nepotřeba: 500 g")).toBe("gone");
  expect(noteTone("navýšení: Guláš na 6 porcí")).toBe("delta");
});

test("Plenty items are split off and don't count towards progress", () => {
  const items = [
    { label: "sůl", plenty: true, checked: false, fresh: null },
    { label: "mrkev", plenty: false, checked: true, fresh: null },
    { label: "hovězí", plenty: false, checked: false, fresh: { gap: 3, max: 2 } },
  ];
  const { list, plenty } = splitPlenty(items);
  expect(plenty.map((i) => i.label)).toEqual(["sůl"]);
  expect(progress(list)).toEqual({ done: 1, total: 2, left: 1 });
  expect(freshCount(list)).toBe(1);
});

test("freshness texts", () => {
  expect(freshBadge({ gap: 3, max: 2 })).toBe("⚠ nebude čerstvé · 3 dny předem (max 2)");
  expect(freshBadge({ gap: 6, max: 5 })).toBe("⚠ nebude čerstvé · 6 dní předem (max 5)");
  expect(freshExplanation({ gap: 2, max: 1 }, "Velmi čerstvé")).toBe(
    "Kupuješ 2 dny před jídlem, ale „Velmi čerstvé\" vydrží jen 1 den. Je to jen upozornění – položka na seznamu zůstává.",
  );
});

test("everyDays words the trip interval", () => {
  expect(everyDays(1)).toBe("každý den");
  expect(everyDays(2)).toBe("každé 2 dny");
  expect(everyDays(7)).toBe("každých 7 dní");
});

test("shoppingError maps codes to Czech and falls back", () => {
  expect(shoppingError("TRIP_HAS_CHECKED", "x")).toBe("Nákup už má odškrtnuté položky.");
  expect(shoppingError("SOMETHING_ELSE", "Nepovedlo se.")).toBe("Nepovedlo se.");
  expect(shoppingError(undefined, "Nepovedlo se.")).toBe("Nepovedlo se.");
});
