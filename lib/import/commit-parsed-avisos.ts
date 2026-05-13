/**
 * Persistencia de filas ya parseadas (`parse-avisos-excel`) en Firestore (Admin SDK).
 */
import { AppError } from "@/lib/errors/app-error";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { isCentroInKnownList } from "@/lib/config/app-config";
import { normalizeCentro } from "@/lib/firestore/derive-centro";
import { ASSETS_COLLECTION, AVISOS_COLLECTION } from "@/lib/firestore/collections";
import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";
import {
  buildUbicacionToAssetIdLookup,
  resolveAssetIdFromLookup,
} from "@/lib/import/asset-ut-lookup";
import {
  avisoDocId,
  candidateAvisoDocIds,
  nAvisoStringsForFirestoreInQuery,
  normalizeNAvisoCompare,
  preferredNumericAvisoId,
} from "@/lib/import/aviso-numero-canonical";
import { especialidadImportToDominio } from "@/lib/import/normalize-values";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import type { ParsedAvisoRow } from "@/lib/import/parse-avisos-excel";
import { reconcileAntecesorTrasImportar } from "@/lib/mantenimiento/antecesor-orden-admin";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import type { Especialidad, EstadoAviso, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";
import { getWorkOrderById } from "@/modules/work-orders/repository";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

export type CommitImportResult = {
  importados: number;
  actualizados: number;
  sinActivoUt: number;
  errores: string[];
  /** Filas no escritas por conflicto de `n_aviso`+centro (Excel o ya existente en Firestore con otro ID). */
  omitidos_por_duplicado: number;
  /** UTs (o clave fila) sin activo en catálogo — para corregir en Activos y reimportar. */
  utSinActivo: string[];
  /** Centros presentes en el lote que no están en `NEXT_PUBLIC_KNOWN_CENTROS` (el motor los ignora). */
  centrosDesconocidos: string[];
};

/** Clave canónica centro + número SAP (misma lógica = mismo slot). */
function nAvisoCentroLogicalKey(centro: string, nAviso: string): string {
  const norm = normalizeNAvisoCompare(nAviso);
  return `${centro.trim()}\u0000${norm}`;
}

const FIRESTORE_IN_MAX = 30;

/**
 * Evita dos documentos `avisos/{id}` distintos con el mismo `n_aviso` en el mismo centro (error típico de export SAP / Excel).
 * - En el lote: mismo par centro+n_aviso con IDs de doc distintos → se rechaza.
 * - En Firestore: ya existe otro doc con ese par y distinto id → se rechaza el ítem del import.
 */
async function excludePayloadsConflictoNAvisoCentro(
  payloads: Array<{ id: string; data: Record<string, unknown> }>,
  errores: string[],
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const withNa = payloads.filter(
    (p) => typeof p.data.n_aviso === "string" && String(p.data.n_aviso).trim().length > 0,
  );
  if (!withNa.length) return payloads;

  const keyToIds = new Map<string, Set<string>>();
  const logicalKeyToDisplayN = new Map<string, string>();
  for (const p of withNa) {
    const c = String(p.data.centro ?? "").trim();
    const n = String(p.data.n_aviso).trim();
    if (!c || !n) continue;
    const k = nAvisoCentroLogicalKey(c, n);
    if (!logicalKeyToDisplayN.has(k)) logicalKeyToDisplayN.set(k, n);
    if (!keyToIds.has(k)) keyToIds.set(k, new Set());
    keyToIds.get(k)!.add(p.id);
  }

  const excluded = new Set<string>();
  for (const [k, ids] of keyToIds) {
    if (ids.size <= 1) continue;
    const [c] = k.split("\u0000");
    const nDisp = logicalKeyToDisplayN.get(k) ?? "";
    errores.push(
      `Conflicto en el archivo: el aviso SAP «${nDisp}» (centro ${c}) genera más de un ID de documento (${[...ids].join(", ")}). Unificá el número de aviso en el Excel.`,
    );
    for (const id of ids) excluded.add(id);
  }

  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);
  const toCheck = withNa.filter((p) => !excluded.has(p.id));

  const nAvisoPorCentro = new Map<string, Set<string>>();
  for (const p of toCheck) {
    const c = String(p.data.centro ?? "").trim();
    const n = String(p.data.n_aviso).trim();
    if (!c || !n) continue;
    if (!nAvisoPorCentro.has(c)) nAvisoPorCentro.set(c, new Set());
    for (const q of nAvisoStringsForFirestoreInQuery(n)) {
      nAvisoPorCentro.get(c)!.add(q);
    }
  }

  const existingIdsByKey = new Map<string, Set<string>>();
  for (const [centro, numeros] of nAvisoPorCentro) {
    const nums = [...numeros];
    for (let i = 0; i < nums.length; i += FIRESTORE_IN_MAX) {
      const chunk = nums.slice(i, i + FIRESTORE_IN_MAX);
      const snap = await col.where("centro", "==", centro).where("n_aviso", "in", chunk).get();
      for (const d of snap.docs) {
        const dat = d.data() as { n_aviso?: string; centro?: string };
        const nc = String(dat.centro ?? "").trim();
        const nn = String(dat.n_aviso ?? "").trim();
        if (!nc || !nn) continue;
        const key = nAvisoCentroLogicalKey(nc, nn);
        if (!existingIdsByKey.has(key)) existingIdsByKey.set(key, new Set());
        existingIdsByKey.get(key)!.add(d.id);
      }
    }
  }

  for (const p of toCheck) {
    if (excluded.has(p.id)) continue;
    const c = String(p.data.centro ?? "").trim();
    const n = String(p.data.n_aviso).trim();
    if (!c || !n) continue;
    const k = nAvisoCentroLogicalKey(c, n);
    const intendedId = p.id;
    const existing = existingIdsByKey.get(k);
    if (!existing?.size) continue;
    const mismatches = [...existing].filter((id) => id !== intendedId);
    if (mismatches.length === 0) continue;
    const existingId = mismatches[0]!;
    errores.push(
      `n_aviso ${n} ya existe en Firestore con ID ${existingId} (distinto al del Excel). Se omitió para evitar duplicado.`,
    );
    excluded.add(intendedId);
  }

  if (!excluded.size) return payloads;
  return payloads.filter((p) => !excluded.has(p.id));
}

/**
 * Reutiliza el `id` de documento ya existente si el mismo aviso SAP llega con otro formato
 * (p. ej. 11375283 vs 11-375283), y alinea altas nuevas al id numérico canónico cuando aplica.
 */
async function resolvePayloadAvisoDocIds(
  payloads: Array<{ id: string; data: Record<string, unknown> }>,
  errores: string[],
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  if (!payloads.length) return payloads;
  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);
  const allCandidateIds = new Set<string>();
  for (const p of payloads) {
    const n = String(p.data.n_aviso ?? "").trim();
    if (!n) continue;
    allCandidateIds.add(p.id);
    for (const c of candidateAvisoDocIds(n)) allCandidateIds.add(c);
  }
  const ids = [...allCandidateIds];
  const snapById = new Map<string, DocumentSnapshot>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((id) => col.doc(id)));
    for (const s of snaps) snapById.set(s.ref.id, s);
  }

  const resolved: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const p of payloads) {
    const centro = String(p.data.centro ?? "").trim();
    const nAviso = String(p.data.n_aviso ?? "").trim();
    if (!centro || !nAviso) {
      resolved.push(p);
      continue;
    }
    const targetNorm = normalizeNAvisoCompare(nAviso);
    const preferred = preferredNumericAvisoId(nAviso);
    const candidates = [...new Set([...(preferred ? [preferred] : []), ...candidateAvisoDocIds(nAviso), p.id])];

    const matches: string[] = [];
    for (const candId of candidates) {
      const snap = snapById.get(candId);
      if (!snap?.exists) continue;
      const d = snap.data() as { centro?: string; n_aviso?: string };
      if (String(d.centro ?? "").trim() !== centro) continue;
      if (normalizeNAvisoCompare(String(d.n_aviso ?? "")) !== targetNorm) continue;
      matches.push(candId);
    }

    let finalId: string;
    if (matches.length === 0) {
      finalId = preferred ?? p.id;
    } else if (matches.length === 1) {
      finalId = matches[0]!;
    } else {
      if (preferred && matches.includes(preferred)) {
        finalId = preferred;
      } else {
        finalId = [...matches].sort()[0]!;
      }
      errores.push(
        `Aviso ${nAviso} (${centro}): hay ${matches.length} documentos con el mismo número SAP (IDs: ${matches.join(", ")}). Revisá duplicados en Firestore.`,
      );
    }

    resolved.push({ id: finalId, data: { ...p.data } });
  }

  const byId = new Map<string, { id: string; data: Record<string, unknown> }>();
  for (const p of resolved) {
    byId.set(p.id, p);
  }
  return [...byId.values()];
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

/**
 * Activos catalogados como GG (p. ej. `scripts/seed/seed-activos-gg.ts`: `especialidad_predeterminada`).
 * Si la UT matchea ese equipo, priorizamos GG aunque el Excel viniera mal (fallback AA / heurística eléctrica).
 */
function especialidadConPreferenciaCatalogoGg(
  assetId: string,
  desdeFuente: Especialidad,
  predPorAssetId: Map<string, Especialidad>,
): Especialidad {
  if (predPorAssetId.get(assetId) === "GG") return "GG";
  return desdeFuente;
}

/**
 * Import preventivos “Abril–Marzo” y similares solo traen A/E: no deben pisar un `GG` ya
 * fijado (p. ej. por listado semestral / PtoTrbRes SSGG-02) cuando el orden de import es fijo.
 */
function especialidadRespetandoGgEnFirestoreVariants(
  numero: string,
  espCalculada: Especialidad,
  existentePorId: Map<string, Especialidad>,
): Especialidad {
  let sawGg = false;
  for (const id of candidateAvisoDocIds(numero)) {
    if (existentePorId.get(id) === "GG") sawGg = true;
  }
  if (!sawGg) return espCalculada;
  if (espCalculada === "AA" || espCalculada === "ELECTRICO") return "GG";
  return espCalculada;
}

async function fetchEspecialidadExistentePorAvisoIds(ids: string[]): Promise<Map<string, Especialidad>> {
  const out = new Map<string, Especialidad>();
  if (!ids.length) return out;
  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);
  const uniq = [...new Set(ids)];
  const getChunk = 30;
  for (let i = 0; i < uniq.length; i += getChunk) {
    const chunk = uniq.slice(i, i + getChunk);
    const snaps = await db.getAll(...chunk.map((id) => col.doc(id)));
    for (const s of snaps) {
      if (!s.exists) continue;
      const e = (s.data() as { especialidad?: unknown }).especialidad;
      if (e === "AA" || e === "ELECTRICO" || e === "GG" || e === "HG") {
        out.set(s.id, e);
      }
    }
  }
  return out;
}

type UbicacionAssetLookup = {
  utToAsset: Map<string, string>;
  /** `codigo_nuevo` por id de documento en `assets` — alinea `centro` del aviso con la misma regla que el maestro (prefijo PM02/PF01/… en el código). */
  codigoNuevoByAssetId: Map<string, string>;
  /** `especialidad_predeterminada` por id de documento (solo valores de dominio). */
  especialidadPredeterminadaByAssetId: Map<string, Especialidad>;
};

async function loadUbicacionToAssetLookup(): Promise<UbicacionAssetLookup> {
  const db = getAdminDb();
  const snap = await db.collection(ASSETS_COLLECTION).get();
  const utToAsset = buildUbicacionToAssetIdLookup(snap.docs);
  const codigoNuevoByAssetId = new Map<string, string>();
  const especialidadPredeterminadaByAssetId = new Map<string, Especialidad>();
  for (const d of snap.docs) {
    const codigo = String(d.get("codigo_nuevo") ?? "").trim();
    if (codigo) codigoNuevoByAssetId.set(d.id, codigo);
    const esp = d.get("especialidad_predeterminada");
    if (esp === "AA" || esp === "ELECTRICO" || esp === "GG" || esp === "HG") {
      especialidadPredeterminadaByAssetId.set(d.id, esp);
    }
  }
  return { utToAsset, codigoNuevoByAssetId, especialidadPredeterminadaByAssetId };
}

async function quitarEstadoSiHayOrdenAbierta(
  payloads: Array<{ id: string; data: Record<string, unknown> }>,
): Promise<void> {
  if (!payloads.length) return;
  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);
  const byId = new Map(payloads.map((p) => [p.id, p]));
  const ids = [...byId.keys()];
  const getChunk = 10;
  for (let i = 0; i < ids.length; i += getChunk) {
    const chunk = ids.slice(i, i + getChunk);
    const snaps = await db.getAll(...chunk.map((id) => col.doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const p = byId.get(snap.id);
      if (!p || !("estado" in p.data)) continue;
      const woid = String((snap.data() as { work_order_id?: string }).work_order_id ?? "").trim();
      if (!woid) continue;
      const wo = await getWorkOrderById(woid);
      if (wo && wo.estado !== "CERRADA" && wo.estado !== "ANULADA") {
        delete p.data.estado;
      }
    }
  }
}

async function clavesPreventivosTrasMerge(avisoIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!avisoIds.length) return m;
  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);
  const getChunk = 10;
  for (let i = 0; i < avisoIds.length; i += getChunk) {
    const chunk = avisoIds.slice(i, i + getChunk);
    const snaps = await db.getAll(...chunk.map((id) => col.doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const d = snap.data() as { tipo?: string; clave_mantenimiento?: string };
      if (d.tipo === "PREVENTIVO" && d.clave_mantenimiento) {
        m.set(snap.id, d.clave_mantenimiento);
      }
    }
  }
  return m;
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
      const snap = snapsMap.get(id);
      if (!snap) {
        throw new AppError("NOT_FOUND", `Documento de aviso no encontrado al mergear lote (id: ${id})`);
      }
      const base = { ...data, updated_at: FieldValue.serverTimestamp() };
      if (!snap.exists) (base as Record<string, unknown>).created_at = FieldValue.serverTimestamp();
      batch.set(refs[k], base, { merge: true });
    }
    await batch.commit();
  }
}

/**
 * Import calendario anual Arauco: solo escribe `meses_programados` en `avisos` ya existentes
 * con frecuencia M o T coherentes; sincroniza `plan_mantenimiento` vía `ensurePlansForCentro`.
 */
async function commitCalendarioMesesPreventivos(input: {
  modo: "calendario_mensual" | "calendario_trimestral";
  rows: ParsedAvisoRow[];
  centroForzado?: string;
}): Promise<CommitImportResult> {
  const errores: string[] = [];
  const expectedFreq: FrecuenciaMantenimiento =
    input.modo === "calendario_mensual" ? "MENSUAL" : "TRIMESTRAL";
  const mtsaExpected: "M" | "T" = input.modo === "calendario_mensual" ? "M" : "T";

  const { utToAsset, codigoNuevoByAssetId } = await loadUbicacionToAssetLookup();

  const idsToFetch = new Set<string>();
  for (const row of input.rows) {
    const n = row.numero?.trim();
    if (!n || !row.meses_programados?.length) continue;
    for (const c of candidateAvisoDocIds(n)) idsToFetch.add(c);
    const pref = preferredNumericAvisoId(n);
    if (pref) idsToFetch.add(pref);
    idsToFetch.add(avisoDocId(n));
  }

  const db = getAdminDb();
  const avisosCol = db.collection(AVISOS_COLLECTION);
  const snapById = new Map<string, DocumentSnapshot>();
  const idList = [...idsToFetch];
  for (let i = 0; i < idList.length; i += 30) {
    const snaps = await db.getAll(...idList.slice(i, i + 30).map((id) => avisosCol.doc(id)));
    for (const s of snaps) snapById.set(s.ref.id, s);
  }

  function resolveExistingId(row: ParsedAvisoRow): string | null {
    const numero = row.numero?.trim();
    if (!numero) return null;
    const ut = (row.ubicacionTecnica ?? "").trim();
    let assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
    const espCode = defaultEspecialidadCode(row);
    if (espCode === "E") {
      const cen = input.centroForzado?.trim() || normalizeCentro(row.centro ?? "", ut);
      assetId = `ee-gral-${cen.toLowerCase()}`;
    }
    const codigoEquipo = assetId ? codigoNuevoByAssetId.get(assetId) : undefined;
    const centroObjetivo =
      input.centroForzado?.trim() || normalizeCentro(row.centro ?? "", ut, codigoEquipo);
    const centroKey = centroObjetivo.trim();
    const tgt = normalizeNAvisoCompare(numero);
    const cands = [
      ...(preferredNumericAvisoId(numero) ? [preferredNumericAvisoId(numero)!] : []),
      ...candidateAvisoDocIds(numero),
    ];
    for (const cid of [...new Set(cands)]) {
      const snap = snapById.get(cid);
      if (!snap?.exists) continue;
      const d = snap.data() as { centro?: string; n_aviso?: string };
      if (String(d.centro ?? "").trim() !== centroKey) continue;
      if (normalizeNAvisoCompare(String(d.n_aviso ?? "")) !== tgt) continue;
      return cid;
    }
    return null;
  }

  const mesesPorId = new Map<string, number[]>();

  for (const row of input.rows) {
    const mesesRaw = row.meses_programados;
    if (!mesesRaw?.length) {
      errores.push(`Aviso ${row.numero ?? "?"}: sin meses programados.`);
      continue;
    }
    const id = resolveExistingId(row);
    if (!id) {
      errores.push(
        `Aviso ${row.numero?.trim() ?? "?"}: no existe en este centro (o no coincide el nº SAP). Importá antes el maestro preventivo.`,
      );
      continue;
    }
    const snap = snapById.get(id);
    const dat = snap?.data() as { tipo?: string; frecuencia?: string; frecuencia_plan_mtsa?: string } | undefined;
    if (dat?.tipo !== "PREVENTIVO") {
      errores.push(`Aviso ${row.numero?.trim()}: el documento en base no es preventivo.`);
      continue;
    }
    const freqMatch =
      dat.frecuencia === expectedFreq || dat.frecuencia_plan_mtsa === mtsaExpected;
    if (!freqMatch) {
      errores.push(
        `Aviso ${row.numero?.trim()}: en base es (${dat?.frecuencia ?? "?"} / badge ${dat?.frecuencia_plan_mtsa ?? "?"}); este archivo corresponde a ${expectedFreq}.`,
      );
      continue;
    }
    mesesPorId.set(id, [...mesesRaw].sort((a, b) => a - b));
  }

  const mergePayloads: Array<{ id: string; data: Record<string, unknown> }> = [...mesesPorId.entries()].map(
    ([idDoc, meses]) => ({ id: idDoc, data: { meses_programados: meses } }),
  );

  const centros = new Set<string>();
  for (const p of mergePayloads) {
    const s = snapById.get(p.id);
    const c = String((s?.data() as { centro?: string })?.centro ?? "").trim();
    if (c) centros.add(c);
  }

  if (mergePayloads.length) {
    await commitAvisoBatchMerge(mergePayloads);
    for (const c of centros) await ensurePlansForCentro(c);
  }

  return {
    importados: 0,
    actualizados: mergePayloads.length,
    sinActivoUt: 0,
    errores,
    omitidos_por_duplicado: 0,
    utSinActivo: [],
    centrosDesconocidos: [...centros].filter((c) => !isCentroInKnownList(c)),
  };
}

/**
 * `actorUid` reservado para trazabilidad futura.
 * `centroForzado` sobreescribe la derivación automática de centro (útil cuando el Excel no
 * tiene columna centro o el prefijo UT es ambiguo, p. ej. BOSS→PF01 vs PM02).
 */
export async function commitParsedAvisoRows(input: {
  modo: Exclude<ModoImportacionAvisos, "mensuales_parche">;
  rows: ParsedAvisoRow[];
  actorUid: string;
  centroForzado?: string;
}): Promise<CommitImportResult> {
  void input.actorUid;
  const errores: string[] = [];
  const { utToAsset, codigoNuevoByAssetId, especialidadPredeterminadaByAssetId } =
    await loadUbicacionToAssetLookup();
  let sinActivoUt = 0;
  const utSinActivoKeys = new Set<string>();

  if (input.modo === "calendario_mensual" || input.modo === "calendario_trimestral") {
    return commitCalendarioMesesPreventivos({
      modo: input.modo,
      rows: input.rows,
      centroForzado: input.centroForzado,
    });
  }

  if (input.modo === "listado_semestral_anual") {
    return commitListadoSemestralAnual(
      input.rows,
      utToAsset,
      codigoNuevoByAssetId,
      especialidadPredeterminadaByAssetId,
      errores,
      utSinActivoKeys,
      input.centroForzado,
    );
  }

  const idsCandidatosSet = new Set<string>();
  for (const r of input.rows) {
    const n = r.numero?.trim();
    if (!n) continue;
    for (const id of candidateAvisoDocIds(n)) idsCandidatosSet.add(id);
  }
  const idsCandidatos = [...idsCandidatosSet];
  const existenteEspecialidadPorId = await fetchEspecialidadExistentePorAvisoIds(idsCandidatos);

  const payloads: Array<{ id: string; data: Record<string, unknown> }> = [];
  const existingBefore = new Set<string>();

  for (const row of input.rows) {
    const numero = row.numero?.trim();
    if (!numero) continue;
    const ut = (row.ubicacionTecnica ?? "").trim();
    const descripcion = (row.descripcion ?? "").trim();
    const id = avisoDocId(numero);
    let assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
    const espCode = defaultEspecialidadCode(row);
    let esp = especialidadImportToDominio(espCode);
    const codigoEquipo = assetId ? codigoNuevoByAssetId.get(assetId) : undefined;
    const centro = input.centroForzado?.trim() || normalizeCentro(row.centro ?? "", ut, codigoEquipo);
    const denom = (row.denomUbicTecnica ?? "").trim();

    // ELECTRICO siempre usa activo sintético del centro — nunca un activo real del catálogo.
    if (espCode === "E") {
      assetId = `ee-gral-${centro.toLowerCase()}`;
    }

    if (assetId) {
      esp = especialidadConPreferenciaCatalogoGg(assetId, esp, especialidadPredeterminadaByAssetId);
    }

    esp = especialidadRespetandoGgEnFirestoreVariants(numero, esp, existenteEspecialidadPorId);

    if (!assetId) {
      sinActivoUt++;
      utSinActivoKeys.add(ut ? `UT ${ut} (aviso ${numero})` : `Aviso ${numero} (sin UT)`);
      errores.push(`Sin activo para UT «${ut}» (aviso ${numero})`);
      continue;
    }

    if (row.tipo === "correctivo") {
      const fecha = row.fechaProgramada ? new Date(row.fechaProgramada) : null;
      const cerrado = fecha !== null && !Number.isNaN(fecha.getTime());
      const clave = buildClaveMantenimiento({
        ubicacion_tecnica: ut,
        frecuencia: "UNICA",
        especialidad: esp,
        tipo: "CORRECTIVO",
      });
      const payload: Record<string, unknown> = {
        n_aviso: numero,
        asset_id: assetId,
        ubicacion_tecnica: ut,
        centro,
        frecuencia: "UNICA" satisfies FrecuenciaMantenimiento,
        tipo: "CORRECTIVO" as TipoAviso,
        especialidad: esp,
        clave_mantenimiento: clave,
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
    const clave = buildClaveMantenimiento({
      ubicacion_tecnica: ut,
      frecuencia: freq,
      especialidad: esp,
      tipo: "PREVENTIVO",
    });
    const payload: Record<string, unknown> = {
      n_aviso: numero,
      asset_id: assetId,
      ubicacion_tecnica: ut,
      centro,
      frecuencia: freq,
      tipo: "PREVENTIVO" as TipoAviso,
      especialidad: esp,
      clave_mantenimiento: clave,
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
    if (row.meses_programados?.length) payload.meses_programados = row.meses_programados;
    payloads.push({ id, data: payload });
  }

  const db = getAdminDb();
  const colRef = db.collection(AVISOS_COLLECTION);
  const dedupPayloads = [...new Map(payloads.map((p) => [p.id, p])).values()];
  const remapped = await resolvePayloadAvisoDocIds(dedupPayloads, errores);
  const filteredPayloads = await excludePayloadsConflictoNAvisoCentro(remapped, errores);
  const omitidos_por_duplicado = dedupPayloads.length - filteredPayloads.length;
  const idsPayloads = filteredPayloads.map((p) => p.id);
  for (let i = 0; i < idsPayloads.length; i += 30) {
    const snaps = await db.getAll(...idsPayloads.slice(i, i + 30).map((id) => colRef.doc(id)));
    for (const s of snaps) if (s.exists) existingBefore.add(s.id);
  }

  let actualizados = 0;
  let importados = 0;
  for (const p of filteredPayloads) {
    if (existingBefore.has(p.id)) actualizados++;
    else importados++;
  }

  const centrosTocados = new Set<string>();
  for (const p of filteredPayloads) {
    const c = p.data.centro;
    if (typeof c === "string" && c.trim()) centrosTocados.add(c.trim());
  }

  if (filteredPayloads.length) {
    await quitarEstadoSiHayOrdenAbierta(filteredPayloads);
    await commitAvisoBatchMerge(filteredPayloads);
    const idsTocados = filteredPayloads.map((p) => p.id);
    const claveMap = await clavesPreventivosTrasMerge(idsTocados);
    await reconcileAntecesorTrasImportar({ avisoIds: idsTocados, clavePorAvisoId: claveMap });
    for (const c of centrosTocados) await ensurePlansForCentro(c);
  }

  const centrosDesconocidos = [...centrosTocados].filter((c) => !isCentroInKnownList(c));
  return {
    importados,
    actualizados,
    sinActivoUt,
    errores,
    omitidos_por_duplicado,
    utSinActivo: [...utSinActivoKeys].slice(0, 200),
    centrosDesconocidos,
  };
}

async function commitListadoSemestralAnual(
  rows: ParsedAvisoRow[],
  utToAsset: Map<string, string>,
  codigoNuevoByAssetId: Map<string, string>,
  especialidadPredeterminadaByAssetId: Map<string, Especialidad>,
  errores: string[],
  utSinActivoKeys: Set<string>,
  centroForzado?: string,
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
    let assetId = resolveAssetIdFromLookup(utToAsset, ut) ?? "";
    const mtsa = row.frecuencia;
    if (!mtsa) {
      errores.push(`Listado S/A ${numero}: sin frecuencia inferida`);
      continue;
    }
    const freq = mtsaToFrecuencia(mtsa);
    const espCode = defaultEspecialidadCode(row);
    let esp = especialidadImportToDominio(espCode);
    const codigoEquipo = assetId ? codigoNuevoByAssetId.get(assetId) : undefined;
    const centro = centroForzado?.trim() || normalizeCentro(row.centro ?? "", ut, codigoEquipo);
    // ELECTRICO siempre usa activo sintético del centro — nunca un activo real del catálogo.
    if (espCode === "E") {
      assetId = `ee-gral-${centro.toLowerCase()}`;
    }
    if (assetId) {
      esp = especialidadConPreferenciaCatalogoGg(assetId, esp, especialidadPredeterminadaByAssetId);
    }

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
      utSinActivoKeys.add(ut ? `UT ${ut} (aviso ${numero})` : `Aviso ${numero} (sin UT)`);
      prepared.push({ kind: "freq", id, data: freqOnly });
      continue;
    }

    const textoCorto = descripcion.slice(0, 500) || numero;
    const textoLargo =
      [denom, descripcion.length > 500 ? descripcion : ""].filter(Boolean).join(" — ") || undefined;
    const clave = buildClaveMantenimiento({
      ubicacion_tecnica: ut,
      frecuencia: freq,
      especialidad: esp,
      tipo: "PREVENTIVO",
    });

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
        clave_mantenimiento: clave,
        texto_corto: textoCorto,
        texto_largo: textoLargo,
        estado: "ABIERTO" as EstadoAviso,
        fecha_programada: null,
        ...(row.meses_programados?.length ? { meses_programados: row.meses_programados } : {}),
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
      const meses = d.meses_programados;
      const mesesOk = Array.isArray(meses) && meses.length > 0;
      payloads.push({
        id: p.id,
        data: {
          frecuencia: d.frecuencia,
          frecuencia_plan_mtsa: d.frecuencia_plan_mtsa,
          especialidad: d.especialidad,
          clave_mantenimiento: d.clave_mantenimiento,
          asset_id: d.asset_id,
          ubicacion_tecnica: d.ubicacion_tecnica,
          centro: d.centro,
          texto_corto: d.texto_corto,
          ...(typeof d.texto_largo === "string" && d.texto_largo.trim()
            ? { texto_largo: d.texto_largo }
            : {}),
          ...(mesesOk ? { meses_programados: meses } : {}),
          ...(d.estado_planilla != null ? { estado_planilla: d.estado_planilla } : {}),
          ...(d.fecha_programada != null ? { fecha_programada: d.fecha_programada } : {}),
        },
      });
    } else {
      payloads.push({ id: p.id, data: p.data });
    }
  }

  const dedupPayloads = [...new Map(payloads.map((p) => [p.id, p])).values()];
  const remapped = await resolvePayloadAvisoDocIds(dedupPayloads, errores);
  const filteredPayloads = await excludePayloadsConflictoNAvisoCentro(remapped, errores);
  const omitidos_por_duplicado = dedupPayloads.length - filteredPayloads.length;
  const existingBefore = new Set(existing);
  let actualizados = 0;
  let importados = 0;
  for (const p of filteredPayloads) {
    if (existingBefore.has(p.id)) actualizados++;
    else importados++;
  }

  if (filteredPayloads.length) {
    await quitarEstadoSiHayOrdenAbierta(filteredPayloads);
    await commitAvisoBatchMerge(filteredPayloads);
    const idsTocados = filteredPayloads.map((p) => p.id);
    const claveMap = await clavesPreventivosTrasMerge(idsTocados);
    await reconcileAntecesorTrasImportar({ avisoIds: idsTocados, clavePorAvisoId: claveMap });
    const centros = new Set<string>();
    for (const p of dedupPayloads) {
      const c = p.data.centro;
      if (typeof c === "string" && c.trim()) centros.add(c.trim());
    }
    for (const c of centros) await ensurePlansForCentro(c);
  }

  const centrosFromRows = new Set<string>();
  for (const row of rows) {
    const utr = (row.ubicacionTecnica ?? "").trim();
    const cr = normalizeCentro(row.centro ?? "", utr);
    if (cr) centrosFromRows.add(cr);
  }
  const centrosFromPayloads = new Set<string>();
  for (const p of filteredPayloads) {
    const c = p.data.centro;
    if (typeof c === "string" && c.trim()) centrosFromPayloads.add(c.trim());
  }
  const allCentrosListado = new Set([...centrosFromRows, ...centrosFromPayloads]);
  const centrosDesconocidos = [...allCentrosListado].filter((c) => !isCentroInKnownList(c));

  return {
    importados,
    actualizados,
    sinActivoUt,
    errores,
    omitidos_por_duplicado,
    utSinActivo: [...utSinActivoKeys].slice(0, 200),
    centrosDesconocidos,
  };
}
