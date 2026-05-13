/**
 * Persistencia de filas ya parseadas (`parse-avisos-excel`) en Firestore (Admin SDK).
 */
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { deriveCentroPlantCodeFromUbicacionTecnica } from "@/lib/firestore/derive-centro";
import { ASSETS_COLLECTION, AVISOS_COLLECTION } from "@/lib/firestore/collections";
import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";
import {
  buildUbicacionToAssetIdLookup,
  resolveAssetIdFromLookup,
} from "@/lib/import/asset-ut-lookup";
import { especialidadImportToDominio } from "@/lib/import/normalize-values";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import type { ParsedAvisoRow } from "@/lib/import/parse-avisos-excel";
import type { EstadoAviso, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

export type CommitImportResult = {
  importados: number;
  actualizados: number;
  sinActivoUt: number;
  errores: string[];
};

function avisoDocId(numeroRaw: string): string {
  return String(numeroRaw)
    .replace(/\//g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function mtsaToFrecuencia(m: "M" | "T" | "S" | "A"): FrecuenciaMantenimiento {
  const map: Record<string, FrecuenciaMantenimiento> = {
    M: "MENSUAL",
    T: "TRIMESTRAL",
    S: "SEMESTRAL",
    A: "ANUAL",
  };
  return map[m] ?? "MENSUAL";
}

function defaultEspecialidadCode(row: ParsedAvisoRow): "A" | "E" | "GG" | "HG" {
  return row.especialidad ?? "A";
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

/**
 * `actorUid` reservado para trazabilidad futura.
 */
export async function commitParsedAvisoRows(input: {
  modo: Exclude<ModoImportacionAvisos, "mensuales_parche">;
  rows: ParsedAvisoRow[];
  actorUid: string;
}): Promise<CommitImportResult> {
  void input.actorUid;
  const errores: string[] = [];
  const utToAsset = await loadUbicacionToAssetId();
  let sinActivoUt = 0;

  if (input.modo === "listado_semestral_anual") {
    return commitListadoSemestralAnual(input.rows, utToAsset, errores);
  }

  const payloads: Array<{ id: string; data: Record<string, unknown> }> = [];
  const existingBefore = new Set<string>();

  for (const row of input.rows) {
    const numero = row.numero?.trim();
    if (!numero) continue;
    const ut = (row.ubicacionTecnica ?? "").trim();
    const descripcion = (row.descripcion ?? "").trim();
    const id = avisoDocId(numero);
    const assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";

    if (!assetId) {
      sinActivoUt++;
      errores.push(`Sin activo para UT «${ut}» (aviso ${numero})`);
      continue;
    }

    const espCode = defaultEspecialidadCode(row);
    const esp = especialidadImportToDominio(espCode);
    const centro =
      (row.centro ?? "").trim() || deriveCentroPlantCodeFromUbicacionTecnica(ut);
    const denom = (row.denomUbicTecnica ?? "").trim();

    if (row.tipo === "correctivo") {
      const fecha = row.fechaProgramada ? new Date(row.fechaProgramada) : null;
      const cerrado = fecha !== null && !Number.isNaN(fecha.getTime());
      const payload: Record<string, unknown> = {
        n_aviso: numero,
        asset_id: assetId,
        ubicacion_tecnica: ut,
        centro,
        frecuencia: "UNICA" satisfies FrecuenciaMantenimiento,
        tipo: "CORRECTIVO" as TipoAviso,
        especialidad: esp,
        texto_corto: descripcion.slice(0, 500) || numero,
        estado: (cerrado ? "CERRADO" : "ABIERTO") as EstadoAviso,
        fecha_programada: fecha ? Timestamp.fromDate(fecha) : null,
      };
      if (descripcion.length > 500) payload.texto_largo = descripcion;
      if (denom) {
        payload.texto_largo = [denom, payload.texto_largo].filter(Boolean).join(" — ");
      }
      payloads.push({ id, data: payload });
      continue;
    }

    const mtsa = row.frecuencia;
    if (!mtsa) {
      errores.push(`Preventivo ${numero}: falta frecuencia M/T/S/A`);
      continue;
    }
    const freq = mtsaToFrecuencia(mtsa);
    const payload: Record<string, unknown> = {
      n_aviso: numero,
      asset_id: assetId,
      ubicacion_tecnica: ut,
      centro,
      frecuencia: freq,
      tipo: "PREVENTIVO" as TipoAviso,
      especialidad: esp,
      texto_corto: descripcion.slice(0, 500) || numero,
      estado: "ABIERTO" as EstadoAviso,
      fecha_programada: null,
      frecuencia_plan_mtsa: mtsa,
    };
    if (descripcion.length > 500) payload.texto_largo = descripcion;
    if (denom) {
      payload.texto_largo = [denom, payload.texto_largo].filter(Boolean).join(" — ");
    }
    if (row.fechaProgramada) {
      const fd = new Date(row.fechaProgramada);
      if (!Number.isNaN(fd.getTime())) payload.fecha_programada = Timestamp.fromDate(fd);
    }
    if (row.status === "PDTE") payload.estado_planilla = "PDTE";
    payloads.push({ id, data: payload });
  }

  const db = getAdminDb();
  const colRef = db.collection(AVISOS_COLLECTION);
  const dedupPayloads = [...new Map(payloads.map((p) => [p.id, p])).values()];
  const idsPayloads = dedupPayloads.map((p) => p.id);
  for (let i = 0; i < idsPayloads.length; i += 30) {
    const snaps = await db.getAll(...idsPayloads.slice(i, i + 30).map((id) => colRef.doc(id)));
    for (const s of snaps) if (s.exists) existingBefore.add(s.id);
  }

  let actualizados = 0;
  let importados = 0;
  for (const p of dedupPayloads) {
    if (existingBefore.has(p.id)) actualizados++;
    else importados++;
  }

  if (dedupPayloads.length) {
    await commitAvisoBatchMerge(dedupPayloads);
    const centros = new Set<string>();
    for (const p of dedupPayloads) {
      const c = p.data.centro;
      if (typeof c === "string" && c.trim()) centros.add(c.trim());
    }
    for (const c of centros) await ensurePlansForCentro(c);
  }

  return { importados, actualizados, sinActivoUt, errores };
}

async function commitListadoSemestralAnual(
  rows: ParsedAvisoRow[],
  utToAsset: Map<string, string>,
  errores: string[],
): Promise<CommitImportResult> {
  type Prepared =
    | { kind: "freq"; id: string; data: Record<string, unknown> }
    | { kind: "full"; id: string; data: Record<string, unknown> };

  const prepared: Prepared[] = [];
  let sinActivoUt = 0;

  for (const row of rows) {
    const numero = row.numero?.trim();
    if (!numero) continue;
    const ut = (row.ubicacionTecnica ?? "").trim();
    const descripcion = (row.descripcion ?? "").trim();
    const denom = (row.denomUbicTecnica ?? "").trim();
    const id = avisoDocId(numero);
    const assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
    const mtsa = row.frecuencia;
    if (!mtsa) {
      errores.push(`Listado S/A ${numero}: sin frecuencia inferida`);
      continue;
    }
    const freq = mtsaToFrecuencia(mtsa);
    const espCode = defaultEspecialidadCode(row);
    const esp = especialidadImportToDominio(espCode);
    const centro =
      (row.centro ?? "").trim() || deriveCentroPlantCodeFromUbicacionTecnica(ut);

    const estadoPatch: Record<string, unknown> = {};
    if (row.status === "PDTE") estadoPatch.estado_planilla = "PDTE";
    if (row.fechaProgramada) {
      const fd = new Date(row.fechaProgramada);
      if (!Number.isNaN(fd.getTime())) estadoPatch.fecha_programada = Timestamp.fromDate(fd);
    }

    const freqOnly: Record<string, unknown> = {
      frecuencia: freq,
      frecuencia_plan_mtsa: mtsa,
      ...estadoPatch,
    };

    if (!assetId) {
      sinActivoUt++;
      prepared.push({ kind: "freq", id, data: freqOnly });
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
  }

  const db = getAdminDb();
  const avisosCol = db.collection(AVISOS_COLLECTION);
  const ids = [...new Set(prepared.map((p) => p.id))];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 30) {
    const snaps = await db.getAll(...ids.slice(i, i + 30).map((docId) => avisosCol.doc(docId)));
    for (const s of snaps) {
      if (s.exists) existing.add(s.id);
    }
  }

  const payloads: Array<{ id: string; data: Record<string, unknown> }> = [];
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

  const dedupPayloads = [...new Map(payloads.map((p) => [p.id, p])).values()];
  const existingBefore = new Set(existing);
  let actualizados = 0;
  let importados = 0;
  for (const p of dedupPayloads) {
    if (existingBefore.has(p.id)) actualizados++;
    else importados++;
  }

  if (dedupPayloads.length) {
    await commitAvisoBatchMerge(dedupPayloads);
    const centros = new Set<string>();
    for (const p of dedupPayloads) {
      const c = p.data.centro;
      if (typeof c === "string" && c.trim()) centros.add(c.trim());
    }
    for (const c of centros) await ensurePlansForCentro(c);
  }

  return { importados, actualizados, sinActivoUt, errores };
}
