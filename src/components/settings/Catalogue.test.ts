import { describe, expect, test } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { groupBySection, recipesLabel, type Item } from "./Catalogue";
import { daysLabel } from "@convex/lib/ingredients";

const item = (name: string, storeSection: Item["storeSection"]): Item => ({
  _id: name as Id<"ingredients">,
  name,
  storeSection,
  freshnessClass: "longLife",
  measureKind: "count",
  neverBuy: false,
  recipeCount: 0,
});

describe("groupBySection", () => {
  const items = [item("sůl", "spices"), item("cibule", "produce"), item("Česnek", "produce")];

  test("groups in walking order and skips empty sections", () => {
    expect(groupBySection(items, "").map((g) => [g.label, g.items.map((i) => i.name)])).toEqual([
      ["Ovoce a zelenina", ["cibule", "Česnek"]],
      ["Koření a dochucovadla", ["sůl"]],
    ]);
  });

  test("searches ignoring case and spacing", () => {
    expect(groupBySection(items, "  ČES ").flatMap((g) => g.items.map((i) => i.name))).toEqual([
      "Česnek",
    ]);
    expect(groupBySection(items, "xyz")).toEqual([]);
  });
});

test("Czech plurals", () => {
  expect([0, 1, 3, 5].map(recipesLabel)).toEqual([
    "v žádném receptu",
    "1 recept",
    "3 recepty",
    "5 receptů",
  ]);
  expect([null, 1, 2, 5].map(daysLabel)).toEqual(["bez limitu", "1 den", "2 dny", "5 dní"]);
});
