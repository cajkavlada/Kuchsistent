import { addDays, type CalendarDay } from "./dates";

/**
 * Meal Slot ordering (#5, #8), shared by client and server. Lunch and Dinner
 * are ordered within a day; Specials sit beside them and never take part in
 * Leftover Portions.
 */

export type MainSlot = "lunch" | "dinner";
export type MealSlot = MainSlot | "special";

/** Lunch and Dinner in day order. */
export const MAIN_SLOTS: MainSlot[] = ["lunch", "dinner"];

/** Negative when (a) comes before (b), 0 when the same Lunch/Dinner slot. */
export function compareSlots(
  a: { date: CalendarDay; slot: MainSlot },
  b: { date: CalendarDay; slot: MainSlot },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return MAIN_SLOTS.indexOf(a.slot) - MAIN_SLOTS.indexOf(b.slot);
}

/** Whether `target` is a Lunch/Dinner after `source` (where Leftovers may go). */
export function isLaterSlot(
  source: { date: CalendarDay; slot: MealSlot },
  target: { date: CalendarDay; slot: MealSlot },
): boolean {
  const s = source.slot;
  const t = target.slot;
  if (s === "special" || t === "special") return false;
  return compareSlots({ date: source.date, slot: s }, { date: target.date, slot: t }) < 0;
}

/** The next `n` Lunch/Dinner slots after a Lunch/Dinner one. */
export function laterSlots(
  from: { date: CalendarDay; slot: MainSlot },
  n: number,
): { date: CalendarDay; slot: MainSlot }[] {
  const out: { date: CalendarDay; slot: MainSlot }[] = [];
  let date = from.date;
  let i = MAIN_SLOTS.indexOf(from.slot);
  while (out.length < n) {
    i++;
    if (i === MAIN_SLOTS.length) {
      i = 0;
      date = addDays(date, 1);
    }
    out.push({ date, slot: MAIN_SLOTS[i] });
  }
  return out;
}
