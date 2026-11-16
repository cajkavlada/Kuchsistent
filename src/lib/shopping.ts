import { ConvexError } from "convex/values";
import { daysLabel, STORE_SECTIONS, type StoreSection } from "@convex/lib/ingredients";
import { formatParts, NOT_NEEDED, type MoveBlock, type Part, type TripLock } from "@convex/lib/shopping";

/** What the list needs of a Shopping Item. */
export type ListItem = {
  label: string;
  amount?: number;
  unit?: string;
  moreAmounts?: Part[];
  checked: boolean;
  storeSection: StoreSection;
};

/**
 * The amount column: "1,2 kg", "500 g + 1 hrnek", or "—" when vague; a
 * top-up shows what it adds: "+500 g".
 */
export function itemAmount(
  i: Pick<ListItem, "amount" | "unit" | "moreAmounts"> & { topUp?: boolean },
): string {
  if (i.amount === undefined || i.unit === undefined) return "—";
  const parts = [{ amount: i.amount, unit: i.unit }, ...(i.moreAmounts ?? [])];
  return i.topUp ? parts.map((p) => `+${formatParts([p])}`).join(" ") : formatParts(parts);
}

/** How a regeneration note shows (#10): red "už nepotřeba", otherwise green. */
export function noteTone(note: string): "gone" | "delta" {
  return note.startsWith(NOT_NEEDED) ? "gone" : "delta";
}

/**
 * Items by Store Section in walking order (#6); within a section unticked
 * first, ticked items sink to the bottom (#10). Empty sections are left out.
 */
export function groupBySection<T extends ListItem>(items: T[]) {
  return STORE_SECTIONS.map((s) => ({
    section: s.id,
    label: s.label,
    items: items
      .filter((i) => i.storeSection === s.id)
      .sort((a, b) => Number(a.checked) - Number(b.checked) || a.label.localeCompare(b.label, "cs")),
  }))
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, left: g.items.filter((i) => !i.checked).length }));
}

export function progress(items: { checked: boolean }[]) {
  const done = items.filter((i) => i.checked).length;
  return { done, total: items.length, left: items.length - done };
}

/**
 * A trip's items split for Nákup (#29): Plenty items go to the "Máme dost"
 * box at the bottom and don't count towards progress; the rest is the list.
 */
export function splitPlenty<T extends { plenty: boolean }>(items: T[]) {
  return { list: items.filter((i) => !i.plenty), plenty: items.filter((i) => i.plenty) };
}

/** How many of a trip's items carry a freshness warning (shown in the trip header). */
export function freshCount(items: { fresh: unknown }[]): number {
  return items.filter((i) => i.fresh).length;
}

/** Row badge: "⚠ nebude čerstvé · 3 dny předem (max 2)". */
export function freshBadge(w: { gap: number; max: number }): string {
  return `⚠ nebude čerstvé · ${daysLabel(w.gap)} předem (max ${w.max})`;
}

/** Item sheet: why the warning is there. */
export function freshExplanation(w: { gap: number; max: number }, className: string): string {
  return `Kupuješ ${daysLabel(w.gap)} před jídlem, ale „${className}" vydrží jen ${daysLabel(w.max)}. Je to jen upozornění – položka na seznamu zůstává.`;
}

// ---------- trip management (#30) ----------

/** "každý den", "každé 2 dny", "každých 5 dní". */
export function everyDays(n: number): string {
  if (n === 1) return "každý den";
  return n >= 2 && n <= 4 ? `každé ${n} dny` : `každých ${n} dní`;
}

/** Why a "Nakoupit při nákupu" chip is disabled. */
export const MOVE_BLOCK_LABEL: Record<MoveBlock, string> = {
  done: "hotový",
  past: "proběhl",
  afterMeal: "až po jídle",
};

/** Why a trip can't be moved or deleted (trip menu). */
export const TRIP_LOCK_LABEL: Record<TripLock, string> = {
  checked: "Nákup už má odškrtnuté položky, takže ho nejde přesunout ani smazat.",
  past: "Nákup už proběhl, takže ho nejde přesunout ani smazat.",
};

const ERRORS: Record<string, string> = {
  TRIP_DONE: "Nákup je hotový a nové položky nebere. Nejdřív ho znovu otevři.",
  TRIP_PAST: "Ten nákup už proběhl.",
  TRIP_HAS_CHECKED: "Nákup už má odškrtnuté položky.",
  TRIP_AFTER_MEAL: "Ten nákup je až po jídle.",
  ITEM_NOT_MOVABLE: "Tuhle položku přesunout nejde.",
  ITEM_NOT_REMOVABLE: "Tuhle položku smazat nejde.",
  INVALID_LABEL: "Napiš, co koupit (nejvýš 80 znaků).",
  INVALID_DATE: "Tohle datum nejde použít.",
  DATE_PAST: "Datum nesmí být v minulosti.",
  NOT_FOUND: "Nákup nebo položka už neexistuje.",
};

/** Czech message for a shopping mutation's error code. */
export function shoppingError(code: string | undefined, fallback: string): string {
  return (code && ERRORS[code]) || fallback;
}

/** The `code` of a ConvexError, if it is one. */
export function errorCode(e: unknown): string | undefined {
  return e instanceof ConvexError ? (e.data as { code?: string }).code : undefined;
}
