import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  FRESHNESS_CLASSES,
  MEASURE_KINDS,
  STORE_SECTIONS,
  ingredientKey,
  type Proposal,
} from "@convex/lib/ingredients";
import { errorMessage } from "~/lib/format";
import type { RecipeView } from "./Review";
import { Sheet } from "./ui";

/**
 * Ingredient pieces of recipe review (#19): new Ingredients the AI proposes
 * are created on save; the summary marks them "nová" and the line sheet edits
 * their details or maps the line to an existing Ingredient instead.
 */

export type Line = RecipeView["lines"][number];

/** Ingredient name a line shows in the summary: existing, proposed, or none. */
export const lineIngredientName = (l: Line) => l.ingredient?.name ?? l.proposed?.name ?? "";

export type NewIngredientFields = Omit<Proposal, "name">;

export const MEASURE_SHORT = { weight: "g", volume: "ml", count: "ks" } as const;

/** Badges after a line's Ingredient in the summary; a new one shows how it is counted. */
export function LineBadges({ line }: { line: Line }) {
  return (
    <>
      {line.uncertain && <span className="badge b-warn">nejisté</span>}
      {line.proposed && (
        <span className="badge b-new">nová · {MEASURE_SHORT[line.proposed.measureKind]}</span>
      )}
      {line.optional && <span className="badge b-opt">volitelné</span>}
      {!line.ingredient && !line.proposed && <span className="badge b-warn">bez suroviny</span>}
    </>
  );
}

/** Freshness Class, Store Section and Measure Kind of a new Ingredient. */
export function ProposalFields({
  value,
  onChange,
}: {
  value: NewIngredientFields;
  onChange: (p: NewIngredientFields) => void;
}) {
  return (
    <>
      <div className="lbl">
        Čerstvost (jak dlouho vydrží po nákupu)
        <div className="chips" role="radiogroup">
          {FRESHNESS_CLASSES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={value.freshnessClass === f.id}
              className={`chip${value.freshnessClass === f.id ? " on" : ""}`}
              onClick={() => onChange({ ...value, freshnessClass: f.id })}
            >
              {f.label}
              {f.days !== null ? ` · ${f.days} d` : ""}
            </button>
          ))}
        </div>
      </div>
      <label className="lbl">
        Oddělení v obchodě
        <select
          className="finput"
          value={value.storeSection}
          onChange={(e) => onChange({ ...value, storeSection: e.target.value as Proposal["storeSection"] })}
        >
          {STORE_SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="lbl">
        Počítá se na
        <div className="seg" role="radiogroup">
          {MEASURE_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={value.measureKind === k.id}
              className={value.measureKind === k.id ? "on" : ""}
              onClick={() => onChange({ ...value, measureKind: k.id })}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Pick an existing Household Ingredient for a line. */
export function IngredientPicker({
  lineId,
  onClose,
}: {
  lineId: Id<"ingredientLines">;
  onClose: () => void;
}) {
  const ingredients = useQuery(api.ingredients.list);
  const map = useMutation(api.recipes.mapToIngredient);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => {
    const f = ingredientKey(filter);
    return (ingredients ?? []).filter((i) => !f || ingredientKey(i.name).includes(f));
  }, [ingredients, filter]);

  async function pick(ingredientId: Id<"ingredients">) {
    setBusy(true);
    setError(null);
    try {
      await map({ lineId, ingredientId });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Která surovina to je?" onClose={onClose}>
      <input
        className="finput"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Hledat surovinu…"
        aria-label="Hledat surovinu"
      />
      {ingredients === undefined && <p className="muted">Načítám…</p>}
      {ingredients?.length === 0 && (
        <p className="muted">Domácnost zatím nemá žádné uložené suroviny.</p>
      )}
      {ingredients && ingredients.length > 0 && shown.length === 0 && (
        <p className="muted">Nic nenalezeno.</p>
      )}
      <div className="pickl">
        {shown.map((i) => (
          <button key={i._id} className="sumline" disabled={busy} onClick={() => void pick(i._id)}>
            <span>{STORE_SECTIONS.find((s) => s.id === i.storeSection)?.label}</span>
            <b>{i.name}</b>
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" onClick={onClose} disabled={busy}>
        Zpět
      </button>
    </Sheet>
  );
}
