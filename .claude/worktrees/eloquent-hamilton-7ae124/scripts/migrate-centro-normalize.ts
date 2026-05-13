/**
 * Migración: reasigna el campo `centro` de activos y avisos usando como fuente
 * de verdad el código SAP del equipo (PC01xxx→PC01, PF01xxx→PF01, PM02xxx→PM02, PT01xxx→PT01).
 *
 * Para avisos (sin código de equipo propio) usa el prefijo de la ubicación técnica.
 *
 * Uso:
 *   npx tsx scripts/migrate-centro-normalize.ts [--dry-run] [--coleccion assets|avisos|ambas]
 *
 * Entorno: FIREBASE_SERVICE_ACCOUNT_KEY (JSON) o GOOGLE_APPLICATION_CREDENTIALS,
 *          más NEXT_PUBLIC_FIREBASE_PROJECT_ID (y NEXT_PUBLIC_KNOWN_CENTROS si se cambió).
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../firebase/firebaseAdmin";
import {
  deriveCentroFromEquipmentCode,
  deriveCentroPlantCodeFromUbicacionTecnica,
} from "../lib/firestore/derive-centro";

const CHUNK = 400;

function parseArgs() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let coleccion: "assets" | "avisos" | "ambas" = "ambas";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") dryRun = true;
    if (a === "--coleccion" || a === "-c") {
      const v = argv[++i];
      if (v === "assets" || v === "avisos" || v === "ambas") coleccion = v;
    }
  }
  return { dryRun, coleccion };
}

async function migrateAssets(dryRun: boolean): Promise<void> {
  const db = getAdminDb();
  const col = db.collection("assets");

  console.log("\n=== assets ===");
  const snap = await col.get();
  console.log(`  Total documentos: ${snap.size}`);

  const toUpdate: { id: string; oldCentro: string; newCentro: string }[] = [];
  const sinResolver: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const currentCentro: string = (data["centro"] ?? "").trim();
    const codigo: string = (data["codigo_nuevo"] ?? "").trim();
    const ut: string = (data["ubicacion_tecnica"] ?? "").trim();

    // Fuente primaria: prefijo del código de equipo (más preciso que UT)
    let newCentro: string | null = codigo ? deriveCentroFromEquipmentCode(codigo) : null;

    // Fallback: prefijo de UT
    if (!newCentro) {
      if (!ut) {
        sinResolver.push(`${doc.id} (codigo="${codigo || "—"}", sin UT)`);
        continue;
      }
      newCentro = deriveCentroPlantCodeFromUbicacionTecnica(ut);
    }

    if (newCentro !== currentCentro) {
      toUpdate.push({ id: doc.id, oldCentro: currentCentro, newCentro });
    }
  }

  await _printAndCommit("assets", toUpdate, sinResolver, col, dryRun);
}

async function migrateAvisos(dryRun: boolean): Promise<void> {
  const db = getAdminDb();
  const col = db.collection("avisos");

  console.log("\n=== avisos ===");
  const snap = await col.get();
  console.log(`  Total documentos: ${snap.size}`);

  const toUpdate: { id: string; oldCentro: string; newCentro: string }[] = [];
  const sinResolver: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const currentCentro: string = (data["centro"] ?? "").trim();
    const ut: string = (data["ubicacion_tecnica"] ?? "").trim();

    if (!ut) {
      sinResolver.push(`${doc.id} (centro="${currentCentro || "—"}", sin UT)`);
      continue;
    }

    const newCentro = deriveCentroPlantCodeFromUbicacionTecnica(ut);
    if (newCentro !== currentCentro) {
      toUpdate.push({ id: doc.id, oldCentro: currentCentro, newCentro });
    }
  }

  await _printAndCommit("avisos", toUpdate, sinResolver, col, dryRun);
}

async function _printAndCommit(
  name: string,
  toUpdate: { id: string; oldCentro: string; newCentro: string }[],
  sinResolver: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  col: any,
  dryRun: boolean,
): Promise<void> {
  console.log(`  Documentos a actualizar: ${toUpdate.length}`);
  if (sinResolver.length) {
    console.log(`  Sin resolver (sin código ni UT — revisar manualmente):`);
    sinResolver.slice(0, 20).forEach((s) => console.log(`    - ${s}`));
    if (sinResolver.length > 20) console.log(`    … y ${sinResolver.length - 20} más`);
  }

  if (toUpdate.length === 0) {
    console.log("  Nada que actualizar.");
    return;
  }

  const muestra = toUpdate.slice(0, 10);
  console.log(`  Muestra (máx 10):`);
  muestra.forEach(({ id, oldCentro, newCentro }) =>
    console.log(`    ${id}: "${oldCentro}" → "${newCentro}"`),
  );
  if (toUpdate.length > 10) console.log(`    … y ${toUpdate.length - 10} más`);

  if (dryRun) {
    console.log("  [DRY RUN] No se escribió nada.");
    return;
  }

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    const batch = col.firestore.batch();
    for (const { id, newCentro } of chunk) {
      batch.update(col.doc(id), {
        centro: newCentro,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`  Lote ${Math.floor(i / CHUNK) + 1}: ${chunk.length} docs actualizados.`);
  }

  console.log(`  ✓ ${toUpdate.length} documentos en ${name} actualizados.`);
}

async function main() {
  const { dryRun, coleccion } = parseArgs();

  console.log(dryRun ? "[DRY RUN] Modo simulación — no se escribirá nada." : "[WRITE] Modo escritura activo.");
  console.log(`Colección(es): ${coleccion}`);

  if (coleccion === "assets" || coleccion === "ambas") {
    await migrateAssets(dryRun);
  }
  if (coleccion === "avisos" || coleccion === "ambas") {
    await migrateAvisos(dryRun);
  }

  console.log("\nListo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
