import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ScanView, TopBar } from "~/components/recipes/ui";
import { errorMessage } from "~/lib/format";
import { resizeToJpeg, uploadJpeg } from "~/lib/photo";

export const Route = createFileRoute("/recepty/vyfotit")({
  component: Capture,
});

type Photo = { jpeg: Blob; url: string };

/**
 * Camera screen (#9 variant C): take a photo, see it large, retake or send
 * it to be read. Multi-page and gallery picks come with #20 / #21.
 */
function Capture() {
  const generateUploadUrl = useMutation(api.recipes.generateUploadUrl);
  const createDraft = useMutation(api.recipes.createDraft);
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [phase, setPhase] = useState<"pick" | "preparing" | "uploading">("pick");
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const openCamera = () => camera.current?.click();

  async function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again
    if (!file) return;
    setError(null);
    setPhase("preparing");
    try {
      const jpeg = await resizeToJpeg(file);
      setPhoto({ jpeg, url: URL.createObjectURL(jpeg) });
    } catch {
      setError("Fotku se nepodařilo načíst. Zkus ji vyfotit znovu.");
    } finally {
      setPhase("pick");
    }
  }

  async function read() {
    if (!photo) return;
    setError(null);
    setPhase("uploading");
    try {
      const storageId = await uploadJpeg(await generateUploadUrl(), photo.jpeg);
      const recipeId = await createDraft({ storageIds: [storageId as Id<"_storage">] });
      await navigate({ to: "/recepty/$recipeId", params: { recipeId }, replace: true });
    } catch (err) {
      setError(errorMessage(err, "Fotku se nepodařilo nahrát. Zkontroluj připojení a zkus to znovu."));
      setPhase("pick");
    }
  }

  if (phase === "uploading") {
    return (
      <section className="page">
        <TopBar title="Čtu recept" back={false} />
        <ScanView photoUrl={photo?.url ?? null} stage="upload" />
      </section>
    );
  }

  return (
    <section className="page with-bar">
      <TopBar title="Vyfoť recept" />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onPicked}
      />
      {photo ? (
        <>
          <div className="shot">
            <img src={photo.url} alt="Vyfocená stránka" />
          </div>
          <button className="btn" onClick={openCamera} disabled={phase !== "pick"}>
            Vyfotit znovu
          </button>
        </>
      ) : (
        <button className="viewfinder" onClick={openCamera} disabled={phase !== "pick"}>
          <span aria-hidden="true">📷</span>
          {phase === "preparing" ? "Připravuji fotku…" : "Namiř na stránku receptu a vyfoť ji"}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bottombar">
        {photo ? (
          <button className="btn primary grow" onClick={read} disabled={phase !== "pick"}>
            Přečíst recept ›
          </button>
        ) : (
          <button className="btn primary grow" onClick={openCamera} disabled={phase !== "pick"}>
            📷 Vyfotit
          </button>
        )}
      </div>
    </section>
  );
}
