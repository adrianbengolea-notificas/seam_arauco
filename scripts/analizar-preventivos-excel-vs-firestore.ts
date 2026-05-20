/**
 * Cruza el Excel oficial de preventivos (periodo Abr 26 – Mar 27) con Firestore.
 * Solo lectura: identifica duplicados, solapamiento de periodos y avisos fuera del listado vigente.
 *
 * Uso:
 *   npx tsx scripts/analizar-preventivos-excel-vs-firestore.ts
 *   npx tsx scripts/analizar-preventivos-excel-vs-firestore.ts "C:/ruta/archivo.xlsx"
 *   npx tsx scripts/analizar-preventivos-excel-vs-firestore.ts --centro PM02 --json reporte.json
 *
 * Entorno: `.env.local` + credenciales Admin.
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { normalizeCentro } from "@/lib/firestore/derive-centro";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizeNAvisoCompare } from "@/lib/import/aviso-numero-canonical";
import {
  especialidadImportToDominio,
  normalizeEspecialidad,
} from "@/lib/import/normalize-values";
import { parseAvisosPorModo } from "@/lib/import/parse-avisos-excel";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";

function mtsaToFrecuencia(m: "M" | "T" | "S" | "A"): FrecuenciaMantenimiento {
  const map: Record<"M" | "T" | "S" | "A", FrecuenciaMantenimiento> = {
    M: "MENSUAL",
    T: "TRIMESTRAL",
    S: "SEMESTRAL",
    A: "ANUAL",
  };
  return map[m] ?? "MENSUAL";
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let excelPath = path.join(
    process.env.USERPROFILE ?? "",
    "Documents",
    "Downloads",
    "AVISOS PREVENTIVOS Abril 26 - Marzo 27.xlsx",
  );
  let centro = "";
  let limit = 120_000;
  let jsonOut = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" || a === "-c") centro = (argv[++i] ?? "").trim();
    if (a === "--limit" || a === "-l") limit = Math.max(1, parseInt(argv[++i] ?? "120000", 10) || 120_000);
    if (a === "--json") jsonOut = (argv[++i] ?? "").trim();
    else if (!a.startsWith("-") && (a.endsWith(".xlsx") || a.endsWith(".xls"))) excelPath = a;
  }
  return { excelPath, centro, limit, jsonOut };
}

function nAvisoCentroKey(centro: string, nAviso: string): string {
  return `${centro.trim()}\u0000${normalizeNAvisoCompare(nAviso)}`;
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

type DbRow = {
  id: string;
  n_aviso: string;
  centro: string;
  ut: string;
  frecuencia: string;
  mtsa: string;
  especialidad: string;
  tipo: string;
  estado: string;
  clave: string;
  work_order_id: string;
  created_ms: number | null;
};

type ExcelRow = {
  numero: string;
  centro: string;
  ut: string;
  mtsa: string;
  especialidadRaw: string;
  clave: string;
};

function claveFromDb(data: Record<string, unknown>): string {
  const stored = String(data.clave_mantenimiento ?? "").trim();
  if (stored) return stored;
  const ut = String(data.ubicacion_tecnica ?? "").trim();
  const freq = data.frecuencia as FrecuenciaMantenimiento | undefined;
  const esp = data.especialidad as Especialidad | undefined;
  const tipo = (data.tipo as TipoAviso | undefined) ?? "PREVENTIVO";
  if (!ut || !freq || !esp) return "";
  return buildClaveMantenimiento({ ubicacion_tecnica: ut, frecuencia: freq, especialidad: esp, tipo });
}

function claveFromExcel(r: ExcelRow): string {
  if (!r.ut || !r.mtsa) return "";
  const espCode = normalizeEspecialidad(r.especialidadRaw) ?? "A";
  const esp = especialidadImportToDominio(espCode);
  const freq = mtsaToFrecuencia(r.mtsa as "M" | "T" | "S" | "A");
  return buildClaveMantenimiento({
    ubicacion_tecnica: r.ut,
    frecuencia: freq,
    especialidad: esp,
    tipo: "PREVENTIVO",
  });
}

async function main() {
  const { excelPath, centro, limit, jsonOut } = parseArgs();

  console.log("=== Análisis preventivos: Excel vs Firestore ===\n");
  console.log("Excel:", excelPath);
  if (!fs.existsSync(excelPath)) {
    console.error("No existe el archivo Excel.");
    process.exit(1);
  }

  const buf = fs.readFileSync(excelPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseAvisosPorModo(ab as ArrayBuffer, "preventivos_todas");
  console.log(`Filas parseadas (preventivos_todas): ${parsed.avisos.length}`);
  if (parsed.fatal) console.log("FATAL parse:", parsed.fatal);
  if (parsed.errores.length) console.log(`Errores parse: ${parsed.errores.length}`);
  if (parsed.hojasProcesadas?.length) console.log("Hojas:", parsed.hojasProcesadas.join(", "));

  const excelRows: ExcelRow[] = [];
  const excelByKey = new Map<string, ExcelRow>();
  const excelByClave = new Map<string, ExcelRow[]>();

  for (const row of parsed.avisos) {
    if (row.tipo !== "preventivo" || !row.numero?.trim()) continue;
    const numero = row.numero.trim();
    const ut = (row.ubicacionTecnica ?? "").trim();
    const c = normalizeCentro(String(row.centro ?? ""), ut);
    const mtsa = row.frecuencia ?? "";
    if (!ut || !mtsa) continue;
    const er: ExcelRow = {
      numero,
      centro: c,
      ut,
      mtsa,
      especialidadRaw: String(row.especialidad ?? ""),
      clave: "",
    };
    er.clave = claveFromExcel(er);
    const k = nAvisoCentroKey(c, numero);
    excelByKey.set(k, er);
    if (er.clave) {
      if (!excelByClave.has(er.clave)) excelByClave.set(er.clave, []);
      excelByClave.get(er.clave)!.push(er);
    }
    excelRows.push(er);
  }

  const excelDupClave = [...excelByClave.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`\nExcel: filas preventivo con centro+frec: ${excelRows.length}`);
  console.log(`Excel: claves únicas n_aviso+centro: ${excelByKey.size}`);
  if (excelDupClave.length) console.log(`Excel: claves mantenimiento duplicadas: ${excelDupClave.length}`);

  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const base = centro ? col.where("centro", "==", centro) : col;
  const snap = await base.limit(limit).get();
  console.log(`\nFirestore: documentos leídos: ${snap.size}${centro ? ` (centro=${centro})` : ""}`);

  const dbPreventivos: DbRow[] = [];
  const dbByKey = new Map<string, DbRow[]>();
  const dbByClave = new Map<string, DbRow[]>();

  for (const d of snap.docs) {
    const data = d.data();
    const tipo = String(data.tipo ?? "").trim();
    if (tipo !== "PREVENTIVO") continue;
    const c = String(data.centro ?? "").trim();
    const na = String(data.n_aviso ?? "").trim();
    if (!c || !na) continue;
    const clave = claveFromDb(data);
    const row: DbRow = {
      id: d.id,
      n_aviso: na,
      centro: c,
      ut: String(data.ubicacion_tecnica ?? "").trim(),
      frecuencia: String(data.frecuencia ?? "").trim(),
      mtsa: String(data.frecuencia_plan_mtsa ?? "").trim(),
      especialidad: String(data.especialidad ?? "").trim(),
      tipo,
      estado: String(data.estado ?? "").trim(),
      clave,
      work_order_id: String(data.work_order_id ?? "").trim(),
      created_ms: tsMs(data.created_at),
    };
    dbPreventivos.push(row);
    const k = nAvisoCentroKey(c, na);
    if (!dbByKey.has(k)) dbByKey.set(k, []);
    dbByKey.get(k)!.push(row);
    if (clave) {
      if (!dbByClave.has(clave)) dbByClave.set(clave, []);
      dbByClave.get(clave)!.push(row);
    }
  }

  console.log(`Firestore: preventivos: ${dbPreventivos.length}`);

  const dupNaDb = [...dbByKey.entries()].filter(([, rows]) => rows.length > 1);
  const dupClaveDb = [...dbByClave.entries()].filter(([, rows]) => rows.length > 1);
  const dupClaveDistintoSap = dupClaveDb.filter(([, rows]) => {
    const nums = new Set(rows.map((r) => normalizeNAvisoCompare(r.n_aviso)));
    return nums.size > 1;
  });

  const enExcelNoDb: ExcelRow[] = [];
  for (const [k, er] of excelByKey) {
    if (!dbByKey.has(k)) enExcelNoDb.push(er);
  }

  const enDbNoExcel: DbRow[] = [];
  for (const r of dbPreventivos) {
    const k = nAvisoCentroKey(r.centro, r.n_aviso);
    if (!excelByKey.has(k)) enDbNoExcel.push(r);
  }

  /** Misma clave de mantenimiento: Excel tiene un n° SAP, DB tiene otro(s) además. */
  type Solapamiento = {
    clave: string;
    excel: ExcelRow;
    enDb: DbRow[];
    candidatosBorrar: DbRow[];
  };
  const solapamientos: Solapamiento[] = [];

  for (const [clave, excelList] of excelByClave) {
    if (excelList.length !== 1) continue;
    const ex = excelList[0]!;
    const dbRows = dbByClave.get(clave) ?? [];
    if (dbRows.length <= 1) continue;
    const exNorm = normalizeNAvisoCompare(ex.numero);
    const otros = dbRows.filter((r) => normalizeNAvisoCompare(r.n_aviso) !== exNorm);
    if (!otros.length) continue;
    const candidatos = otros.filter((r) => {
      const k = nAvisoCentroKey(r.centro, r.n_aviso);
      return !excelByKey.has(k);
    });
    if (candidatos.length) {
      solapamientos.push({ clave, excel: ex, enDb: dbRows, candidatosBorrar: candidatos });
    }
  }

  const candidatosBorrarFlat = new Map<string, DbRow & { motivo: string }>();
  for (const s of solapamientos) {
    for (const r of s.candidatosBorrar) {
      candidatosBorrarFlat.set(r.id, {
        ...r,
        motivo: "misma_clave_mantenimiento_fuera_excel",
      });
    }
  }
  for (const r of enDbNoExcel) {
    if (!candidatosBorrarFlat.has(r.id)) {
      candidatosBorrarFlat.set(r.id, { ...r, motivo: "n_aviso_no_esta_en_excel_vigente" });
    }
  }
  for (const [, rows] of dupNaDb) {
    const sorted = rows.slice().sort((a, b) => {
      const aWo = a.work_order_id ? 1 : 0;
      const bWo = b.work_order_id ? 1 : 0;
      if (bWo !== aWo) return bWo - aWo;
      return (b.created_ms ?? 0) - (a.created_ms ?? 0);
    });
    const winner = sorted[sorted.length - 1]!;
    for (const loser of sorted.slice(0, -1)) {
      if (!candidatosBorrarFlat.has(loser.id)) {
        candidatosBorrarFlat.set(loser.id, {
          ...loser,
          motivo: "duplicado_mismo_n_aviso_formato_id",
        });
      }
      if (!excelByKey.has(nAvisoCentroKey(winner.centro, winner.n_aviso))) {
        /* winner también fuera del excel — no lo marcamos automáticamente */
      }
    }
  }

  const conOt = [...candidatosBorrarFlat.values()].filter((r) => r.work_order_id);
  const cerrados = [...candidatosBorrarFlat.values()].filter(
    (r) => r.estado === "CERRADO" || r.estado === "ANULADO",
  );

  console.log("\n--- Duplicados en Firestore ---");
  console.log(`Mismo centro + n° SAP (normalizado), >1 documento: ${dupNaDb.length} grupos`);
  console.log(`Misma clave_mantenimiento, >1 documento: ${dupClaveDb.length} grupos`);
  console.log(`  … con distinto n° SAP (solapamiento periodos): ${dupClaveDistintoSap.length}`);

  console.log("\n--- Cruce con Excel vigente ---");
  console.log(`En Excel, no en DB (faltan importar): ${enExcelNoDb.length}`);
  console.log(`En DB, no en Excel (n° SAP distinto al listado): ${enDbNoExcel.length}`);
  console.log(`Solapamiento clave: Excel vigente + otros docs en DB: ${solapamientos.length} grupos`);

  console.log("\n--- Candidatos a revisar/borrar (heurística, NO borra) ---");
  console.log(`Total candidatos únicos: ${candidatosBorrarFlat.size}`);
  console.log(`  Con work_order_id (revisar manual): ${conOt.length}`);
  console.log(`  CERRADO/ANULADO: ${cerrados.length}`);

  const byMotivo = new Map<string, number>();
  for (const r of candidatosBorrarFlat.values()) {
    byMotivo.set(r.motivo, (byMotivo.get(r.motivo) ?? 0) + 1);
  }
  console.log("  Por motivo:");
  for (const [m, n] of byMotivo) console.log(`    ${m}: ${n}`);

  const byCentro = new Map<string, number>();
  for (const r of candidatosBorrarFlat.values()) {
    byCentro.set(r.centro, (byCentro.get(r.centro) ?? 0) + 1);
  }
  console.log("\n  Por centro:");
  for (const [c, n] of [...byCentro.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c}: ${n}`);
  }

  console.log("\n--- Muestra: en DB pero NO en Excel (primeros 15) ---");
  for (const r of enDbNoExcel.slice(0, 15)) {
    console.log(
      `  ${r.centro} | ${r.n_aviso} | id=${r.id} | ${r.frecuencia}/${r.mtsa} | ${r.estado}` +
        (r.work_order_id ? ` OT=${r.work_order_id}` : "") +
        ` | creado=${fmtDate(r.created_ms)}`,
    );
  }
  if (enDbNoExcel.length > 15) console.log(`  … y ${enDbNoExcel.length - 15} más`);

  if (solapamientos.length) {
    console.log("\n--- Muestra: solapamiento periodo (misma UT+freq, otro n° SAP en DB) ---");
    for (const s of solapamientos.slice(0, 8)) {
      console.log(`  Clave ${s.clave.slice(0, 12)}…`);
      console.log(`    Excel vigente: ${s.excel.numero} (${s.excel.centro}) UT=${s.excel.ut}`);
      for (const r of s.candidatosBorrar) {
        console.log(
          `    → candidato: ${r.n_aviso} id=${r.id} ${r.estado}` +
            (r.work_order_id ? ` OT=${r.work_order_id}` : "") +
            ` creado=${fmtDate(r.created_ms)}`,
        );
      }
    }
    if (solapamientos.length > 8) console.log(`  … y ${solapamientos.length - 8} grupos más`);
  }

  if (dupNaDb.length) {
    console.log("\n--- Muestra: duplicado mismo n° SAP (IDs distintos) ---");
    for (const [, rows] of dupNaDb.slice(0, 5)) {
      for (const r of rows) {
        console.log(`  id=${r.id} n=${r.n_aviso} ${r.estado}${r.work_order_id ? ` OT` : ""}`);
      }
      console.log("  ---");
    }
  }

  const report = {
    generado: new Date().toISOString(),
    excelPath,
    excelFilas: excelRows.length,
    firestoreLeidos: snap.size,
    firestorePreventivos: dbPreventivos.length,
    enExcelNoDb: enExcelNoDb.map((r) => ({ numero: r.numero, centro: r.centro, ut: r.ut, mtsa: r.mtsa })),
    enDbNoExcel: enDbNoExcel.map((r) => ({
      id: r.id,
      n_aviso: r.n_aviso,
      centro: r.centro,
      ut: r.ut,
      frecuencia: r.frecuencia,
      mtsa: r.mtsa,
      estado: r.estado,
      work_order_id: r.work_order_id || null,
      created: fmtDate(r.created_ms),
    })),
    candidatosBorrar: [...candidatosBorrarFlat.values()].map((r) => ({
      id: r.id,
      n_aviso: r.n_aviso,
      centro: r.centro,
      motivo: r.motivo,
      estado: r.estado,
      work_order_id: r.work_order_id || null,
      created: fmtDate(r.created_ms),
    })),
    resumen: {
      dupNaGrupos: dupNaDb.length,
      dupClaveGrupos: dupClaveDb.length,
      dupClaveDistintoSap: dupClaveDistintoSap.length,
      enExcelNoDb: enExcelNoDb.length,
      enDbNoExcel: enDbNoExcel.length,
      solapamientos: solapamientos.length,
      candidatosBorrar: candidatosBorrarFlat.size,
      candidatosConOt: conOt.length,
    },
  };

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nReporte JSON: ${jsonOut}`);
  }

  console.log("\n=== Fin análisis (solo lectura) ===");
  console.log(
    "Próximo paso sugerido: revisar candidatos con OT o CERRADO antes de borrar; usar cleanup-duplicados-avisos.ts solo para dup mismo n° SAP.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
