/* eslint-disable no-console */
/**
 * Corrige avisos de aire (AA) mal clasificados como GG cuando el activo del catálogo es AA.
 * Alinea aviso, OT y chips del programa publicado (columna GG → Aire).
 *
 * Simulación:
 *   npx tsx --env-file=.env.local scripts/corregir-avisos-aa-gg-mal-clasificados.ts
 *   npx tsx --env-file=.env.local scripts/corregir-avisos-aa-gg-mal-clasificados.ts --centro PF01 --n-aviso 11376375
 *
 * Aplicar:
 *   npx tsx --env-file=.env.local scripts/corregir-avisos-aa-gg-mal-clasificados.ts --apply --centro PF01
 */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";
import * as readline from "node:readline";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION, AVISOS_COLLECTION, COLLECTIONS } from "@/lib/firestore/collections";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";
import type { AvisoSlot, DiaSemanaPrograma, EspecialidadPrograma, SlotSemanal } from "@/modules/scheduling/types";

type AvisoRow = {
  id: string;
  n_aviso: string;
  centro: string;
  texto_corto: string;
  ubicacion_tecnica: string;
  frecuencia: FrecuenciaMantenimiento;
  tipo: TipoAviso;
  asset_id: string;
  codigo_activo: string;
  work_order_id: string;
};

type OtPatch = {
  woId: string;
  n_ot: string;
  avisoId: string;
  codigo_activo: string;
};

type ProgramaMovimiento = {
  programaDocId: string;
  numero: string;
  avisoFirestoreId: string;
  dia: DiaSemanaPrograma;
  localidad: string;
  de: EspecialidadPrograma;
  a: EspecialidadPrograma;
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let apply = false;
  let centro: string | null = null;
  let nAviso: string | null = null;
  let sinPrograma = false;
  let jsonPath: string | null = null;
  let muestra = 25;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply" || a === "--commit") apply = true;
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--sin-programa") sinPrograma = true;
    else if (a === "--centro" && argv[i + 1]) centro = argv[++i]!.trim().toUpperCase();
    else if ((a === "--n-aviso" || a === "--aviso") && argv[i + 1]) nAviso = argv[++i]!.trim();
    else if (a === "--json" && argv[i + 1]) jsonPath = argv[++i]!.trim();
    else if (a === "--muestra" && argv[i + 1]) muestra = Math.max(1, parseInt(argv[++i]!, 10) || 25);
  }
  return { apply, centro, nAviso, sinPrograma, jsonPath, muestra, yes };
}

function respuestaAfirmativa(resp: string): boolean {
  const r = resp.trim().toLowerCase();
  return r === "si" || r === "sí" || r === "s" || r === "y" || r === "yes";
}

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(pregunta, (resp) => {
      rl.close();
      resolve(respuestaAfirmativa(resp));
    });
  });
}

async function cargarPrediccionActivos(): Promise<Map<string, Especialidad>> {
  const snap = await getAdminDb().collection(ASSETS_COLLECTION).get();
  const out = new Map<string, Especialidad>();
  for (const d of snap.docs) {
    const esp = d.get("especialidad_predeterminada");
    if (esp === "AA" || esp === "ELECTRICO" || esp === "GG" || esp === "HG") {
      out.set(d.id, esp);
    }
  }
  return out;
}

async function cargarCodigoPorAssetId(): Promise<Map<string, string>> {
  const snap = await getAdminDb().collection(ASSETS_COLLECTION).get();
  const out = new Map<string, string>();
  for (const d of snap.docs) {
    const c = String(d.get("codigo_nuevo") ?? "").trim();
    if (c) out.set(d.id, c);
  }
  return out;
}

async function cargarAvisosAfectados(input: {
  centro: string | null;
  nAviso: string | null;
  predActivos: Map<string, Especialidad>;
  codigoPorAsset: Map<string, string>;
}): Promise<AvisoRow[]> {
  const db = getAdminDb();
  const snap = await db.collection(AVISOS_COLLECTION).where("especialidad", "==", "GG").get();
  const out: AvisoRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const centro = String(d.centro ?? "").trim().toUpperCase();
    const n = String(d.n_aviso ?? doc.id).trim();
    if (input.centro && centro !== input.centro) continue;
    if (input.nAviso && n !== input.nAviso && doc.id !== input.nAviso) continue;
    const assetId = String(d.asset_id ?? "").trim();
    if (!assetId || input.predActivos.get(assetId) !== "AA") continue;
    out.push({
      id: doc.id,
      n_aviso: n,
      centro,
      texto_corto: String(d.texto_corto ?? ""),
      ubicacion_tecnica: String(d.ubicacion_tecnica ?? ""),
      frecuencia: (d.frecuencia as FrecuenciaMantenimiento) ?? "SEMESTRAL",
      tipo: (d.tipo as TipoAviso) ?? "PREVENTIVO",
      asset_id: assetId,
      codigo_activo: input.codigoPorAsset.get(assetId) ?? assetId,
      work_order_id: String(d.work_order_id ?? "").trim(),
    });
  }
  out.sort((a, b) => a.n_aviso.localeCompare(b.n_aviso));
  return out;
}

async function cargarOtPatches(avisos: AvisoRow[]): Promise<OtPatch[]> {
  const db = getAdminDb();
  const out: OtPatch[] = [];
  for (const a of avisos) {
    if (!a.work_order_id) continue;
    const snap = await db.collection(COLLECTIONS.work_orders).doc(a.work_order_id).get();
    if (!snap.exists) continue;
    if (String(snap.get("especialidad") ?? "") === "AA") continue;
    out.push({
      woId: snap.id,
      n_ot: String(snap.get("n_ot") ?? snap.id),
      avisoId: a.id,
      codigo_activo: a.codigo_activo,
    });
  }
  return out;
}

function cloneSlots(slots: SlotSemanal[]): SlotSemanal[] {
  return slots.map((s) => ({ ...s, avisos: [...(s.avisos ?? [])] }));
}

function quitarAvisoDeSlot(
  slots: SlotSemanal[],
  localidad: string,
  dia: DiaSemanaPrograma,
  esp: EspecialidadPrograma,
  avisoNumero: string,
  avisoFirestoreId: string,
): { slots: SlotSemanal[]; aviso: AvisoSlot | null } {
  const loc = localidad.trim() || "—";
  let removed: AvisoSlot | null = null;
  const next = cloneSlots(slots);
  const idx = next.findIndex((s) => s.localidad === loc && s.dia === dia && s.especialidad === esp);
  if (idx < 0) return { slots: next, aviso: null };
  const slot = next[idx]!;
  const avisos = (slot.avisos ?? []).filter((a) => {
    const match =
      a.numero === avisoNumero ||
      a.avisoFirestoreId === avisoFirestoreId ||
      a.numero === avisoFirestoreId;
    if (match) {
      removed = a;
      return false;
    }
    return true;
  });
  if (!removed) return { slots: next, aviso: null };
  if (avisos.length === 0) next.splice(idx, 1);
  else next[idx] = { ...slot, avisos };
  return { slots: next, aviso: removed };
}

function agregarAvisoASlot(
  slots: SlotSemanal[],
  localidad: string,
  dia: DiaSemanaPrograma,
  esp: EspecialidadPrograma,
  aviso: AvisoSlot,
  fechaRef: SlotSemanal["fecha"],
): SlotSemanal[] {
  const loc = localidad.trim() || "—";
  const next = cloneSlots(slots);
  const idx = next.findIndex((s) => s.localidad === loc && s.dia === dia && s.especialidad === esp);
  if (idx >= 0) {
    const cur = next[idx]!;
    const avisos = [...(cur.avisos ?? [])];
    if (!avisos.some((a) => a.numero === aviso.numero)) avisos.push(aviso);
    next[idx] = { ...cur, avisos };
    return next;
  }
  next.push({ localidad: loc, especialidad: esp, dia, fecha: fechaRef, avisos: [aviso] });
  return next;
}

async function cargarMovimientosPrograma(avisos: AvisoRow[], centroFiltro: string | null): Promise<ProgramaMovimiento[]> {
  const db = getAdminDb();
  const numeros = new Set(avisos.map((a) => a.n_aviso));
  const ids = new Set(avisos.map((a) => a.id));
  const codigoPorId = new Map(avisos.map((a) => [a.id, a.codigo_activo]));
  const movs: ProgramaMovimiento[] = [];
  const col = db.collection(COLLECTIONS.programa_semanal);
  const snap = centroFiltro
    ? await col
        .orderBy(FieldPath.documentId())
        .startAt(centroFiltro)
        .endAt(`${centroFiltro}\uf8ff`)
        .get()
    : await col.orderBy("updated_at", "desc").limit(80).get();

  for (const doc of snap.docs) {
    const parts = doc.id.split("_");
    const centroDoc = parts[0]?.trim().toUpperCase() ?? "";
    if (centroFiltro && centroDoc !== centroFiltro) continue;
    const slots = ((doc.data() as { slots?: SlotSemanal[] }).slots ?? []) as SlotSemanal[];
    for (const slot of slots) {
      if (slot.especialidad !== "GG") continue;
      for (const av of slot.avisos ?? []) {
        const n = String(av.numero ?? "").trim();
        const fid = String(av.avisoFirestoreId ?? "").trim();
        if (!numeros.has(n) && !ids.has(fid) && !ids.has(n)) continue;
        const aviso = avisos.find((a) => a.n_aviso === n || a.id === fid || a.id === n);
        if (!aviso) continue;
        const codigo = codigoPorId.get(aviso.id) ?? aviso.codigo_activo;
        movs.push({
          programaDocId: doc.id,
          numero: n || aviso.n_aviso,
          avisoFirestoreId: aviso.id,
          dia: slot.dia,
          localidad: slot.localidad,
          de: "GG",
          a: "Aire",
        });
        void codigo;
      }
    }
  }
  return movs;
}

async function aplicarParches(input: {
  avisos: AvisoRow[];
  otPatches: OtPatch[];
  movimientos: ProgramaMovimiento[];
}): Promise<{ avisosOk: number; otsOk: number; programasOk: number }> {
  const db = getAdminDb();
  const CHUNK = 400;
  let avisosOk = 0;
  for (let i = 0; i < input.avisos.length; i += CHUNK) {
    const batch = db.batch();
    for (const a of input.avisos.slice(i, i + CHUNK)) {
      const clave = buildClaveMantenimiento({
        ubicacion_tecnica: a.ubicacion_tecnica,
        frecuencia: a.frecuencia,
        especialidad: "AA",
        tipo: a.tipo,
      });
      batch.update(db.collection(AVISOS_COLLECTION).doc(a.id), {
        especialidad: "AA",
        clave_mantenimiento: clave,
        updated_at: FieldValue.serverTimestamp(),
      });
      avisosOk++;
    }
    await batch.commit();
  }

  let otsOk = 0;
  for (let i = 0; i < input.otPatches.length; i += CHUNK) {
    const batch = db.batch();
    for (const p of input.otPatches.slice(i, i + CHUNK)) {
      batch.update(db.collection(COLLECTIONS.work_orders).doc(p.woId), {
        especialidad: "AA",
        codigo_activo_snapshot: p.codigo_activo,
        equipo_codigo: p.codigo_activo,
        updated_at: FieldValue.serverTimestamp(),
      });
      otsOk++;
    }
    await batch.commit();
  }

  const porPrograma = new Map<string, ProgramaMovimiento[]>();
  for (const m of input.movimientos) {
    const arr = porPrograma.get(m.programaDocId) ?? [];
    arr.push(m);
    porPrograma.set(m.programaDocId, arr);
  }

  let programasOk = 0;
  for (const [programaDocId, movs] of porPrograma) {
    const ref = db.collection(COLLECTIONS.programa_semanal).doc(programaDocId);
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return;
      let slots = cloneSlots(((snap.data() as { slots?: SlotSemanal[] }).slots ?? []) as SlotSemanal[]);
      for (const m of movs) {
        const avisoRow = input.avisos.find((a) => a.id === m.avisoFirestoreId || a.n_aviso === m.numero);
        const { slots: afterRemove, aviso } = quitarAvisoDeSlot(
          slots,
          m.localidad,
          m.dia,
          m.de,
          m.numero,
          m.avisoFirestoreId,
        );
        if (!aviso) continue;
        const avisoSlot: AvisoSlot = {
          ...aviso,
          equipoCodigo: aviso.equipoCodigo ?? avisoRow?.codigo_activo,
        };
        const srcSlot = slots.find(
          (s) => s.localidad === m.localidad && s.dia === m.dia && s.especialidad === m.de,
        );
        const fechaRef = srcSlot?.fecha ?? afterRemove[0]?.fecha;
        if (!fechaRef) continue;
        slots = agregarAvisoASlot(afterRemove, m.localidad, m.dia, m.a, avisoSlot, fechaRef);
      }
      txn.update(ref, { slots, updated_at: FieldValue.serverTimestamp() });
    });
    programasOk++;
  }

  return { avisosOk, otsOk, programasOk };
}

async function main() {
  const args = parseArgs();
  console.log("Corrección avisos AA mal clasificados como GG\n");
  console.log(`Modo: ${args.apply ? "APLICAR" : "simulación (dry-run)"}`);
  if (args.centro) console.log(`Centro: ${args.centro}`);
  if (args.nAviso) console.log(`Aviso: ${args.nAviso}`);
  console.log("");

  const predActivos = await cargarPrediccionActivos();
  const codigoPorAsset = await cargarCodigoPorAssetId();
  const avisos = await cargarAvisosAfectados({
    centro: args.centro,
    nAviso: args.nAviso,
    predActivos,
    codigoPorAsset,
  });

  console.log(`Avisos candidatos: ${avisos.length}`);
  if (!avisos.length) {
    console.log("Nada que corregir.");
    return;
  }

  for (const a of avisos.slice(0, args.muestra)) {
    console.log(`  ${a.n_aviso}  ${a.codigo_activo}  ${a.texto_corto.slice(0, 50)}`);
  }
  if (avisos.length > args.muestra) console.log(`  … y ${avisos.length - args.muestra} más`);

  const otPatches = await cargarOtPatches(avisos);
  const movimientos = args.sinPrograma ? [] : await cargarMovimientosPrograma(avisos, args.centro);
  console.log(`\nOTs a actualizar: ${otPatches.length}`);
  console.log(`Movimientos en programa: ${movimientos.length}`);

  const reporte = { avisos: avisos.length, ots: otPatches.length, programa: movimientos.length, muestra: avisos.slice(0, 50) };
  if (args.jsonPath) {
    fs.writeFileSync(args.jsonPath, JSON.stringify(reporte, null, 2), "utf8");
    console.log(`Reporte JSON: ${args.jsonPath}`);
  }

  if (!args.apply) {
    console.log("\nDry-run. Para aplicar: agregá --apply (opcional --centro PF01 --yes).");
    return;
  }

  if (!args.yes) {
    const ok = await confirmar(`¿Aplicar ${avisos.length} avisos? (si/no): `);
    if (!ok) {
      console.log("Cancelado.");
      return;
    }
  }

  const res = await aplicarParches({ avisos, otPatches, movimientos });
  console.log(`\nListo: ${res.avisosOk} avisos, ${res.otsOk} OTs, ${res.programasOk} documentos de programa.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
