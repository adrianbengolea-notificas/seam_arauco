/**
 * Importa avisos semestrales/anuales desde Excel → `avisos` (merge).
 *
 *   npm run seed:sem-anual
 *
 * Archivo esperado: `scripts/seed/data/Listado_avisos_Semestral-Anual.xlsx`, hoja `Hoja1`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { deriveCentroPlantCodeFromUbicacionTecnica } from "@/lib/firestore/derive-centro";
import { ASSETS_COLLECTION, AVISOS_COLLECTION } from "@/lib/firestore/collections";
import type { Especialidad, EstadoAviso, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import { findHeaderRowByKeys, headerIndexMap, normHeader, sheetMatrix, str } from "./excel-utils";

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

const DATA_DIR = path.join(process.cwd(), "scripts", "seed", "data");
const FILE_NAME = "Listado_avisos_Semestral-Anual.xlsx";

function resolveDataPath(name: string): string | null {
  const p = path.join(DATA_DIR, name);
  if (fs.existsSync(p)) return p;
  const noAccent = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const p2 = path.join(DATA_DIR, noAccent);
  if (fs.existsSync(p2)) return p2;
  const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
  const hit = files.find((f) => normHeader(f) === normHeader(name));
  return hit ? path.join(DATA_DIR, hit) : null;
}

function avisoDocId(numeroRaw: string): string {
  return str(numeroRaw)
    .replace(/\//g, "-")
    .replace(/\s+/g, "")
    .trim();
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

function inferFrecuenciaBadge(descRaw: string): { mtsa: "S" | "A"; freq: FrecuenciaMantenimiento } {
  const d = normHeader(descRaw);
  if (d.includes("semestral")) return { mtsa: "S", freq: "SEMESTRAL" };
  if (d.includes("anual") && !d.includes("semest")) return { mtsa: "A", freq: "ANUAL" };
  if (d.includes("verificar elementos")) return { mtsa: "S", freq: "SEMESTRAL" };
  if (d.includes("tablero") || d.includes("ccm")) return { mtsa: "A", freq: "ANUAL" };
  return { mtsa: "S", freq: "SEMESTRAL" };
}

function inferEspecialidad(descRaw: string, ptoRaw: string): Especialidad {
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

async function loadUbicacionToAssetId(): Promise<Map<string, string>> {
  const db = getAdminDb();
  const map = new Map<string, string>();
  const snap = await db.collection(ASSETS_COLLECTION).get();
  for (const d of snap.docs) {
    const ut = str(d.get("ubicacion_tecnica"));
    if (ut && !map.has(ut)) map.set(ut, d.id);
  }
  return map;
}

async function commitAvisoBatchMerge(
  payloads: Array<{ id: string; data: Record<string, unknown> }>,
  label: string,
) {
  const db = getAdminDb();
  const collection = db.collection(AVISOS_COLLECTION);
  const chunkSize = 450;
  const getChunk = 10;
  let done = 0;

  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize);
    const refs = chunk.map((p) => collection.doc(p.id));
    const snapsMap = new Map<string, DocumentSnapshot>();
    for (let j = 0; j < refs.length; j += getChunk) {
      const slice = refs.slice(j, j + getChunk);
      const snaps = await db.getAll(...slice);
      for (const s of snaps) snapsMap.set(s.ref.id, s);
    }
    const batch = db.batch();
    for (let k = 0; k < chunk.length; k++) {
      const { id, data } = chunk[k];
      const snap = snapsMap.get(id)!;
      const base = {
        ...data,
      };
      if (!snap.exists) {
        (base as Record<string, unknown>).created_at = FieldValue.serverTimestamp();
      }
      (base as Record<string, unknown>).updated_at = FieldValue.serverTimestamp();
      batch.set(refs[k], base, { merge: true });
    }
    await batch.commit();
    done += chunk.length;
    process.stdout.write(`\r${label} ${done}/${payloads.length} ✓`);
  }
  console.log("");
}

async function main() {
  const file = resolveDataPath(FILE_NAME);
  if (!file) {
    console.error(`No se encontró ${FILE_NAME} en scripts/seed/data/`);
    process.exit(1);
  }

  console.log(`Leyendo ${path.basename(file)}…`);
  const wb = XLSX.readFile(file);
  const sh = wb.Sheets["Hoja1"] ?? wb.Sheets[wb.SheetNames[0]!];
  if (!sh) {
    console.error("Sin hoja Hoja1");
    process.exit(1);
  }
  const matrix = sheetMatrix(sh);
  const hr = findHeaderRowByKeys(matrix, ["aviso", "descripcion"], 45);
  if (hr < 0) {
    console.error("No se detectó fila de encabezados (Aviso, Descripción)");
    process.exit(1);
  }
  const h = headerIndexMap(matrix[hr]!);
  const iAviso =
    col(h, "aviso") ??
    [...h.entries()].find(([k]) => k.includes("aviso") && !k.includes("aut"))?.[1];
  const iDesc = col(h, "descripcion", "descripción");
  const iPto = col(h, "ptotrbres", "pto trb res", "ptotrb", "pto trb");
  const iUt = col(h, "ubicacion tecnica", "ubicación técnica", "ubicacion");
  const iDenom = col(h, "denom", "denominacion", "denominación");
  const iStatus = col(h, "status", "status usuario", "estado");
  /** CePl / Ce.coste */
  const iCePl = col(h, "cepl", "ce pl", "ce.coste", "ce coste", "cepl.");
  const iFecha = col(h, "fecha");
  if (iAviso === undefined || iDesc === undefined || iUt === undefined) {
    console.error("Faltan columnas obligatorias (aviso, descripción, ubicación técnica)");
    process.exit(1);
  }

  const utToAsset = await loadUbicacionToAssetId();
  console.log(`UT con activo: ${utToAsset.size}`);

  type Prepared =
    | { kind: "freq"; id: string; data: Record<string, unknown> }
    | { kind: "full"; id: string; data: Record<string, unknown> };

  const prepared: Prepared[] = [];
  let skipNoAsset = 0;

  for (let r = hr + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const numero = str(line[iAviso]);
    const descripcion = str(line[iDesc]);
    const ut = str(line[iUt]);
    const pto = iPto !== undefined ? str(line[iPto]) : "";
    const denom = iDenom !== undefined ? str(line[iDenom]) : "";
    if (!numero && !descripcion && !ut) continue;
    if (!numero) continue;

    const { mtsa, freq } = inferFrecuenciaBadge(descripcion);
    const esp = inferEspecialidad(descripcion, pto);
    const id = avisoDocId(numero);
    const assetId = utToAsset.get(ut) ?? "";

    const centro =
      iCePl !== undefined ? str(line[iCePl]).trim() || deriveCentroPlantCodeFromUbicacionTecnica(ut) : deriveCentroPlantCodeFromUbicacionTecnica(ut);

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
      skipNoAsset++;
      prepared.push({ kind: "freq", id, data: freqOnly });
      continue;
    }

    const tipo: TipoAviso = "PREVENTIVO";
    const est: EstadoAviso = "ABIERTO";
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
        tipo,
        especialidad: esp,
        texto_corto: textoCorto,
        texto_largo: textoLargo,
        estado: est,
        fecha_programada: null,
        ...estadoPatch,
      },
    });
  }

  const db = getAdminDb();
  const avisosCol = db.collection(AVISOS_COLLECTION);
  const ids = [...new Set(prepared.map((p) => p.id))];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((id) => avisosCol.doc(id)));
    for (const s of snaps) {
      if (s.exists) existing.add(s.id);
    }
  }

  const nuevos: Array<{ id: string; data: Record<string, unknown> }> = [];
  const soloFreq: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (const p of prepared) {
    if (p.kind === "freq") {
      soloFreq.push({ id: p.id, data: p.data });
      continue;
    }
    if (existing.has(p.id)) {
      soloFreq.push({
        id: p.id,
        data: {
          frecuencia: p.data.frecuencia,
          frecuencia_plan_mtsa: p.data.frecuencia_plan_mtsa,
        },
      });
    } else {
      nuevos.push({ id: p.id, data: p.data });
    }
  }

  console.log(
    `Filas: alta completa ${nuevos.length}; merge solo frecuencia ${soloFreq.length}; sin activo (freq): ${skipNoAsset}`,
  );

  if (nuevos.length) await commitAvisoBatchMerge(nuevos, "Alta avisos semestral/anual…");
  if (soloFreq.length) await commitAvisoBatchMerge(soloFreq, "Merge frecuencia S/A…");

  console.log("Listo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
