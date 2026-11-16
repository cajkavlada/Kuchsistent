/**
 * Calendar days in Kuchsistent are Europe/Prague days, written `YYYY-MM-DD`
 * (Core data model, #5). Use these helpers on both client and server instead
 * of `Date#toISOString()`, which gives the UTC day.
 */

export const APP_TIME_ZONE = "Europe/Prague";

/** A calendar day, `YYYY-MM-DD`. */
export type CalendarDay = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pragueDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Prague calendar day that `instant` falls on. */
export function toCalendarDay(instant: Date | number): CalendarDay {
  return pragueDayFormat.format(instant);
}

/** Today in Prague. */
export function today(now: Date | number = Date.now()): CalendarDay {
  return toCalendarDay(now);
}

export function isCalendarDay(value: string): value is CalendarDay {
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}

function parse(day: CalendarDay): Date {
  if (!isCalendarDay(day)) throw new Error(`Not a calendar day: ${day}`);
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `day` shifted by `days` (negative goes back). DST-safe: pure date math. */
export function addDays(day: CalendarDay, days: number): CalendarDay {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(day: CalendarDay): number {
  return ((parse(day).getUTCDay() + 6) % 7) + 1;
}
