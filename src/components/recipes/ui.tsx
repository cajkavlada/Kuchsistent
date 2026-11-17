import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage } from "~/lib/format";

/** Sticky screen header with a back link to the library. */
export function TopBar({ title, back = true }: { title: string; back?: boolean }) {
  return (
    <header className="topbar">
      {back && (
        <Link to="/recepty" className="navb" aria-label="Zpět do knihovny">
          ‹
        </Link>
      )}
      <h1>{title}</h1>
    </header>
  );
}

/** Bottom sheet over the screen; tap the shade to close. */
export function Sheet({
  title,
  onClose,
  children,
  hideTitle = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The content shows the title itself; keep it for screen readers only. */
  hideTitle?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="shade" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-in">
          <h2 className={hideTitle ? "sr-only" : undefined}>{title}</h2>
          {children}
        </div>
      </div>
    </>
  );
}

/** Where a recipe sits on a spread photo, as the AI reports it. */
export const PAGE_SIDE: Record<string, string> = { left: "levá strana", right: "pravá strana" };

export const STAGES = [
  { id: "upload", label: "Nahrávám fotky" },
  { id: "read", label: "Čtu recept" },
  { id: "match", label: "Páruji suroviny" },
] as const;
export type Stage = (typeof STAGES)[number]["id"];

/** The photo with a moving scan line and the current reading stage. */
export function ScanView({
  photoUrl,
  stage,
  pages = 1,
}: {
  photoUrl: string | null;
  stage: Stage;
  pages?: number;
}) {
  const at = STAGES.findIndex((s) => s.id === stage);
  return (
    <>
      <div className="scanwrap">
        {photoUrl ? <img src={photoUrl} alt="Fotka receptu" /> : <div className="scan-empty" />}
        <div className="scanline" />
        <div className="scanmsg" aria-live="polite">
          {STAGES[at].label}…{pages > 1 ? ` (${pages} str.)` : ""}
        </div>
      </div>
      <ol className="stages">
        {STAGES.map((s, i) => (
          <li key={s.id} className={i < at ? "done" : i === at ? "cur" : ""}>
            {i < at ? "✓" : i === at ? "●" : "○"} {s.label}
          </li>
        ))}
      </ol>
    </>
  );
}

type Photo = { _id: string; url: string | null; cover?: boolean };

/**
 * Recipe Photos at the top of the screen. Small by default: the user usually
 * has the book next to the phone. "Zvětšit" pins a larger, zoomable pane;
 * "Celá obrazovka" (or tapping the photo) opens all photos full screen.
 * The pane shows the pages; a Cover Photo (#58) is only in the full screen.
 * `editable`: the full screen can change which photo is the Cover Photo.
 */
export function PhotoPane({ photos, editable = false }: { photos: Photo[]; editable?: boolean }) {
  const [size, setSize] = useState<"small" | "large">("small");
  const [zoom, setZoom] = useState(false);
  const [viewer, setViewer] = useState(false);
  const pages = photos.some((p) => !p.cover) ? photos.filter((p) => !p.cover) : photos;
  const first = pages[0];
  if (!first?.url) return null;
  const many = pages.length > 1;
  const hasCover = pages.length < photos.length;
  const count = many ? ` (${pages.length} str.)` : "";
  return (
    <>
      {size === "small" ? (
        <div className="photostrip">
          <button
            type="button"
            className="pthumb"
            onClick={() => setViewer(true)}
            aria-label={many ? `Všech ${pages.length} stránek na celou obrazovku` : "Fotka na celou obrazovku"}
          >
            <img src={first.url} alt="Fotka receptu" />
            {many && <span className="pcount">{pages.length} str.</span>}
          </button>
          <span className="muted small grow">
            {many ? `Fotky receptu · ${pages.length} str.` : "Fotka receptu"}
            {hasCover && " · 🍽 náhled"}
          </span>
          <button type="button" className="chip" onClick={() => setSize("large")}>
            Zvětšit
          </button>
          <button type="button" className="chip" onClick={() => setViewer(true)} aria-label="Celá obrazovka">
            ⛶
          </button>
        </div>
      ) : (
        <div className="photopane">
          <div className={`photoscroll${zoom ? " zoom" : ""}`}>
            <img src={first.url} alt="Fotka receptu" onClick={() => setViewer(true)} />
          </div>
          {many && (
            <button type="button" className="pcount big" onClick={() => setViewer(true)}>
              {pages.length} str.
            </button>
          )}
          <div className="pctl">
            <button type="button" onClick={() => setZoom((z) => !z)}>
              {zoom ? "− detail" : "＋ detail"}
            </button>
            <button type="button" onClick={() => setViewer(true)}>
              ⛶ Celá obrazovka{count}
            </button>
            <button
              type="button"
              onClick={() => {
                setSize("small");
                setZoom(false);
              }}
            >
              Zmenšit
            </button>
          </div>
        </div>
      )}
      {viewer && <PhotoViewer photos={photos} editable={editable} onClose={() => setViewer(false)} />}
    </>
  );
}

/**
 * Full-screen photos; pinch-zoom works natively, the button doubles the width.
 * A Cover Photo is labelled "Náhled receptu"; when `editable` (and there is
 * more than one photo) each photo can be made the Cover Photo or a page again.
 */
export function PhotoViewer({
  photos,
  onClose,
  editable = false,
}: {
  photos: Photo[];
  onClose: () => void;
  editable?: boolean;
}) {
  const setCoverPhoto = useMutation(api.recipes.setCoverPhoto);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = editable && photos.length > 1;
  const pages = photos.filter((p) => !p.cover).length;

  async function setCover(photoId: string, cover: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setCoverPhoto({ photoId: photoId as Id<"recipePhotos">, cover });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let page = 0;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Fotky receptu">
      <div className={`vimg${zoom ? " zoom" : ""}`}>
        {photos.map((p) => {
          if (!p.url) return null;
          const label = p.cover ? "Fotka jídla" : `Stránka ${++page}`;
          return (
            <figure key={p._id} className="vpage">
              <img src={p.url} alt={label} />
              {(p.cover || canEdit) && (
                <figcaption className="vcap">
                  {p.cover && <span>🍽 Náhled receptu</span>}
                  {canEdit &&
                    (p.cover ? (
                      <button type="button" disabled={busy} onClick={() => void setCover(p._id, false)}>
                        Je to stránka receptu
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void setCover(p._id, true)}>
                        🍽 Použít jako náhled
                      </button>
                    ))}
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
      {error && (
        <p className="error vcap" role="alert">
          {error}
        </p>
      )}
      <div className="vbar">
        <button type="button" onClick={() => setZoom((z) => !z)}>
          {zoom ? "− Zmenšit" : "＋ Zvětšit"}
        </button>
        <span>{pages > 1 ? `${pages} stránky` : ""}</span>
        <button type="button" onClick={onClose}>
          ✕ Zavřít
        </button>
      </div>
    </div>
  );
}
