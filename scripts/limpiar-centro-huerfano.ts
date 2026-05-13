/**
 * Borra un código de centro de prueba / huérfano en Firestore:
 * - documentos `propuestas_semana` con campo `centro` igual al código
 * - documentos `programa_semanal` cuyo id empiece por `{codigo}_`
 * - documento `centros/{codigo}`
 *
 * Seguridad:
 * - No corre si el centro está en `KNOWN_CENTROS` (salvo `--allow-known-centro`).
 * - No corre si hay work_orders, avisos, assets, plan_mantenimiento o users con ese centro.
 *
 * Por defecto solo lista lo que haría. Para borrar:
 *   npx tsx scripts/limpiar-centro-huerfano.ts --centro CENTRO-01 --commit
 *
 * Entorno: `.env.local` + credenciales Admin (igual que otros scripts).
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldPath, type DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { KNOWN_CENTROS } from "@/lib/config/app-config";

const KNOWN_SET = new Set(KNOWN_CENTROS.map((c) => c.trim()));
const BATCH = 400;

function parseArgs(): {
  centro: string;
  commit: boolean;
  allowKnownCentro: boolean;
} {
  const argv = process.argv.slice(2);
  let centro = "";
  let commit = false;
  let allowKnownCentro = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" || a === "-c") centro = (argv[++i] ?? "").trim();
    else if (a === "--commit") commit = true;
    else if (a === "--allow-known-centro") allowKnownCentro = true;
  }
  return { centro, commit, allowKnownCentro };
}

async function countEq(collection: string, field: string, value: string): Promise<number> {
  const db = getAdminDb();
  const snap = await db.collection(collection).where(field, "==", value).count().get();
  return snap.data().count;
}

async function commitDeletes(refs: DocumentReference[]): Promise<void> {
  const db = getAdminDb();
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function main(): Promise<void> {
  const { centro, commit, allowKnownCentro } = parseArgs();
  if (!centro) {
    console.error("Uso: npx tsx scripts/limpiar-centro-huerfano.ts --centro CENTRO-01 [--commit] [--allow-known-centro]");
    process.exit(1);
  }

  if (KNOWN_SET.has(centro) && !allowKnownCentro) {
    console.error(
      `El centro "${centro}" está en NEXT_PUBLIC_KNOWN_CENTROS / lista por defecto. ` +
        `No se borra para evitar romper producción. Si en serio querés, repetí con --allow-known-centro.`,
    );
    process.exit(1);
  }

  const db = getAdminDb();

  const [
    nOt,
    nAvisos,
    nAssets,
    nPlanes,
    nUsersCentro,
    nUsersLista,
  ] = await Promise.all([
    countEq(COLLECTIONS.work_orders, "centro", centro),
    countEq(COLLECTIONS.avisos, "centro", centro),
    countEq(COLLECTIONS.assets, "centro", centro),
    countEq(COLLECTIONS.plan_mantenimiento, "centro", centro),
    countEq(COLLECTIONS.users, "centro", centro),
    db.collection(COLLECTIONS.users).where("centros_asignados", "array-contains", centro).count().get(),
  ]);
  const nUsersMulti = nUsersLista.data().count;

  const bloqueo = nOt + nAvisos + nAssets + nPlanes + nUsersCentro + nUsersMulti;
  if (bloqueo > 0) {
    console.error("Hay datos operativos con este centro; no se borra nada por seguridad.");
    console.error(
      `  work_orders: ${nOt} | avisos: ${nAvisos} | assets: ${nAssets} | plan_mantenimiento: ${nPlanes} | users.centro: ${nUsersCentro} | users centros_asignados: ${nUsersMulti}`,
    );
    console.error("Migrá o borrá esos registros antes, o usá otro flujo manual.");
    process.exit(1);
  }

  const propSnap = await db.collection(COLLECTIONS.propuestas_semana).where("centro", "==", centro).get();
  const prefix = `${centro}_`;
  const progSnap = await db
    .collection(COLLECTIONS.programa_semanal)
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .get();

  const refCentro = db.collection(COLLECTIONS.centros).doc(centro);
  const snapCentro = await refCentro.get();

  console.log(`\nCentro a limpiar: ${centro}`);
  console.log(`  propuestas_semana: ${propSnap.size} doc(s)`);
  for (const d of propSnap.docs) {
    console.log(`    · borrar ${d.ref.path}`);
  }
  console.log(`  programa_semanal (ids ${prefix}…): ${progSnap.size} doc(s)`);
  for (const d of progSnap.docs) {
    console.log(`    · borrar ${d.ref.path}`);
  }
  console.log(`  centros/${centro}: ${snapCentro.exists ? "existe → borrar" : "no existe"}`);

  const toDelete: DocumentReference[] = [
    ...propSnap.docs.map((d) => d.ref),
    ...progSnap.docs.map((d) => d.ref),
  ];
  if (snapCentro.exists) {
    toDelete.push(refCentro);
  }

  if (toDelete.length === 0) {
    console.log("\nNada que borrar.");
    return;
  }

  if (!commit) {
    console.log(
      `\nSimulación solamente (${toDelete.length} documento(s)). Para aplicar: añadí --commit`,
    );
    return;
  }

  await commitDeletes(toDelete);
  console.log(`\nListo: eliminados ${toDelete.length} documento(s) raíz.`);
  console.log(
    "Nota: si algún programa_semanal tenía subcolecciones, en Firestore pueden quedar huérfanas; revisá en consola si aplica.",
  );
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
