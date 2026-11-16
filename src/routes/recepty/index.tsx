import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { CATEGORY_LABEL, portionsLabel } from "~/lib/format";

export const Route = createFileRoute("/recepty/")({
  component: Library,
});

type Item = FunctionReturnType<typeof api.recipes.library>["recipes"][number];

/** Recepty: drafts in progress, then confirmed Recipes as a simple list (shelves come with #25). */
function Library() {
  const library = useQuery(api.recipes.library);
  return (
    <section className="page">
      <h1>Recepty</h1>
      <Link to="/recepty/vyfotit" className="btn primary">
        📷 Vyfotit recept
      </Link>

      {library === undefined ? (
        <p className="muted">Načítám…</p>
      ) : (
        <>
          {library.drafts.length > 0 && (
            <>
              <h3 className="sec">Rozpracované</h3>
              <ul className="rlist">
                {library.drafts.map((r) => (
                  <RecipeRow key={r._id} r={r} sub={<DraftState state={r.extractionState} />} />
                ))}
              </ul>
            </>
          )}
          <h3 className="sec">Moje recepty</h3>
          {library.recipes.length === 0 ? (
            <p className="muted">Zatím tu nejsou žádné recepty. Vyfoť první z kuchařky.</p>
          ) : (
            <ul className="rlist">
              {library.recipes.map((r) => (
                <RecipeRow
                  key={r._id}
                  r={r}
                  sub={`${CATEGORY_LABEL[r.category]}${r.baseServings ? ` · ${portionsLabel(r.baseServings)}` : ""}`}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function RecipeRow({ r, sub }: { r: Item; sub: React.ReactNode }) {
  return (
    <li>
      <Link to="/recepty/$recipeId" params={{ recipeId: r._id }} className="rc">
        {r.photoUrl ? (
          <img src={r.photoUrl} alt="" loading="lazy" />
        ) : (
          <span className="ph" aria-hidden="true">🍲</span>
        )}
        <span className="rc-text">
          <b>{r.name || "Nový recept"}</b>
          <span className="muted small">{sub}</span>
        </span>
      </Link>
    </li>
  );
}

function DraftState({ state }: { state: Item["extractionState"] }) {
  if (state === "pending")
    return (
      <>
        <span className="mini-spin" aria-hidden="true" /> Čte se…
      </>
    );
  if (state === "failed") return <span className="warn-text">Nepodařilo se přečíst</span>;
  return <>Čeká na kontrolu</>;
}
