/**
 * Observación de avisos semestrales/anuales en Firestore.
 *
 * Detecta conflictos típicos tras cargar listados del periodo anterior y del actual:
 * - Varios documentos con el mismo número SAP normalizado (mismo centro).
 * - Varios documentos con la misma `clave_mantenimiento` (misma UT+frecuencia+esp+tipo, distinto n° SAP).
 * - Avisos S/A sin `clave_mantenimiento` persistida (import legado).
 *
 * Solo lectura. No modifica datos.
 *
 * Uso:
 *   npx tsx scripts/observar-avisos-semestral-anual.ts
 *   npx tsx scripts/observar-avisos-semestral-anual.ts --centro PM02
 *   npx tsx scripts/observar-avisos-semestral-anual.ts --verbose
 *   npx tsx scripts/observar-avisos-semestral-anual.ts --limit 120000
 *
 * Entorno: `.env.local` + credenciales Admin (como `scripts/cleanup-duplicados-avisos.ts`).
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizeNAvisoCompare } from "@/lib/import/aviso-numero-canonical";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";

type Row = {
  id: string;
  n_aviso: string;
  centro: string;
  ut: string;
  frecuencia: string;
  mtsa: string;
  especialidad: string;
  tipo: string;
  estado: string;
  claveDb: string;
  claveCalc: string;
  work_order_id: string;
  antecesor: boolean;
  proximo_venc_ms: number | null;
  created_ms: number | null;
  updated_ms: number | null;
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let centro = "";
  let limit = 120_000;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" || a === "-c") centro = (argv[++i] ?? "").trim();
    if (a === "--limit" || a === "-l") limit = Math.max(1, parseInt(argv[++i] ?? "120000", 10) || 120_000);
    if (a === "--verbose" || a === "-v") verbose = true;
  }
  return { centro, limit, verbose };
}

function isSemAnual(freq: string, mtsa: string): boolean {
  const f = freq.toUpperCase();
  const m = mtsa.toUpperCase();
  return f === "SEMESTRAL" || f === "ANUAL" || m === "S" || m === "A";
}

function tsMs(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return null;
}

function fmtDate(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

function claveForDoc(data: Record<string, unknown>): string {
  const stored = String(data.clave_mantenimiento ?? "").trim();
  if (stored) return stored;
  const ut = String(data.ubicacion_tecnica ?? "").trim();
  const freq = data.frecuencia as FrecuenciaMantenimiento | undefined;
  const esp = data.especialidad as Especialidad | undefined;
  const tipo = (data.tipo as TipoAviso | undefined) ?? "PREVENTIVO";
  if (!ut || !freq || !esp) return "";
  return buildClaveMantenimiento({
    ubicacion_tecnica: ut,
    frecuencia: freq,
    especialidad: esp,
    tipo,
  });
}

function nAvisoCentroKey(centro: string, nAviso: string): string {
  return `${centro.trim()}\u0000${normalizeNAvisoCompare(nAviso)}`;
}

function printGroup(
  title: string,
  key: string,
  rows: Row[],
  verbose: boolean,
  maxShow: number,
) {
  console.log(`\n--- ${title} ---`);
  console.log(`  clave: ${key.replace(/\u0000/g, " | ")}`);
  for (const r of rows.slice(0, maxShow)) {
    console.log(
      `  · id=${r.id} n_aviso=${r.n_aviso} centro=${r.centro} ${r.frecuencia}/${r.mtsa} ${r.especialidad}` +
        ` estado=${r.estado}` +
        (r.work_order_id ? ` OT=${r.work_order_id}` : "") +
        (r.antecesor ? " [antecesor]" : "") +
        ` venc=${fmtDate(r.proximo_venc_ms)}` +
        ` creado=${fmtDate(r.created_ms)}` +
        (r.claveDb !== r.claveCalc && r.claveCalc ? ` clave≠calc` : ""),
    );
    if (verbose) {
      console.log(`      UT=${r.ut}`);
      if (!r.claveDb && r.claveCalc) console.log(`      (sin clave_mantenimiento en DB; calculada al vuelo)`);
    }
  }
  if (rows.length > maxShow) {
    console.log(`  … y ${rows.length - maxShow} documentos más en este grupo`);
  }
}

async function main() {
  const { centro, limit, verbose } = parseArgs();
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const planCol = db.collection(COLLECTIONS.plan_mantenimiento);

  const base = centro ? col.where("centro", "==", centro) : col;
  const snap = await base.limit(limit).get();

  const allRows: Row[] = [];
  const byCentroFreq = new Map<string, number>();
  let sinClaveDb = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const freq = String(data.frecuencia ?? "").trim();
    const mtsa = String(data.frecuencia_plan_mtsa ?? "").trim();
    if (!isSemAnual(freq, mtsa)) continue;

    const c = String(data.centro ?? "").trim();
    const claveDb = String(data.clave_mantenimiento ?? "").trim();
    const claveCalc = claveForDoc(data);
    if (!claveDb && claveCalc) sinClaveDb++;

    const row: Row = {
      id: d.id,
      n_aviso: String(data.n_aviso ?? "").trim(),
      centro: c,
      ut: String(data.ubicacion_tecnica ?? "").trim(),
      frecuencia: freq,
      mtsa,
      especialidad: String(data.especialidad ?? "").trim(),
      tipo: String(data.tipo ?? "").trim(),
      estado: String(data.estado ?? "").trim(),
      claveDb,
      claveCalc,
      work_order_id: String(data.work_order_id ?? "").trim(),
      antecesor: Boolean(data.antecesor_orden_abierta),
      proximo_venc_ms: tsMs(data.proximo_vencimiento),
      created_ms: tsMs(data.created_at),
      updated_ms: tsMs(data.updated_at),
    };
    allRows.push(row);

    const bucket = `${c || "?"}\t${freq || mtsa || "?"}`;
    byCentroFreq.set(bucket, (byCentroFreq.get(bucket) ?? 0) + 1);
  }

  console.log("=== Observación avisos semestral / anual ===");
  console.log(
    `Documentos leídos en colección: ${snap.size}${centro ? ` (filtro centro=${centro})` : ""}`,
  );
  console.log(`Avisos S/A en el subconjunto: ${allRows.length}`);
  console.log(`Sin clave_mantenimiento en DB (pero calculable): ${sinClaveDb}`);

  console.log("\n--- Resumen por centro × frecuencia ---");
  const sortedBuckets = [...byCentroFreq.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of sortedBuckets.slice(0, 40)) {
    const [c, f] = k.split("\t");
    console.log(`  ${c}: ${f} → ${n}`);
  }
  if (sortedBuckets.length > 40) {
    console.log(`  … y ${sortedBuckets.length - 40} combinaciones más`);
  }

  const byNaCentro = new Map<string, Row[]>();
  const byClave = new Map<string, Row[]>();

  for (const r of allRows) {
    if (r.n_aviso && r.centro) {
      const k = nAvisoCentroKey(r.centro, r.n_aviso);
      if (!byNaCentro.has(k)) byNaCentro.set(k, []);
      byNaCentro.get(k)!.push(r);
    }
    const clave = r.claveDb || r.claveCalc;
    if (clave) {
      if (!byClave.has(clave)) byClave.set(clave, []);
      byClave.get(clave)!.push(r);
    }
  }

  const dupNa = [...byNaCentro.entries()].filter(([, rows]) => rows.length > 1);
  const dupClave = [...byClave.entries()].filter(([, rows]) => rows.length > 1);

  const dupClaveDistintoSap = dupClave.filter(([, rows]) => {
    const nums = new Set(rows.map((r) => normalizeNAvisoCompare(r.n_aviso)).filter(Boolean));
    return nums.size > 1;
  });

  const conAntecesor = allRows.filter((r) => r.antecesor);
  const conOt = allRows.filter((r) => r.work_order_id);
  const cerrados = allRows.filter((r) => r.estado === "CERRADO" || r.estado === "ANULADO");

  console.log("\n--- Indicadores de conflicto ---");
  console.log(`Grupos mismo centro + n° SAP normalizado con >1 documento: ${dupNa.length}`);
  console.log(
    `Grupos misma clave_mantenimiento con >1 documento: ${dupClave.length}` +
      ` (de ellos, distinto n° SAP: ${dupClaveDistintoSap.length})`,
  );
  console.log(`Avisos con antecesor_orden_abierta: ${conAntecesor.length}`);
  console.log(`Avisos con work_order_id: ${conOt.length}`);
  console.log(`Avisos CERRADO/ANULADO: ${cerrados.length}`);

  const maxShow = verbose ? 50 : 12;

  if (dupNa.length) {
    console.log(
      "\n>>> Posible duplicado por formato de número SAP (mismo aviso lógico, IDs distintos).",
    );
    console.log("    Herramienta sugerida: scripts/cleanup-duplicados-avisos.ts (simulación primero).");
    for (const [k, rows] of dupNa.slice(0, maxShow)) {
      printGroup("Mismo n° SAP (normalizado)", k, rows, verbose, 8);
    }
    if (dupNa.length > maxShow) {
      console.log(`\n… ${dupNa.length - maxShow} grupos más (usá --verbose para ver más).`);
    }
  }

  if (dupClaveDistintoSap.length) {
    console.log(
      "\n>>> Posible solapamiento de periodos: mismo mantenimiento (UT+freq+esp), distintos números SAP.",
    );
    console.log(
      "    Suele pasar si quedó el listado del periodo anterior y se importó el actual sin cerrar/borrar el viejo.",
    );
    const ranked = dupClaveDistintoSap
      .map(([k, rows]) => ({
        k,
        rows,
        score: rows.filter((r) => r.work_order_id).length + (rows.some((r) => r.antecesor) ? 2 : 0),
      }))
      .sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);

    for (const { k, rows } of ranked.slice(0, maxShow)) {
      printGroup("Misma clave_mantenimiento", k.slice(0, 12) + "…", rows, verbose, 8);
    }
    if (ranked.length > maxShow) {
      console.log(`\n… ${ranked.length - maxShow} grupos más.`);
    }
  }

  const planOrphans: string[] = [];
  const sampleIds = dupClaveDistintoSap.flatMap(([, rows]) => rows.map((r) => r.id)).slice(0, 80);
  if (sampleIds.length) {
    const planSnaps = await db.getAll(...sampleIds.map((id) => planCol.doc(id)));
    for (const s of planSnaps) {
      if (s.exists) planOrphans.push(s.id);
    }
  }

  if (sampleIds.length) {
    console.log(
      `\n--- Plan mantenimiento (muestra ${sampleIds.length} ids en grupos clave duplicada) ---`,
    );
    console.log(`Documentos plan_mantenimiento/{id} existentes: ${planOrphans.length}`);
  }

  const gruposMixtos = dupClaveDistintoSap.filter(([, rows]) => {
    const est = new Set(rows.map((r) => r.estado));
    return est.size > 1;
  });
  if (gruposMixtos.length) {
    console.log(
      `\nGrupos clave duplicada con estados mezclados (ej. ABIERTO + CERRADO): ${gruposMixtos.length}`,
    );
  }

  console.log("\n=== Fin observación (solo lectura) ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
