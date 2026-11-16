import type { StoreSection } from "@convex/lib/ingredients";
import { NOT_NEEDED, type Part } from "@convex/lib/shopping";
import { dayLabel } from "~/lib/plan";
import { groupBySection, itemAmount } from "~/lib/shopping";

/**
 * Rohlík hand-off (#31, decisions #3 and #10): no server-side integration and
 * no linked accounts. The list leaves Kuchsistent as text (copied list or an
 * AI prompt for ChatGPT with the Rohlík app) or as per-item search links.
 */

/** Rohlík's cart overview ("Přehled košíku"); checkout is the next step there. */
export const ROHLIK_CART = "https://www.rohlik.cz/objednavka/prehled-kosiku";

/** Rohlík search for one item. */
export function rohlikSearchUrl(term: string): string {
  return `https://www.rohlik.cz/hledat?companyId=1&q=${encodeURIComponent(term)}`;
}

export type HandoffItem = {
  label: string;
  amount?: number;
  unit?: string;
  moreAmounts?: Part[];
  checked: boolean;
  storeSection: StoreSection;
  plenty: boolean;
  optional: boolean;
  note?: string;
};

/** Whether an item still has to go into the cart: unticked, not Plenty, not "už nepotřeba". */
export function needsHandoff(i: HandoffItem): boolean {
  return !i.checked && !i.plenty && !(i.note ?? "").startsWith(NOT_NEEDED);
}

/** One "name amount" line; a top-up lists what it adds, without the "+". */
export function handoffLine(i: HandoffItem): string {
  const amount = itemAmount(i);
  return `${i.label}${amount === "—" ? "" : ` ${amount}`}${i.optional ? " (volitelné)" : ""}`;
}

/** The plain list for "📋 Kopírovat seznam", one item per line, in Store Section order. */
export function handoffLines(items: HandoffItem[]): string[] {
  return groupBySection(items.filter(needsHandoff)).flatMap((g) => g.items.map(handoffLine));
}

/** The fixed prompt for "✨ Naplnit košík s AI" (#31). */
export function rohlikPrompt(date: string, items: HandoffItem[]): string {
  return (
    `/rohlik Vlož mi do košíku tyto položky (doručení ${dayLabel(date)}). ` +
    `Vyber běžné balení v rozumné ceně, množství zaokrouhli nahoru na celá balení. ` +
    `Položky označené (volitelné) přidej jen pokud jsou skladem. Objednávku neodesílej. ` +
    `Až budeš hotový, napiš, co se nepodařilo najít, a na konec odpovědi dej odkaz na přehled košíku: ${ROHLIK_CART}\n\n` +
    handoffLines(items)
      .map((l) => `- ${l}`)
      .join("\n")
  );
}

/** Copies text; falls back to a hidden textarea where the Clipboard API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
