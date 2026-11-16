import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { checkQueue as queueOf, type Check } from "@convex/lib/checks";
import { errorMessage, formatAmount, parseAmount } from "~/lib/format";
import { lineIngredientName, type Line } from "./Ingredients";
import type { RecipeView } from "./Review";

/**
 * The check queue (#9, #20): only what on a Draft Recipe needs a person,
 * one card at a time, with the photo pinned above. Saving needs it empty.
 * New Ingredients are not checked here (#44); the summary marks them "nová".
 */

export type QueueItem = Check<Id<"ingredientLines">>;

export function checkQueue(recipe: RecipeView): QueueItem[] {
  return queueOf(
    recipe,
    recipe.lines.map((l) => ({
      _id: l._id,
      uncertain: l.uncertain,
      hasIngredient: !!(l.ingredient || l.proposed),
    })),
  );
}

/** Number chips on "Pro kolik osob?". */
const SERVINGS_CHIPS = [2, 3, 4, 5, 6, 8];

function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, act };
}

/** The card for the first item of the queue. */
export function QueueCard({ recipe, item }: { recipe: RecipeView; item: QueueItem }) {
  switch (item.kind) {
    case "continues":
      return <ContinuesCard recipe={recipe} />;
    case "name":
      return <NameCard recipe={recipe} />;
    case "servings":
      return <ServingsCard recipe={recipe} />;
    case "uncertain":
    case "noIngredient": {
      const line = recipe.lines.find((l) => l._id === item.lineId);
      return line ? <LineCard key={`${item.kind}-${line._id}`} line={line} kind={item.kind} /> : null;
    }
  }
}

/** "Recept pokračuje": photograph the next page, or say the recipe is complete. */
function ContinuesCard({ recipe }: { recipe: RecipeView }) {
  const dismiss = useMutation(api.recipes.dismissCheck);
  const navigate = useNavigate();
  const { busy, error, act } = useAct();
  return (
    <div className="qcard">
      <div className="qkind">📄 Recept pokračuje</div>
      <p className="nomargin">
        Vypadá to, že recept pokračuje na další stránce. Vyfoť ji a recept se přečte znovu ze
        všech stránek.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <button
        className="btn primary"
        disabled={busy}
        onClick={() => void navigate({ to: "/recepty/vyfotit", search: { recept: recipe._id } })}
      >
        📷 Vyfotit další stránku
      </button>
      <button
        className="btn ghost"
        disabled={busy}
        onClick={() => void act(() => dismiss({ recipeId: recipe._id, check: "continues" }))}
      >
        Ne, je to celé
      </button>
    </div>
  );
}

function NameCard({ recipe }: { recipe: RecipeView }) {
  const update = useMutation(api.recipes.updateBasics);
  const [name, setName] = useState("");
  const { busy, error, setError, act } = useAct();
  return (
    <form
      className="qcard"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Napiš název receptu.");
        void act(() =>
          update({
            recipeId: recipe._id,
            name,
            category: recipe.category,
            baseServings: recipe.baseServings,
          }),
        );
      }}
    >
      <div className="qkind">Název receptu</div>
      <p className="nomargin">Název se z fotky nepodařilo přečíst.</p>
      <input
        className="finput"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="např. Svíčková na smetaně"
        aria-label="Název receptu"
      />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        Hotovo
      </button>
    </form>
  );
}

/** "Pro kolik osob?": a chip, or keep the Household default (never scaled). */
function ServingsCard({ recipe }: { recipe: RecipeView }) {
  const set = useMutation(api.recipes.setServings);
  const dismiss = useMutation(api.recipes.dismissCheck);
  const { busy, error, act } = useAct();
  return (
    <div className="qcard">
      <div className="qkind">Pro kolik osob?</div>
      <p className="nomargin">
        Kniha počet porcí neuvádí. Bez něj se recept bere jako pro výchozí počet porcí
        domácnosti a množství se nepřepočítávají.
      </p>
      <div className="chips big" role="group" aria-label="Počet porcí">
        {SERVINGS_CHIPS.map((n) => (
          <button
            key={n}
            className="chip"
            disabled={busy}
            onClick={() => void act(() => set({ recipeId: recipe._id, baseServings: n }))}
          >
            {n}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button
        className="btn ghost"
        disabled={busy}
        onClick={() => void act(() => dismiss({ recipeId: recipe._id, check: "servings" }))}
      >
        Nevím – nechat výchozí
      </button>
    </div>
  );
}

/**
 * "Nejisté čtení" (confirm or correct the reading against the photo) and
 * "Řádek bez suroviny" (fill in the Ingredient, or delete the line).
 */
function LineCard({ line, kind }: { line: Line; kind: "uncertain" | "noIngredient" }) {
  const update = useMutation(api.recipes.updateLine);
  const remove = useMutation(api.recipes.deleteLine);
  const ingredients = useQuery(api.ingredients.list);
  const [amount, setAmount] = useState(formatAmount(line.amount));
  const [unit, setUnit] = useState(line.unit ?? "");
  const [ingredientName, setIngredientName] = useState(lineIngredientName(line));
  const { busy, error, setError, act } = useAct();
  const uncertain = kind === "uncertain";

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseAmount(amount);
    if (Number.isNaN(parsed)) return setError("Množství zadej jako číslo, např. 2,5 nebo ½.");
    if (!uncertain && !ingredientName.trim()) {
      return setError("Doplň surovinu, nebo řádek smaž.");
    }
    void act(() =>
      update({
        lineId: line._id,
        line: {
          raw: line.raw,
          amount: parsed,
          unit: unit.trim() || undefined,
          ingredientName: ingredientName.trim(),
        },
      }),
    );
  }

  return (
    <form className={`qcard${uncertain ? " unsure" : ""}`} onSubmit={confirm}>
      <div className="qkind">{uncertain ? "⚠ Nejisté čtení" : "Řádek bez suroviny"}</div>
      <div className="bigraw printed">„{line.raw}“</div>
      <p className="muted small nomargin">
        {uncertain
          ? "AI si tímhle řádkem nebyla jistá. Porovnej ho s fotkou nahoře a oprav, co nesedí."
          : "Nevíme, co se má koupit. Doplň surovinu, nebo řádek smaž."}
      </p>
      <div className="frow">
        <label className="lbl qamount">
          Množství
          <input
            className="finput"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="lbl qunit">
          Jednotka
          <input className="finput" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
      </div>
      <label className="lbl">
        Surovina (co se kupuje)
        <input
          className="finput"
          list="queue-ingredients"
          value={ingredientName}
          onChange={(e) => setIngredientName(e.target.value)}
          placeholder="např. smetana ke šlehání"
          autoFocus={!uncertain}
        />
        <datalist id="queue-ingredients">
          {ingredients?.map((i) => <option key={i._id} value={i.name} />)}
        </datalist>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {uncertain ? "✓ Takhle je to správně" : "Doplnit"}
      </button>
      <button
        className="btn danger"
        type="button"
        disabled={busy}
        onClick={() => void act(() => remove({ lineId: line._id }))}
      >
        Smazat řádek
      </button>
    </form>
  );
}
