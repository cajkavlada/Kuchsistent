import { describe, expect, test } from "vitest";
import { lineIngredientName, type Line } from "./Ingredients";

const line = (id: string, over: Partial<Line> = {}): Line =>
  ({ _id: id, raw: id, optional: false, ingredient: null, proposed: null, ...over }) as Line;

describe("lineIngredientName", () => {
  test("existing Ingredient, then the proposed new one, else nothing", () => {
    const proposed = {
      name: "sádlo",
      freshnessClass: "chilled" as const,
      storeSection: "meatFish" as const,
      measureKind: "weight" as const,
    };
    const lines = [
      line("a", { ingredient: { _id: "i1", name: "cibule" } as Line["ingredient"] }),
      line("b", { proposed }),
      line("c"),
    ];
    expect(lines.map(lineIngredientName)).toEqual(["cibule", "sádlo", ""]);
  });
});
