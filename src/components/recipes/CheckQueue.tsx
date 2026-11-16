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

export type Line = RecipeView["lines"][number];

/** A check-queue item; only "Nová surovina" so far (the other cards come with #20). */
export type QueueItem = { kind: "newIngredient"; line: Line };

/**
 * The check queue (#9): what needs a person before saving. One "Nová
 * surovina" per proposed Ingredient not yet approved; lines proposing the same
 * name share one card.
 */
export function checkQueue(lines: Line[]): QueueItem[] {
  const seen = new Set<string>();
  const out: QueueItem[] = [];
  for (const line of lines) {
    if (!line.proposed || line.proposed.approved) continue;
    const key = ingredientKey(line.proposed.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "newIngredient", line });
  }
  return out;
}

/** Ingredient name a line shows in the summary: existing, proposed, or none. */
export const lineIngredientName = (l: Line) => l.ingredient?.name ?? l.proposed?.name ?? "";

/** Badges after a line's Ingredient in the summary. */
export function LineBadges({ line }: { line: Line }) {
  return (
    <>
      {line.proposed && (
        <span className="badge b-new">{line.proposed.approved ? "nová ✓" : "nová"}</span>
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
  value: Proposal;
  onChange: (p: Proposal) => void;
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

/** "Nová surovina": accept the AI's guess (edited if needed) or pick an existing one. */
export function NewIngredientCard({ line }: { line: Line }) {
  const approve = useMutation(api.recipes.approveNewIngredient);
  const proposed = line.proposed!;
  const [value, setValue] = useState<Proposal>({
    name: proposed.name,
    freshnessClass: proposed.freshnessClass,
    storeSection: proposed.storeSection,
    measureKind: proposed.measureKind,
  });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (!value.name.trim()) return setError("Doplň název suroviny.");
    setBusy(true);
    setError(null);
    try {
      await approve({ lineId: line._id, proposal: value });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="qcard new">
      <div className="qkind">＋ Nová surovina</div>
      <input
        className="finput qname"
        value={value.name}
        aria-label="Název suroviny"
        onChange={(e) => setValue({ ...value, name: e.target.value })}
      />
      <small className="muted">
        z řádku <span className="printed">„{line.raw}“</span>
      </small>
      <ProposalFields value={value} onChange={setValue} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => void accept()}>
        ✓ Přidat surovinu
      </button>
      <button className="btn ghost" disabled={busy} onClick={() => setPicking(true)}>
        Je to vlastně jiná surovina…
      </button>
      {picking && <IngredientPicker lineId={line._id} onClose={() => setPicking(false)} />}
    </div>
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
