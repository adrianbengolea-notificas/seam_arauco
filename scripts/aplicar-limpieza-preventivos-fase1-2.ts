/**
 * Fase 1: borra avisos preventivos ABIERTO sin OT fuera del Excel vigente.
 * Fase 2: anula avisos del solapamiento (misma clave, n° SAP viejo) que tienen OT.
 *
 * Uso:
 *   npx tsx scripts/aplicar-limpieza-preventivos-fase1-2.ts "ruta.xlsx"
 *   npx tsx scripts/aplicar-limpieza-preventivos-fase1-2.ts --apply
 *   npx tsx scripts/aplicar-limpieza-preventivos-fase1-2.ts --apply --solo-fase1
 *   npx tsx scripts/aplicar-limpieza-preventivos-fase1-2.ts --apply --solo-fase2
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
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
import { anularWorkOrder } from "@/modules/work-orders/service";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";

const ACTOR_UID = process.env.SCRIPT_ACTOR_UID?.trim() || "script-limpieza-preventivos";
const MAX_BATCH_OPS = 500;
const NOTA_ANULACION =
  "Anulado por limpieza periodo: Excel vigente reemplaza este n° SAP (misma clave mantenimiento).";

function mtsaToFrecuencia(m: "M" | "T" | "S" | "A"): FrecuenciaMantenimiento {
  const map: Record<"M" | "T" | "S" | "A", FrecuenciaMantenimiento> = {
    M: "MENSUAL",
    T: "TRIMESTRAL",
    S: "SEMESTRAL",
    A: "ANUAL",
  };
  return map[m] ?? "MENSUAL";
}

function nAvisoCentroKey(centro: string, nAviso: string): string {
  return `${centro.trim()}\u0000${normalizeNAvisoCompare(nAviso)}`;
}

type ExcelRow = {
  numero: string;
  centro: string;
  ut: string;
  mtsa: string;
  especialidadRaw: string;
  clave: string;
};

type DbRow = {
  id: string;
  n_aviso: string;
  centro: string;
  estado: string;
  work_order_id: string;
  clave: string;
};

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

function parseArgs() {
  const argv = process.argv.slice(2);
  let excelPath = path.join(
    process.env.USERPROFILE ?? "",
    "Documents",
    "Downloads",
    "AVISOS PREVENTIVOS Abril 26 - Marzo 27.xlsx",
  );
  let apply = false;
  let soloFase1 = false;
  let soloFase2 = false;
  let limit = 120_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") apply = true;
    if (a === "--solo-fase1") soloFase1 = true;
    if (a === "--solo-fase2") soloFase2 = true;
    if (a === "--limit" || a === "-l") limit = Math.max(1, parseInt(argv[++i] ?? "120000", 10) || 120_000);
    else if (!a.startsWith("-") && (a.endsWith(".xlsx") || a.endsWith(".xls"))) excelPath = a;
  }
  const fase2 = soloFase2 || (!soloFase1 && !soloFase2);
  const fase1 = soloFase1 || (!soloFase1 && !soloFase2);
  return { excelPath, apply, fase1, fase2, limit };
}

async function cargarSets(excelPath: string, limit: number) {
  const buf = fs.readFileSync(excelPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseAvisosPorModo(ab as ArrayBuffer, "preventivos_todas");

  const excelByKey = new Map<string, ExcelRow>();
  const excelByClave = new Map<string, ExcelRow[]>();

  for (const row of parsed.avisos) {
    if (row.tipo !== "preventivo" || !row.numero?.trim()) continue;
    const ut = (row.ubicacionTecnica ?? "").trim();
    const c = normalizeCentro(String(row.centro ?? ""), ut);
    const mtsa = row.frecuencia ?? "";
    if (!ut || !mtsa) continue;
    const er: ExcelRow = {
      numero: row.numero.trim(),
      centro: c,
      ut,
      mtsa,
      especialidadRaw: String(row.especialidad ?? ""),
      clave: "",
    };
    er.clave = claveFromExcel(er);
    excelByKey.set(nAvisoCentroKey(c, er.numero), er);
    if (er.clave) {
      if (!excelByClave.has(er.clave)) excelByClave.set(er.clave, []);
      excelByClave.get(er.clave)!.push(er);
    }
  }

  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.avisos).limit(limit).get();
  const dbByKey = new Map<string, DbRow[]>();
  const dbByClave = new Map<string, DbRow[]>();

  for (const d of snap.docs) {
    const data = d.data();
    if (String(data.tipo ?? "").trim() !== "PREVENTIVO") continue;
    const c = String(data.centro ?? "").trim();
    const na = String(data.n_aviso ?? "").trim();
    if (!c || !na) continue;
    const row: DbRow = {
      id: d.id,
      n_aviso: na,
      centro: c,
      estado: String(data.estado ?? "").trim(),
      work_order_id: String(data.work_order_id ?? "").trim(),
      clave: claveFromDb(data),
    };
    const k = nAvisoCentroKey(c, na);
    if (!dbByKey.has(k)) dbByKey.set(k, []);
    dbByKey.get(k)!.push(row);
    if (row.clave) {
      if (!dbByClave.has(row.clave)) dbByClave.set(row.clave, []);
      dbByClave.get(row.clave)!.push(row);
    }
  }

  /** Números SAP del Excel (sin centro): evita borrar si DB tiene centro distinto al derivado del UT. */
  const excelNumerosNorm = new Set(
    [...excelByKey.values()].map((e) => normalizeNAvisoCompare(e.numero)).filter(Boolean),
  );

  const enDbNoExcel: DbRow[] = [];
  for (const rows of dbByKey.values()) {
    for (const r of rows) {
      const enExcelPorPar = excelByKey.has(nAvisoCentroKey(r.centro, r.n_aviso));
      const enExcelPorNumero = excelNumerosNorm.has(normalizeNAvisoCompare(r.n_aviso));
      if (!enExcelPorPar && !enExcelPorNumero) enDbNoExcel.push(r);
    }
  }

  const solapCandidatos: Array<DbRow & { excelVigente: string }> = [];
  for (const [clave, excelList] of excelByClave) {
    if (excelList.length !== 1) continue;
    const ex = excelList[0]!;
    const dbRows = dbByClave.get(clave) ?? [];
    if (dbRows.length <= 1) continue;
    const exNorm = normalizeNAvisoCompare(ex.numero);
    for (const r of dbRows) {
      if (normalizeNAvisoCompare(r.n_aviso) === exNorm) continue;
      const k = nAvisoCentroKey(r.centro, r.n_aviso);
      if (!excelByKey.has(k)) {
        solapCandidatos.push({ ...r, excelVigente: ex.numero });
      }
    }
  }

  const fase1Ids = new Set<string>();
  for (const r of enDbNoExcel) {
    if (r.estado === "ABIERTO" && !r.work_order_id) fase1Ids.add(r.id);
  }

  const fase2Rows: Array<DbRow & { excelVigente: string }> = [];
  for (const r of solapCandidatos) {
    if (fase1Ids.has(r.id)) continue;
    if (r.work_order_id || r.estado === "OT_GENERADA") fase2Rows.push(r);
  }

  return {
    excelByKey,
    fase1Ids: [...fase1Ids],
    fase2Rows,
    excelFilas: excelByKey.size,
    excelNumerosNorm,
  };
}

async function main() {
  const { excelPath, apply, fase1, fase2, limit } = parseArgs();
  if (!fs.existsSync(excelPath)) {
    console.error("No existe:", excelPath);
    process.exit(1);
  }

  console.log("=== Limpieza preventivos fase 1 + 2 ===");
  console.log("Excel:", excelPath);
  console.log("Modo:", apply ? "APLICAR" : "SIMULACIÓN (--apply para persistir)");
  console.log("Actor OT:", ACTOR_UID);

  const { fase1Ids, fase2Rows, excelFilas, excelNumerosNorm } = await cargarSets(excelPath, limit);
  console.log(`Excel claves únicas: ${excelFilas} | números SAP únicos: ${excelNumerosNorm.size}`);
  console.log(`Fase 1 — borrar ABIERTO sin OT: ${fase1 ? fase1Ids.length : "(omitida)"}`);
  console.log(`Fase 2 — anular solapamiento con OT: ${fase2 ? fase2Rows.length : "(omitida)"}`);

  if (fase1 && fase1Ids.length) {
    console.log("\nFase 1 IDs:", fase1Ids.slice(0, 20).join(", ") + (fase1Ids.length > 20 ? "…" : ""));
  }
  if (fase2 && fase2Rows.length) {
    console.log("\nFase 2 muestra:");
    for (const r of fase2Rows.slice(0, 12)) {
      console.log(
        `  ${r.n_aviso} → vigente Excel ${r.excelVigente} | ${r.estado} | OT=${r.work_order_id || "—"}`,
      );
    }
    if (fase2Rows.length > 12) console.log(`  … y ${fase2Rows.length - 12} más`);
  }

  if (!apply) {
    console.log("\nSimulación terminada. Re-ejecutá con --apply.");
    return;
  }

  const db = getAdminDb();
  const avisosCol = db.collection(COLLECTIONS.avisos);
  const planCol = db.collection(COLLECTIONS.plan_mantenimiento);
  const log: Record<string, unknown> = {
    generado: new Date().toISOString(),
    actorUid: ACTOR_UID,
    excelPath,
    borrados: [] as string[],
    anulados: [] as Array<{ id: string; n_aviso: string; ot?: string; error?: string }>,
    omitidos: [] as string[],
  };

  if (fase1 && fase1Ids.length) {
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    for (const id of fase1Ids) {
      const snap = await avisosCol.doc(id).get();
      if (!snap.exists) {
        (log.omitidos as string[]).push(`${id}: ya no existe`);
        continue;
      }
      const d = snap.data()!;
      const st = String(d.estado ?? "");
      const wo = String(d.work_order_id ?? "").trim();
      const na = String(d.n_aviso ?? "").trim();
      if (excelNumerosNorm.has(normalizeNAvisoCompare(na))) {
        (log.omitidos as string[]).push(`${id}: n_aviso ${na} está en Excel (centro distinto, no borrar)`);
        continue;
      }
      if (st !== "ABIERTO" || wo) {
        (log.omitidos as string[]).push(`${id}: estado=${st} wo=${wo || "—"} (no borrado)`);
        continue;
      }
      batch.delete(planCol.doc(id));
      batch.delete(avisosCol.doc(id));
      ops += 2;
      (log.borrados as string[]).push(id);
      if (ops >= MAX_BATCH_OPS) await flush();
    }
    await flush();
    console.log(`\nFase 1: borrados ${(log.borrados as string[]).length} avisos + planes`);
  }

  if (fase2 && fase2Rows.length) {
    for (const r of fase2Rows) {
      const snap = await avisosCol.doc(r.id).get();
      if (!snap.exists) {
        (log.omitidos as string[]).push(`${r.id}: ya no existe (fase2)`);
        continue;
      }
      const d = snap.data()!;
      if (String(d.estado ?? "") === "ANULADO" || String(d.estado ?? "") === "CERRADO") {
        (log.omitidos as string[]).push(`${r.id}: ya ${d.estado}`);
        continue;
      }

      const woId = String(d.work_order_id ?? "").trim();
      let otError: string | undefined;
      if (woId) {
        try {
          await anularWorkOrder({ workOrderId: woId, actorUid: ACTOR_UID });
        } catch (e) {
          otError = e instanceof Error ? e.message : String(e);
        }
      }

      await avisosCol.doc(r.id).update({
        estado: "ANULADO",
        work_order_id: FieldValue.delete(),
        texto_largo: [String(d.texto_largo ?? "").trim(), NOTA_ANULACION].filter(Boolean).join(" — "),
        updated_at: FieldValue.serverTimestamp(),
      });

      const planSnap = await planCol.doc(r.id).get();
      if (planSnap.exists) {
        await planCol.doc(r.id).update({
          activo: false,
          updated_at: FieldValue.serverTimestamp(),
        });
      }

      (log.anulados as Array<{ id: string; n_aviso: string; ot?: string; error?: string }>).push({
        id: r.id,
        n_aviso: r.n_aviso,
        ot: woId || undefined,
        error: otError,
      });
    }
    const ok = (log.anulados as Array<{ error?: string }>).filter((x) => !x.error).length;
    const err = (log.anulados as Array<{ error?: string }>).filter((x) => x.error).length;
    console.log(`\nFase 2: anulados ${ok} avisos (${err} con error al anular OT, aviso igual quedó ANULADO)`);
  }

  const logPath = path.join(process.cwd(), "aplicacion-limpieza-preventivos.json");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
  console.log("Log:", logPath);
  console.log("\n=== Fin ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
