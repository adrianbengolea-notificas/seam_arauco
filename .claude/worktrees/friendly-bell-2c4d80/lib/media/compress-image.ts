const DEFAULT_MAX_EDGE = 1920;
const DEFAULT_QUALITY = 0.82;

export type CompressImageOptions = {
  maxEdgePx?: number;
  quality?: number;
  mimeType?: "image/jpeg" | "image/webp";
};

/**
 * Redimensiona y comprime en el cliente antes de subir a Storage.
 */
export async function compressImageFile(
  file: File,
  options: CompressImageOptions = {},
): Promise<Blob> {
  const maxEdge = options.maxEdgePx ?? DEFAULT_MAX_EDGE;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const mimeType = options.mimeType ?? "image/jpeg";

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D no disponible");
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((blobResult) => resolve(blobResult), mimeType, quality),
  );
  if (!blob) {
    throw new Error("No se pudo comprimir la imagen");
  }
  return blob;
}
