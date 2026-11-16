import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  MAX_INGREDIENT_NAME,
  STORE_SECTIONS,
  freshnessLabel,
  ingredientKey,
  type FreshnessClass,
} from "@convex/lib/ingredients";
import { errorMessage } from "~/lib/format";
import { MEASURE_SHORT, ProposalFields, type NewIngredientFields } from "~/components/recipes/Ingredients";
import { Sheet } from "~/components/recipes/ui";

/**
 * Settings → "Suroviny" (#22): the Household's Ingredients grouped by Store
 * Section; tap one to rename, re-class, mark Never Buy or merge a duplicate.
 */

export type Item = FunctionReturnType<typeof api.ingredients.catalogue>[number];
type Days = Partial<Record<FreshnessClass, number | null>>;

const NOT_FOUND = { NOT_FOUND: "Surovina už neexistuje." };

/** "1 recept", "3 recepty", "5 receptů", "v žádném receptu". */
export function recipesLabel(n: number): string {
  if (n === 0) return "v žádném receptu";
  if (n === 1) return "1 recept";
  if (n >= 2 && n <= 4) return `${n} recepty`;
  return `${n} receptů`;
}

/** Items matching the search, grouped by Store Section in walking order. */
export function groupBySection(items: Item[], search: string) {
  const f = ingredientKey(search);
  const shown = f ? items.filter((i) => ingredientKey(i.name).includes(f)) : items;
  return STORE_SECTIONS.map((s) => ({
    ...s,
    items: shown.filter((i) => i.storeSection === s.id),
  })).filter((g) => g.items.length > 0);
}

export function Catalogue() {
  const items = useQuery(api.ingredients.catalogue);
  const household = useQuery(api.households.current);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Id<"ingredients"> | null>(null);
  const groups = useMemo(() => groupBySection(items ?? [], search), [items, search]);
  const days: Days | undefined = household
    ? Object.fromEntries(household.freshness.map((f) => [f.id, f.days]))
    : undefined;
  const selected = items?.find((i) => i._id === open);

  return (
    <section className="page">
      <header className="topbar">
        <Link to="/nastaveni" className="navb" aria-label="Zpět do nastavení">
          ‹
        </Link>
        <h1>Suroviny</h1>
      </header>
      {items === undefined ? (
        <p className="muted">Načítám…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          Zatím tu nejsou žádné suroviny. Přibudou samy, když uložíš první recept.
        </p>
      ) : (
        <>
          <input
            className="finput"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Hledat mezi ${items.length} surovinami…`}
            aria-label="Hledat surovinu"
          />
          {groups.length === 0 && <p className="muted">Nic nenalezeno.</p>}
          {groups.map((g) => (
            <div key={g.id}>
              <h3 className="sec">{g.label}</h3>
              <div className="rcard">
                {g.items.map((i) => (
                  <button key={i._id} className="ingrow" onClick={() => setOpen(i._id)}>
                    <b>
                      {i.name}
                      {i.neverBuy && <span className="badge b-opt">nekupovat</span>}
                    </b>
                    <span className="muted small">
                      {freshnessLabel(i.freshnessClass)} · {MEASURE_SHORT[i.measureKind]} ·{" "}
                      {recipesLabel(i.recipeCount)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {selected && items && (
        <IngredientSheet
          key={selected._id}
          item={selected}
          all={items}
          days={days}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function IngredientSheet({
  item,
  all,
  days,
  onClose,
}: {
  item: Item;
  all: Item[];
  days: Days | undefined;
  onClose: () => void;
}) {
  const update = useMutation(api.ingredients.update);
  const [name, setName] = useState(item.name);
  const [fields, setFields] = useState<NewIngredientFields>({
    freshnessClass: item.freshnessClass,
    storeSection: item.storeSection,
    measureKind: item.measureKind,
  });
  const [neverBuy, setNeverBuy] = useState(item.neverBuy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Merging: picking the other Ingredient, then confirming with it. */
  const [merge, setMerge] = useState<"pick" | Item | null>(null);
  const clash = all.find(
    (i) => i._id !== item._id && name.trim() !== "" && ingredientKey(i.name) === ingredientKey(name),
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (clash) return setMerge(clash);
    setBusy(true);
    setError(null);
    try {
      await update({ ingredientId: item._id, name, ...fields, neverBuy });
      onClose();
    } catch (err) {
      setError(errorMessage(err, undefined, NOT_FOUND));
      setBusy(false);
    }
  }

  if (merge === "pick") {
    return <MergePicker item={item} all={all} onPick={setMerge} onBack={() => setMerge(null)} />;
  }
  if (merge) {
    return <MergeConfirm a={item} b={merge} onDone={onClose} onBack={() => setMerge(null)} />;
  }
  return (
    <Sheet title="Surovina" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="lbl">
          Název
          <input
            className="finput"
            value={name}
            maxLength={MAX_INGREDIENT_NAME}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        {clash && (
          <p className="banner warn small">
            Surovina „{clash.name}“ už existuje. Uložením je sloučíš.
          </p>
        )}
        <ProposalFields value={fields} onChange={setFields} days={days} />
        <label className="check">
          <input type="checkbox" checked={neverBuy} onChange={(e) => setNeverBuy(e.target.checked)} />
          Nikdy nekupovat (např. voda) – nebude na nákupním seznamu
        </label>
        <p className="muted small">Používá se: {recipesLabel(item.recipeCount)}.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Zrušit
          </button>
          <button className="btn primary" disabled={busy}>
            {clash ? "Sloučit…" : busy ? "Ukládám…" : "Uložit"}
          </button>
        </div>
        {all.length > 1 && (
          <button type="button" className="link" onClick={() => setMerge("pick")} disabled={busy}>
            Je to duplicita? Sloučit s jinou surovinou…
          </button>
        )}
      </form>
    </Sheet>
  );
}

function MergePicker({
  item,
  all,
  onPick,
  onBack,
}: {
  item: Item;
  all: Item[];
  onPick: (other: Item) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState("");
  const others = useMemo(() => {
    const f = ingredientKey(filter);
    return all.filter((i) => i._id !== item._id && (!f || ingredientKey(i.name).includes(f)));
  }, [all, item._id, filter]);
  return (
    <Sheet title={`Sloučit „${item.name}“ s…`} onClose={onBack}>
      <input
        className="finput"
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Hledat surovinu…"
        aria-label="Hledat surovinu"
      />
      {others.length === 0 && <p className="muted">Nic nenalezeno.</p>}
      <div className="pickl">
        {others.map((i) => (
          <button key={i._id} className="sumline" onClick={() => onPick(i)}>
            <span>{STORE_SECTIONS.find((s) => s.id === i.storeSection)?.label}</span>
            <b>{i.name}</b>
          </button>
        ))}
      </div>
      <button className="btn" onClick={onBack}>
        Zpět
      </button>
    </Sheet>
  );
}

/** Pick which of the two stays; the other's lines move to it and it disappears. */
function MergeConfirm({
  a,
  b,
  onDone,
  onBack,
}: {
  a: Item;
  b: Item;
  onDone: () => void;
  onBack: () => void;
}) {
  const merge = useMutation(api.ingredients.merge);
  // Usually you open the duplicate and pick the good one, so the picked one stays.
  const [keep, setKeep] = useState<Item>(b);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drop = keep._id === a._id ? b : a;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await merge({ from: drop._id, into: keep._id });
      onDone();
    } catch (err) {
      setError(errorMessage(err, undefined, NOT_FOUND));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Sloučit suroviny" onClose={onBack}>
      <div className="lbl">
        Která zůstane?
        <div className="seg" role="radiogroup">
          {[b, a].map((i) => (
            <button
              key={i._id}
              type="button"
              role="radio"
              aria-checked={keep._id === i._id}
              className={keep._id === i._id ? "on" : ""}
              onClick={() => setKeep(i)}
            >
              {i.name}
            </button>
          ))}
        </div>
      </div>
      <p className="small">
        Recepty se surovinou „{drop.name}“ ({recipesLabel(drop.recipeCount)}) budou používat „
        {keep.name}“. Surovina „{drop.name}“ zmizí. Čerstvost, oddělení a počítání zůstanou podle „
        {keep.name}“.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn" onClick={onBack} disabled={busy}>
          Zpět
        </button>
        <button className="btn primary" onClick={() => void confirm()} disabled={busy}>
          {busy ? "Slučuji…" : "Sloučit"}
        </button>
      </div>
    </Sheet>
  );
}
