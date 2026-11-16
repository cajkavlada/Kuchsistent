import { v } from "convex/values";

/**
 * Ingredient constants and pure helpers (#6), shared by Convex functions and
 * the app. No Convex runtime imports beyond validators, so the client can use
 * this module too.
 */

/** Freshness Classes with default days bought before the meal (null = no limit). */
export const FRESHNESS_CLASSES = [
  { id: "veryFresh", label: "Velmi čerstvé", days: 1 },
  { id: "meat", label: "Maso", days: 2 },
  { id: "chilled", label: "Chlazené", days: 5 },
  { id: "produce", label: "Ovoce a zelenina", days: 5 },
  { id: "longLife", label: "Trvanlivé", days: null },
] as const;
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number]["id"];

/** Store Sections in walking order. */
export const STORE_SECTIONS = [
  { id: "produce", label: "Ovoce a zelenina" },
  { id: "bakery", label: "Pečivo" },
  { id: "meatFish", label: "Maso a ryby" },
  { id: "deli", label: "Uzeniny" },
  { id: "dairyEggs", label: "Mléčné a vejce" },
  { id: "pantry", label: "Trvanlivé" },
  { id: "spices", label: "Koření a dochucovadla" },
  { id: "frozen", label: "Mražené" },
  { id: "drinks", label: "Nápoje" },
  { id: "household", label: "Drogerie" },
  { id: "other", label: "Ostatní" },
] as const;
export type StoreSection = (typeof STORE_SECTIONS)[number]["id"];

/** Measure Kinds: how an Ingredient is counted on the list. */
export const MEASURE_KINDS = [
  { id: "weight", label: "váha (g)" },
  { id: "volume", label: "objem (ml)" },
  { id: "count", label: "kusy (ks)" },
] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number]["id"];

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((x) => x.id) as unknown as [T[number]["id"], ...T[number]["id"][]];

export const FRESHNESS_IDS = ids(FRESHNESS_CLASSES);
export const SECTION_IDS = ids(STORE_SECTIONS);
export const MEASURE_IDS = ids(MEASURE_KINDS);

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((x) => v.literal(x)));

export const vFreshnessClass = literals(FRESHNESS_IDS);
export const vStoreSection = literals(SECTION_IDS);
export const vMeasureKind = literals(MEASURE_IDS);

/** The AI's (or a default) guess for a new Ingredient, reviewed by the user. */
export const vProposal = v.object({
  name: v.string(),
  freshnessClass: vFreshnessClass,
  storeSection: vStoreSection,
  measureKind: vMeasureKind,
});
export type Proposal = {
  name: string;
  freshnessClass: FreshnessClass;
  storeSection: StoreSection;
  measureKind: MeasureKind;
};

/**
 * Per-Household overrides of the Freshness Class day limits
 * (`households.freshnessDays`); `null` means no limit. A class missing here
 * uses its default.
 */
const vDays = v.optional(v.union(v.number(), v.null()));
export const vFreshnessDays = v.object({
  veryFresh: vDays,
  meat: vDays,
  chilled: vDays,
  produce: vDays,
  longLife: vDays,
});
export type FreshnessDays = Partial<Record<FreshnessClass, number | null>>;

export const MIN_FRESHNESS_DAYS = 1;
export const MAX_FRESHNESS_DAYS = 60;

export function defaultFreshnessDays(id: FreshnessClass): number | null {
  return FRESHNESS_CLASSES.find((f) => f.id === id)?.days ?? null;
}

/** Days an Ingredient of this class may be bought before its meal, in this Household. */
export function freshnessDaysFor(
  overrides: FreshnessDays | undefined,
  id: FreshnessClass,
): number | null {
  const own = overrides?.[id];
  return own === undefined ? defaultFreshnessDays(id) : own;
}

/** All five classes with this Household's limits, in display order. */
export function freshnessTable(overrides: FreshnessDays | undefined) {
  return FRESHNESS_CLASSES.map((f) => ({
    id: f.id as FreshnessClass,
    label: f.label,
    days: freshnessDaysFor(overrides, f.id),
    defaultDays: f.days as number | null,
  }));
}

/** "1 den", "2 dny", "5 dní", "bez limitu". */
export function daysLabel(days: number | null): string {
  if (days === null) return "bez limitu";
  if (days === 1) return "1 den";
  if (days >= 2 && days <= 4) return `${days} dny`;
  return `${days} dní`;
}

export const freshnessLabel =(id: FreshnessClass) =>
  FRESHNESS_CLASSES.find((f) => f.id === id)?.label ?? id;
export const sectionLabel = (id: StoreSection) =>
  STORE_SECTIONS.find((s) => s.id === id)?.label ?? id;

export const MAX_INGREDIENT_NAME = 100;

/** Display form of an Ingredient name: trimmed, single spaces, lower-case first letter kept as typed. */
export function cleanIngredientName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_INGREDIENT_NAME);
}

/** Matching key: names that differ only in case or spacing are the same Ingredient. */
export function ingredientKey(name: string): string {
  return cleanIngredientName(name).toLocaleLowerCase("cs");
}

const UNIT_KIND: Record<string, MeasureKind> = {
  g: "weight",
  dkg: "weight",
  kg: "weight",
  ml: "volume",
  dl: "volume",
  l: "volume",
  lžíce: "volume",
  lžíci: "volume",
  lžic: "volume",
  lžička: "volume",
  lžičky: "volume",
  lžiček: "volume",
  hrnek: "volume",
  hrnky: "volume",
  hrnku: "volume",
  hrnků: "volume",
};

/** Measure Kind implied by a unit as printed; pieces when unknown or absent. */
export function unitMeasureKind(unit: string | undefined): MeasureKind {
  const key = (unit ?? "").trim().toLocaleLowerCase("cs").replace(/\.$/, "");
  return UNIT_KIND[key] ?? "count";
}

/** A fallback guess when the AI gave none (or the user typed a new name). */
export function defaultProposal(name: string, unit?: string): Proposal {
  return {
    name: cleanIngredientName(name),
    freshnessClass: "longLife",
    storeSection: "other",
    measureKind: unitMeasureKind(unit),
  };
}

/** Lines the recipe treats as optional ("případně", "na ozdobu"). */
export function looksOptional(text: string): boolean {
  return /(^|[\s,;(])(případně|popřípadě|na ozdob|dle potřeby|podle potřeby)/i.test(text);
}
