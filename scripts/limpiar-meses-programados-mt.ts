/**
 * Borra `meses_programados` en avisos y en `plan_mantenimiento` para preventivos **mensual y trimestral**
 * donde ese campo está cargado (p. ej. meses inferidos antes del cambio a Excel Arauco).
 *
 * Tras ejecutarlo, el calendario anual (/programa/anual) ya no muestra M/T hasta que importés
 * los Excels «calendario_mensual» / «calendario_trimestral» en Administración → Configuración e importación.
 *
 * Simulación (solo lista cuántos docs tocaría):
 *   npx tsx scripts/limpiar-meses-programados-mt.ts
 * Una planta:
 *   npx tsx scripts/limpiar-meses-programados-mt.ts --centro PM02
 * Aplicar en Firestore:
 *   npx tsx scripts/limpiar-meses-programados-mt.ts --commit
 *   npx tsx scripts/limpiar-meses-programados-mt.ts --centro PM02 --commit
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

const BATCH_MAX = 400;

function parseArgs(): { centro: string | null; commit: boolean } {
  const argv = process.argv.slice(2);
  let centro: string | null = null;
  let commit = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--centro" && argv[i + 1]) {
      centro = argv[i + 1]!.trim();
      i++;
    } else if (argv[i] === "--commit") {
      commit = true;
    }
  }
  return { centro: centro?.length ? centro : null, commit };
}

function esPlanMT(frecuencia: unknown): boolean {
  return frecuencia === "M" || frecuencia === "T";
}

function esAvisoMT(dat: Record<string, unknown>): boolean {
  const badge = dat.frecuencia_plan_mtsa;
  const fq = dat.frecuencia;
  if (badge === "M" || badge === "T") return true;
  if (fq === "MENSUAL" || fq === "TRIMESTRAL") return true;
  return false;
}

function tieneMeses(dat: Record<string, unknown>): boolean {
  const m = dat.meses_programados;
  return Array.isArray(m) && m.length > 0;
}

async function main() {
  const { centro, commit } = parseArgs();
  const centros = centro ? [centro] : [...KNOWN_CENTROS];
  const db = getAdminDb();
  const colPlan = db.collection(COLLECTIONS.plan_mantenimiento);
  const colAv = db.collection(COLLECTIONS.avisos);

  const ids = new Set<string>();

  console.log(commit ? "MODO COMMIT — se escribe en Firestore\n" : "Simulación (sin --commit no se modifica nada)\n");

  for (const c of centros) {
    const [plans, avSnap] = await Promise.all([
      colPlan.where("centro", "==", c).get(),
      colAv.where("centro", "==", c).where("tipo", "==", "PREVENTIVO").get(),
    ]);

    for (const d of plans.docs) {
      const dat = d.data() as Record<string, unknown>;
      if (!esPlanMT(dat.frecuencia)) continue;
      if (!tieneMeses(dat)) continue;
      ids.add(d.id);
    }
    for (const d of avSnap.docs) {
      const dat = d.data() as Record<string, unknown>;
      if (!esAvisoMT(dat)) continue;
      if (!tieneMeses(dat)) continue;
      ids.add(d.id);
    }
  }

  const listIds = [...ids];
  console.log(`Documentos (aviso/plan mismo id) a limpiar: ${listIds.length}`);
  if (!listIds.length) {
    console.log("Nada para hacer.");
    return;
  }
  console.log(`Centros alcance: ${centro ?? KNOWN_CENTROS.join(", ")}`);

  if (!commit) {
    console.log("\nPara aplicar los borrados ejecutá este script con --commit.");
    return;
  }

  let batches = 0;
  let batch = db.batch();
  let n = 0;

  async function flush() {
    if (n === 0) return;
    await batch.commit();
    batches++;
    batch = db.batch();
    n = 0;
  }

  const patch = {
    meses_programados: FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
  } as Record<string, unknown>;

  let updates = 0;
  for (const id of listIds) {
    const pref = colPlan.doc(id);
    const aref = colAv.doc(id);
    const [pSnap, aSnap] = await db.getAll(pref, aref);
    if (pSnap.exists && tieneMeses(pSnap.data() as Record<string, unknown>)) {
      batch.update(pref, patch);
      n++;
      updates++;
    }
    if (aSnap.exists && tieneMeses(aSnap.data() as Record<string, unknown>)) {
      batch.update(aref, patch);
      n++;
      updates++;
    }
    if (n >= BATCH_MAX) await flush();
  }
  await flush();

  console.log(
    `Listo: conjunto ${listIds.length} ids · ${updates} escrituras (solo docs existentes con meses). ${batches} commits.`,
  );
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
