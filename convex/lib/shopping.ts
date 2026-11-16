import { addDays, daysBetween, type CalendarDay } from "./dates";
import type { MeasureKind } from "./ingredients";

/**
 * Shopping list logic (#7, #6), pure so the server and the app share it:
 * units and amounts, default Shopping Trip dates, and which trip each
 * Planned Meal's Ingredients go to.
 */

export const DEFAULT_TRIP_INTERVAL_DAYS = 2;
export const MIN_TRIP_INTERVAL_DAYS = 1;
export const MAX_TRIP_INTERVAL_DAYS = 14;

// ---------- units ----------

/** Base unit of each Measure Kind. */
export const BASE_UNIT: Record<MeasureKind, string> = { weight: "g", volume: "ml", count: "ks" };

/** Units that convert within their kind (#6); spoons and cups are approximate. */
const UNITS: Record<string, { kind: MeasureKind; factor: number }> = {
  g: { kind: "weight", factor: 1 },
  dkg: { kind: "weight", factor: 10 },
  kg: { kind: "weight", factor: 1000 },
  ml: { kind: "volume", factor: 1 },
  dl: { kind: "volume", factor: 100 },
  l: { kind: "volume", factor: 1000 },
  lžíce: { kind: "volume", factor: 15 },
  lžíci: { kind: "volume", factor: 15 },
  lžic: { kind: "volume", factor: 15 },
  lžička: { kind: "volume", factor: 5 },
  lžičky: { kind: "volume", factor: 5 },
  lžiček: { kind: "volume", factor: 5 },
  hrnek: { kind: "volume", factor: 250 },
  hrnky: { kind: "volume", factor: 250 },
  hrnku: { kind: "volume", factor: 250 },
  hrnků: { kind: "volume", factor: 250 },
  ks: { kind: "count", factor: 1 },
  kus: { kind: "count", factor: 1 },
  kusy: { kind: "count", factor: 1 },
  kusů: { kind: "count", factor: 1 },
};

/** Unit as printed, normalised for lookup: "Lžíce." → "lžíce"; none → "". */
export function normalizeUnit(unit: string | undefined): string {
  return (unit ?? "").trim().toLocaleLowerCase("cs").replace(/\.$/, "");
}

/** Kind and size of a known unit; no unit means pieces; unknown units → null. */
export function unitInfo(unit: string | undefined): { kind: MeasureKind; factor: number } | null {
  const key = normalizeUnit(unit);
  if (key === "") return { kind: "count", factor: 1 };
  return UNITS[key] ?? null;
}

// ---------- amounts ----------

/** One amount on the list, in a base unit (g, ml, ks) or a unit we can't convert. */
export type Part = { amount: number; unit: string };

/** One Ingredient Line's need for one Planned Meal. */
export type Need = { amount?: number; unit?: string; scale: number };

/** Factor from the Recipe's baseServings to the meal's Portions; unstated servings never scale (#6). */
export function scaleFactor(portions: number, baseServings: number | undefined): number {
  return baseServings ? portions / baseServings : 1;
}

function roundPart(kind: MeasureKind | null, value: number): number {
  if (kind === "count" || kind === null) return Math.ceil(value - 1e-9);
  // Weights and volumes: nearest 10 g / 10 ml; small amounts stay as they are (whole g/ml).
  if (value >= 10) return Math.round(value / 10) * 10;
  return Math.max(1, Math.round(value));
}

/**
 * The total to buy of one Ingredient: same-kind units are summed in the
 * Ingredient's base unit, clashing kinds and unknown units stay beside it
 * ("500 g + 1 hrnek"). Vague lines (no amount) add nothing; all vague → [].
 */
export function totalOf(measureKind: MeasureKind, needs: Need[]): Part[] {
  const buckets = new Map<string, { kind: MeasureKind | null; value: number; units: Set<string> }>();
  for (const n of needs) {
    if (n.amount === undefined || !(n.amount > 0)) continue;
    const info = unitInfo(n.unit);
    const key = info ? info.kind : `u:${normalizeUnit(n.unit)}`;
    const b = buckets.get(key) ?? { kind: info?.kind ?? null, value: 0, units: new Set() };
    b.value += n.amount * n.scale * (info?.factor ?? 1);
    b.units.add(info ? normalizeUnit(n.unit) || BASE_UNIT.count : normalizeUnit(n.unit));
    buckets.set(key, b);
  }
  const parts: Part[] = [];
  const main = buckets.get(measureKind);
  if (main) parts.push({ amount: roundPart(measureKind, main.value), unit: BASE_UNIT[measureKind] });
  for (const [key, b] of buckets) {
    if (key === measureKind) continue;
    if (b.kind === null) {
      parts.push({ amount: roundPart(null, b.value), unit: [...b.units][0] });
    } else if (b.units.size === 1 && b.kind !== "count") {
      // A clashing kind written in one unit stays in it: "1 hrnek", not "250 ml".
      const unit = [...b.units][0];
      const factor = UNITS[unit]?.factor ?? 1;
      parts.push({ amount: Math.round((b.value / factor) * 10) / 10, unit });
    } else {
      parts.push({ amount: roundPart(b.kind, b.value), unit: BASE_UNIT[b.kind] });
    }
  }
  return parts;
}

function czNumber(n: number, maxDecimals: number): string {
  return String(Number(n.toFixed(maxDecimals))).replace(".", ",");
}

/** "1,2 kg", "350 ml", "3 ks", "1,5 hrnek". */
export function formatPart({ amount, unit }: Part): string {
  if (unit === "g" && amount >= 1000) return `${czNumber(amount / 1000, 2)} kg`;
  if (unit === "ml" && amount >= 1000) return `${czNumber(amount / 1000, 2)} l`;
  return `${czNumber(amount, 1)} ${unit}`;
}

/** The amount column of a Shopping Item: "500 g + 1 hrnek", or "—" when vague. */
export function formatParts(parts: Part[]): string {
  return parts.length ? parts.map(formatPart).join(" + ") : "—";
}

// ---------- trips ----------

export type TripLike = { date: CalendarDay; kind: "store" | "rohlik"; status: "planned" | "done" };

/**
 * Dates of the default trips to create (#7): every `interval` days after the
 * last existing trip (or from today when there is none or it's past), up to
 * the last Planned Meal. Never fills gaps before the last trip.
 */
export function newTripDates(
  existing: CalendarDay[],
  lastMeal: CalendarDay | undefined,
  today: CalendarDay,
  interval: number,
): CalendarDay[] {
  if (lastMeal === undefined || daysBetween(today, lastMeal) < 0) return [];
  const last = existing.reduce<CalendarDay | undefined>(
    (max, d) => (max === undefined || d > max ? d : max),
    undefined,
  );
  let next = last === undefined ? today : addDays(last, interval);
  if (next < today) next = today;
  const dates: CalendarDay[] = [];
  while (next <= lastMeal) {
    dates.push(next);
    next = addDays(next, interval);
  }
  return dates;
}

/**
 * Whether a trip can supply a meal: not after it; a Rohlík trip on the day
 * serves Dinner, not Lunch (Specials count as Lunch).
 */
export function canServe(
  trip: TripLike,
  meal: { date: CalendarDay; slot: "lunch" | "dinner" | "special" },
): boolean {
  if (trip.date > meal.date) return false;
  if (trip.kind === "rohlik" && trip.date === meal.date && meal.slot !== "dinner") return false;
  return true;
}

/**
 * The trip a meal's Ingredients go to: the latest open trip on or before the
 * meal, from today on. On a day with two trips only the first counts.
 * `trips` must be in date order, ties in creation order.
 */
export function tripFor<T extends TripLike>(
  trips: T[],
  meal: { date: CalendarDay; slot: "lunch" | "dinner" | "special" },
  today: CalendarDay,
): T | undefined {
  const firstOfDay = new Map<CalendarDay, T>();
  for (const t of trips) if (!firstOfDay.has(t.date)) firstOfDay.set(t.date, t);
  const days = [...firstOfDay.keys()].sort().reverse();
  for (const d of days) {
    if (d < today) break;
    const t = firstOfDay.get(d)!;
    if (t.status === "planned" && canServe(t, meal)) return t;
  }
  return undefined;
}
