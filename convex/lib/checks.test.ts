import { describe, expect, test } from "vitest";
import { checkQueue, rawKey } from "./checks";

const named = { name: "Svíčková", baseServings: 4 };

describe("checkQueue", () => {
  test("a clean draft has nothing to check", () => {
    expect(checkQueue(named, [{ _id: "a", hasIngredient: true }])).toEqual([]);
  });

  test("cards come in order: continues, name, servings, then lines in order", () => {
    const queue = checkQueue({ name: " ", continuesOffPage: true }, [
      { _id: "a", hasIngredient: false },
      { _id: "b", hasIngredient: true },
      { _id: "c", uncertain: true, hasIngredient: true },
    ]);
    expect(queue).toEqual([
      { kind: "continues" },
      { kind: "name" },
      { kind: "servings" },
      { kind: "noIngredient", lineId: "a" },
      { kind: "uncertain", lineId: "c" },
    ]);
  });

  test("'Nevím – nechat výchozí' answers the servings check", () => {
    expect(checkQueue({ name: "x", servingsUnknown: true }, [])).toEqual([]);
  });

  test("an uncertain line without an Ingredient asks about the reading first", () => {
    expect(checkQueue(named, [{ _id: "a", uncertain: true, hasIngredient: false }])).toEqual([
      { kind: "uncertain", lineId: "a" },
    ]);
  });
});

test("rawKey ignores case and spacing", () => {
  expect(rawKey("  2,5 dl  Smetany ")).toBe(rawKey("2,5 dl smetany"));
});
