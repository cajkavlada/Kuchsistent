import { daysBetween, type CalendarDay } from "@convex/lib/dates";
import { dayLabel } from "./plan";

/**
 * The recipe library's browsing logic (#25, decision #12), lifted from the
 * prototype's pure `LIB` module: search, Cooking History, filters and shelves.
 * Runs on the client over the Household's confirmed Recipes. The picker on the
 * planning calendar (#26) reuses it.
 */

export type Category = "main" | "special";

/** What the library needs to know about one confirmed Recipe. */
export type LibraryRecipe = {
  _id: string;
  _creationTime: number;
  name: string;
  category: Category;
  favourite: boolean;
  /** Distinct Ingredient names. */
  ingredients: string[];
  /** Planned Meal dates, any order. */
  mealDates: CalendarDay[];
};

/** Lowercase without diacritics ("Kuře" → "kure"). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("cs");
}

// ---------- Cooking History ----------

export type History = {
  /** Times cooked: Planned Meals before today. */
  cooked: number;
  /** Times cooked within the last 90 days. */
  cooked90: number;
  /** The last time it was cooked. */
  last: CalendarDay | null;
  /** Days since `last`. */
  daysSince: number | null;
  /** The next Planned Meal, today or later. */
  next: CalendarDay | null;
  /** Up to four last cooking dates, newest first. */
  recent: CalendarDay[];
};

/** Cooking History from Planned Meal dates (#12): before today = cooked. */
export function history(mealDates: CalendarDay[], today: CalendarDay): History {
  const sorted = [...mealDates].sort();
  const past = sorted.filter((d) => d < today);
  const future = sorted.filter((d) => d >= today);
  const last = past.at(-1) ?? null;
  return {
    cooked: past.length,
    cooked90: past.filter((d) => daysBetween(d, today) <= 90).length,
    last,
    daysSince: last ? daysBetween(last, today) : null,
    next: future[0] ?? null,
    recent: past.slice(-4).reverse(),
  };
}

/** "včera", "před 3 dny", "před 3 týd.", "před 4 měs." or "ještě nevařeno". */
export function agoLabel(h: Pick<History, "cooked" | "daysSince">): string {
  if (!h.cooked || h.daysSince === null) return "ještě nevařeno";
  const d = h.daysSince;
  if (d <= 1) return "včera";
  if (d < 7) return `před ${d} dny`;
  if (d < 60) return `před ${Math.round(d / 7)} týd.`;
  return `před ${Math.round(d / 30)} měs.`;
}

/** The tile's second line: "před 3 týd. · 6×" or "ještě nevařeno". */
export function tileMeta(h: History): string {
  return h.cooked ? `${agoLabel(h)} · ${h.cooked}×` : agoLabel(h);
}

/** "Vařeno 6× · naposledy Pá 23. 10. (před 3 týd.)" or "Ještě jsme nevařili." */
export function historyLine(h: History): string {
  if (!h.cooked || !h.last) return "Ještě jsme nevařili.";
  return `Vařeno ${h.cooked}× · naposledy ${dayLabel(h.last)} (${agoLabel(h)})`;
}

// ---------- search ----------

export type Match = { score: number; via: string[] };

const WORD_SPLIT = /[\s,.;:()/–-]+/;

/**
 * Every typed word must prefix-match a word of the Recipe name or of one of
 * its Ingredients, ignoring diacritics. Name matches score higher; `via`
 * lists the Ingredients that matched. Null when something didn't match.
 */
export function match(recipe: Pick<LibraryRecipe, "name" | "ingredients">, text: string): Match | null {
  const tokens = fold(text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, via: [] };
  const name = fold(recipe.name);
  const nameWords = name.split(WORD_SPLIT);
  let score = 0;
  const via: string[] = [];
  for (const t of tokens) {
    if (nameWords.some((w) => w.startsWith(t))) {
      score += 10;
      continue;
    }
    if (name.includes(t)) {
      score += 6;
      continue;
    }
    const ing = recipe.ingredients.find((i) => fold(i).split(WORD_SPLIT).some((w) => w.startsWith(t)));
    if (ing === undefined) return null;
    score += 3;
    if (!via.includes(ing)) via.push(ing);
  }
  return { score, via };
}

// ---------- filters and shelves ----------

export type Filters = {
  text: string;
  category: Category | "all";
  /** Ingredient names; a Recipe must contain all of them. */
  ingredients: string[];
};

export const NO_FILTERS: Filters = { text: "", category: "all", ingredients: [] };

export function hasFilters(f: Filters): boolean {
  return f.text.trim() !== "" || f.category !== "all" || f.ingredients.length > 0;
}

/** True when the shelves give way to a results grid. */
export function isSearching(f: Filters): boolean {
  return f.text.trim() !== "" || f.ingredients.length > 0;
}

export type Row<R extends LibraryRecipe = LibraryRecipe> = { r: R; h: History; m: Match };

const byName = (a: Row, b: Row) => a.r.name.localeCompare(b.r.name, "cs");

/**
 * The Recipes that pass the filters, with their history and match. With a
 * search, best matches first; otherwise A–Z.
 */
export function query<R extends LibraryRecipe>(recipes: R[], f: Filters, today: CalendarDay): Row<R>[] {
  const out: Row<R>[] = [];
  for (const r of recipes) {
    if (f.category !== "all" && r.category !== f.category) continue;
    if (!f.ingredients.every((i) => r.ingredients.includes(i))) continue;
    const m = match(r, f.text);
    if (m === null) continue;
    out.push({ r, h: history(r.mealDates, today), m });
  }
  return out.sort(f.text.trim() ? (a, b) => b.m.score - a.m.score || byName(a, b) : byName);
}

export type ShelfKey = "fav" | "stale" | "often" | "new" | "all";

export type Shelf<R extends LibraryRecipe = LibraryRecipe> = {
  key: ShelfKey;
  title: string;
  sub?: string;
  rows: Row<R>[];
};

/** Days without cooking after which a Recipe is "Dlouho jsme nevařili". */
export const STALE_DAYS = 30;
/** "Často vaříme": cooked at least this often within the last 90 days. */
export const OFTEN_MIN = 2;

/**
 * The shelves, in the library's order (#12); empty ones are left out.
 * `rows` is the output of `query` (A–Z when there is no search).
 */
export function shelves<R extends LibraryRecipe>(rows: Row<R>[]): Shelf<R>[] {
  const az = [...rows].sort(byName);
  const list: Shelf<R>[] = [
    { key: "fav", title: "★ Oblíbené", rows: az.filter((x) => x.r.favourite) },
    {
      key: "stale",
      title: "Dlouho jsme nevařili",
      sub: "víc než měsíc",
      rows: az
        .filter((x) => x.h.cooked > 0 && (x.h.daysSince ?? 0) > STALE_DAYS)
        .sort((a, b) => (b.h.daysSince ?? 0) - (a.h.daysSince ?? 0) || byName(a, b)),
    },
    {
      key: "often",
      title: "Často vaříme",
      sub: "za 3 měsíce",
      rows: az
        .filter((x) => x.h.cooked90 >= OFTEN_MIN)
        .sort((a, b) => b.h.cooked90 - a.h.cooked90 || b.h.cooked - a.h.cooked || byName(a, b)),
    },
    {
      key: "new",
      title: "Nové a ještě nevařené",
      rows: az
        .filter((x) => x.h.cooked === 0)
        .sort((a, b) => b.r._creationTime - a.r._creationTime || byName(a, b)),
    },
    { key: "all", title: "Všechny recepty", sub: "A–Z", rows: az },
  ];
  return list.filter((s) => s.rows.length > 0);
}

/** Ingredients used by the Recipes, most used first (the "Se surovinou" sheet). */
export function ingredientCounts(recipes: Pick<LibraryRecipe, "ingredients">[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of recipes) for (const i of r.ingredients) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "cs"));
}

/** "1 výsledek", "3 výsledky", "7 výsledků". */
export function resultsLabel(n: number): string {
  if (n === 1) return "1 výsledek";
  if (n >= 2 && n <= 4) return `${n} výsledky`;
  return `${n} výsledků`;
}

/**
 * For the picker (#26): the same Recipe already planned or cooked within
 * four days of `target`, nearest first; null when there is none.
 */
export function nearHint(mealDates: CalendarDay[], target: CalendarDay): CalendarDay | null {
  const near = mealDates
    .filter((d) => Math.abs(daysBetween(d, target)) <= 4)
    .sort((a, b) => Math.abs(daysBetween(a, target)) - Math.abs(daysBetween(b, target)));
  return near[0] ?? null;
}
