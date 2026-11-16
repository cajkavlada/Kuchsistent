import { ConvexError } from "convex/values";

/** Amount in Czech notation: 2.5 → "2,5", 0.25 → "0,25". */
export function formatAmount(amount: number | undefined): string {
  if (amount === undefined) return "";
  return String(Number(amount.toFixed(3))).replace(".", ",");
}

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

/**
 * Parses what a person types as an amount: "2,5", "2.5", "½", "1 ½", "1/2".
 * Empty → undefined; anything else unreadable → NaN.
 */
export function parseAmount(text: string): number | undefined {
  const value = text.trim().replace(",", ".");
  if (!value) return undefined;
  const mixed = /^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔])$/.exec(value);
  if (mixed) return (mixed[1] ? Number(mixed[1]) : 0) + FRACTIONS[mixed[2]];
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2]);
  if (!/^\d+(\.\d+)?$/.test(value)) return NaN;
  return Number(value);
}

/** "4 porce", "1 porce", "5 porcí". */
export function portionsLabel(n: number): string {
  if (n === 1) return "1 porce";
  if (n >= 2 && n <= 4) return `${n} porce`;
  return `${n} porcí`;
}

/** "1 recept", "2 recepty", "5 receptů". */
export function recipesLabel(n: number): string {
  if (n === 1) return "1 recept";
  if (n >= 2 && n <= 4) return `${n} recepty`;
  return `${n} receptů`;
}

export const CATEGORY_LABEL = { main: "Hlavní jídlo", special: "Speciál" } as const;

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Nejsi přihlášený.",
  NOT_A_MEMBER: "Nejsi členem domácnosti.",
  NOT_FOUND: "Recept už neexistuje.",
  EXTRACTION_PENDING: "Recept se ještě čte, chvilku počkej.",
  EXTRACTION_FAILED: "Recept se nepodařilo přečíst.",
  NAME_REQUIRED: "Doplň název receptu.",
  INVALID_NAME: "Název je příliš dlouhý.",
  INVALID_PORTIONS: "Neplatný počet porcí.",
  NOT_PLANNABLE: "Tenhle recept zatím nejde naplánovat.",
  INVALID_DATE: "Neplatné datum.",
  INVALID_LINE: "Řádek suroviny je prázdný nebo má špatné množství.",
  INVALID_STEPS: "Postup je příliš dlouhý.",
  INVALID_PHOTOS: "Fotky se nepodařilo uložit (nejvýš 10 stránek), zkus to znovu.",
  CANNOT_RETRY: "Recept se právě čte.",
  NOT_A_DRAFT: "Recept je už uložený.",
  CHECKS_PENDING: "Nejdřív projdi, co je ke kontrole.",
  ALREADY_CHOSEN: "Recepty z fotky už jsou vybrané.",
  CHOOSE_FIRST: "Nejdřív vyber, které recepty z fotky chceš.",
};

/** Czech message for a failed Convex call. */
export function errorMessage(err: unknown, fallback = "Něco se nepovedlo, zkus to znovu."): string {
  const code = err instanceof ConvexError ? (err.data as { code?: string })?.code : undefined;
  return (code && MESSAGES[code]) || fallback;
}
