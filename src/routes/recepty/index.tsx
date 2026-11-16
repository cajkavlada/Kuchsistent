import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { CATEGORY_LABEL, errorMessage, portionsLabel } from "~/lib/format";
import { useOnline } from "~/pwa";

export const Route = createFileRoute("/recepty/")({
  component: Library,
});

type Item = FunctionReturnType<typeof api.recipes.library>["recipes"][number];

/** Recepty: drafts in progress, then confirmed Recipes as a simple list (shelves come with #25). */
function Library() {
  const library = useQuery(api.recipes.library);
  const createManual = useMutation(api.recipes.createManual);
  const navigate = useNavigate();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="page">
      <h1>Recepty</h1>
      <div className="frow">
        <Link to="/recepty/vyfotit" className="btn primary grow">
          📷 Vyfotit recept
        </Link>
        <button className="btn" onClick={manual} disabled={busy || !online}>
          ✎ Ručně
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {library === undefined ? (
        <p className="muted">Načítám…</p>
      ) : (
        <>
          {library.drafts.length > 0 && (
            <>
              <h3 className="sec">Rozpracované</h3>
              <ul className="rlist">
                {library.drafts.map((r) => (
                  <RecipeRow key={r._id} r={r} sub={<DraftState r={r} />} />
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

function DraftState({ r }: { r: Item }) {
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
