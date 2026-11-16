import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toCalendarDay, today } from "@convex/lib/dates";
import { CATEGORY_LABEL, errorMessage, recipesLabel } from "~/lib/format";
import {
  history,
  historyLine,
  ingredientCounts,
  tileMeta,
  type Row,
} from "~/lib/library";
import { dayLabel } from "~/lib/plan";
import { lineIngredientName } from "./Ingredients";
import { amountUnit, type RecipeView } from "./Review";
import { PhotoViewer, Sheet } from "./ui";

export type LibraryItem = FunctionReturnType<typeof api.recipes.library>["recipes"][number];
export type LibraryRow = Row<LibraryItem>;

// ---------- tiles ----------

/** A Recipe Photo thumbnail, or the "bez fotky" placeholder. */
export function Thumb({ url, className = "" }: { url: string | null; className?: string }) {
  return url ? (
    <img className={`rthumb ${className}`} src={url} alt="" loading="lazy" />
  ) : (
    <span className={`rthumb none ${className}`} aria-hidden="true">
      bez fotky
    </span>
  );
}

/** A photo tile: thumbnail, ★ mark, name (2 lines) and when it was last cooked. */
export function Tile({ row, onOpen }: { row: LibraryRow; onOpen: (id: Id<"recipes">) => void }) {
  const { r, h, m } = row;
  return (
    <button type="button" className="tile" onClick={() => onOpen(r._id)}>
      <span className="tile-img">
        <Thumb url={r.photoUrl} />
        {r.favourite && (
          <span className="stag" aria-label="Oblíbený">
            ★
          </span>
        )}
      </span>
      <span className="tile-nm">{r.name}</span>
      <span className="tile-meta">{tileMeta(h)}</span>
      {m.via.length > 0 && <span className="tile-why">obsahuje {m.via.join(", ")}</span>}
    </button>
  );
}

export function TileGrid({ rows, onOpen }: { rows: LibraryRow[]; onOpen: (id: Id<"recipes">) => void }) {
  return (
    <div className="gridt">
      {rows.map((x) => (
        <Tile key={x.r._id} row={x} onOpen={onOpen} />
      ))}
    </div>
  );
}

// ---------- "Se surovinou" ----------

/**
 * Pick one or more Ingredients; the library then shows only Recipes that
 * contain all of them. Lists Ingredients used by confirmed Recipes, most used first.
 */
export function IngredientSheet({
  recipes,
  picked,
  countFor,
  onChange,
  onClose,
}: {
  recipes: LibraryItem[];
  picked: string[];
  /** How many Recipes the filters would show with this selection. */
  countFor: (picked: string[]) => number;
  onChange: (picked: string[]) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const all = ingredientCounts(recipes);
  const key = filter.trim().toLocaleLowerCase("cs");
  const shown = key ? all.filter((i) => i.name.toLocaleLowerCase("cs").includes(key)) : all;
  const toggle = (name: string) =>
    onChange(picked.includes(name) ? picked.filter((p) => p !== name) : [...picked, name]);
  return (
    <Sheet title="Recepty se surovinou" onClose={onClose}>
      <p className="muted small">Vyber jednu nebo víc. Ukážou se recepty, které obsahují všechny.</p>
      {all.length > 12 && (
        <input
          className="finput"
          type="search"
          placeholder="Najít surovinu…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Najít surovinu"
        />
      )}
      {all.length === 0 ? (
        <p className="muted">Recepty zatím nemají žádné suroviny.</p>
      ) : (
        <div className="chips">
          {shown.map((i) => (
            <button
              key={i.name}
              type="button"
              className={`chip${picked.includes(i.name) ? " on" : ""}`}
              aria-pressed={picked.includes(i.name)}
              onClick={() => toggle(i.name)}
            >
              {i.name}
            </button>
          ))}
        </div>
      )}
      <div className="frow">
        {picked.length > 0 && (
          <button type="button" className="btn ghost" onClick={() => onChange([])}>
            Vymazat
          </button>
        )}
        <button type="button" className="btn primary grow" onClick={onClose}>
          Ukázat {recipesLabel(countFor(picked))}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- detail ----------

/** "16. 11. 2026" */
function fullDate(instant: number): string {
  const [y, m, d] = toCalendarDay(instant).split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

/**
 * A confirmed Recipe's header, history, actions and Ingredients: the body of
 * the library's detail sheet and the top of the Recipe screen.
 */
export function RecipeInfo({ recipe, onGone }: { recipe: RecipeView; onGone: () => void }) {
  const setFavourite = useMutation(api.recipes.setFavourite);
  const [viewer, setViewer] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = history(recipe.mealDates, today());
  const photo = recipe.photos[0]?.url ?? null;

  async function toggleFavourite() {
    setError(null);
    try {
      await setFavourite({ recipeId: recipe._id, favourite: !recipe.favourite });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="dhead">
        {photo ? (
          <button type="button" className="dthumb" onClick={() => setViewer(true)} aria-label="Fotka receptu">
            <Thumb url={photo} />
          </button>
        ) : (
          <Thumb url={null} className="dthumb" />
        )}
        <div className="dhead-t">
          <b className="dname">{recipe.name}</b>
          <span className="muted small">
            {CATEGORY_LABEL[recipe.category]} · přidáno {fullDate(recipe._creationTime)}
          </span>
          <button
            type="button"
            className={`star${recipe.favourite ? " on" : ""}`}
            aria-pressed={recipe.favourite}
            onClick={() => void toggleFavourite()}
          >
            {recipe.favourite ? "★ Oblíbený" : "☆ Přidat k oblíbeným"}
          </button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="hist">
        <span>{historyLine(h)}</span>
        {h.recent.length > 0 && <span className="muted small">{h.recent.map(dayLabel).join(" · ")}</span>}
        {h.next && <b>V plánu: {dayLabel(h.next)}</b>}
      </div>

      <Link to="/plan" search={{ naplanovat: recipe._id }} className="btn primary">
        📅 Naplánovat
      </Link>

      <h3 className="sec">Suroviny</h3>
      <div className="rcard">
        {recipe.lines.map((l) => (
          <div key={l._id} className="sumline">
            <span>{amountUnit(l)}</span>
            <span>
              {lineIngredientName(l) || <span className="printed">{l.raw}</span>}
              {l.optional && <small className="muted"> (volitelné)</small>}
            </span>
          </div>
        ))}
        {recipe.lines.length === 0 && <p className="muted pad">Žádné suroviny.</p>}
      </div>

      <div className="frow">
        <Link
          to="/recepty/$recipeId"
          params={{ recipeId: recipe._id }}
          search={{ upravit: true }}
          className="btn grow"
        >
          ✎ Upravit recept
        </Link>
        <button type="button" className="btn danger grow" onClick={() => setArchiving(true)}>
          Archivovat
        </button>
      </div>

      {viewer && <PhotoViewer photos={recipe.photos} onClose={() => setViewer(false)} />}
      {archiving && (
        <ArchiveSheet
          recipeId={recipe._id}
          neverPlanned={recipe.mealDates.length === 0}
          onClose={() => setArchiving(false)}
          onDone={onGone}
        />
      )}
    </>
  );
}

/** The library's detail sheet; loads the full Recipe when opened. */
export function RecipeSheet({ recipeId, onClose }: { recipeId: Id<"recipes">; onClose: () => void }) {
  const recipe = useQuery(api.recipes.get, { recipeId });
  const gone = recipe === null || recipe?.archived || recipe?.status === "draft";
  return (
    <Sheet title={recipe?.name ?? "Recept"} onClose={onClose} hideTitle>
      {recipe === undefined ? (
        <p className="muted">Načítám…</p>
      ) : gone ? (
        <p className="muted">Tenhle recept už v knihovně není.</p>
      ) : (
        <>
          <RecipeInfo recipe={recipe} onGone={onClose} />
          <Link to="/recepty/$recipeId" params={{ recipeId }} className="btn ghost">
            Celý recept s postupem ›
          </Link>
        </>
      )}
    </Sheet>
  );
}

/**
 * "Archivovat": hidden from the library and picker, meals already planned
 * keep it. A Recipe that was never planned may instead be deleted for good.
 */
function ArchiveSheet({
  recipeId,
  neverPlanned,
  onClose,
  onDone,
}: {
  recipeId: Id<"recipes">;
  neverPlanned: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const archive = useMutation(api.recipes.archive);
  const deleteForever = useMutation(api.recipes.deleteForever);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
      await navigate({ to: "/recepty", replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Sheet title="Archivovat recept?" onClose={onClose}>
      <p className="muted">
        Recept zmizí z knihovny i z výběru do plánu. Jídla, která už jsou v plánu, zůstanou.
      </p>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => archive({ recipeId }))}>
        Archivovat
      </button>
      {neverPlanned && (
        <>
          <p className="muted small">Recept ještě nikdy nebyl v plánu, takže ho můžeš i úplně smazat i s fotkami.</p>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => void run(() => deleteForever({ recipeId }))}
          >
            Smazat úplně
          </button>
        </>
      )}
      <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
        Zrušit
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}
