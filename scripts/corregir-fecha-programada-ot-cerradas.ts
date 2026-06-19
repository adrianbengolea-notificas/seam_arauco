/**
 * Corrige OT preventivas CERRADAS cuya fecha_inicio_programada quedó en un mes
 * distinto al de fecha_fin_ejecucion (p. ej. reprogramadas por generarOtsDesdePrograma
 * después del cierre). Alinea programación al mes de cierre real para reportes.
 *
 * Uso:
 *   npx tsx scripts/corregir-fecha-programada-ot-cerradas.ts
 *   npx tsx scripts/corregir-fecha-programada-ot-cerradas.ts --centro PC01
 *   npx tsx scripts/corregir-fecha-programada-ot-cerradas.ts --año 2026
 *   npx tsx scripts/corregir-fecha-programada-ot-cerradas.ts --apply
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue, Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  formatFechaReporteAR,
  inicioAnioArgentinaMs,
  mesCalendarioArgentina,
} from "@/lib/reportes/periodo-reporte";
import { timestampToMillis } from "@/lib/reportes/cumplimiento-metrics";

const MAX_BATCH = 400;

type Fila = {
  id: string;
  n_ot: string;
  centro: string;
  finMs: number;
  progMs: number | null;
  finLabel: string;
  progLabel: string;
  finMes: { año: number; mes: number };
  progMes: { año: number; mes: number } | null;
};

function parseArgs(): { apply: boolean; centro?: string; año?: number } {
  const args = process.argv.slice(2);
  let apply = false;
  let centro: string | undefined;
  let año: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--centro" && args[i + 1]) centro = args[++i]!.trim();
    else if (a === "--año" && args[i + 1]) año = Number(args[++i]);
  }
  return { apply, centro, año };
}

function labelMes(m: { año: number; mes: number }): string {
  const n = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${n[m.mes] ?? m.mes} ${m.año}`;
}

function mesesDistintos(
  fin: { año: number; mes: number },
  prog: { año: number; mes: number },
): boolean {
  return fin.año !== prog.año || fin.mes !== prog.mes;
}

async function cargarCerradas(
  db: Firestore,
  opts: { centro?: string; año: number },
): Promise<QueryDocumentSnapshot[]> {
  const desde = Timestamp.fromMillis(inicioAnioArgentinaMs(opts.año));
  const centros = opts.centro ? [opts.centro] : [...KNOWN_CENTROS];
  const docs: QueryDocumentSnapshot[] = [];

  for (const centro of centros) {
    const snap = await db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "==", "PREVENTIVO")
      .where("estado", "==", "CERRADA")
      .where("fecha_fin_ejecucion", ">=", desde)
      .get();
    docs.push(...snap.docs);
  }

  return docs;
}

async function main() {
  const opts = parseArgs();
  const db = getAdminDb();
  const añoConsulta = opts.año ?? 2026;

  console.log("Opciones:", { ...opts, añoConsulta });
  console.log(`Consultando OT preventivas CERRADAS con fecha_fin >= ${añoConsulta}…`);

  const docs = await cargarCerradas(db, { centro: opts.centro, año: añoConsulta });
  console.log(`Documentos leídos: ${docs.length}`);

  const candidatas: Fila[] = [];

  for (const doc of docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;

    const finMs = timestampToMillis(d.fecha_fin_ejecucion);
    if (finMs == null) continue;

    const progMs = timestampToMillis(d.fecha_inicio_programada);
    const finMes = mesCalendarioArgentina(finMs);
    const progMes = progMs != null ? mesCalendarioArgentina(progMs) : null;

    if (progMes == null || !mesesDistintos(finMes, progMes)) continue;

    candidatas.push({
      id: doc.id,
      n_ot: String(d.n_ot ?? ""),
      centro: String(d.centro ?? ""),
      finMs,
      progMs,
      finLabel: formatFechaReporteAR(finMs),
      progLabel: progMs != null ? formatFechaReporteAR(progMs) : "—",
      finMes,
      progMes,
    });
  }

  candidatas.sort((a, b) => a.finMs - b.finMs);

  console.log(`\nDesalineadas (programación ≠ mes de cierre): ${candidatas.length}`);

  const porPar = new Map<string, number>();
  for (const f of candidatas) {
    const key = `${labelMes(f.finMes)} ← estaba ${labelMes(f.progMes!)}`;
    porPar.set(key, (porPar.get(key) ?? 0) + 1);
  }
  if (porPar.size) {
    console.log("\nResumen:");
    for (const [k, v] of [...porPar.entries()].sort()) {
      console.log(`  ${v} OT · cierre ${k}`);
    }
  }

  if (candidatas.length > 0) {
    console.log("\nPrimeras 25:");
    for (const f of candidatas.slice(0, 25)) {
      console.log(
        `  OT ${f.n_ot || f.id} · ${f.centro} · cierre ${f.finLabel} (${labelMes(f.finMes)}) · programada ${f.progLabel} (${labelMes(f.progMes!)})`,
      );
    }
    if (candidatas.length > 25) {
      console.log(`  … y ${candidatas.length - 25} más`);
    }
  }

  if (!opts.apply) {
    console.log("\n[dry-run] Sin cambios. Repetí con --apply para escribir en Firestore.");
    return;
  }

  if (candidatas.length === 0) {
    console.log("\nNada que corregir.");
    return;
  }

  let escritas = 0;
  let batch = db.batch();
  let ops = 0;

  for (const f of candidatas) {
    const ref = db.collection(COLLECTIONS.work_orders).doc(f.id);
    batch.update(ref, {
      fecha_inicio_programada: Timestamp.fromMillis(f.finMs),
      updated_at: FieldValue.serverTimestamp(),
    });
    ops += 1;
    escritas += 1;

    if (ops >= MAX_BATCH) {
      await batch.commit();
      console.log(`  batch commit (${escritas}/${candidatas.length})…`);
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();

  console.log(`\nListo. ${escritas} OT actualizadas: fecha_inicio_programada → mes de fecha_fin_ejecucion.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
