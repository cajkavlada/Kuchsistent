import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { CATEGORY_LABEL, errorMessage, portionsLabel } from "~/lib/format";
import { amountUnit, type RecipeView } from "./Review";
import { PhotoPane, ScanView, TopBar } from "./ui";

/** The AI is reading the photos; the action finishes even if the app is closed. */
export function Reading({ recipe }: { recipe: RecipeView }) {
  return (
    <section className="page">
      <TopBar title="Čtu recept" />
      <ScanView photoUrl={recipe.photos[0]?.url ?? null} stage="read" />
      <p className="muted small center-text">
        Obvykle 5–20 s. Když aplikaci zavřeš, čtení doběhne a koncept najdeš
        v knihovně v Rozpracovaných.
      </p>
      {recipe.extraction?.stale && <RetryButtons recipe={recipe} />}
    </section>
  );
}

/** Reading failed (the full set of ways out comes with #21). */
export function ReadingFailed({ recipe }: { recipe: RecipeView }) {
  return (
    <section className="page">
      <TopBar title="Nepodařilo se přečíst" />
      <p className="banner warn">Recept se z fotky nepodařilo přečíst.</p>
      <PhotoPane photos={recipe.photos} />
      <RetryButtons recipe={recipe} />
    </section>
  );
}

function RetryButtons({ recipe }: { recipe: RecipeView }) {
  const retry = useMutation(api.recipes.retryExtraction);
  const discard = useMutation(api.recipes.discard);
  const navigate = useNavigate();
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
  return (
    <div className="stack">
      <button className="btn primary" disabled={busy} onClick={() => act(() => retry({ recipeId: recipe._id }))}>
        Zkusit znovu
      </button>
      <button
        className="btn danger"
        disabled={busy}
        onClick={() =>
          act(async () => {
            await discard({ recipeId: recipe._id });
            await navigate({ to: "/recepty", replace: true });
          })
        }
      >
        Zahodit
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** After "Uložit recept". */
export function Saved({ recipe }: { recipe: RecipeView }) {
  return (
    <section className="page">
      <TopBar title="Uloženo" />
      <div className="saved">
        <div className="tick" aria-hidden="true">✓</div>
        <b>„{recipe.name}“ je v knihovně.</b>
        <p className="muted small">
          {recipe.lines.length} surovin · {recipe.steps.length} kroků
        </p>
      </div>
      {/* Planning arrives with the day plan (#23). */}
      <Link to="/plan" className="btn primary">
        Naplánovat
      </Link>
      <Link to="/recepty/vyfotit" className="btn">
        📷 Vyfotit další recept
      </Link>
      <Link to="/recepty" className="btn ghost">
        Do knihovny
      </Link>
    </section>
  );
}

/** A confirmed Recipe, read-only for now. */
export function RecipeDetail({ recipe }: { recipe: RecipeView }) {
  return (
    <section className="page">
      <TopBar title={recipe.name} />
      <PhotoPane photos={recipe.photos} />
      <p className="muted">
        {CATEGORY_LABEL[recipe.category]}
        {recipe.baseServings ? ` · ${portionsLabel(recipe.baseServings)}` : ""}
      </p>
      <h3 className="sec">Suroviny</h3>
      <div className="rcard">
        {recipe.lines.map((l) => (
          <div key={l._id} className="sumline">
            <span>{amountUnit(l)}</span>
            <span className="printed">{l.raw}</span>
          </div>
        ))}
      </div>
      <h3 className="sec">Postup</h3>
      <ol className="steps">
        {recipe.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </section>
  );
}
