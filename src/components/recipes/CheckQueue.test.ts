import { describe, expect, test } from "vitest";
import { checkQueue, lineIngredientName, type Line } from "./CheckQueue";

const line = (id: string, over: Partial<Line> = {}): Line =>
  ({
    _id: id,
    raw: id,
    optional: false,
    ingredient: null,
    proposed: null,
    ...over,
  }) as Line;
const proposal = (name: string, approved = false) => ({
  name,
  freshnessClass: "chilled" as const,
  storeSection: "meatFish" as const,
  measureKind: "weight" as const,
  approved,
});

describe("checkQueue", () => {
  test("one 'Nová surovina' card per unapproved proposed name", () => {
    const lines = [
      line("a", { ingredient: { _id: "i1", name: "cibule" } as Line["ingredient"] }),
      line("b", { proposed: proposal("sádlo") }),
      line("c", { proposed: proposal("Sádlo ") }),
      line("d", { proposed: proposal("petrželka", true) }),
      line("e"),
      line("f", { proposed: proposal("kmín") }),
    ];
    expect(checkQueue(lines).map((q) => [q.kind, q.line._id])).toEqual([
      ["newIngredient", "b"],
      ["newIngredient", "f"],
    ]);
    expect(lines.map(lineIngredientName)).toEqual(["cibule", "sádlo", "Sádlo ", "petrželka", "", "kmín"]);
  });
});
