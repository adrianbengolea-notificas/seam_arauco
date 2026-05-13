/**
 * Resume qué hay en Firestore para un código de centro (p. ej. CENTRO-01 o PC01):
 * documento `centros/{id}` y conteos donde otros documentos usan ese mismo string en `centro` / IDs.
 *
 * Requiere `.env.local` con proyecto y credenciales Admin (igual que otros scripts), p. ej.
 * `NEXT_PUBLIC_FIREBASE_PROJECT_ID` y `FIREBASE_SERVICE_ACCOUNT_KEY` o ADC.
 *
 * Uso:
 *   npx tsx scripts/inspeccionar-centro-firestore.ts CENTRO-01
 *   npx tsx scripts/inspeccionar-centro-firestore.ts PC01 PF01
 */

/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.replace(/^\s*export\s+/, "").trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function prettyFields(data: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Timestamp) {
      o[k] = v.toDate().toISOString();
    } else {
      o[k] = v;
    }
  }
  return o;
}

async function countEq(collection: string, field: string, value: string): Promise<number> {
  const db = getAdminDb();
  const snap = await db.collection(collection).where(field, "==", value).count().get();
  return snap.data().count;
}

async function countProgramaSemanalDocIdsWithCentroPrefix(centro: string): Promise<number> {
  const db = getAdminDb();
  const prefix = `${centro}_`;
  const snap = await db
    .collection(COLLECTIONS.programa_semanal)
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .count()
    .get();
  return snap.data().count;
}

async function inspeccionarCentro(centroRaw: string): Promise<void> {
  const centro = centroRaw.trim();
  if (!centro) return;

  const db = getAdminDb();
  const known = new Set(KNOWN_CENTROS.map((c) => c.trim()));
  const nombre = nombreCentro(centro);

  console.log("\n" + "=".repeat(72));
  console.log(`Centro: ${centro}`);
  console.log(
    known.has(centro)
      ? `Está en NEXT_PUBLIC_KNOWN_CENTROS / lista por defecto. Nombre UI: ${nombre}`
      : `No está en la lista KNOWN_CENTROS de la app (solo aparecerá si hay doc en centros u otros datos con este ID).`,
  );
  if (nombre !== centro) {
    console.log(`Nombre legible (CENTRO_NOMBRES): ${nombre}`);
  }

  const refCentro = db.collection(COLLECTIONS.centros).doc(centro);
  const snapCentro = await refCentro.get();
  console.log("\n--- Documento configuración ---");
  console.log(`Ruta: ${refCentro.path}`);
  if (!snapCentro.exists) {
    console.log("No existe. La app usará valores por defecto hasta que guardes desde superadmin.");
  } else {
    console.log(JSON.stringify(prettyFields(snapCentro.data() as Record<string, unknown>), null, 2));
  }

  console.log("\n--- Conteos (mismo string en campo o prefijo de ID) ---");
  const [
    nOt,
    nAvisos,
    nAssets,
    nPlanes,
    nPropuestas,
    nUsersCentro,
    nUsersEnLista,
    nProgSem,
  ] = await Promise.all([
    countEq(COLLECTIONS.work_orders, "centro", centro),
    countEq(COLLECTIONS.avisos, "centro", centro),
    countEq(COLLECTIONS.assets, "centro", centro),
    countEq(COLLECTIONS.plan_mantenimiento, "centro", centro),
    countEq(COLLECTIONS.propuestas_semana, "centro", centro),
    countEq(COLLECTIONS.users, "centro", centro),
    db.collection(COLLECTIONS.users).where("centros_asignados", "array-contains", centro).count().get(),
    countProgramaSemanalDocIdsWithCentroPrefix(centro),
  ]);

  const nUsersMulti = nUsersEnLista.data().count;

  console.log(`  work_orders:          ${nOt}`);
  console.log(`  avisos:               ${nAvisos}`);
  console.log(`  assets:               ${nAssets}`);
  console.log(`  plan_mantenimiento:   ${nPlanes}`);
  console.log(`  propuestas_semana:    ${nPropuestas}`);
  console.log(`  programa_semanal (IDs ${centro}_…): ${nProgSem}`);
  console.log(`  users (campo centro): ${nUsersCentro}`);
  console.log(`  users (centros_asignados contiene): ${nUsersMulti}`);

  if (nPropuestas > 0) {
    const limite = 25;
    console.log(`\n--- propuestas_semana (detalle, hasta ${limite}) ---`);
    const propSnap = await db
      .collection(COLLECTIONS.propuestas_semana)
      .where("centro", "==", centro)
      .limit(limite)
      .get();
    for (const d of propSnap.docs) {
      const p = d.data() as Record<string, unknown>;
      const nItems = Array.isArray(p.items) ? p.items.length : 0;
      const semana = String(p.semana ?? "?");
      const status = String(p.status ?? "?");
      const gen =
        p.generada_en instanceof Timestamp
          ? (p.generada_en as Timestamp).toDate().toISOString()
          : String(p.generada_en ?? "");
      console.log(`  · id=${d.id} | semana=${semana} | status=${status} | ítems=${nItems} | generada_en=${gen}`);
    }
    if (nPropuestas > limite) {
      console.log(`  … y ${nPropuestas - limite} más en esta colección.`);
    }
  }

  const totalUso = nOt + nAvisos + nAssets + nPlanes + nPropuestas + nProgSem + nUsersCentro + nUsersMulti;
  const refParts: string[] = [];
  if (nOt) refParts.push(`${nOt} work_orders`);
  if (nAvisos) refParts.push(`${nAvisos} avisos`);
  if (nAssets) refParts.push(`${nAssets} assets`);
  if (nPlanes) refParts.push(`${nPlanes} plan_mantenimiento`);
  if (nPropuestas) refParts.push(`${nPropuestas} propuestas_semana`);
  if (nProgSem) refParts.push(`${nProgSem} programa_semanal (${centro}_…)`);
  if (nUsersCentro) refParts.push(`${nUsersCentro} users.centro`);
  if (nUsersMulti) refParts.push(`${nUsersMulti} users en centros_asignados`);

  console.log("\n--- Lectura rápida ---");
  if (refParts.length) {
    console.log(`Referencias con este código: ${refParts.join("; ")}.`);
  }
  if (!snapCentro.exists && totalUso === 0) {
    console.log(
      "No hay documento centros/ ni otros datos: suele ser ID huérfano o de prueba (revisá antes de borrar en consola).",
    );
  } else if (!known.has(centro) && totalUso === 0 && snapCentro.exists) {
    console.log("Solo existe centros/ con configuración; ningún OT, aviso ni activo usa este código.");
  } else if (totalUso > 0) {
    console.log(
      "Antes de borrar el doc centros/ o el código, migrá o limpiá esas colecciones si corresponde.",
    );
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = process.argv.slice(2).map((a) => a.trim()).filter(Boolean);
  const centros = args.length ? args : ["CENTRO-01"];

  for (const c of centros) {
    await inspeccionarCentro(c);
  }
  console.log("\n");
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
