/**
 * The check queue (#9, #20): what on a Draft Recipe needs a person before it
 * can be saved. Pure, so the review screen and `recipes.confirm` agree.
 *
 * New Ingredients are not checks (#44): they are created on save as guessed.
 */

/** Most Recipe Photos (pages) one recipe can have. */
export const MAX_PHOTOS = 10;

export type CheckRecipe = {
  name: string;
  baseServings?: number;
  /** The user chose "Nevím – nechat výchozí". */
  servingsUnknown?: boolean;
  /** The model reports the recipe goes on past the photographed pages. */
  continuesOffPage?: boolean;
};

export type CheckLine<Id = string> = {
  _id: Id;
  /** The model wasn't sure how it read this line. */
  uncertain?: boolean;
  /** Mapped to an Ingredient, existing or proposed new. */
  hasIngredient: boolean;
};

export type Check<Id = string> =
  | { kind: "continues" }
  | { kind: "name" }
  | { kind: "servings" }
  | { kind: "uncertain"; lineId: Id }
  | { kind: "noIngredient"; lineId: Id };

/**
 * In the order the cards are shown: "Recept pokračuje" first (re-reading
 * replaces everything else), then the name, servings, and the lines in order.
 * A line shows one card at a time: an uncertain one first, then (if still
 * unmapped after confirming) "Řádek bez suroviny".
 */
export function checkQueue<Id>(recipe: CheckRecipe, lines: CheckLine<Id>[]): Check<Id>[] {
  const out: Check<Id>[] = [];
  if (recipe.continuesOffPage) out.push({ kind: "continues" });
  if (!recipe.name.trim()) out.push({ kind: "name" });
  if (recipe.baseServings === undefined && !recipe.servingsUnknown) out.push({ kind: "servings" });
  for (const line of lines) {
    if (line.uncertain) out.push({ kind: "uncertain", lineId: line._id });
    else if (!line.hasIngredient) out.push({ kind: "noIngredient", lineId: line._id });
  }
  return out;
}

/** Whitespace- and case-insensitive key for matching a line to the model's `uncertain` list. */
export const rawKey = (raw: string) => raw.trim().replace(/\s+/g, " ").toLocaleLowerCase("cs");
