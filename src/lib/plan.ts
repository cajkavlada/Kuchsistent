import { addDays, daysBetween, weekday, type CalendarDay } from "@convex/lib/dates";
import { MAIN_SLOTS, type MainSlot, type MealSlot } from "@convex/lib/slots";

/** Czech weekday abbreviations, by ISO weekday (1 = Monday). */
const WEEKDAY_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export const SLOT_LABEL = { lunch: "Oběd", dinner: "Večeře", special: "Speciál" } as const;
/** Any Meal Slot. */
export type Slot = MealSlot;
/** The Oběd and Večeře sections, in day order. */
export const SLOTS: MainSlot[] = MAIN_SLOTS;
/** The picker's Oběd / Večeře / Speciál segmented control. */
export const PICKER_SLOTS: Slot[] = ["lunch", "dinner", "special"];

/** Slot in a chip or a leftover line: "St večeře". */
export function slotShort(day: CalendarDay, slot: MainSlot): string {
  return `${weekdayShort(day)} ${slot === "lunch" ? "oběd" : "večeře"}`;
}

/** What a meal cooks: its own Portions plus all its Leftover Portions' (#5). */
export function cookTotal(portions: number, leftovers: { portions: number }[]): number {
  return leftovers.reduce((sum, l) => sum + l.portions, portions);
}

/** "porce" with the right Czech plural: 1 porce, 2–4 porce, 5 porcí. */
export function porce(n: number): string {
  return `${n} ${n >= 5 || n === 0 ? "porcí" : "porce"}`;
}

export const MIN_PORTIONS = 1;
export const MAX_PORTIONS = 20;

export function weekdayShort(day: CalendarDay): string {
  return WEEKDAY_SHORT[weekday(day) - 1];
}

export function dayOfMonth(day: CalendarDay): number {
  return Number(day.slice(8, 10));
}

/** "Út 17. 11." */
export function dayLabel(day: CalendarDay): string {
  return `${weekdayShort(day)} ${dayOfMonth(day)}. ${Number(day.slice(5, 7))}.`;
}

/** Days the strip shows around today. */
const BEFORE_TODAY = 7;
const AFTER_TODAY = 27;

/**
 * The day strip: a week back to four weeks ahead of today. When the selected
 * day is outside that, a five-week window around the selected day's week.
 */
export function stripDays(today: CalendarDay, selected: CalendarDay): CalendarDay[] {
  let from = addDays(today, -BEFORE_TODAY);
  let to = addDays(today, AFTER_TODAY);
  if (daysBetween(from, selected) < 0 || daysBetween(selected, to) < 0) {
    from = addDays(selected, -(weekday(selected) - 1) - 7);
    to = addDays(from, 34);
  }
  const days: CalendarDay[] = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Lowercase without diacritics, for "Hledat recept…". */
export function searchKey(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
