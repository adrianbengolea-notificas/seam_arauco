import { randomUUID } from "node:crypto";
import { getAdminStorage } from "@/firebase/firebaseAdmin";
import { AppError } from "@/lib/errors/app-error";

const MAX_BYTES = 512 * 1024;

export type WorkOrderSignatureStorageRole =
  | "tecnico"
  | "usuario_planta"
  | "pad_tecnico"
  | "pad_usuario"
  | "planilla_arauco"
  | "planilla_tecnico";

/**
 * Sube PNG/JPEG de firma (data URL del cliente) a Storage y devuelve ruta + URL de lectura.
 * Evita documentos Firestore &gt; 1MB por base64 embebido.
 */
export async function uploadFirmaDigitalFromDataUrl(input: {
  workOrderId: string;
  role: WorkOrderSignatureStorageRole;
  dataUrl: string;
  /** Ej. `planilla_{respuestaId}` para agrupar archivos de la misma planilla. */
  pathPrefix?: string;
}): Promise<{ storage_path: string; download_url: string; content_type: string }> {
  const raw = input.dataUrl.trim();
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(raw);
  if (!m) {
    throw new AppError("VALIDATION", "Firma inválida: se esperaba imagen PNG o JPEG en base64");
  }
  const ext = m[1]!.toLowerCase() === "png" ? "png" : "jpg";
  const contentType = ext === "png" ? "image/png" : "image/jpeg";
  let buf: Buffer;
  try {
    buf = Buffer.from(m[2]!, "base64");
  } catch {
    throw new AppError("VALIDATION", "Firma inválida: base64 corrupto");
  }
  if (buf.length < 32) {
    throw new AppError("VALIDATION", "Firma demasiado pequeña");
  }
  if (buf.length > MAX_BYTES) {
    throw new AppError("VALIDATION", "Firma demasiado grande (máx. 512 KB)");
  }

  const bucket = getAdminStorage().bucket();
  const stem = input.pathPrefix?.trim()
    ? `${input.pathPrefix.trim()}_${input.role}`
    : input.role;
  const path = `signatures/${input.workOrderId}/${stem}_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
  const file = bucket.file(path);
  const downloadToken = randomUUID();
  await file.save(buf, {
    metadata: {
      contentType,
      cacheControl: "public, max-age=31536000",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  // URL con token de descarga de Firebase (mismo esquema que getDownloadURL del client SDK).
  // Sin `token=`, ?alt=media solo no autoriza ante reglas típicas; el token en la query sí.
  // No usar getSignedUrl() de GCS para esto: límite ~7 días con service accounts.
  const [meta] = await file.getMetadata();
  const tokensFromMeta = meta.metadata?.firebaseStorageDownloadTokens;
  const token =
    typeof tokensFromMeta === "string" && tokensFromMeta.trim()
      ? tokensFromMeta.split(",")[0]!.trim()
      : downloadToken;
  const encodedPath = encodeURIComponent(path);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${encodeURIComponent(token)}`;

  return { storage_path: path, download_url: downloadUrl, content_type: contentType };
}
