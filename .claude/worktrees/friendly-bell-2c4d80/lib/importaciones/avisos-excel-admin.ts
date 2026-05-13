/**
 * Importación de avisos desde Excel (Admin SDK) — comparte lógica con `scripts/seed/import-from-excel.ts`
 * y `seed-sem-anual.ts`.
 */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { deriveCentroPlantCodeFromUbicacionTecnica } from "@/lib/firestore/derive-centro";
import { ASSETS_COLLECTION, AVISOS_COLLECTION } from "@/lib/firestore/collections";
import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";
import type { Especialidad, EstadoAviso, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import {
  buildUbicacionToAssetIdLookup,
  resolveAssetIdFromLookup,
} from "@/lib/import/asset-ut-lookup";
import { findHeaderRowByKeys, headerIndexMap, normHeader, sheetMatrix, str } from "@/scripts/seed/excel-utils";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";

export type { ModoImportacionAvisos };

export type ResultadoImportacionAvisos = {
  procesados: number;
  filasLeidas: number;
  sinNumeroAviso: number;
  sinActivoUt: number;
  nuevosDocumentos: number;
  existentesMerge: number;
  advertencias: string[];
  /** Primeras filas para vista previa (solo en modo dry-run). */
  vistaPrevia: string[][];
  hojasConsideradas: string[];
};

function col(h: Map<string, number>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const nk = normHeader(k);
    if (h.has(nk)) return h.get(nk);
  }
  for (const [key, idx] of h) {
    for (const k of keys) {
      if (key.includes(normHeader(k))) return idx;
    }
  }
  return undefined;
}

function avisoDocId(numeroRaw: string): string {
  return str(numeroRaw)
    .replace(/\//g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function mapEspecialidad(raw: string): Especialidad {
  const x = normHeader(raw);
  if (x.includes("gg") || x === "g") return "GG";
  if (x.includes("elec") || x === "e" || x.includes("hidr") || x.includes("hg")) return "ELECTRICO";
  return "AA";
}

function mapFrecuenciaFromSheet(sheetName: string): FrecuenciaMantenimiento | null {
  const n = normHeader(sheetName);
  if (n.includes("semestral")) return "SEMESTRAL";
  if (n.includes("anual") && !n.includes("semest")) return "ANUAL";
  if (n.includes("trim")) return "TRIMESTRAL";
  if (n.startsWith("men") || n.includes("mensual")) return "MENSUAL";
  return null;
}

function mapMtsaFromSheetName(sheetName: string): "M" | "T" | "S" | "A" | null {
  const n = normHeader(sheetName);
  if (n.includes("semestral")) return "S";
  if (n.includes("anual") && !n.includes("semest")) return "A";
  if (n.includes("trim")) return "T";
  if (n.startsWith("men") || n.includes("mensual")) return "M";
  return null;
}

function parseLooseDate(value: string): Date | null {
  const t = value.trim();
  if (!t) return null;
  const ts = Date.parse(t);
  if (!Number.isNaN(ts)) return new Date(ts);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function mapEstadoUsuario(statusRaw: string): EstadoAviso | null {
  const u = normHeader(statusRaw);
  if (!u) return null;
  if (u.includes("pdte") || u.includes("pend") || u.includes("abiert")) return "ABIERTO";
  if (u.includes("ot") && u.includes("gener")) return "OT_GENERADA";
  if (u.includes("curso") || u.includes("proce")) return "OT_GENERADA";
  if (u.includes("compl") || u.includes("cerr") || u.includes("realiz")) return "CERRADO";
  if (u.includes("cancel") || u.includes("anul")) return "ANULADO";
  return null;
}

function mapEstadoPlanilla(statusRaw: string): string | null {
  const u = normHeader(statusRaw);
  if (!u) return null;
  if (u.includes("pdte") || (u.includes("pend") && u.includes("iente"))) return "PDTE";
  return null;
}

function filtroModoPreventivo(
  modo: ModoImportacionAvisos,
  freq: FrecuenciaMantenimiento,
): boolean {
  if (modo === "preventivos_todas") return true;
  if (modo === "preventivos_mensual") return freq === "MENSUAL";
  if (modo === "preventivos_trimestral") return freq === "TRIMESTRAL";
  if (modo === "preventivos_semestral") return freq === "SEMESTRAL";
  if (modo === "preventivos_anual") return freq === "ANUAL";
  return false;
}

async function loadUbicacionToAssetId(): Promise<Map<string, string>> {
  const db = getAdminDb();
  const snap = await db.collection(ASSETS_COLLECTION).get();
  return buildUbicacionToAssetIdLookup(snap.docs);
}

async function commitAvisoBatchMerge(payloads: Array<{ id: string; data: Record<string, unknown> }>): Promise<void> {
  const db = getAdminDb();
  const collection = db.collection(AVISOS_COLLECTION);
  const chunkSize = 450;
  const getChunk = 10;

  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize);
    const refs = chunk.map((p) => collection.doc(p.id));
    const snapsMap = new Map<string, DocumentSnapshot>();
    for (let j = 0; j < refs.length; j += getChunk) {
      const snaps = await db.getAll(...refs.slice(j, j + getChunk));
      for (const s of snaps) snapsMap.set(s.ref.id, s);
    }
    const batch = db.batch();
    for (let k = 0; k < chunk.length; k++) {
      const { id, data } = chunk[k];
      const snap = snapsMap.get(id)!;
      const base = { ...data, updated_at: FieldValue.serverTimestamp() };
      if (!snap.exists) (base as Record<string, unknown>).created_at = FieldValue.serverTimestamp();
      batch.set(refs[k], base, { merge: true });
    }
    await batch.commit();
  }
}

async function commitPatchesOnlyExisting(patches: Array<{ id: string; data: Record<string, unknown> }>): Promise<number> {
  const db = getAdminDb();
  const collection = db.collection(AVISOS_COLLECTION);
  const chunkSize = 450;
  const getChunk = 10;
  let skipped = 0;
  let applied = 0;

  for (let i = 0; i < patches.length; i += chunkSize) {
    const chunk = patches.slice(i, i + chunkSize);
    const refs = chunk.map((p) => collection.doc(p.id));
    const snapsMap = new Map<string, DocumentSnapshot>();
    for (let j = 0; j < refs.length; j += getChunk) {
      const snaps = await db.getAll(...refs.slice(j, j + getChunk));
      for (const s of snaps) snapsMap.set(s.ref.id, s);
    }
    const batch = db.batch();
    let ops = 0;
    for (let k = 0; k < chunk.length; k++) {
      const { id, data } = chunk[k];
      const snap = snapsMap.get(id)!;
      if (!snap.exists) {
        skipped++;
        continue;
      }
      batch.set(refs[k], { ...data, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      ops++;
      applied++;
    }
    if (ops) await batch.commit();
  }
  void skipped;
  return applied;
}

function inferFrecuenciaBadgeSemAnual(descRaw: string): { mtsa: "S" | "A"; freq: FrecuenciaMantenimiento } {
  const d = normHeader(descRaw);
  if (d.includes("semestral")) return { mtsa: "S", freq: "SEMESTRAL" };
  if (d.includes("anual") && !d.includes("semest")) return { mtsa: "A", freq: "ANUAL" };
  if (d.includes("verificar elementos")) return { mtsa: "S", freq: "SEMESTRAL" };
  if (d.includes("tablero") || d.includes("ccm")) return { mtsa: "A", freq: "ANUAL" };
  return { mtsa: "S", freq: "SEMESTRAL" };
}

function inferEspecialidadSemAnual(descRaw: string, ptoRaw: string): Especialidad {
  const d = normHeader(descRaw);
  const p = normHeader(ptoRaw);
  if (
    d.includes(" aa ") ||
    d.startsWith("aa ") ||
    d.includes("aire acond") ||
    (d.includes("mtto") && d.includes("aa"))
  ) {
    return "AA";
  }
  if (p.includes("aa") && (p.includes("pc01") || p.includes("ad"))) return "AA";
  if (
    d.includes("tablero") ||
    d.includes("proteccion") ||
    d.includes("protección") ||
    d.includes("ccm") ||
    d.includes("bomb") ||
    d.includes("rotul")
  ) {
    return "ELECTRICO";
  }
  return "ELECTRICO";
}

/** Parsea y opcionalmente persiste avisos. `dryRun`: no escribe Firestore. */
export async function importarAvisosDesdeExcelBuffer(input: {
  buffer: Buffer;
  modo: ModoImportacionAvisos;
  dryRun: boolean;
  actorUid: string;
}): Promise<ResultadoImportacionAvisos> {
  const wb = XLSX.read(input.buffer, { type: "buffer" });
  const advertencias: string[] = [];
  const hojasConsideradas: string[] = [];
  let filasLeidas = 0;
  let sinNumeroAviso = 0;
  let sinActivoUt = 0;

  const utToAsset = await loadUbicacionToAssetId();
  if (utToAsset.size === 0) advertencias.push("No hay activos con ubicacion_tecnica — revisá la colección assets.");

  const payloads: Array<{ id: string; data: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; data: Record<string, unknown> }> = [];
  const vistaPrevia: string[][] = [];

  const pushPreview = (cells: string[]) => {
    if (vistaPrevia.length < 10) vistaPrevia.push(cells);
  };

  if (
    input.modo === "preventivos_todas" ||
    input.modo === "preventivos_mensual" ||
    input.modo === "preventivos_trimestral" ||
    input.modo === "preventivos_semestral" ||
    input.modo === "preventivos_anual"
  ) {
    for (const sheetName of wb.SheetNames) {
      const freq = mapFrecuenciaFromSheet(sheetName);
      if (!freq || !filtroModoPreventivo(input.modo, freq)) continue;
      const mtsa = mapMtsaFromSheetName(sheetName);
      hojasConsideradas.push(sheetName);
      const sh = wb.Sheets[sheetName]!;
      const matrix = sheetMatrix(sh);
      const hr = findHeaderRowByKeys(matrix, ["descripcion", "ubic"], 40);
      if (hr < 0) {
        advertencias.push(`Hoja «${sheetName}»: sin encabezados esperados.`);
        continue;
      }
      const h = headerIndexMap(matrix[hr]!);
      const iAviso =
        col(h, "aviso", "n aviso", "n° de aviso", "numero") ??
        [...h.entries()].find(([k]) => k.includes("aviso"))?.[1];
      const iDesc = col(h, "descripcion", "descripción");
      const iUt = col(h, "ubicacion tecnica", "ubicación técnica", "ubicacion");
      const iDenom = col(h, "denom", "denominacion", "denominación");
      const iEsp = col(h, "especialidad");
      if (iAviso === undefined || iDesc === undefined || iUt === undefined) {
        advertencias.push(`Hoja «${sheetName}»: columnas incompletas.`);
        continue;
      }

      for (let r = hr + 1; r < matrix.length; r++) {
        const line = matrix[r] ?? [];
        filasLeidas++;
        const numero = str(line[iAviso]);
        const descripcion = str(line[iDesc]);
        const ut = str(line[iUt]);
        const denom = iDenom !== undefined ? str(line[iDenom]) : "";
        const espRaw = iEsp !== undefined ? str(line[iEsp]) : "";
        if (!numero && !descripcion && !ut) continue;
        if (!numero) {
          sinNumeroAviso++;
          continue;
        }
        const assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
        if (!assetId) {
          sinActivoUt++;
          pushPreview([numero, descripcion.slice(0, 40), ut, "sin activo"]);
          continue;
        }
        const id = avisoDocId(numero);
        const row: Record<string, unknown> = {
          n_aviso: numero,
          asset_id: assetId,
          ubicacion_tecnica: ut,
          centro: deriveCentroPlantCodeFromUbicacionTecnica(ut),
          frecuencia: freq,
          tipo: "PREVENTIVO",
          especialidad: mapEspecialidad(espRaw),
          texto_corto: descripcion.slice(0, 500) || numero,
          estado: "ABIERTO",
          fecha_programada: null,
        };
        if (descripcion.length > 500) row.texto_largo = descripcion;
        if (mtsa) row.frecuencia_plan_mtsa = mtsa;
        if (denom) {
          row.texto_largo = [denom, row.texto_largo].filter(Boolean).join(" — ") || undefined;
        }
        payloads.push({ id, data: row });
        pushPreview([numero, descripcion.slice(0, 48), ut, sheetName]);
      }
    }
    if (!hojasConsideradas.length) advertencias.push("No se encontraron hojas con la frecuencia esperada en el archivo.");
  } else if (input.modo === "mensuales_parche") {
    const sh = wb.Sheets[wb.SheetNames[0]!] ?? wb.Sheets["Hoja1"];
    if (!sh) advertencias.push("El archivo no tiene hojas.");
    else {
      hojasConsideradas.push(wb.SheetNames[0] ?? "Hoja1");
      const matrix = sheetMatrix(sh);
      const hr = findHeaderRowByKeys(matrix, ["aviso", "descripcion"], 40);
      if (hr < 0) advertencias.push("Mensuales: sin fila de encabezados (aviso, descripción).");
      else {
        const h = headerIndexMap(matrix[hr]!);
        const iAviso = col(h, "aviso") ?? [...h.entries()].find(([k]) => k.includes("aviso"))?.[1];
        const iStatus = col(h, "status", "status usuario", "estado");
        const iCePl = col(h, "cepl", "ce pl", "ce.coste", "ce coste");
        const iFecha = col(h, "fecha");
        if (iAviso !== undefined) {
          for (let r = hr + 1; r < matrix.length; r++) {
            const line = matrix[r] ?? [];
            filasLeidas++;
            const numero = str(line[iAviso]);
            if (!numero) continue;
            const id = avisoDocId(numero);
            const patch: Record<string, unknown> = {};
            if (iStatus !== undefined) {
              const rawSt = str(line[iStatus]);
              const st = mapEstadoUsuario(rawSt);
              const planilla = mapEstadoPlanilla(rawSt);
              if (st) patch.estado = st;
              if (planilla) patch.estado_planilla = planilla;
            }
            if (iCePl !== undefined) {
              const ce = str(line[iCePl]);
              if (ce) patch.centro = ce;
            }
            if (iFecha !== undefined) {
              const fd = parseLooseDate(str(line[iFecha]));
              if (fd) patch.fecha_programada = Timestamp.fromDate(fd);
            }
            if (Object.keys(patch).length) {
              patches.push({ id, data: patch });
              pushPreview([numero, JSON.stringify(patch).slice(0, 60)]);
            }
          }
        }
      }
    }
  } else if (input.modo === "listado_semestral_anual") {
    const sh = wb.Sheets["Hoja1"] ?? wb.Sheets[wb.SheetNames[0]!];
    if (!sh) advertencias.push("Sin hoja Hoja1.");
    else {
      hojasConsideradas.push("Hoja1");
      const matrix = sheetMatrix(sh);
      const hr = findHeaderRowByKeys(matrix, ["aviso", "descripcion"], 45);
      if (hr < 0) advertencias.push("Listado S/A: sin encabezados.");
      else {
        const h = headerIndexMap(matrix[hr]!);
        const iAviso =
          col(h, "aviso") ??
          [...h.entries()].find(([k]) => k.includes("aviso") && !k.includes("aut"))?.[1];
        const iDesc = col(h, "descripcion", "descripción");
        const iPto = col(h, "ptotrbres", "pto trb res", "ptotrb", "pto trb");
        const iUt = col(h, "ubicacion tecnica", "ubicación técnica", "ubicacion");
        const iDenom = col(h, "denom", "denominacion", "denominación");
        const iStatus = col(h, "status", "status usuario", "estado");
        const iCePl = col(h, "cepl", "ce pl", "ce.coste", "ce coste", "cepl.");
        const iFecha = col(h, "fecha");
        if (iAviso !== undefined && iDesc !== undefined && iUt !== undefined) {
          type Prepared =
            | { kind: "freq"; id: string; data: Record<string, unknown> }
            | { kind: "full"; id: string; data: Record<string, unknown> };
          const prepared: Prepared[] = [];
          for (let r = hr + 1; r < matrix.length; r++) {
            const line = matrix[r] ?? [];
            filasLeidas++;
            const numero = str(line[iAviso]);
            const descripcion = str(line[iDesc]);
            const ut = str(line[iUt]);
            const pto = iPto !== undefined ? str(line[iPto]) : "";
            const denom = iDenom !== undefined ? str(line[iDenom]) : "";
            if (!numero && !descripcion && !ut) continue;
            if (!numero) {
              sinNumeroAviso++;
              continue;
            }
            const { mtsa, freq } = inferFrecuenciaBadgeSemAnual(descripcion);
            const esp = inferEspecialidadSemAnual(descripcion, pto);
            const id = avisoDocId(numero);
            const assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
            const centro =
              iCePl !== undefined
                ? str(line[iCePl]).trim() || deriveCentroPlantCodeFromUbicacionTecnica(ut)
                : deriveCentroPlantCodeFromUbicacionTecnica(ut);
            const estadoPatch: Record<string, unknown> = {};
            if (iStatus !== undefined) {
              const u = normHeader(str(line[iStatus]));
              if (u.includes("pdte") || (u.includes("pend") && u.includes("iente"))) {
                estadoPatch.estado_planilla = "PDTE";
              }
            }
            if (iFecha !== undefined) {
              const fd = parseLooseDate(str(line[iFecha]));
              if (fd) estadoPatch.fecha_programada = Timestamp.fromDate(fd);
            }
            const freqOnly: Record<string, unknown> = {
              frecuencia: freq,
              frecuencia_plan_mtsa: mtsa,
              ...estadoPatch,
            };
            if (!assetId) {
              sinActivoUt++;
              prepared.push({ kind: "freq", id, data: freqOnly });
              pushPreview([numero, descripcion.slice(0, 40), ut, "solo frecuencia"]);
              continue;
            }
            const textoCorto = descripcion.slice(0, 500) || numero;
            const textoLargo =
              [denom, descripcion.length > 500 ? descripcion : ""].filter(Boolean).join(" — ") || undefined;
            prepared.push({
              kind: "full",
              id,
              data: {
                n_aviso: numero,
                asset_id: assetId,
                ubicacion_tecnica: ut,
                centro,
                frecuencia: freq,
                frecuencia_plan_mtsa: mtsa,
                tipo: "PREVENTIVO" as TipoAviso,
                especialidad: esp,
                texto_corto: textoCorto,
                texto_largo: textoLargo,
                estado: "ABIERTO" as EstadoAviso,
                fecha_programada: null,
                ...estadoPatch,
              },
            });
            pushPreview([numero, descripcion.slice(0, 40), ut, "alta/marge"]);
          }

          const db = getAdminDb();
          const avisosCol = db.collection(AVISOS_COLLECTION);
          const ids = [...new Set(prepared.map((p) => p.id))];
          const existing = new Set<string>();
          for (let i = 0; i < ids.length; i += 30) {
            const snaps = await db.getAll(...ids.slice(i, i + 30).map((id) => avisosCol.doc(id)));
            for (const s of snaps) {
              if (s.exists) existing.add(s.id);
            }
          }
          for (const p of prepared) {
            if (p.kind === "freq") {
              payloads.push({ id: p.id, data: p.data });
            } else if (existing.has(p.id)) {
              const d = p.data;
              payloads.push({
                id: p.id,
                data: {
                  frecuencia: d.frecuencia,
                  frecuencia_plan_mtsa: d.frecuencia_plan_mtsa,
                  ...(d.estado_planilla != null ? { estado_planilla: d.estado_planilla } : {}),
                  ...(d.fecha_programada != null ? { fecha_programada: d.fecha_programada } : {}),
                },
              });
            } else {
              payloads.push({ id: p.id, data: p.data });
            }
          }
        }
      }
    }
  } else if (input.modo === "correctivos") {
    const sh = wb.Sheets[wb.SheetNames[0]!] ?? wb.Sheets["Hoja1"];
    if (!sh) advertencias.push("Correctivos: sin hoja.");
    else {
      hojasConsideradas.push(wb.SheetNames[0] ?? "Hoja1");
      const matrix = sheetMatrix(sh);
      const hr = findHeaderRowByKeys(matrix, ["ubicacion", "descripcion"], 40);
      if (hr < 0) advertencias.push("Correctivos: sin encabezados.");
      else {
        const h = headerIndexMap(matrix[hr]!);
        const iAviso =
          col(h, "n de aviso", "n° de aviso", "aviso", "numero") ??
          [...h.entries()].find(([k]) => k.includes("aviso"))?.[1];
        const iUt = col(h, "ubicacion tecnica", "ubicación técnica", "ubicacion");
        const iDesc = col(h, "descripcion", "descripción");
        const iEsp = col(h, "especialidad");
        const iFecha = col(h, "fecha realizacion", "fecha realización", "fecha");
        if (iAviso !== undefined && iUt !== undefined && iDesc !== undefined) {
          for (let r = hr + 1; r < matrix.length; r++) {
            const line = matrix[r] ?? [];
            filasLeidas++;
            const numero = str(line[iAviso]);
            const ut = str(line[iUt]);
            const descripcion = str(line[iDesc]);
            const espRaw = iEsp !== undefined ? str(line[iEsp]) : "";
            const fechaStr = iFecha !== undefined ? str(line[iFecha]) : "";
            if (!numero && !ut) continue;
            if (!numero) {
              sinNumeroAviso++;
              continue;
            }
            const assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
            if (!assetId) {
              sinActivoUt++;
              continue;
            }
            const fecha = parseLooseDate(fechaStr);
            const cerrado = fecha !== null;
            const id = avisoDocId(numero);
            payloads.push({
              id,
              data: {
                n_aviso: numero,
                asset_id: assetId,
                ubicacion_tecnica: ut,
                centro: deriveCentroPlantCodeFromUbicacionTecnica(ut),
                frecuencia: "UNICA",
                tipo: "CORRECTIVO",
                especialidad: mapEspecialidad(espRaw),
                texto_corto: descripcion.slice(0, 500) || numero,
                texto_largo: descripcion.length > 500 ? descripcion : undefined,
                estado: cerrado ? "CERRADO" : "ABIERTO",
                fecha_programada: fecha ? Timestamp.fromDate(fecha) : null,
              },
            });
            pushPreview([numero, descripcion.slice(0, 40), ut]);
          }
        }
      }
    }
  }

  let nuevosDocumentos = 0;
  let existentesMerge = 0;
  let procesados = 0;

  const db = getAdminDb();
  const colRef = db.collection(AVISOS_COLLECTION);
  const idsPayloads = [...new Set(payloads.map((p) => p.id))];
  const existingPayloads = new Set<string>();
  if (idsPayloads.length) {
    for (let i = 0; i < idsPayloads.length; i += 30) {
      const snaps = await db.getAll(...idsPayloads.slice(i, i + 30).map((id) => colRef.doc(id)));
      for (const s of snaps) if (s.exists) existingPayloads.add(s.id);
    }
    for (const p of payloads) {
      if (existingPayloads.has(p.id)) existentesMerge++;
      else nuevosDocumentos++;
    }
  }

  if (!input.dryRun) {
    if (patches.length) {
      procesados += await commitPatchesOnlyExisting(patches);
    }
    if (payloads.length) {
      await commitAvisoBatchMerge(payloads);
      procesados += payloads.length;
      const centros = new Set<string>();
      for (const p of payloads) {
        const c = p.data.centro;
        if (typeof c === "string" && c.trim()) centros.add(c.trim());
      }
      for (const c of centros) {
        await ensurePlansForCentro(c);
      }
    }
    void input.actorUid;
  } else {
    procesados = patches.length + payloads.length;
  }

  return {
    procesados,
    filasLeidas,
    sinNumeroAviso,
    sinActivoUt,
    nuevosDocumentos,
    existentesMerge,
    advertencias,
    vistaPrevia,
    hojasConsideradas,
  };
}
