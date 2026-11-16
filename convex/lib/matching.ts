import { z } from "zod";
import {
  FRESHNESS_CLASSES,
  FRESHNESS_IDS,
  MEASURE_IDS,
  MEASURE_KINDS,
  SECTION_IDS,
  STORE_SECTIONS,
  cleanIngredientName,
  defaultProposal,
  ingredientKey,
  type Proposal,
} from "./ingredients";

/**
 * Matching Ingredient Lines to Household Ingredients (#19, stage "Páruji
 * suroviny"). Names that match an Ingredient exactly (ignoring case and
 * spacing) are mapped in code; only the rest go to the model, which either
 * picks an existing Ingredient (a synonym or other form) or proposes a new
 * one with a guessed Freshness Class, Store Section and Measure Kind.
 *
 * No Node or SDK imports here, so tests can drive it with fake models.
 */

export const MatchSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().describe("Číslo položky ze zadání"),
      existing: z
        .string()
        .describe('Přesný název existující suroviny domácnosti, pokud jde o tutéž věc; jinak ""'),
      name: z.string().describe("Název nové suroviny v základním tvaru, např. hladká mouka"),
      freshnessClass: z.enum(FRESHNESS_IDS),
      storeSection: z.enum(SECTION_IDS),
      measureKind: z.enum(MEASURE_IDS),
    }),
  ),
});
export type MatchResult = z.infer<typeof MatchSchema>;

const list = (items: readonly { id: string; label: string }[], extra?: (id: string) => string) =>
  items.map((x) => `- ${x.id}: ${x.label}${extra ? extra(x.id) : ""}`).join("\n");

export const MATCH_SYSTEM_PROMPT = `Jsi pomocník české domácnosti při nákupu. Dostaneš suroviny z receptu a seznam surovin, které domácnost už má v katalogu.
U každé položky rozhodni:
1. Pokud jde o tutéž věc, jakou už katalog obsahuje (jiný tvar, pořadí slov, synonymum, např. „mouka hladká“ = „hladká mouka“, „vejce“ = „vajíčka“), dej do existing přesný název z katalogu. Různé věci nespojuj (hladká a polohrubá mouka jsou dvě suroviny; kuřecí prsa a kuřecí stehna také).
2. Jinak dej existing "" a navrhni novou surovinu: name v základním tvaru jednotného čísla tak, jak se kupuje (malými písmeny, bez množství a poznámek), a odhadni:
freshnessClass – jak dlouho vydrží po nákupu:
${list(FRESHNESS_CLASSES, (id) => {
  const d = FRESHNESS_CLASSES.find((f) => f.id === id)!.days;
  return d === null ? " (bez omezení; mouka, konzervy, koření, mražené)" : ` (${d} d)`;
})}
storeSection – oddělení v supermarketu:
${list(STORE_SECTIONS)}
measureKind – jak se počítá na nákupu:
${list(MEASURE_KINDS)}
Vrať přesně jednu odpověď pro každé číslo n ze zadání.`;

export function matchUserPrompt(
  items: { name: string; unit?: string; raw: string }[],
  catalogue: string[],
): string {
  const cat = catalogue.length ? catalogue.map((n) => `- ${n}`).join("\n") : "(prázdný)";
  const its = items
    .map((it, n) => `${n}. ${it.name}${it.unit ? ` [${it.unit}]` : ""} — „${it.raw}“`)
    .join("\n");
  return `Katalog surovin domácnosti:\n${cat}\n\nSuroviny z receptu (číslo. název [jednotka] — řádek v knize):\n${its}`;
}

/** One configured model for matching: calls the vendor with a text prompt. */
export type MatchCaller = {
  model: string;
  call: (system: string, prompt: string) => Promise<unknown>;
};

/** Tries each model in turn; null when all fail (the user then reviews default guesses). */
export async function matchWithFallback(
  callers: MatchCaller[],
  system: string,
  prompt: string,
): Promise<{ model: string; result: MatchResult } | null> {
  for (const { model, call } of callers) {
    try {
      const output = await call(system, prompt);
      const parsed = MatchSchema.safeParse(
        typeof output === "string" ? JSON.parse(output) : output,
      );
      if (!parsed.success) throw new Error(`invalid output: ${parsed.error.message}`);
      return { model, result: parsed.data };
    } catch (err) {
      console.warn(`Matching with ${model} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return null;
}

/** A line as read, before matching. */
export type LineToMatch = { name: string; unit?: string; raw: string };

/** Distinct names (by key) that have no exact match in the catalogue, first line wins. */
export function unmatchedItems(lines: LineToMatch[], catalogue: string[]): LineToMatch[] {
  const known = new Set(catalogue.map(ingredientKey));
  const seen = new Set<string>();
  const out: LineToMatch[] = [];
  for (const line of lines) {
    const key = ingredientKey(line.name);
    if (!key || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export type LineMapping<Id> = { ingredient?: Id; proposed?: Proposal };

/**
 * Maps each line to an existing Ingredient or a proposed new one.
 * `items` are the lines sent to the model (from `unmatchedItems`), and
 * `result` the model's answer for them (null if matching failed).
 */
export function mapLines<Id>(
  lines: LineToMatch[],
  catalogue: { _id: Id; name: string }[],
  items: LineToMatch[],
  result: MatchResult | null,
): LineMapping<Id>[] {
  const byKey = new Map(catalogue.map((i) => [ingredientKey(i.name), i._id]));
  const answer = new Map<string, MatchResult["items"][number]>();
  for (const a of result?.items ?? []) {
    const item = items[a.n];
    if (item && !answer.has(ingredientKey(item.name))) answer.set(ingredientKey(item.name), a);
  }
  return lines.map((line) => {
    const key = ingredientKey(line.name);
    if (!key) return {};
    const exact = byKey.get(key);
    if (exact !== undefined) return { ingredient: exact };
    const a = answer.get(key);
    if (!a) return { proposed: defaultProposal(line.name, line.unit) };
    const existing = byKey.get(ingredientKey(a.existing));
    if (existing !== undefined) return { ingredient: existing };
    const name = cleanIngredientName(a.name) || cleanIngredientName(line.name);
    const renamed = byKey.get(ingredientKey(name));
    if (renamed !== undefined) return { ingredient: renamed };
    return {
      proposed: {
        name,
        freshnessClass: a.freshnessClass,
        storeSection: a.storeSection,
        measureKind: a.measureKind,
      },
    };
  });
}
