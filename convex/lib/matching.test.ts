import { describe, expect, test, vi } from "vitest";
import { ingredientKey, looksOptional, unitMeasureKind } from "./ingredients";
import {
  mapLines,
  matchUserPrompt,
  matchWithFallback,
  unmatchedItems,
  type MatchResult,
} from "./matching";

const catalogue = [
  { _id: "i1", name: "Hladká mouka" },
  { _id: "i2", name: "vejce" },
];
const names = catalogue.map((i) => i.name);

const line = (name: string, unit?: string) => ({ name, unit, raw: `x ${name}` });
const answer = (
  n: number,
  over: Partial<MatchResult["items"][number]> = {},
): MatchResult["items"][number] => ({
  n,
  existing: "",
  name: "",
  freshnessClass: "longLife",
  storeSection: "other",
  measureKind: "count",
  ...over,
});

describe("ingredient helpers", () => {
  test("keys ignore case and spacing", () => {
    expect(ingredientKey("  Hladká   Mouka ")).toBe("hladká mouka");
  });

  test.each([
    ["dkg", "weight"],
    ["kg", "weight"],
    ["dl", "volume"],
    ["lžíce", "volume"],
    ["lžičky", "volume"],
    ["ks", "count"],
    [undefined, "count"],
    ["stroužky", "count"],
  ])("unit %s → %s", (unit, kind) => {
    expect(unitMeasureKind(unit)).toBe(kind);
  });

  test.each([
    ["případně trochu smetany", true],
    ["Na ozdobu: petrželka", true],
    ["sůl dle potřeby", true],
    ["2 vejce", false],
    ["ozdobný talíř", false],
  ])("optional %s → %s", (text, expected) => {
    expect(looksOptional(text)).toBe(expected);
  });
});

describe("unmatchedItems", () => {
  test("skips exact matches, blanks and duplicates", () => {
    const lines = [line("hladká mouka"), line(""), line("sádlo", "g"), line("Sádlo"), line("cibule")];
    expect(unmatchedItems(lines, names)).toEqual([line("sádlo", "g"), line("cibule")]);
  });
});

describe("mapLines", () => {
  test("exact names map in code; the model maps synonyms and proposes the rest", () => {
    const lines = [line("hladká mouka"), line("vajíčka"), line("sádlo", "g"), line("Sádlo"), line("")];
    const items = unmatchedItems(lines, names);
    const result: MatchResult = {
      items: [
        answer(0, { existing: "vejce" }),
        answer(1, { name: "sádlo", freshnessClass: "chilled", storeSection: "meatFish", measureKind: "weight" }),
      ],
    };
    expect(mapLines(lines, catalogue, items, result)).toEqual([
      { ingredient: "i1" },
      { ingredient: "i2" },
      { proposed: { name: "sádlo", freshnessClass: "chilled", storeSection: "meatFish", measureKind: "weight" } },
      { proposed: { name: "sádlo", freshnessClass: "chilled", storeSection: "meatFish", measureKind: "weight" } },
      {},
    ]);
  });

  test("an unknown 'existing' name is ignored; a proposed name that exists maps to it", () => {
    const lines = [line("kmín"), line("mouka hladká")];
    const items = unmatchedItems(lines, names);
    const result: MatchResult = {
      items: [answer(0, { existing: "kmín celý", name: "kmín" }), answer(1, { name: "hladká mouka" })],
    };
    const out = mapLines(lines, catalogue, items, result);
    expect(out[0].proposed?.name).toBe("kmín");
    expect(out[1]).toEqual({ ingredient: "i1" });
  });

  test("without an answer, new names get default guesses from the unit", () => {
    const lines = [line("mléko", "dl"), line("cibule")];
    expect(mapLines(lines, catalogue, unmatchedItems(lines, names), null)).toEqual([
      { proposed: { name: "mléko", freshnessClass: "longLife", storeSection: "other", measureKind: "volume" } },
      { proposed: { name: "cibule", freshnessClass: "longLife", storeSection: "other", measureKind: "count" } },
    ]);
  });
});

describe("matchWithFallback", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ok: MatchResult = { items: [answer(0)] };

  test("parses JSON text and falls back past a bad model", async () => {
    const out = await matchWithFallback(
      [
        { model: "a", call: async () => ({ items: [{ n: 0 }] }) },
        { model: "b", call: async () => JSON.stringify(ok) },
      ],
      "sys",
      "prompt",
    );
    expect(out).toEqual({ model: "b", result: ok });
  });

  test("returns null when every model fails", async () => {
    const out = await matchWithFallback(
      [{ model: "a", call: async () => { throw new Error("down"); } }],
      "sys",
      "prompt",
    );
    expect(out).toBeNull();
  });

  test("the prompt numbers the items and lists the catalogue", () => {
    const prompt = matchUserPrompt([line("sádlo", "g")], names);
    expect(prompt).toContain("- Hladká mouka");
    expect(prompt).toContain("0. sádlo [g] — „x sádlo“");
  });
});
