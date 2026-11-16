import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
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
          <h2>{title}</h2>
          {children}
        </div>
      </div>
    </>
  );
}

export const STAGES = [
  { id: "upload", label: "Nahrávám fotky" },
  { id: "read", label: "Čtu recept" },
  { id: "match", label: "Páruji suroviny" },
] as const;
export type Stage = (typeof STAGES)[number]["id"];

/** The photo with a moving scan line and the current reading stage. */
export function ScanView({ photoUrl, stage }: { photoUrl: string | null; stage: Stage }) {
  const at = STAGES.findIndex((s) => s.id === stage);
  return (
    <>
      <div className="scanwrap">
        {photoUrl ? <img src={photoUrl} alt="Fotka receptu" /> : <div className="scan-empty" />}
        <div className="scanline" />
        <div className="scanmsg" aria-live="polite">
          {STAGES[at].label}…
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

type Photo = { _id: string; url: string | null };

/** Recipe Photos pinned at the top of the screen; zoomable, tap for full screen. */
export function PhotoPane({ photos }: { photos: Photo[] }) {
  const [zoom, setZoom] = useState(false);
  const [viewer, setViewer] = useState(false);
  const first = photos[0];
  if (!first?.url) return null;
  return (
    <>
      <div className="photopane">
        <div className={`photoscroll${zoom ? " zoom" : ""}`}>
          <img src={first.url} alt="Fotka receptu" onClick={() => setViewer(true)} />
        </div>
        <div className="pctl">
          <button type="button" onClick={() => setZoom((z) => !z)}>
            {zoom ? "− zmenšit" : "＋ zvětšit"}
          </button>
          {photos.length > 1 && (
            <button type="button" onClick={() => setViewer(true)}>
              {photos.length} str.
            </button>
          )}
        </div>
      </div>
      {viewer && <PhotoViewer photos={photos} onClose={() => setViewer(false)} />}
    </>
  );
}

/** Full-screen photo pages; pinch-zoom works natively, the button doubles the width. */
export function PhotoViewer({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Fotky receptu">
      <div className={`vimg${zoom ? " zoom" : ""}`}>
        {photos.map((p, i) =>
          p.url ? <img key={p._id} src={p.url} alt={`Stránka ${i + 1}`} /> : null,
        )}
      </div>
      <div className="vbar">
        <button type="button" onClick={() => setZoom((z) => !z)}>
          {zoom ? "− Zmenšit" : "＋ Zvětšit"}
        </button>
        <span>{photos.length > 1 ? `${photos.length} stránky` : ""}</span>
        <button type="button" onClick={onClose}>
          ✕ Zavřít
        </button>
      </div>
    </div>
  );
}
