import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { today } from "@convex/lib/dates";
import { errorMessage } from "~/lib/format";
import { useOnline } from "~/pwa";
import {
  FilterBar,
  IngredientSheet,
  NoResults,
  RecipeSheet,
  Shelves,
  TileGrid,
  type LibraryItem,
} from "~/components/recipes/library";
import {
  LIBRARY_SHELVES,
  NO_FILTERS,
  isSearching,
  query,
  resultsLabel,
  shelves,
  type Filters,
  type ShelfKey,
} from "~/lib/library";

const SHELF_KEYS = LIBRARY_SHELVES;

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
      body = <Shelves list={list} onShelf={openShelf} onOpen={setOpen} />;
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
          <FilterBar filters={filters} onChange={set} onIngredients={() => setIngSheet(true)} />
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
