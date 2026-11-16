import { daysLabel, STORE_SECTIONS, type StoreSection } from "@convex/lib/ingredients";
import { formatParts, NOT_NEEDED, type Part } from "@convex/lib/shopping";

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
