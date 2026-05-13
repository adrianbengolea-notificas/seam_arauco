/**
 * Rellena `incluido_en_semana` en `avisos` a partir de la grilla publicada (`programa_semanal` / slots).
 * Útil para datos previos a que el motor / la UI dejaran el campo alineado con la grilla.
 *
 * Por cada aviso con `avisoFirestoreId` en algún slot, toma la semana ISO **más reciente** entre todos
 * los documentos de programa donde aún aparece (comparación lexicográfica de `YYYY-Www`).
 *
 * Simulación (recomendado primero):
 *   npx tsx scripts/backfill-incluido-en-semana-desde-programa.ts
 * Una planta:
 *   npx tsx scripts/backfill-incluido-en-semana-desde-programa.ts --centro PM02
 * Aplicar:
 *   npx tsx scripts/backfill-incluido-en-semana-desde-programa.ts --commit
 *   npx tsx scripts/backfill-incluido-en-semana-desde-programa.ts --centro PM02 --commit
 *
 * Notas:
 * - No borra `incluido_en_semana` en avisos que ya no están en ninguna grilla (solo escribe cuando hay match).
 * - Requiere credenciales Admin (mismo `.env` / `.env.local` que el resto de scripts).
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";

const BATCH_MAX = 400;

function parseArgs(): { centro: string | null; commit: boolean; limiteMuestra: number } {
  const argv = process.argv.slice(2);
  let centro: string | null = null;
  let commit = false;
  let limiteMuestra = 15;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--centro" && argv[i + 1]) {
      centro = argv[i + 1]!.trim();
      i++;
    } else if (argv[i] === "--commit") {
      commit = true;
    } else if (argv[i] === "--muestra" && argv[i + 1]) {
      limiteMuestra = Math.max(0, parseInt(argv[i + 1]!, 10) || 0);
      i++;
    }
  }
  return { centro: centro?.length ? centro : null, commit, limiteMuestra };
}

function maxIsoSemana(a: string, b: string): string {
  return a.localeCompare(b, undefined, { numeric: true }) >= 0 ? a : b;
}

function recolectarAvisoIsoDesdePrograma(
  data: Record<string, unknown>,
  docId: string,
  acumulado: Map<string, string>,
): void {
  const iso = parseIsoWeekIdFromSemanaParam(docId);
  if (!iso) return;

  const slots = data.slots;
  if (!Array.isArray(slots)) return;

  for (const slot of slots as Array<Record<string, unknown>>) {
    const avisos = slot.avisos;
    if (!Array.isArray(avisos)) continue;
    for (const av of avisos as Array<Record<string, unknown>>) {
      const aid = typeof av.avisoFirestoreId === "string" ? av.avisoFirestoreId.trim() : "";
      if (!aid) continue;
      const prev = acumulado.get(aid);
      acumulado.set(aid, prev ? maxIsoSemana(prev, iso) : iso);
    }
  }
}

async function main() {
  const { centro, commit, limiteMuestra } = parseArgs();
  const db = getAdminDb();

  console.log(
    commit
      ? "MODO COMMIT — se actualizará incluido_en_semana en avisos\n"
      : "Simulación (sin --commit no se escribe nada)\n",
  );

  const snap = await db.collection(COLLECTIONS.programa_semanal).get();
  const porAviso = new Map<string, string>();
  let docsProgramaConsiderados = 0;

  for (const d of snap.docs) {
    const raw = d.data() as Record<string, unknown>;
    const c = typeof raw.centro === "string" ? raw.centro.trim() : "";
    if (centro && c !== centro) continue;
    recolectarAvisoIsoDesdePrograma(raw, d.id, porAviso);
    docsProgramaConsiderados += 1;
  }

  console.log(`Documentos programa_semanal leídos: ${snap.size}`);
  console.log(`Documentos tras filtro de centro: ${docsProgramaConsiderados}`);
  console.log(`Avisos (id Firestore) vistos en grillas: ${porAviso.size}`);

  const avisoIds = [...porAviso.keys()];
  if (!avisoIds.length) {
    console.log("Nada para hacer.");
    return;
  }

  type Cambio = { id: string; antes: string | null; despues: string };
  const cambios: Cambio[] = [];

  const chunkRead = 300;
  for (let i = 0; i < avisoIds.length; i += chunkRead) {
    const slice = avisoIds.slice(i, i + chunkRead);
    const refs = slice.map((id) => db.collection(COLLECTIONS.avisos).doc(id));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      const id = doc.id;
      const despues = porAviso.get(id);
      if (!despues) continue;
      const dat = doc.data() as Record<string, unknown>;
      const antes =
        typeof dat.incluido_en_semana === "string" ? dat.incluido_en_semana.trim() || null : null;
      if (antes === despues) continue;
      cambios.push({ id, antes, despues });
    }
  }

  console.log(`Avisos a actualizar (nuevo valor distinto al actual): ${cambios.length}`);

  if (limiteMuestra > 0 && cambios.length) {
    console.log("\nMuestra de cambios:");
    for (const row of cambios.slice(0, limiteMuestra)) {
      console.log(
        `  ${row.id}: incluido_en_semana ${row.antes ?? "—"} → ${row.despues}`,
      );
    }
    if (cambios.length > limiteMuestra) {
      console.log(`  … y ${cambios.length - limiteMuestra} más`);
    }
  }

  if (!commit) {
    console.log("\nPara aplicar: npx tsx scripts/backfill-incluido-en-semana-desde-programa.ts --commit");
    if (centro) {
      console.log(`  (con --centro ${centro} si querés limitar a esa planta)`);
    }
    return;
  }

  let batch = db.batch();
  let n = 0;
  let batches = 0;

  async function flush() {
    if (n === 0) return;
    await batch.commit();
    batches += 1;
    batch = db.batch();
    n = 0;
  }

  for (const row of cambios) {
    batch.update(db.collection(COLLECTIONS.avisos).doc(row.id), {
      incluido_en_semana: row.despues,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
    n += 1;
    if (n >= BATCH_MAX) await flush();
  }
  await flush();

  console.log(`\nListo: ${cambios.length} avisos actualizados en ${batches} batch(es).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
