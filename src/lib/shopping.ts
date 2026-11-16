import { STORE_SECTIONS, type StoreSection } from "@convex/lib/ingredients";
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
