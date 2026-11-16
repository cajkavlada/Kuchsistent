import { describe, expect, test } from "vitest";
import {
  NO_FILTERS,
  agoLabel,
  fold,
  hasFilters,
  history,
  historyLine,
  ingredientCounts,
  match,
  nearHint,
  query,
  resultsLabel,
  shelves,
  tileMeta,
  type LibraryRecipe,
} from "./library";

const TODAY = "2026-11-16";

let n = 0;
function recipe(over: Partial<LibraryRecipe> & { name: string }): LibraryRecipe {
  n += 1;
  return {
    _id: `r${n}`,
    _creationTime: n,
    category: "main",
    favourite: false,
    ingredients: [],
    mealDates: [],
    ...over,
  };
}

describe("fold", () => {
  test("drops diacritics and case", () => {
    expect(fold("Kuře na PAPRICE")).toBe("kure na paprice");
    expect(fold("Žluťoučký kůň")).toBe("zlutoucky kun");
  });
});

describe("history", () => {
  test("past dates are cooked, today and later are planned", () => {
    const h = history(["2026-11-20", "2026-10-23", "2026-11-16", "2026-06-01", "2026-11-10"], TODAY);
    expect(h.cooked).toBe(3);
    expect(h.cooked90).toBe(2);
    expect(h.last).toBe("2026-11-10");
    expect(h.daysSince).toBe(6);
    expect(h.next).toBe("2026-11-16");
    expect(h.recent).toEqual(["2026-11-10", "2026-10-23", "2026-06-01"]);
  });

  test("keeps only the last four cooking dates", () => {
    const h = history(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"], TODAY);
    expect(h.recent).toEqual(["2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01"]);
  });

  test("never cooked", () => {
    const h = history([], TODAY);
    expect(h).toMatchObject({ cooked: 0, last: null, daysSince: null, next: null });
    expect(tileMeta(h)).toBe("ještě nevařeno");
    expect(historyLine(h)).toBe("Ještě jsme nevařili.");
  });

  test("labels", () => {
    expect(agoLabel({ cooked: 1, daysSince: 1 })).toBe("včera");
    expect(agoLabel({ cooked: 1, daysSince: 4 })).toBe("před 4 dny");
    expect(agoLabel({ cooked: 1, daysSince: 21 })).toBe("před 3 týd.");
    expect(agoLabel({ cooked: 1, daysSince: 120 })).toBe("před 4 měs.");
    const h = history(["2026-10-23", "2026-10-01", "2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01"], TODAY);
    expect(tileMeta(h)).toBe("před 3 týd. · 6×");
    expect(historyLine(h)).toBe("Vařeno 6× · naposledy Pá 23. 10. (před 3 týd.)");
  });
});

describe("match", () => {
  const kure = recipe({ name: "Kuře na paprice", ingredients: ["kuřecí stehna", "paprika sladká", "smetana"] });

  test("word prefixes without diacritics", () => {
    expect(match(kure, "kure")).toEqual({ score: 10, via: [] });
    expect(match(kure, "pap")).toEqual({ score: 10, via: [] });
  });

  test("every word must match the name or an Ingredient", () => {
    expect(match(kure, "kure smet")).toEqual({ score: 13, via: ["smetana"] });
    expect(match(kure, "kure brambory")).toBeNull();
  });

  test("a match inside a name word scores below a prefix", () => {
    expect(match(kure, "aprice")?.score).toBe(6);
  });

  test("empty text matches everything", () => {
    expect(match(kure, "  ")).toEqual({ score: 0, via: [] });
  });
});

describe("query", () => {
  const svickova = recipe({ name: "Svíčková", ingredients: ["hovězí", "mrkev", "smetana"] });
  const gulas = recipe({ name: "Guláš", ingredients: ["hovězí", "cibule"] });
  const smetanovy = recipe({ name: "Smetanový dort", category: "special", ingredients: ["smetana", "mouka"] });
  const all = [svickova, gulas, smetanovy];

  test("no filters: A–Z", () => {
    expect(query(all, NO_FILTERS, TODAY).map((x) => x.r.name)).toEqual(["Guláš", "Smetanový dort", "Svíčková"]);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  test("search puts name matches first and says which Ingredient matched", () => {
    const rows = query(all, { ...NO_FILTERS, text: "smet" }, TODAY);
    expect(rows.map((x) => x.r.name)).toEqual(["Smetanový dort", "Svíčková"]);
    expect(rows[1].m.via).toEqual(["smetana"]);
  });

  test("category and every picked Ingredient", () => {
    expect(query(all, { ...NO_FILTERS, category: "special" }, TODAY).map((x) => x.r.name)).toEqual(["Smetanový dort"]);
    expect(query(all, { ...NO_FILTERS, ingredients: ["hovězí"] }, TODAY)).toHaveLength(2);
    expect(query(all, { ...NO_FILTERS, ingredients: ["hovězí", "smetana"] }, TODAY).map((x) => x.r.name)).toEqual([
      "Svíčková",
    ]);
  });
});

describe("shelves", () => {
  test("order, membership and sorting", () => {
    const fav = recipe({ name: "Zelňačka", favourite: true, mealDates: ["2026-11-10", "2026-10-20"] });
    const stale = recipe({ name: "Bramboráky", mealDates: ["2026-09-01"] });
    const staler = recipe({ name: "Čočka", mealDates: ["2026-05-01"] });
    const often = recipe({ name: "Rizoto", mealDates: ["2026-11-01", "2026-11-08", "2026-11-12"] });
    const older = recipe({ name: "Apple" });
    const newer = recipe({ name: "Buchty" });
    const plannedOnly = recipe({ name: "Dýně", mealDates: ["2026-11-20"] });
    const sh = shelves(query([fav, stale, staler, often, older, newer, plannedOnly], NO_FILTERS, TODAY));
    const names = Object.fromEntries(sh.map((s) => [s.key, s.rows.map((x) => x.r.name)]));
    expect(sh.map((s) => s.key)).toEqual(["fav", "stale", "often", "new", "all"]);
    expect(names.fav).toEqual(["Zelňačka"]);
    expect(names.stale).toEqual(["Čočka", "Bramboráky"]);
    expect(names.often).toEqual(["Rizoto", "Zelňačka"]);
    expect(names.new).toEqual(["Dýně", "Buchty", "Apple"]);
    expect(names.all).toEqual(["Apple", "Bramboráky", "Buchty", "Čočka", "Dýně", "Rizoto", "Zelňačka"]);
  });

  test("empty shelves are hidden", () => {
    const sh = shelves(query([recipe({ name: "Nový" })], NO_FILTERS, TODAY));
    expect(sh.map((s) => s.key)).toEqual(["new", "all"]);
    expect(shelves([])).toEqual([]);
  });
});

test("ingredientCounts: most used first, then A–Z", () => {
  expect(
    ingredientCounts([{ ingredients: ["cibule", "česnek"] }, { ingredients: ["cibule", "brambory"] }, { ingredients: ["česnek"] }]),
  ).toEqual([
    { name: "cibule", count: 2 },
    { name: "česnek", count: 2 },
    { name: "brambory", count: 1 },
  ]);
});

test("resultsLabel", () => {
  expect([1, 3, 5, 0].map(resultsLabel)).toEqual(["1 výsledek", "3 výsledky", "5 výsledků", "0 výsledků"]);
});

test("nearHint: nearest Planned Meal within four days", () => {
  expect(nearHint(["2026-11-10", "2026-11-18", "2026-11-23"], "2026-11-19")).toBe("2026-11-18");
  expect(nearHint(["2026-11-10"], "2026-11-19")).toBeNull();
});
