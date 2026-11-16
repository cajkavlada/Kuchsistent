/**
 * Recipe Photos are resized on the phone before upload (#2, #4): a JPEG with
 * the long edge at most 2576 px. Drawing through a canvas also drops EXIF
 * (location) data and turns HEIC into JPEG.
 */

export const MAX_EDGE = 2576;
export const JPEG_QUALITY = 0.85;

/** Size that fits `width`×`height` within `max` on the long edge (never upscales). */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function resizeToJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2d canvas");
    g.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
        "image/jpeg",
        JPEG_QUALITY,
      ),
    );
  } finally {
    bitmap.close();
  }
}

/** POSTs a JPEG to a Convex upload URL; returns its storage id. */
export async function uploadJpeg(uploadUrl: string, jpeg: Blob): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: jpeg,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: string };
  return storageId;
}
