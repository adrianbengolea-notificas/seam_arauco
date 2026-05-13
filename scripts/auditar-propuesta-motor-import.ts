/**
 * Auditoría: causa de «Propuesta sin ítems» (motor + import Excel / derivación de centro).
 *
 * Por cada centro:
 * - Conteos de avisos, planes y desglose del pool que ve el motor greedy (inactivos, sin asset, con OT pendiente).
 * - Conflictos aviso.centro ≠ activo.centro (típico BOSS→PF01 vs equipo PM02…).
 * - Correctivos ABIERTA/EN_EJECUION (entran a la propuesta si `incluir_correctivos_en_propuesta`).
 * - Config `centros/{id}.config_motor` (merge con defaults).
 *
 * Global:
 * - Documentos `propuestas_semana` con status pendiente_aprobacion e items vacíos.
 *
 * Uso:
 *   npx tsx scripts/auditar-propuesta-motor-import.ts
 *   npx tsx scripts/auditar-propuesta-motor-import.ts --centro PM02 --centro PT01
 *   npx tsx scripts/auditar-propuesta-motor-import.ts --semana 2026-W18
 *
 * Entorno: credenciales Admin (como `scripts/auditar-centro-aviso-vs-activo.ts`).
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PlanMantenimientoFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { mergeCentroConfig } from "@/modules/centros/merge-config";
import { listPlanesMantenimientoCentro } from "@/lib/plan-mantenimiento/admin";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import type { WorkOrder } from "@/modules/work-orders/types";
import type { Firestore } from "firebase-admin/firestore";

const CHUNK = 400;

type MotorPoolStats = {
  total: number;
  elegibles: number;
  exclInactivo: number;
  exclOtPendiente: number;
  exclSinAsset: number;
};

function statsMotorPool(planes: PlanMantenimientoFirestore[]): MotorPoolStats {
  let exclInactivo = 0;
  let exclOtPendiente = 0;
  let exclSinAsset = 0;
  let elegibles = 0;
  for (const p of planes) {
    if (p.activo === false) {
      exclInactivo++;
      continue;
    }
    const pend = p.incluido_en_ot_pendiente;
    if (pend != null && String(pend).trim() !== "") {
      exclOtPendiente++;
      continue;
    }
    if (p.asset_id?.trim() === "") {
      exclSinAsset++;
      continue;
    }
    elegibles++;
  }
  return {
    total: planes.length,
    elegibles,
    exclInactivo,
    exclOtPendiente,
    exclSinAsset,
  };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const centros: string[] = [];
  let semanaId: string | null = null;
  let muestraMis = 15;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" || a === "-c") {
      const v = (argv[++i] ?? "").trim();
      if (v) centros.push(v);
    } else if (a === "--semana" || a === "-s") {
      semanaId = (argv[++i] ?? "").trim() || null;
    } else if (a === "--muestra" || a === "-m") {
      muestraMis = Math.max(0, parseInt(argv[++i] ?? "15", 10) || 15);
    }
  }
  return { centros, semanaId, muestraMis };
}

async function conflictosAvisoVsActivo(
  db: Firestore,
  filtroCentro: string,
  limit: number,
  muestraLimite: number,
): Promise<{
  total: number;
  muestra: Array<{
    avisoId: string;
    n_aviso: string;
    centroAviso: string;
    codigo: string;
    centroAsset: string;
  }>;
}> {
  const col = db.collection(COLLECTIONS.avisos);
  const q = col.where("centro", "==", filtroCentro).limit(limit);
  const snap = await q.get();
  const assetIds = [...new Set(snap.docs.map((d) => String(d.get("asset_id") ?? "").trim()).filter(Boolean))];
  const assetCentroById = new Map<string, { centro: string; codigo: string }>();
  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.assets).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      assetCentroById.set(s.id, {
        centro: String(s.get("centro") ?? "").trim(),
        codigo: String(s.get("codigo_nuevo") ?? "").trim(),
      });
    }
  }
  const muestra: Array<{
    avisoId: string;
    n_aviso: string;
    centroAviso: string;
    codigo: string;
    centroAsset: string;
  }> = [];
  let total = 0;
  for (const d of snap.docs) {
    const avisoCentro = String(d.get("centro") ?? "").trim();
    const assetId = String(d.get("asset_id") ?? "").trim();
    const n_aviso = String(d.get("n_aviso") ?? "").trim();
    if (!assetId) continue;
    const meta = assetCentroById.get(assetId);
    if (!meta || !meta.centro) continue;
    if (avisoCentro && meta.centro !== avisoCentro) {
      total++;
      if (muestra.length < muestraLimite) {
        muestra.push({
          avisoId: d.id,
          n_aviso,
          centroAviso: avisoCentro,
          codigo: meta.codigo || "—",
          centroAsset: meta.centro,
        });
      }
    }
  }
  return { total, muestra };
}

async function auditarCentro(
  db: Firestore,
  centro: string,
  semanaId: string | null,
  muestraLimite: number,
): Promise<void> {
  const [planes, woSnap, cfgSnap, mis] = await Promise.all([
    listPlanesMantenimientoCentro(centro),
    db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .orderBy("created_at", "desc")
      .limit(300)
      .get(),
    db.collection(COLLECTIONS.centros).doc(centro).get(),
    conflictosAvisoVsActivo(db, centro, 8000, muestraLimite),
  ]);

  const cfg = mergeCentroConfig(cfgSnap.data() as Record<string, unknown> | undefined);
  const pool = statsMotorPool(planes);

  const correctivosAbiertos = woSnap.docs.filter((d) => {
    const w = { id: d.id, ...(d.data() as Omit<WorkOrder, "id">) };
    return w.sub_tipo === "correctivo" && (w.estado === "ABIERTA" || w.estado === "EN_EJECUCION");
  }).length;

  console.log(`\n─── ${centro} (${cfg.config_motor.incluir_correctivos_en_propuesta ? "correctivos en propuesta: sí" : "correctivos en propuesta: no"}) ───`);
  console.log(
    `  Avisos (Firestore):     ${(await db.collection(COLLECTIONS.avisos).where("centro", "==", centro).count().get()).data().count}`,
  );
  console.log(`  Planes mantenimiento:   ${pool.total}`);
  console.log(
    `  Pool motor (elegibles): ${pool.elegibles}  | excl. inactivo: ${pool.exclInactivo} | excl. OT pendiente: ${pool.exclOtPendiente} | excl. sin asset_id: ${pool.exclSinAsset}`,
  );
  console.log(`  Correctivos abiertos (muestra reciente ≤300 OTs): ${correctivosAbiertos}`);
  console.log(
    `  Aviso.centro ≠ activo.centro (muestra hasta 8000 avisos del centro): ${mis.total} conflictos`,
  );
  if (mis.muestra.length) {
    for (const m of mis.muestra) {
      console.log(
        `    · n_aviso=${m.n_aviso} aviso→${m.centroAviso} vs activo ${m.codigo}→${m.centroAsset}`,
      );
    }
    if (mis.total > mis.muestra.length) {
      console.log(`    … ${mis.total - mis.muestra.length} más (revisá con scripts/auditar-centro-aviso-vs-activo.ts)`);
    }
  }

  if (semanaId) {
    const pid = propuestaSemanaDocId(centro, semanaId);
    const pr = await db.collection(COLLECTIONS.propuestas_semana).doc(pid).get();
    if (!pr.exists) {
      console.log(`  Propuesta ${semanaId}: (sin documento) id=${pid}`);
    } else {
      const data = pr.data() as { status?: string; items?: unknown[]; semana?: string };
      const n = Array.isArray(data.items) ? data.items.length : 0;
      console.log(
        `  Propuesta ${semanaId}: status=${data.status ?? "—"} items=${n} id=${pid}`,
      );
      if (data.status === "pendiente_aprobacion" && n === 0) {
        console.log(`    ⚠ Coincide con «Propuesta sin ítems» para esta semana.`);
      }
    }
  }

  const riesgoVacio =
    pool.elegibles === 0 &&
    (!cfg.config_motor.incluir_correctivos_en_propuesta || correctivosAbiertos === 0);
  if (riesgoVacio) {
    console.log(
      `  ⚠ Riesgo de propuesta vacía: 0 planes elegibles y sin correctivos en propuesta (o sin correctivos abiertos en la muestra).`,
    );
  }
}

async function listarPropuestasVaciaPendiente(db: Firestore): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.propuestas_semana)
    .where("status", "==", "pendiente_aprobacion")
    .get();

  const vacias: Array<{ id: string; centro?: string; semana?: string; n: number }> = [];
  for (const d of snap.docs) {
    const data = d.data() as { items?: unknown[]; centro?: string; semana?: string };
    const n = Array.isArray(data.items) ? data.items.length : 0;
    if (n === 0) {
      vacias.push({ id: d.id, centro: data.centro, semana: data.semana, n });
    }
  }

  console.log("\n=== Propuestas pendiente_aprobacion SIN ítems (Firestore) ===");
  console.log(`Total con status pendiente_aprobacion: ${snap.size} | Sin ítems: ${vacias.length}`);
  for (const v of vacias.slice(0, 40)) {
    console.log(`  · ${v.id} | centro=${v.centro ?? "—"} | semana=${v.semana ?? "—"}`);
  }
  if (vacias.length > 40) {
    console.log(`  … y ${vacias.length - 40} más`);
  }
}

async function main() {
  const { centros: centrosArg, semanaId, muestraMis } = parseArgs();
  const centros = centrosArg.length ? centrosArg : [...KNOWN_CENTROS];

  const db = getAdminDb();

  console.log("Auditoría motor / import (propuesta sin ítems)");
  console.log(`Centros: ${centros.join(", ")}`);
  if (semanaId) console.log(`Semana (detalle propuesta por doc): ${semanaId}`);

  for (const c of centros) {
    const t = c.trim();
    if (!t) continue;
    await auditarCentro(db, t, semanaId, muestraMis);
  }

  await listarPropuestasVaciaPendiente(db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
