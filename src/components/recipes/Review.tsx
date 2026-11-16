import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CATEGORY_LABEL,
  errorMessage,
  formatAmount,
  parseAmount,
  portionsLabel,
  recipesLabel,
} from "~/lib/format";
import { defaultProposal, ingredientKey } from "@convex/lib/ingredients";
import {
  IngredientPicker,
  LineBadges,
  ProposalFields,
  lineIngredientName,
  type Line,
  type NewIngredientFields,
} from "./Ingredients";
import { QueueCard, checkQueue } from "./CheckQueue";
import { PAGE_SIDE, PhotoPane, Sheet, TopBar } from "./ui";

export type RecipeView = NonNullable<FunctionReturnType<typeof api.recipes.get>>;

type SheetState =
  | { kind: "basics" }
  | { kind: "steps" }
  | { kind: "line"; line: Line | null }
  | { kind: "discard" };

/** "1 nová surovina se přidá", "3 nové suroviny se přidají", "5 nových surovin se přidá". */
function newIngredientsLabel(n: number): string {
  if (n === 1) return "1 nová surovina se přidá do domácnosti";
  if (n >= 2 && n <= 4) return `${n} nové suroviny se přidají do domácnosti`;
  return `${n} nových surovin se přidá do domácnosti`;
}

export const amountUnit = (l: { amount?: number; unit?: string }) =>
  [formatAmount(l.amount), l.unit].filter(Boolean).join(" ");

/**
 * Review of a Draft Recipe (#9, variant C): the photo pinned on top, then the
 * check queue one card at a time ("Ke kontrole ještě N", #20), then the
 * summary: name, category, portions, Ingredient Lines and steps. Tapping any
 * row opens an edit sheet; every edit is saved to the draft straight away.
 * New Ingredients carry a "nová" badge and are created on save, no approval
 * step. Saving needs an empty check queue.
 */
export function Review({ recipe, onSaved }: { recipe: RecipeView; onSaved: () => void }) {
  const confirm = useMutation(api.recipes.confirm);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [skipped, setSkipped] = useState(false);
  const others = (recipe.spread?.drafts.length ?? 1) - 1;
  const side = recipe.spread?.pageSide ? PAGE_SIDE[recipe.spread.pageSide] : undefined;
  // A recipe from a photo with several (#21): say which one this is.
  const fromPhoto = others > 0 && (
    <p className="muted small">
      Z této fotky je ještě {recipesLabel(others)}{side ? `; tohle je ${side}` : ""}.
    </p>
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => setSheet(null);
  const hasName = recipe.name.trim() !== "";
  const queue = checkQueue(recipe);

  if (queue.length > 0 && !skipped) {
    return (
      <section className="page">
        <TopBar title={recipe.name || "Kontrola"} />
        <PhotoPane photos={recipe.photos} />
        {fromPhoto}
        <p className="qcount">
          Ke kontrole ještě {queue.length}
          <button className="link inline" onClick={() => setSkipped(true)}>
            Přeskočit na shrnutí
          </button>
        </p>
        <QueueCard recipe={recipe} item={queue[0]} />
      </section>
    );
  }

  const newCount = new Set(
    recipe.lines.flatMap((l) => (l.proposed ? [ingredientKey(l.proposed.name)] : [])),
  ).size;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await confirm({ recipeId: recipe._id });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page with-bar">
      <TopBar title={recipe.name || (recipe.photos.length ? "Shrnutí" : "Nový recept")} />
      <PhotoPane photos={recipe.photos} />
      {queue.length > 0 ? (
        <div className="banner warn frow">
          <span className="grow">Zbývá {queue.length} k ověření.</span>
          <button className="chip" onClick={() => setSkipped(false)}>
            Projít
          </button>
        </div>
      ) : (
        <p className="banner">✓ Vše zkontrolováno. Ťukni na cokoli pro úpravu.</p>
      )}
      {fromPhoto}

      <div className="rcard">
        <button className="sumline" onClick={() => setSheet({ kind: "basics" })}>
          <span>Název</span>
          {hasName ? <b>{recipe.name}</b> : <span className="warn-text">Doplň název</span>}
        </button>
        <button className="sumline" onClick={() => setSheet({ kind: "basics" })}>
          <span>Druh · porce</span>
          <span>
            {CATEGORY_LABEL[recipe.category]} ·{" "}
            {recipe.baseServings
              ? portionsLabel(recipe.baseServings)
              : recipe.servingsUnknown
                ? "výchozí domácnosti"
                : "neuvedeno"}
          </span>
        </button>
      </div>

      <h3 className="sec">Suroviny</h3>
      {newCount > 0 && (
        <p className="muted small">
          {newIngredientsLabel(newCount)} při uložení. Ťukni na řádek pro úpravu, nebo když
          je to vlastně jiná surovina.
        </p>
      )}
      <div className="rcard">
        {recipe.lines.map((l) => (
          <button key={l._id} className="sumline" onClick={() => setSheet({ kind: "line", line: l })}>
            <span>{amountUnit(l)}</span>
            <span>
              {lineIngredientName(l) || <span className="printed">{l.raw}</span>}
              <LineBadges line={l} />
            </span>
          </button>
        ))}
        {recipe.lines.length === 0 && <p className="muted pad">Žádné suroviny.</p>}
      </div>
      <button className="btn ghost" onClick={() => setSheet({ kind: "line", line: null })}>
        + Surovina
      </button>

      <h3 className="sec">Postup</h3>
      {recipe.continuesOffPage && (
        <div className="banner warn frow">
          <span className="grow">📄 Recept asi pokračuje na další stránce.</span>
          <button className="chip" onClick={() => setSkipped(false)}>
            Vyřešit
          </button>
        </div>
      )}
      <div className="rcard">
        {recipe.steps.map((s, i) => (
          <button key={i} className="sumline" onClick={() => setSheet({ kind: "steps" })}>
            <span>{i + 1}.</span>
            <span>{s}</span>
          </button>
        ))}
        {recipe.steps.length === 0 && <p className="muted pad">Bez postupu.</p>}
      </div>
      <button className="btn ghost" onClick={() => setSheet({ kind: "steps" })}>
        Upravit postup
      </button>

      {recipe.extraction?.model && (
        <p className="muted small center-text">Přečteno modelem {recipe.extraction.model}</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="bottombar">
        <button className="btn danger" onClick={() => setSheet({ kind: "discard" })} disabled={busy}>
          Zahodit
        </button>
        <button
          className="btn primary grow"
          onClick={save}
          disabled={busy || !hasName || queue.length > 0}
        >
          {busy
            ? "Ukládám…"
            : queue.length > 0
              ? `Nejdřív zkontroluj (${queue.length})`
              : hasName
                ? "Uložit recept"
                : "Nejdřív doplň název"}
        </button>
      </div>

      {sheet?.kind === "basics" && <BasicsSheet recipe={recipe} onClose={close} />}
      {sheet?.kind === "steps" && <StepsSheet recipe={recipe} onClose={close} />}
      {sheet?.kind === "line" && <LineSheet recipeId={recipe._id} line={sheet.line} onClose={close} />}
      {sheet?.kind === "discard" && <DiscardSheet recipeId={recipe._id} onClose={close} />}
    </section>
  );
}

function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function BasicsSheet({ recipe, onClose }: { recipe: RecipeView; onClose: () => void }) {
  const update = useMutation(api.recipes.updateBasics);
  const [name, setName] = useState(recipe.name);
  const [category, setCategory] = useState(recipe.category);
  const [servings, setServings] = useState<number | undefined>(recipe.baseServings);
  const { busy, error, run } = useSave(onClose);

  return (
    <Sheet title="Základ receptu" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            update({ recipeId: recipe._id, name, category, baseServings: servings }),
          );
        }}
      >
        <label className="lbl">
          Název
          <input
            className="finput"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="např. Kuře na paprice"
          />
        </label>
        <div className="lbl">
          Druh
          <div className="seg" role="radiogroup">
            {(["main", "special"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                className={category === c ? "on" : ""}
                onClick={() => setCategory(c)}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="lbl">
          Porce v receptu
          {servings === undefined ? (
            <div className="frow">
              <span className="muted small grow">Kniha počet porcí neuvádí.</span>
              <button type="button" className="chip" onClick={() => setServings(4)}>
                Zadat
              </button>
            </div>
          ) : (
            <div className="frow">
              <span className="stepper">
                <button type="button" aria-label="Méně porcí" onClick={() => setServings(Math.max(1, servings - 1))}>
                  −
                </button>
                <output aria-live="polite">{servings}</output>
                <button type="button" aria-label="Více porcí" onClick={() => setServings(Math.min(50, servings + 1))}>
                  +
                </button>
              </span>
              <button type="button" className="chip" onClick={() => setServings(undefined)}>
                Nevím
              </button>
            </div>
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          Hotovo
        </button>
      </form>
    </Sheet>
  );
}

function LineSheet({
  recipeId,
  line,
  onClose,
}: {
  recipeId: Id<"recipes">;
  line: Line | null;
  onClose: () => void;
}) {
  const add = useMutation(api.recipes.addLine);
  const update = useMutation(api.recipes.updateLine);
  const remove = useMutation(api.recipes.deleteLine);
  const [raw, setRaw] = useState(line?.raw ?? "");
  const [amount, setAmount] = useState(formatAmount(line?.amount));
  const [unit, setUnit] = useState(line?.unit ?? "");
  const [ingredientName, setIngredientName] = useState(line ? lineIngredientName(line) : "");
  const [optional, setOptional] = useState(line?.optional ?? false);
  const [picking, setPicking] = useState(false);
  const ingredients = useQuery(api.ingredients.list);
  const household = useQuery(api.households.current);
  const days = household
    ? Object.fromEntries(household.freshness.map((f) => [f.id, f.days]))
    : undefined;
  const known = ingredients?.some((i) => ingredientKey(i.name) === ingredientKey(ingredientName));
  const isNew = ingredientName.trim() !== "" && ingredients !== undefined && !known;
  const [fields, setFields] = useState<NewIngredientFields>(() => {
    const p = line?.proposed ?? defaultProposal("", line?.unit);
    return { freshnessClass: p.freshnessClass, storeSection: p.storeSection, measureKind: p.measureKind };
  });
  const { busy, error, setError, run } = useSave(onClose);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseAmount(amount);
    if (Number.isNaN(parsed)) return setError("Množství zadej jako číslo, např. 2,5 nebo ½.");
    // A new line may be typed as just amount + unit + name; the text is required.
    const text = raw.trim();
    if (!text) return setError("Napiš řádek tak, jak je v knize.");
    const value = {
      raw: text,
      amount: parsed,
      unit: unit.trim() || undefined,
      ingredientName: ingredientName.trim(),
      optional,
      newIngredient: isNew ? fields : undefined,
    };
    void run(() => (line ? update({ lineId: line._id, line: value }) : add({ recipeId, line: value })));
  }

  return (
    <>
      <Sheet title={line ? "Řádek suroviny" : "Nový řádek"} onClose={onClose}>
        <form className="stack" onSubmit={submit}>
          <label className="lbl">
            Jak je to v knize
            <input
              className="finput printed"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="např. 25 dkg hladké mouky"
              autoFocus={!line}
            />
          </label>
          <div className="frow">
            <label className="lbl grow">
              Množství
              <input
                className="finput"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25"
              />
            </label>
            <label className="lbl grow">
              Jednotka
              <input
                className="finput"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="dkg, g, l, lžíce…"
              />
            </label>
          </div>
          <label className="lbl">
            Surovina (co se kupuje)
            <input
              className="finput"
              list="household-ingredients"
              value={ingredientName}
              onChange={(e) => setIngredientName(e.target.value)}
              placeholder="např. hladká mouka"
            />
            <datalist id="household-ingredients">
              {ingredients?.map((i) => <option key={i._id} value={i.name} />)}
            </datalist>
          </label>
          {ingredientName.trim() && (
            <small className="muted">
              {known
                ? "✓ Surovina domácnosti"
                : "Nová surovina – přidá se do domácnosti při uložení receptu"}
            </small>
          )}
          {isNew && (
            <div className="newing stack">
              <ProposalFields value={fields} onChange={setFields} days={days} />
            </div>
          )}
          {line && ingredients && ingredients.length > 0 && (
            <button type="button" className="btn ghost" onClick={() => setPicking(true)}>
              {isNew ? "Je to vlastně jiná surovina…" : "Vybrat ze surovin domácnosti…"}
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} />
            Volitelné (na nákupu s poznámkou „volitelné“)
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {line ? "Hotovo" : "Přidat"}
          </button>
          {line && (
            <button
              className="btn danger"
              type="button"
              disabled={busy}
              onClick={() => void run(() => remove({ lineId: line._id }))}
            >
              Smazat řádek
            </button>
          )}
        </form>
      </Sheet>
      {picking && line && <IngredientPicker lineId={line._id} onClose={onClose} />}
    </>
  );
}

function StepsSheet({ recipe, onClose }: { recipe: RecipeView; onClose: () => void }) {
  const update = useMutation(api.recipes.updateSteps);
  const [steps, setSteps] = useState(recipe.steps.length ? recipe.steps : [""]);
  const { busy, error, run } = useSave(onClose);
  const set = (i: number, text: string) => setSteps((s) => s.map((x, j) => (j === i ? text : x)));
  const move = (i: number, d: number) =>
    setSteps((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <Sheet title="Postup" onClose={onClose}>
      <div className="stack">
        {steps.map((s, i) => (
          <div key={i} className="stepedit">
            <span className="no">{i + 1}.</span>
            <textarea
              className="finput"
              value={s}
              aria-label={`Krok ${i + 1}`}
              onChange={(e) => set(i, e.target.value)}
            />
            <div className="ops">
              <button type="button" aria-label="Posunout nahoru" onClick={() => move(i, -1)}>↑</button>
              <button type="button" aria-label="Posunout dolů" onClick={() => move(i, 1)}>↓</button>
              <button
                type="button"
                aria-label="Smazat krok"
                onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <button className="btn ghost" type="button" onClick={() => setSteps((s) => [...s, ""])}>
          + Přidat krok
        </button>
        {error && <p className="error" role="alert">{error}</p>}
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() => void run(() => update({ recipeId: recipe._id, steps }))}
        >
          Hotovo
        </button>
      </div>
    </Sheet>
  );
}

function DiscardSheet({ recipeId, onClose }: { recipeId: Id<"recipes">; onClose: () => void }) {
  const discard = useMutation(api.recipes.discard);
  const navigate = useNavigate();
  const { busy, error, run } = useSave(() => void navigate({ to: "/recepty", replace: true }));
  return (
    <Sheet title="Zahodit recept?" onClose={onClose}>
      <div className="stack">
        <p className="muted">Koncept i s fotkou se smaže.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => void run(() => discard({ recipeId }))}
        >
          Zahodit
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>
          Zpět
        </button>
      </div>
    </Sheet>
  );
}
