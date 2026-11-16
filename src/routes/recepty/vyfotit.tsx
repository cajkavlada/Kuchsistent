import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MAX_PHOTOS } from "@convex/lib/checks";
import { NeedsInternet } from "~/components/recipes/screens";
import { ScanView, TopBar } from "~/components/recipes/ui";
import { errorMessage } from "~/lib/format";
import { resizeToJpeg, uploadJpeg } from "~/lib/photo";
import { movePage, removePage } from "~/lib/pages";
import { useOnline } from "~/pwa";

type CaptureSearch = {
  /** "Vyfotit další stránku": add pages to this Draft Recipe and read it again. */
  recept?: string;
};

export const Route = createFileRoute("/recepty/vyfotit")({
  validateSearch: (search: Record<string, unknown>): CaptureSearch => ({
    recept: typeof search.recept === "string" ? search.recept : undefined,
  }),
  component: Capture,
});

type Photo = { id: number; jpeg: Blob; url: string };

/**
 * Camera screen (#9 variant C, #20): the shown page large, "Vyfotit znovu"
 * and "＋ Další stránka"; with 2+ pages, thumbnails to reorder and remove.
 * "Přečíst recept" sends all pages as one Draft Recipe, or (from "Recept
 * pokračuje") adds them to the draft, which is then read again from all pages.
 * "🖼 Z galerie" (#21) adds the picked photos (several at once) as pages.
 * Reading needs internet; offline, photos can still be taken (#13).
 */
function Capture() {
  const { recept } = Route.useSearch();
  const target = useQuery(api.recipes.get, recept ? { recipeId: recept } : "skip");
  const generateUploadUrl = useMutation(api.recipes.generateUploadUrl);
  const createDraft = useMutation(api.recipes.createDraft);
  const addPages = useMutation(api.recipes.addPages);
  const navigate = useNavigate();
  const online = useOnline();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  /** Whether the next photo replaces the shown page ("Vyfotit znovu") or adds one. */
  const replacing = useRef(false);
  const nextId = useRef(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<"pick" | "preparing" | "uploading">("pick");
  const [error, setError] = useState<string | null>(null);

  // Object URLs are freed when they leave the list and when the screen closes.
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(photos.map((p) => p.url));
    for (const url of urls.current) if (!live.has(url)) URL.revokeObjectURL(url);
    urls.current = live;
  }, [photos]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const existing = target?.photos.length ?? 0;
  const room = MAX_PHOTOS - existing - photos.length;
  const current = photos[Math.min(shown, photos.length - 1)];

  function openCamera(replace: boolean) {
    replacing.current = replace;
    camera.current?.click();
  }

  async function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again
    if (!file) return;
    setError(null);
    setPhase("preparing");
    try {
      const jpeg = await resizeToJpeg(file);
      const photo = { id: nextId.current++, jpeg, url: URL.createObjectURL(jpeg) };
      if (replacing.current && current) {
        setPhotos((ps) => ps.map((p) => (p.id === current.id ? photo : p)));
      } else {
        setShown(photos.length);
        setPhotos((ps) => [...ps, photo]);
      }
    } catch {
      setError("Fotku se nepodařilo načíst. Zkus ji vyfotit znovu.");
    } finally {
      setPhase("pick");
    }
  }

  /** Gallery: the picked photos are added as pages after the last one. */
  async function onGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);
    if (files.length > room) setError(`Recept může mít nejvýš ${MAX_PHOTOS} stránek, přidám jen ${room}.`);
    setPhase("preparing");
    try {
      const added: Photo[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const jpeg = await resizeToJpeg(file);
        added.push({ id: nextId.current++, jpeg, url: URL.createObjectURL(jpeg) });
      }
      if (added.length) {
        setShown(photos.length + added.length - 1);
        setPhotos((ps) => [...ps, ...added]);
      }
    } catch {
      setError("Fotku z galerie se nepodařilo načíst. Zkus jinou.");
    } finally {
      setPhase("pick");
    }
  }

  async function read() {
    if (photos.length === 0) return;
    setError(null);
    setPhase("uploading");
    try {
      const storageIds: Id<"_storage">[] = [];
      for (const p of photos) {
        storageIds.push((await uploadJpeg(await generateUploadUrl(), p.jpeg)) as Id<"_storage">);
      }
      let recipeId: string;
      if (target) {
        await addPages({ recipeId: target._id, storageIds });
        recipeId = target._id;
      } else {
        recipeId = await createDraft({ storageIds });
      }
      await navigate({ to: "/recepty/$recipeId", params: { recipeId }, replace: true });
    } catch (err) {
      setError(errorMessage(err, "Fotky se nepodařilo nahrát. Zkontroluj připojení a zkus to znovu."));
      setPhase("pick");
    }
  }

  if (phase === "uploading") {
    return (
      <section className="page">
        <TopBar title="Čtu recept" back={false} />
        <ScanView
          photoUrl={photos[0]?.url ?? null}
          stage="upload"
          pages={existing + photos.length}
        />
      </section>
    );
  }

  if (recept && target === undefined) {
    return (
      <section className="page">
        <p className="muted">Načítám…</p>
      </section>
    );
  }
  if (recept && (!target || target.status !== "draft")) {
    return (
      <section className="page">
        <TopBar title="Další stránka" />
        <p className="muted">Tenhle koncept už neexistuje nebo je uložený.</p>
      </section>
    );
  }

  const busy = phase !== "pick";
  return (
    <section className="page with-bar">
      <TopBar title={target ? "Další stránka" : "Vyfoť recept"} />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onPicked}
      />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={onGallery} />
      {!online && <NeedsInternet />}
      {target && (
        <p className="muted small nomargin">
          Přidáváš stránku k „{target.name || "receptu"}“ (už má {existing} str.). Recept se
          pak přečte znovu ze všech stránek.
        </p>
      )}
      {current ? (
        <>
          <div className="shot">
            <img src={current.url} alt={`Stránka ${existing + photos.indexOf(current) + 1}`} />
          </div>
          {photos.length > 1 && (
            <PageThumbs
              photos={photos}
              first={existing + 1}
              shown={current.id}
              onShow={(i) => setShown(i)}
              onMove={(i, d) => {
                setPhotos((ps) => movePage(ps, i, d));
                setShown(i + d);
              }}
              onRemove={(i) => {
                setPhotos((ps) => removePage(ps, i));
                setShown((s) => (s >= i ? Math.max(0, s - 1) : s));
              }}
            />
          )}
          <div className="frow">
            <button className="btn grow" onClick={() => openCamera(true)} disabled={busy}>
              Vyfotit znovu
            </button>
            <button
              className="btn grow"
              onClick={() => openCamera(false)}
              disabled={busy || room <= 0}
            >
              ＋ Další stránka
            </button>
          </div>
          <button className="btn ghost" onClick={() => gallery.current?.click()} disabled={busy || room <= 0}>
            🖼 Z galerie
          </button>
          {room <= 0 && <p className="muted small nomargin">Víc stránek recept mít nemůže.</p>}
        </>
      ) : (
        <>
          <button className="viewfinder" onClick={() => openCamera(false)} disabled={busy}>
            <span aria-hidden="true">📷</span>
            {phase === "preparing" ? "Připravuji fotku…" : "Namiř na stránku receptu a vyfoť ji"}
          </button>
          <button className="btn" onClick={() => gallery.current?.click()} disabled={busy || room <= 0}>
            🖼 Vybrat z galerie
          </button>
        </>
      )}
      {phase === "preparing" && current && <p className="muted small nomargin">Připravuji fotku…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bottombar">
        {current ? (
          <button className="btn primary grow" onClick={read} disabled={busy || !online}>
            {!online
              ? "Přečíst recept (bez připojení)"
              : photos.length > 1
                ? `Přečíst recept (${photos.length} str.) ›`
                : "Přečíst recept ›"}
          </button>
        ) : (
          <button className="btn primary grow" onClick={() => openCamera(false)} disabled={busy}>
            📷 Vyfotit
          </button>
        )}
      </div>
    </section>
  );
}

/** Page thumbnails: tap to show, ‹ › to reorder, × to remove. */
function PageThumbs({
  photos,
  first,
  shown,
  onShow,
  onMove,
  onRemove,
}: {
  photos: Photo[];
  first: number;
  shown: number;
  onShow: (i: number) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <ol className="thumbs" aria-label="Stránky receptu">
      {photos.map((p, i) => (
        <li key={p.id} className={`thumb${p.id === shown ? " on" : ""}`}>
          <button type="button" className="timg" onClick={() => onShow(i)} aria-label={`Ukázat stránku ${first + i}`}>
            <img src={p.url} alt="" />
          </button>
          <span className="n">{first + i}</span>
          <button type="button" className="x" onClick={() => onRemove(i)} aria-label={`Odebrat stránku ${first + i}`}>
            ×
          </button>
          <div className="mv">
            <button type="button" disabled={i === 0} onClick={() => onMove(i, -1)} aria-label="Posunout dopředu">
              ‹
            </button>
            <button
              type="button"
              disabled={i === photos.length - 1}
              onClick={() => onMove(i, 1)}
              aria-label="Posunout dozadu"
            >
              ›
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}
