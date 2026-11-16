import { z } from "zod";
import { rawKey } from "./checks";
import { cleanIngredientName, looksOptional } from "./ingredients";

/**
 * Reading a Recipe from cookbook photos (#2). The model returns
 * `ExtractionSchema`; `extractWithFallback` tries each configured model in
 * turn and validates the output in code (Gemini only guarantees JSON syntax);
 * `draftFromExtraction` turns the result into Draft Recipe fields.
 *
 * No Node or SDK imports here, so tests can drive it with fake models.
 */

export const IngredientLineSchema = z.object({
  raw: z.string().describe('Řádek přesně jak je vytištěný, např. "25 dkg hladké mouky"'),
  quantity: z.number().nullable().describe("Množství jako desetinné číslo; ½ → 0.5; rozsah 2–3 → 2; null když chybí"),
  unit: z.string().describe('Jednotka tak, jak je v knize (dkg, g, l, lžíce…); "" když není'),
  ingredient: z.string().describe("Surovina v základním tvaru, např. hladká mouka"),
  note: z.string().describe('Poznámka, např. "na podsypání", "dle chuti"; jinak ""'),
  optional: z
    .boolean()
    .optional()
    .describe("Recept surovinu uvádí jako volitelnou (případně, na ozdobu)"),
});

export const ExtractedRecipeSchema = z.object({
  name: z.string(),
  servingsText: z.string().describe('Údaj o porcích z knihy, např. "pro 4 osoby"; jinak ""'),
  servings: z.number().nullable(),
  ingredientGroups: z.array(
    z.object({
      title: z.string().describe('Mezititulek, např. "Na těsto"; jinak ""'),
      lines: z.array(IngredientLineSchema),
    }),
  ),
  steps: z.array(z.string()),
  pageSide: z.enum(["left", "right", "single", "both"]),
  continuesOffPage: z.boolean().describe("Recept na fotce pokračuje mimo ni"),
  uncertain: z.array(z.string()).describe("Řádky (raw), které nešly přečíst s jistotou"),
});

export const ExtractionSchema = z.object({
  recipes: z.array(ExtractedRecipeSchema),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/** Czech system prompt (#2 research, section 4). */
export const SYSTEM_PROMPT = `Jsi přepisovač receptů z českých kuchařek. Píšeš česky.
Dostaneš fotografii stránky (nebo dvoustrany) kuchařky a vrátíš recepty podle schématu.

Pravidla:
1. Text opisuj přesně a zachovej všechnu diakritiku. Nepřekládej, nemodernizuj pravopis a nepřeváděj jednotky.
2. Fotka může ukazovat dvě stránky. Každý celý i neúplný recept vrať jako samostatnou položku a vyplň pageSide (left, right, single, both). Čísla stránek, záhlaví, popisky a fotky jídel vynech.
3. U každého řádku surovin dej do raw vytištěný text. Pak vyplň quantity (desetinné číslo; ½ → 0.5; u rozsahu „2–3“ dolní mez) a unit tak, jak je v knize (dkg, g, kg, l, dl, ml, lžíce, lžička, hrnek, špetka, ks, stroužek…). Pro „dle chuti“ a podobné dej quantity null.
4. Mezititulky surovin („Na těsto:“) zachovej jako ingredientGroups. Bez mezititulku použij jednu skupinu s title "".
5. Postup rozděl na kroky tam, kde kniha dělí odstavce nebo číslované kroky. Nic si nevymýšlej.
6. Starší písmo a vybledlý tisk: když si znakem nejsi jistý, napiš nejlepší čtení a celý řádek (raw) dej do uncertain. Nikdy nehádej potichu.
7. Pokud je fotka otočená, čti ji ve správné orientaci.
8. servings vyplň jen tehdy, když kniha počet porcí uvádí; jinak null.
9. optional dej true u surovin, které recept uvádí jako volitelné („případně“, „na ozdobu“, „podle chuti lze přidat“).`;

export const USER_PROMPT = "Přepiš recept(y) z fotografie podle schématu.";

/**
 * Several photos are consecutive pages of one recipe (#20, "＋ Další
 * stránka"); the model must join them rather than return a part per page.
 */
export function userPrompt(pages: number): string {
  if (pages <= 1) return USER_PROMPT;
  return `Fotografie (${pages}) jsou po sobě jdoucí stránky jednoho receptu, v tomto pořadí. Spoj je a vrať ho jako jeden recept podle schématu; continuesOffPage vyplň podle poslední stránky.`;
}

export type ExtractionImage = { data: Uint8Array; mediaType: string };

/** One configured model: calls the vendor and returns the raw JSON output. */
export type ModelCaller = {
  model: string;
  call: (images: ExtractionImage[]) => Promise<unknown>;
};

export type ExtractionOutcome =
  | { ok: true; model: string; result: Extraction }
  | { ok: false; error: string };

/**
 * Tries each model in order; the first output that passes the schema and
 * holds at least one recipe wins. Errors, refusals, token limits and invalid
 * JSON all fall through to the next model.
 */
export async function extractWithFallback(
  callers: ModelCaller[],
  images: ExtractionImage[],
): Promise<ExtractionOutcome> {
  const errors: string[] = [];
  for (const { model, call } of callers) {
    try {
      const raw = await call(images);
      const parsed = ExtractionSchema.safeParse(
        typeof raw === "string" ? JSON.parse(raw) : raw,
      );
      if (!parsed.success) throw new Error(`invalid output: ${parsed.error.message}`);
      if (parsed.data.recipes.length === 0) throw new Error("no recipe found");
      return { ok: true, model, result: parsed.data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Extraction with ${model} failed: ${message}`);
      errors.push(`${model}: ${message}`.slice(0, 300));
    }
  }
  if (callers.length === 0) errors.push("no extraction model configured");
  return { ok: false, error: errors.join(" | ") };
}

export type DraftLine = {
  raw: string;
  amount?: number;
  unit?: string;
  /** The Ingredient as read (base form), matched in the next stage. */
  name?: string;
  optional?: boolean;
  /** Listed in the model's `uncertain`: "Nejisté čtení" in the check queue. */
  uncertain?: boolean;
};
export type DraftFields = {
  name: string;
  baseServings?: number;
  steps: string[];
  lines: DraftLine[];
  /** "Recept pokračuje" in the check queue. */
  continuesOffPage: boolean;
};

export const MAX_SERVINGS = 50;

/** Where a recipe sits on the photo, as the model reports it. */
export type PageSide = Extraction["recipes"][number]["pageSide"];

/**
 * Draft Recipe fields for every recipe on the photo (a spread may hold
 * several, #21), in the model's order. Recipes with no name, lines or steps
 * are dropped; if all are empty the first is kept so the user can fill it in.
 */
export function draftsFromExtraction(result: Extraction): (DraftFields & { pageSide: PageSide })[] {
  const all = result.recipes.map((r) => ({ ...draftFromRecipe(r), pageSide: r.pageSide }));
  const useful = all.filter((d) => d.name || d.lines.length || d.steps.length);
  return useful.length ? useful : all.slice(0, 1);
}

/** Draft Recipe fields from the first extracted recipe. */
export function draftFromExtraction(result: Extraction): DraftFields {
  return draftFromRecipe(result.recipes[0]);
}

function draftFromRecipe(recipe: Extraction["recipes"][number]): DraftFields {
  const servings =
    recipe.servings === null ? undefined : Math.round(recipe.servings);
  const uncertain = new Set(recipe.uncertain.map(rawKey));
  const lines: DraftLine[] = [];
  for (const group of recipe.ingredientGroups) {
    for (const line of group.lines) {
      const raw = line.raw.trim();
      if (!raw) continue;
      const unit = line.unit.trim();
      const name = cleanIngredientName(line.ingredient);
      const optional =
        line.optional === true || looksOptional(`${group.title} ${raw} ${line.note}`);
      lines.push({
        raw,
        amount:
          line.quantity !== null && Number.isFinite(line.quantity) && line.quantity >= 0
            ? line.quantity
            : undefined,
        unit: unit || undefined,
        name: name || undefined,
        optional,
        ...(uncertain.has(rawKey(raw)) ? { uncertain: true } : {}),
      });
    }
  }
  return {
    name: recipe.name.trim(),
    baseServings:
      servings !== undefined && servings >= 1 && servings <= MAX_SERVINGS
        ? servings
        : undefined,
    steps: recipe.steps.map((s) => s.trim()).filter(Boolean),
    lines,
    continuesOffPage: recipe.continuesOffPage,
  };
}
