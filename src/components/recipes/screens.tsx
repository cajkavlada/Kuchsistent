import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABEL, errorMessage, portionsLabel, recipesLabel } from "~/lib/format";
import { useOnline } from "~/pwa";
import { lineIngredientName } from "./Ingredients";
import { amountUnit, type RecipeView } from "./Review";
import { PAGE_SIDE, PhotoPane, ScanView, TopBar } from "./ui";

/** The AI is reading the photos; the action finishes even if the app is closed. */
export function Reading({ recipe }: { recipe: RecipeView }) {
  return (
    <section className="page">
      <TopBar title="Čtu recept" />
      <ScanView
        photoUrl={recipe.photos[0]?.url ?? null}
        stage={recipe.extraction?.stage === "match" ? "match" : "read"}
        pages={recipe.photos.length}
      />
      <p className="muted small center-text">
        Obvykle 5–20 s. Když aplikaci zavřeš, čtení doběhne a koncept najdeš
        v knihovně v Rozpracovaných.
      </p>
      {recipe.extraction?.stale && (
        <>
          <p className="banner warn">Čtení trvá nezvykle dlouho, nejspíš se ztratilo.</p>
          <FailureActions recipe={recipe} />
        </>
      )}
    </section>
  );
}

/** Reading failed: try again, retake, fill in by hand keeping the photo, or discard (#21). */
export function ReadingFailed({ recipe }: { recipe: RecipeView }) {
  return (
    <section className="page">
      <TopBar title="Nepodařilo se přečíst" />
      <p className="banner warn">Recept se z fotky nepodařilo přečíst.</p>
      {recipe.extraction?.error && (
        <details className="errdetail">
          <summary>Podrobnosti</summary>
          <code>{recipe.extraction.error}</code>
        </details>
      )}
      <PhotoPane photos={recipe.photos} />
      <FailureActions recipe={recipe} />
    </section>
  );
}

function useAct() {
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
  return { busy, error, act };
}

function FailureActions({ recipe }: { recipe: RecipeView }) {
  const retry = useMutation(api.recipes.retryExtraction);
  const fillManually = useMutation(api.recipes.fillManually);
  const discard = useMutation(api.recipes.discard);
  const navigate = useNavigate();
  const online = useOnline();
  const { busy, error, act } = useAct();
  const off = busy || !online;
  return (
    <div className="stack">
      {!online && <NeedsInternet />}
      <button className="btn primary" disabled={off} onClick={() => act(() => retry({ recipeId: recipe._id }))}>
        Zkusit znovu
      </button>
      <button
        className="btn"
        disabled={off}
        onClick={() =>
          act(async () => {
            // The old photo goes; the camera opens for a new one.
            await discard({ recipeId: recipe._id });
            await navigate({ to: "/recepty/vyfotit", replace: true });
          })
        }
      >
        Vyfotit znovu
      </button>
      <button className="btn ghost" disabled={off} onClick={() => act(() => fillManually({ recipeId: recipe._id }))}>
        Vyplnit ručně (fotka zůstane u receptu)
      </button>
      <button
        className="btn danger"
        disabled={off}
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

/** Recipe capture needs the server to read the photo (#13). */
export function NeedsInternet() {
  return (
    <p className="banner warn" role="status">
      Bez připojení. Přečíst recept z fotky jde jen s internetem.
    </p>
  );
}

/**
 * "Na fotce je víc receptů" (#21): the AI found several recipes on the photo.
 * The user picks which to keep; each becomes its own draft sharing the photo,
 * reviewed one after another.
 */
export function ChooseFromPhoto({ recipe }: { recipe: RecipeView }) {
  const choose = useMutation(api.recipes.chooseFromPhoto);
  const navigate = useNavigate();
  const online = useOnline();
  const drafts = recipe.spread?.drafts ?? [];
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const { busy, error, act } = useAct();
  const keep = drafts.filter((d) => !skip.has(d._id)).map((d) => d._id as Id<"recipes">);
  const toggle = (id: string) =>
    setSkip((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="page with-bar">
      <TopBar title="Na fotce je víc receptů" />
      <PhotoPane photos={recipe.photos} />
      <p>
        Na fotce jsou <b>{recipesLabel(drafts.length)}</b>. Každý se uloží zvlášť, fotka zůstane
        u všech. Vyber, které chceš.
      </p>
      <div className="stack">
        {drafts.map((d) => {
          const wanted = !skip.has(d._id);
          const side = d.pageSide ? PAGE_SIDE[d.pageSide] : undefined;
          return (
            <button
              key={d._id}
              type="button"
              className={`spread-pick${wanted ? " on" : ""}`}
              aria-pressed={wanted}
              onClick={() => toggle(d._id)}
            >
              <span className="grow">
                <b>{d.name || "Recept bez názvu"}</b>
                <span className="muted small">
                  {[side, d.extractionState === "pending" ? "čte se…" : `${d.lineCount} surovin`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="chip">{wanted ? "✓ Chci" : "Nechci"}</span>
            </button>
          );
        })}
      </div>
      {!online && <NeedsInternet />}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bottombar">
        <button
          className={`btn grow ${keep.length ? "primary" : "danger"}`}
          disabled={busy || !online}
          onClick={() =>
            act(async () => {
              const first = await choose({ recipeId: recipe._id, keep });
              if (first) await navigate({ to: "/recepty/$recipeId", params: { recipeId: first }, replace: true });
              else await navigate({ to: "/recepty", replace: true });
            })
          }
        >
          {keep.length === 0
            ? "Nechci žádný – zahodit"
            : keep.length === 1
              ? "Zkontrolovat vybraný ›"
              : `Zkontrolovat vybrané (${keep.length}) ›`}
        </button>
      </div>
    </section>
  );
}

/** After "Uložit recept". */
export function Saved({ recipe }: { recipe: RecipeView }) {
  // Another draft from the same photo, ready to review.
  const next = recipe.spread?.drafts.find(
    (d) => d._id !== recipe._id && !d.choosing && d.extractionState === "done",
  );
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
      {next && (
        <Link to="/recepty/$recipeId" params={{ recipeId: next._id }} replace className="btn primary">
          Další z fotky: {next.name || "recept bez názvu"} ›
        </Link>
      )}
      <Link to="/plan" search={{ naplanovat: recipe._id }} className={`btn${next ? "" : " primary"}`}>
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
