import { expect, test } from "vitest";
import { groupBySection, itemAmount, progress, type ListItem } from "./shopping";

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
