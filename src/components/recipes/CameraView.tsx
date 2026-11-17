import { useEffect, useRef, useState } from "react";
import { cameraErrorMessage } from "~/lib/camera";

/**
 * The app's own camera, full screen, for devices where `<input capture>`
 * opens the file picker (Windows tablets). Prefers the back camera; the
 * shutter grabs the current frame as a JPEG blob (resized later like any photo).
 */
export function CameraView({
  onShot,
  onClose,
  onPickFile,
}: {
  onShot: (photo: Blob) => void;
  onClose: () => void;
  /** Fallback when the camera can't start: open the file picker instead. */
  onPickFile: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          void v.play().catch(() => {});
        }
      })
      .catch((err) => !cancelled && setError(cameraErrorMessage(err)));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Escape closes the camera (keyboard on a tablet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setShooting(true);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        setShooting(false);
        if (blob) onShot(blob);
        else setError("Fotku se nepodařilo pořídit. Zkus to znovu.");
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="camview" role="dialog" aria-label="Fotoaparát">
      <video
        ref={video}
        playsInline
        muted
        onLoadedMetadata={() => setReady(true)}
        aria-hidden={!!error}
      />
      {error && (
        <div className="camerr">
          <p>{error}</p>
          <button type="button" className="btn" onClick={onPickFile}>
            Vybrat fotku ze souboru
          </button>
        </div>
      )}
      {!ready && !error && <p className="camwait">Spouštím kameru…</p>}
      <div className="cambar">
        <button type="button" className="camclose" onClick={onClose}>
          Zavřít
        </button>
        <button
          type="button"
          className="shutter"
          onClick={shoot}
          disabled={!ready || !!error || shooting}
          aria-label="Vyfotit"
        />
        <span className="camspacer" />
      </div>
    </div>
  );
}
