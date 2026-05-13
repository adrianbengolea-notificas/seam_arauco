/**
 * Migración: firmas base64 en Firestore → Cloud Storage
 *
 * Qué hace:
 *  - Busca work_orders donde `firma_tecnico_pad` o `firma_usuario_pad` contienen
 *    una data URL base64 y aún no tienen su contraparte `_download_url`.
 *  - Sube cada imagen a Cloud Storage como PNG.
 *  - Actualiza el documento con la URL pública y el storage path.
 *  - Opcionalmente borra el campo base64 (ver DRY_RUN y BORRAR_BASE64).
 *
 * También maneja `FirmaDigital.image_data_url_base64` dentro de `firma_tecnico`
 * y `firma_usuario` (subcampos del documento raíz).
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json \
 *   FIREBASE_PROJECT_ID=tu-proyecto \
 *   FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com \
 *   npx tsx scripts/migrate-firmas-base64.ts
 *
 * Variables de entorno opcionales:
 *   DRY_RUN=1          → solo imprime lo que haría, no escribe nada
 *   BORRAR_BASE64=1    → elimina el campo base64 después de migrar (default: no)
 *   BATCH_SIZE=50      → documentos por lote (default: 50)
 */

import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
const DRY_RUN = process.env.DRY_RUN === "1";
const BORRAR_BASE64 = process.env.BORRAR_BASE64 === "1";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? "50");

if (!PROJECT_ID) throw new Error("Falta FIREBASE_PROJECT_ID");
if (!STORAGE_BUCKET) throw new Error("Falta FIREBASE_STORAGE_BUCKET");

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let credential: ServiceAccount | undefined;
if (credPath) {
  credential = JSON.parse(fs.readFileSync(path.resolve(credPath), "utf-8")) as ServiceAccount;
}

initializeApp({
  credential: credential ? cert(credential) : undefined,
  projectId: PROJECT_ID,
  storageBucket: STORAGE_BUCKET,
});

const db = getFirestore();
const bucket = getStorage().bucket();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function mimeToExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

async function uploadBase64ToStorage(
  dataUrl: string,
  storagePath: string,
): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error(`Data URL inválida (primeros 60 chars): ${dataUrl.slice(0, 60)}`);

  const file = bucket.file(storagePath);
  await file.save(parsed.buffer, {
    metadata: { contentType: parsed.mimeType },
    resumable: false,
  });
  await file.makePublic();
  return file.publicUrl();
}

// ---------------------------------------------------------------------------
// Migración de un campo pad (firma_tecnico_pad / firma_usuario_pad)
// ---------------------------------------------------------------------------

type PadField = "firma_tecnico_pad" | "firma_usuario_pad";

async function migratePadField(
  docId: string,
  data: FirebaseFirestore.DocumentData,
  field: PadField,
  stats: Stats,
): Promise<FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> | null> {
  const urlField = `${field}_download_url` as const;
  const pathField = `${field}_storage_path` as const;

  const base64 = data[field] as string | undefined;
  if (!base64?.startsWith("data:")) return null;            // no legacy
  if (data[urlField]) return null;                           // ya migrado

  const parsed = parseDataUrl(base64);
  if (!parsed) {
    console.warn(`  ⚠ [${docId}] ${field}: data URL no parseable, saltando`);
    stats.errores++;
    return null;
  }

  const ext = mimeToExt(parsed.mimeType);
  const storagePath = `firmas/${docId}/${field}.${ext}`;

  if (DRY_RUN) {
    console.log(`  [DRY] ${docId}.${field} → gs://${STORAGE_BUCKET}/${storagePath}`);
    stats.migrados++;
    return null;
  }

  const downloadUrl = await uploadBase64ToStorage(base64, storagePath);
  stats.migrados++;

  const update: Record<string, unknown> = {
    [urlField]: downloadUrl,
    [pathField]: storagePath,
  };
  if (BORRAR_BASE64) update[field] = FieldValue.delete();
  return update;
}

// ---------------------------------------------------------------------------
// Migración de FirmaDigital embebida (firma_tecnico / firma_usuario)
// ---------------------------------------------------------------------------

type FirmaEmbedField = "firma_tecnico" | "firma_usuario";

async function migrateFirmaDigital(
  docId: string,
  data: FirebaseFirestore.DocumentData,
  field: FirmaEmbedField,
  stats: Stats,
): Promise<FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> | null> {
  const firma = data[field] as Record<string, unknown> | undefined | null;
  if (!firma) return null;

  const base64 = firma.image_data_url_base64 as string | undefined;
  if (!base64?.startsWith("data:")) return null;
  if (firma.download_url) return null;                       // ya migrado

  const parsed = parseDataUrl(base64);
  if (!parsed) {
    console.warn(`  ⚠ [${docId}] ${field}.image_data_url_base64: data URL no parseable, saltando`);
    stats.errores++;
    return null;
  }

  const ext = mimeToExt(parsed.mimeType);
  const storagePath = `firmas/${docId}/${field}_digital.${ext}`;

  if (DRY_RUN) {
    console.log(`  [DRY] ${docId}.${field}.image_data_url_base64 → gs://${STORAGE_BUCKET}/${storagePath}`);
    stats.migrados++;
    return null;
  }

  const downloadUrl = await uploadBase64ToStorage(base64, storagePath);
  stats.migrados++;

  const updatedFirma: Record<string, unknown> = {
    ...firma,
    storage_path: storagePath,
    download_url: downloadUrl,
  };
  if (BORRAR_BASE64) delete updatedFirma.image_data_url_base64;

  return { [field]: updatedFirma };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Stats = { procesados: number; migrados: number; errores: number; sinCambios: number };

async function main() {
  console.log(`\n=== Migración firmas base64 → Cloud Storage ===`);
  console.log(`Proyecto: ${PROJECT_ID} | Bucket: ${STORAGE_BUCKET}`);
  console.log(`Modo: ${DRY_RUN ? "DRY RUN (sin escrituras)" : "PRODUCCIÓN"}`);
  console.log(`Borrar base64 post-migración: ${BORRAR_BASE64 ? "SÍ" : "NO"}\n`);

  const stats: Stats = { procesados: 0, migrados: 0, errores: 0, sinCambios: 0 };

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db
      .collection("work_orders")
      .orderBy("__name__")
      .limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      stats.procesados++;
      const data = doc.data();
      const updates: Record<string, unknown> = {};

      for (const result of await Promise.all([
        migratePadField(doc.id, data, "firma_tecnico_pad", stats),
        migratePadField(doc.id, data, "firma_usuario_pad", stats),
        migrateFirmaDigital(doc.id, data, "firma_tecnico", stats),
        migrateFirmaDigital(doc.id, data, "firma_usuario", stats),
      ])) {
        if (result) Object.assign(updates, result);
      }

      if (Object.keys(updates).length > 0 && !DRY_RUN) {
        await doc.ref.update(updates);
        console.log(`  ✓ [${doc.id}] actualizado (${Object.keys(updates).join(", ")})`);
      } else if (Object.keys(updates).length === 0) {
        stats.sinCambios++;
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`  Procesados hasta ahora: ${stats.procesados}`);

    if (snap.size < BATCH_SIZE) break;
  }

  console.log(`\n=== Resumen ===`);
  console.log(`  Documentos procesados : ${stats.procesados}`);
  console.log(`  Firmas migradas       : ${stats.migrados}`);
  console.log(`  Sin cambios           : ${stats.sinCambios}`);
  console.log(`  Errores               : ${stats.errores}`);
  if (DRY_RUN) console.log(`\n  (DRY RUN — ningún cambio fue escrito)`);
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
