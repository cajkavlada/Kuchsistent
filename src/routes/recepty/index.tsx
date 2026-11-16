import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { today } from "@convex/lib/dates";
import { errorMessage } from "~/lib/format";
import { useOnline } from "~/pwa";
import {
  IngredientSheet,
  RecipeSheet,
  Tile,
  TileGrid,
  type LibraryItem,
  type LibraryRow,
} from "~/components/recipes/library";
import {
  NO_FILTERS,
  hasFilters,
  isSearching,
  query,
  resultsLabel,
  shelves,
  type Filters,
  type ShelfKey,
} from "~/lib/library";

const SHELF_KEYS: ShelfKey[] = ["fav", "stale", "often", "new", "all"];

type LibrarySearch = {
  /** "Vše N ›": the whole shelf as a grid. A search param so Back closes it. */
  police?: ShelfKey;
};

export const Route = createFileRoute("/recepty/")({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    police: SHELF_KEYS.includes(search.police as ShelfKey) ? (search.police as ShelfKey) : undefined,
  }),
  component: Library,
});

const CATEGORY_CHIPS = [
  ["main", "Hlavní jídla"],
  ["special", "Speciality"],
  ["all", "Vše"],
] as const;

/** Rail tiles per shelf; the rest is behind "Vše N ›". */
const RAIL_MAX = 12;
/** "Všechny recepty" shows this many as a grid. */
const ALL_PREVIEW = 6;

/**
 * Recepty (#25, decision #12 variant B): drafts under "Rozpracované", then a
 * search, the chip row and shelves of photo tiles. A search or an Ingredient
 * filter swaps the shelves for a results grid.
 */
function Library() {
  const library = useQuery(api.recipes.library);
  const { police } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const createManual = useMutation(api.recipes.createManual);
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [ingSheet, setIngSheet] = useState(false);
  const [open, setOpen] = useState<Id<"recipes"> | null>(null);
  const day = today();

  const recipes = library?.recipes ?? [];
  const rows = useMemo(() => query(recipes, filters, day), [recipes, filters, day]);
  const searching = isSearching(filters);

  const openShelf = (key: ShelfKey) => void navigate({ search: { police: key } });
  const closeShelf = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ search: {}, replace: true });
  };
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  /** "✎ Ručně": an empty draft filled in on the summary (#21). */
  async function manual() {
    setBusy(true);
    setError(null);
    try {
      const recipeId = await createManual();
      await navigate({ to: "/recepty/$recipeId", params: { recipeId } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (library === undefined) {
    return (
      <section className="page">
        <h1>Recepty</h1>
        <p className="muted">Načítám…</p>
      </section>
    );
  }

  let body: React.ReactNode;
  if (recipes.length === 0) {
    body = <p className="muted">Zatím tu nejsou žádné recepty. Vyfoť první z kuchařky.</p>;
  } else if (searching) {
    body = (
      <>
        <div className="count">
          <span>{resultsLabel(rows.length)}</span>
        </div>
        {rows.length ? <TileGrid rows={rows} onOpen={setOpen} /> : <NoResults onReset={() => setFilters(NO_FILTERS)} />}
      </>
    );
  } else {
    const list = shelves(rows);
    const shelf = police && list.find((s) => s.key === police);
    if (police) {
      body = (
        <>
          <div className="count">
            <b>{shelf ? shelf.title : "Police"}</b>
            <button type="button" className="chip" onClick={closeShelf}>
              ‹ Zpět
            </button>
          </div>
          {shelf ? <TileGrid rows={shelf.rows} onOpen={setOpen} /> : <NoResults onReset={() => setFilters(NO_FILTERS)} />}
        </>
      );
    } else if (list.length === 0) {
      body = <NoResults onReset={() => setFilters(NO_FILTERS)} />;
    } else {
      body = list.map((s) => (
        <div key={s.key} className="shelf">
          <div className="shelf-h">
            <h3>
              {s.title} {s.sub && <small>· {s.sub}</small>}
            </h3>
            <button type="button" className="shelf-all" onClick={() => openShelf(s.key)}>
              Vše {s.rows.length} ›
            </button>
          </div>
          {s.key === "all" ? (
            <TileGrid rows={s.rows.slice(0, ALL_PREVIEW)} onOpen={setOpen} />
          ) : (
            <Rail rows={s.rows.slice(0, RAIL_MAX)} onOpen={setOpen} />
          )}
        </div>
      ));
    }
  }

  return (
    <section className="page lib">
      <div className="lib-top">
        <h1>Recepty</h1>
        <Link to="/recepty/vyfotit" className="btn primary">
          📷 Vyfotit
        </Link>
        <button type="button" className="btn" onClick={() => void manual()} disabled={busy || !online}>
          ✎ Ručně
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {library.drafts.length > 0 && <Drafts drafts={library.drafts} />}

      {recipes.length > 0 && (
        <>
          <div className="search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Hledat recept nebo surovinu…"
              value={filters.text}
              onChange={(e) => set({ text: e.target.value })}
              aria-label="Hledat recept nebo surovinu"
              autoComplete="off"
            />
            {filters.text && (
              <button type="button" className="x" aria-label="Smazat hledání" onClick={() => set({ text: "" })}>
                ×
              </button>
            )}
          </div>
          <div className="chips chiprow">
            {CATEGORY_CHIPS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`chip${filters.category === k ? " on" : ""}`}
                aria-pressed={filters.category === k}
                onClick={() => set({ category: k })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`chip${filters.ingredients.length ? " on" : ""}`}
              onClick={() => setIngSheet(true)}
            >
              🥕 {filters.ingredients.length ? filters.ingredients.join(" + ") : "Se surovinou…"}
            </button>
            {hasFilters(filters) && (
              <button type="button" className="chip acc" onClick={() => setFilters(NO_FILTERS)}>
                Zrušit filtry
              </button>
            )}
          </div>
        </>
      )}

      {body}

      {ingSheet && (
        <IngredientSheet
          recipes={recipes}
          picked={filters.ingredients}
          countFor={(ingredients) => query(recipes, { ...filters, ingredients }, day).length}
          onChange={(ingredients) => set({ ingredients })}
          onClose={() => setIngSheet(false)}
        />
      )}
      {open && <RecipeSheet recipeId={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Rail({ rows, onOpen }: { rows: LibraryRow[]; onOpen: (id: Id<"recipes">) => void }) {
  return (
    <div className="rail">
      {rows.map((x) => (
        <Tile key={x.r._id} row={x} onOpen={onOpen} />
      ))}
    </div>
  );
}

function NoResults({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-res">
      <p className="muted">Nic nenalezeno. Zkus jiné slovo nebo zruš filtry.</p>
      <button type="button" className="chip" onClick={onReset}>
        Zrušit hledání a filtry
      </button>
    </div>
  );
}

type Draft = {
  _id: Id<"recipes">;
  name: string;
  photoUrl: string | null;
  extractionState: LibraryItem["extractionState"];
  choosing: boolean;
};

/** Drafts in progress; never on the shelves (#9). Tapping one resumes it. */
function Drafts({ drafts }: { drafts: Draft[] }) {
  return (
    <>
      <h3 className="sec">Rozpracované</h3>
      <ul className="rlist">
        {drafts.map((r) => (
          <li key={r._id}>
            <Link to="/recepty/$recipeId" params={{ recipeId: r._id }} className="rc">
              {r.photoUrl ? (
                <img src={r.photoUrl} alt="" loading="lazy" />
              ) : (
                <span className="ph" aria-hidden="true">🍲</span>
              )}
              <span className="rc-text">
                <b>{r.name || "Nový recept"}</b>
                <span className="muted small">
                  <DraftState r={r} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function DraftState({ r }: { r: Draft }) {
  const state = r.extractionState;
  if (state === "pending")
    return (
      <>
        <span className="mini-spin" aria-hidden="true" /> Čte se…
      </>
    );
  if (state === "failed") return <span className="warn-text">Nepodařilo se přečíst</span>;
  if (r.choosing) return <span className="warn-text">Na fotce je víc receptů – vyber</span>;
  if (state === null && !r.photoUrl) return <>Ruční zápis</>;
  return <>Čeká na kontrolu</>;
}
