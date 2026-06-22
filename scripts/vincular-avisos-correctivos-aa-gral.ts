/* eslint-disable no-console */
/**
 * Vincula avisos correctivos AA sin unidad concreta al activo sintético `aa-gral-{centro}`.
 * También alinea OTs vinculadas (asset_id / snapshots AA-GRAL).
 *
 * Criterio (default):
 *   - tipo CORRECTIVO, especialidad AA
 *   - sin `asset_id`, o sin UT, o `asset_id` que no existe en catálogo
 *   - no pisa correctivos AA ya en `aa-gral-{centro}`
 *   - no pisa correctivos con UT + activo real del catálogo (unidad AA específica)
 *
 * Con `--incluir-activo-no-aa` también incluye correctivos AA cuyo activo en catálogo
 * no es de disciplina AA (p. ej. heladera/cortinas con UT de ubicación genérica).
 *
 * Simulación:
 *   npx tsx scripts/vincular-avisos-correctivos-aa-gral.ts
 *   npx tsx scripts/vincular-avisos-correctivos-aa-gral.ts --centro PC01
 *   npx tsx scripts/vincular-avisos-correctivos-aa-gral.ts --diagnostico --centro PC01
 *
 * Aplicar:
 *   npx tsx scripts/vincular-avisos-correctivos-aa-gral.ts --apply --seed-activos
 *
 * Opciones:
 *   --diagnostico         Resumen de correctivos por especialidad y por qué no califican
 *   --incluir-activo-no-aa  Incluye AA con activo en catálogo que no es unidad AA
 *   --apply               Escribe en Firestore (sin esto, solo informe)
 *   --seed-activos        Crea/actualiza aa-gral-{centro} antes de parchear
 *   --centro CODE         Filtra una planta (PC01, PF01, …)
 *   --json PATH           Guarda reporte JSON
 *   --muestra N           Filas de detalle en consola (default 40)
 *   --yes                 Aplica sin pedir confirmación
 */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs";
import * as readline from "node:readline";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  CODIGO_AA_GRAL,
  esActivoSinteticoAireGeneral,
  syntheticAaAssetId,
} from "@/lib/assets/synthetic-gral-asset";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { ASSETS_COLLECTION, AVISOS_COLLECTION, COLLECTIONS } from "@/lib/firestore/collections";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import type { Especialidad, TipoAviso } from "@/modules/notices/types";

type AvisoAfectado = {
  id: string;
  n_aviso: string;
  centro: string;
  asset_id: string;
  ubicacion_tecnica: string;
  texto_corto: string;
  work_order_id: string;
  motivo: string;
  asset_id_nuevo: string;
};

type OtAfectada = {
  id: string;
  n_ot: string;
  avisoId: string;
  centro: string;
  asset_id: string;
  asset_id_nuevo: string;
  tieneEquipoCodigo: boolean;
  tieneCodigoActivo: boolean;
};

type EvalOpts = {
  centroFiltro: string | null;
  assetIdsCatalogo: Set<string>;
  espPredPorAssetId: Map<string, string>;
  incluirActivoNoAa: boolean;
};

type DiagnosticoBucket =
  | "ya_aa_gral"
  | "sin_asset"
  | "sin_ut"
  | "asset_no_catalogo"
  | "activo_no_aa"
  | "ut_con_unidad_aa"
  | "no_es_correctivo_aa";

function parseArgs() {
  const argv = process.argv.slice(2);
  let apply = false;
  let seedActivos = false;
  let diagnostico = false;
  let incluirActivoNoAa = false;
  let centro: string | null = null;
  let jsonPath: string | null = null;
  let muestra = 40;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply" || a === "--fix") apply = true;
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--seed-activos") seedActivos = true;
    else if (a === "--diagnostico" || a === "--diag") diagnostico = true;
    else if (a === "--incluir-activo-no-aa") incluirActivoNoAa = true;
    else if (a === "--centro" && argv[i + 1]) centro = argv[++i]!.trim().toUpperCase();
    else if (a === "--json" && argv[i + 1]) jsonPath = argv[++i]!.trim();
    else if (a === "--muestra" && argv[i + 1]) muestra = Math.max(1, parseInt(argv[++i]!, 10) || 40);
  }

  return { apply, seedActivos, diagnostico, incluirActivoNoAa, centro, jsonPath, muestra, yes };
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

async function seedActivosAa(centros: string[]): Promise<string[]> {
  const db = getAdminDb();
  const creados: string[] = [];
  for (const centro of centros) {
    const id = syntheticAaAssetId(centro);
    const ref = db.collection(ASSETS_COLLECTION).doc(id);
    const snap = await ref.get();
    await ref.set(
      {
        codigo_nuevo: CODIGO_AA_GRAL,
        denominacion: "Aire General",
        ubicacion_tecnica: `${CODIGO_AA_GRAL}-${centro}`,
        centro,
        especialidad_predeterminada: "AA",
        activo_operativo: true,
        updated_at: FieldValue.serverTimestamp(),
        ...(snap.exists ? {} : { created_at: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
    creados.push(id);
  }
  return creados;
}

async function cargarCorrectivos(centroFiltro: string | null): Promise<QueryDocumentSnapshot[]> {
  const db = getAdminDb();
  if (centroFiltro) {
    const snap = await db.collection(AVISOS_COLLECTION).where("centro", "==", centroFiltro).get();
    return snap.docs.filter((d) => String(d.data().tipo ?? "") === "CORRECTIVO");
  }
  const snap = await db.collection(AVISOS_COLLECTION).where("tipo", "==", "CORRECTIVO").get();
  return snap.docs;
}

async function cargarContextoCatalogo(docs: QueryDocumentSnapshot[]): Promise<{
  assetIdsCatalogo: Set<string>;
  espPredPorAssetId: Map<string, string>;
}> {
  const db = getAdminDb();
  const assetIds = [...new Set(docs.map((d) => String(d.data().asset_id ?? "").trim()).filter(Boolean))];
  const assetIdsCatalogo = new Set<string>();
  const espPredPorAssetId = new Map<string, string>();

  for (let i = 0; i < assetIds.length; i += 30) {
    const chunk = assetIds.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(ASSETS_COLLECTION).doc(id)));
    for (const s of snaps) {
      if (!s.exists) continue;
      assetIdsCatalogo.add(s.id);
      const pred = String((s.data() as { especialidad_predeterminada?: string }).especialidad_predeterminada ?? "");
      if (pred) espPredPorAssetId.set(s.id, pred);
    }
  }

  return { assetIdsCatalogo, espPredPorAssetId };
}

function clasificarAvisoAa(
  d: Record<string, unknown>,
  centro: string,
  opts: Pick<EvalOpts, "assetIdsCatalogo" | "espPredPorAssetId" | "incluirActivoNoAa">,
): { bucket: DiagnosticoBucket; motivo: string | null } {
  const assetId = String(d.asset_id ?? "").trim();
  const ut = String(d.ubicacion_tecnica ?? "").trim();
  const aaGral = syntheticAaAssetId(centro);

  if (assetId === aaGral || esActivoSinteticoAireGeneral("", assetId)) {
    return { bucket: "ya_aa_gral", motivo: null };
  }
  if (!assetId) return { bucket: "sin_asset", motivo: "sin asset_id" };
  if (!ut) return { bucket: "sin_ut", motivo: "sin UT (trabajo no asociado a unidad AA)" };
  if (!opts.assetIdsCatalogo.has(assetId)) {
    return { bucket: "asset_no_catalogo", motivo: "asset_id no está en catálogo" };
  }

  const pred = opts.espPredPorAssetId.get(assetId);
  if (opts.incluirActivoNoAa && pred && pred !== "AA") {
    return {
      bucket: "activo_no_aa",
      motivo: `activo en catálogo con especialidad ${pred} (no unidad AA)`,
    };
  }

  return { bucket: "ut_con_unidad_aa", motivo: null };
}

function evaluarAviso(doc: QueryDocumentSnapshot, opts: EvalOpts): AvisoAfectado | null {
  const d = doc.data() as Record<string, unknown>;
  const tipo = String(d.tipo ?? "");
  const especialidad = String(d.especialidad ?? "");
  if (tipo !== "CORRECTIVO" || especialidad !== "AA") return null;

  const centro = String(d.centro ?? "").trim().toUpperCase();
  if (!centro) return null;
  if (opts.centroFiltro && centro !== opts.centroFiltro) return null;

  const { bucket, motivo } = clasificarAvisoAa(d, centro, opts);
  if (!motivo) return null;

  return {
    id: doc.id,
    n_aviso: String(d.n_aviso ?? doc.id),
    centro,
    asset_id: String(d.asset_id ?? "").trim(),
    ubicacion_tecnica: String(d.ubicacion_tecnica ?? "").trim(),
    texto_corto: String(d.texto_corto ?? "").slice(0, 120),
    work_order_id: String(d.work_order_id ?? "").trim(),
    motivo,
    asset_id_nuevo: syntheticAaAssetId(centro),
  };
}

async function cargarAvisosAfectados(
  centroFiltro: string | null,
  incluirActivoNoAa: boolean,
): Promise<AvisoAfectado[]> {
  const docs = await cargarCorrectivos(centroFiltro);
  const { assetIdsCatalogo, espPredPorAssetId } = await cargarContextoCatalogo(docs);
  const opts: EvalOpts = {
    centroFiltro,
    assetIdsCatalogo,
    espPredPorAssetId,
    incluirActivoNoAa,
  };
  const out: AvisoAfectado[] = [];
  for (const doc of docs) {
    const row = evaluarAviso(doc, opts);
    if (row) out.push(row);
  }
  out.sort((a, b) => a.n_aviso.localeCompare(b.n_aviso));
  return out;
}

async function ejecutarDiagnostico(centroFiltro: string | null, incluirActivoNoAa: boolean): Promise<void> {
  const docs = await cargarCorrectivos(centroFiltro);
  const { assetIdsCatalogo, espPredPorAssetId } = await cargarContextoCatalogo(docs);

  const porEsp = new Map<string, number>();
  const buckets = new Map<DiagnosticoBucket, number>();
  const muestras = new Map<DiagnosticoBucket, Array<{ n: string; texto: string; detalle: string }>>();

  for (const doc of docs) {
    const d = doc.data() as Record<string, unknown>;
    const esp = String(d.especialidad ?? "?");
    porEsp.set(esp, (porEsp.get(esp) ?? 0) + 1);

    if (String(d.tipo ?? "") !== "CORRECTIVO" || esp !== "AA") continue;

    const centro = String(d.centro ?? "").trim().toUpperCase();
    const { bucket, motivo } = clasificarAvisoAa(d, centro, {
      assetIdsCatalogo,
      espPredPorAssetId,
      incluirActivoNoAa,
    });

    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    const list = muestras.get(bucket) ?? [];
    if (list.length < 5) {
      list.push({
        n: String(d.n_aviso ?? doc.id),
        texto: String(d.texto_corto ?? "").slice(0, 70),
        detalle: motivo ?? bucket,
      });
      muestras.set(bucket, list);
    }
  }

  const label: Record<DiagnosticoBucket, string> = {
    ya_aa_gral: "Ya en AA-GRAL",
    sin_asset: "Sin asset_id → calificarían",
    sin_ut: "Sin UT → calificarían",
    asset_no_catalogo: "Asset fuera de catálogo → calificarían",
    activo_no_aa: "Activo no-AA en catálogo → calificarían con --incluir-activo-no-aa",
    ut_con_unidad_aa: "UT + unidad AA real → no se tocan (default)",
    no_es_correctivo_aa: "—",
  };

  console.log(`Correctivos${centroFiltro ? ` en ${centroFiltro}` : ""}: ${docs.length}\n`);
  console.log("Por especialidad:");
  for (const [esp, n] of [...porEsp.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${esp}: ${n}`);
  }

  const aaTotal = [...buckets.values()].reduce((a, b) => a + b, 0);
  console.log(`\nCorrectivos AA: ${aaTotal}`);
  if (aaTotal === 0) {
    console.log("\nNo hay correctivos con especialidad AA en este alcance.");
    console.log("Los trabajos de aire pueden estar como GG u otra disciplina en SAP/import.");
    return;
  }

  console.log("\nDesglose AA:");
  for (const bucket of [
    "sin_asset",
    "sin_ut",
    "asset_no_catalogo",
    "activo_no_aa",
    "ut_con_unidad_aa",
    "ya_aa_gral",
  ] as DiagnosticoBucket[]) {
    const n = buckets.get(bucket) ?? 0;
    if (!n) continue;
    console.log(`  ${label[bucket]}: ${n}`);
    for (const m of muestras.get(bucket) ?? []) {
      console.log(`    · ${m.n} — ${m.texto}${m.detalle !== bucket ? ` (${m.detalle})` : ""}`);
    }
  }

  const califican =
    (buckets.get("sin_asset") ?? 0) +
    (buckets.get("sin_ut") ?? 0) +
    (buckets.get("asset_no_catalogo") ?? 0) +
    (incluirActivoNoAa ? buckets.get("activo_no_aa") ?? 0 : 0);

  console.log(`\nCalificarían con criterio actual${incluirActivoNoAa ? " (+ activo-no-aa)" : ""}: ${califican}`);
  if (!incluirActivoNoAa && (buckets.get("activo_no_aa") ?? 0) > 0) {
    console.log(
      `Hay ${buckets.get("activo_no_aa")} con activo en catálogo que no es unidad AA. Probá:\n` +
        "  npx tsx scripts/vincular-avisos-correctivos-aa-gral.ts --incluir-activo-no-aa --centro " +
        (centroFiltro ?? "PC01"),
    );
  }
}

async function cargarOtsAfectadas(avisos: AvisoAfectado[]): Promise<OtAfectada[]> {
  const db = getAdminDb();
  const out: OtAfectada[] = [];
  for (const a of avisos) {
    if (!a.work_order_id) continue;
    const snap = await db.collection(COLLECTIONS.work_orders).doc(a.work_order_id).get();
    if (!snap.exists) continue;
    const d = snap.data() as Record<string, unknown>;
    const assetId = String(d.asset_id ?? "").trim();
    if (assetId === a.asset_id_nuevo) continue;
    out.push({
      id: snap.id,
      n_ot: String(d.n_ot ?? d.aviso_numero ?? snap.id),
      avisoId: a.id,
      centro: a.centro,
      asset_id: assetId,
      asset_id_nuevo: a.asset_id_nuevo,
      tieneEquipoCodigo: "equipo_codigo" in d,
      tieneCodigoActivo: "codigo_activo_snapshot" in d,
    });
  }
  return out;
}

async function aplicar(input: {
  avisos: AvisoAfectado[];
  ots: OtAfectada[];
  seedActivos: boolean;
}): Promise<{ activosSeed: string[]; avisosOk: number; otsOk: number }> {
  const db = getAdminDb();
  const centros = [...new Set(input.avisos.map((a) => a.centro))];
  let activosSeed: string[] = [];
  if (input.seedActivos && centros.length) {
    activosSeed = await seedActivosAa(centros);
  }

  const CHUNK = 400;
  let avisosOk = 0;
  for (let i = 0; i < input.avisos.length; i += CHUNK) {
    const batch = db.batch();
    for (const a of input.avisos.slice(i, i + CHUNK)) {
      const clave = buildClaveMantenimiento({
        ubicacion_tecnica: a.ubicacion_tecnica,
        frecuencia: "UNICA",
        especialidad: "AA" satisfies Especialidad,
        tipo: "CORRECTIVO" satisfies TipoAviso,
      });
      batch.update(db.collection(AVISOS_COLLECTION).doc(a.id), {
        asset_id: a.asset_id_nuevo,
        especialidad: "AA",
        clave_mantenimiento: clave,
        updated_at: FieldValue.serverTimestamp(),
      });
      avisosOk++;
    }
    await batch.commit();
  }

  let otsOk = 0;
  for (let i = 0; i < input.ots.length; i += CHUNK) {
    const batch = db.batch();
    for (const o of input.ots.slice(i, i + CHUNK)) {
      const patch: Record<string, unknown> = {
        asset_id: o.asset_id_nuevo,
        especialidad: "AA",
        updated_at: FieldValue.serverTimestamp(),
      };
      if (o.tieneEquipoCodigo) patch.equipo_codigo = CODIGO_AA_GRAL;
      if (o.tieneCodigoActivo) patch.codigo_activo_snapshot = CODIGO_AA_GRAL;
      batch.update(db.collection(COLLECTIONS.work_orders).doc(o.id), patch);
      otsOk++;
    }
    await batch.commit();
  }

  return { activosSeed, avisosOk, otsOk };
}

async function main() {
  const opts = parseArgs();

  if (opts.diagnostico) {
    console.log("Diagnóstico de correctivos AA / AA-GRAL…\n");
    await ejecutarDiagnostico(opts.centro, opts.incluirActivoNoAa);
    return;
  }

  console.log("Buscando correctivos AA para vincular a AA-GRAL…\n");
  if (opts.incluirActivoNoAa) {
    console.log("(incluye activos en catálogo que no son unidad AA)\n");
  }

  const avisos = await cargarAvisosAfectados(opts.centro, opts.incluirActivoNoAa);
  const ots = await cargarOtsAfectadas(avisos);

  const reporte = {
    generado_en: new Date().toISOString(),
    modo: opts.apply ? "apply" : "simulacion",
    centro_filtro: opts.centro,
    incluir_activo_no_aa: opts.incluirActivoNoAa,
    avisos_total: avisos.length,
    ots_total: ots.length,
    avisos,
    ots,
  };

  if (opts.jsonPath) {
    fs.writeFileSync(opts.jsonPath, JSON.stringify(reporte, null, 2), "utf8");
    console.log(`Reporte JSON: ${opts.jsonPath}\n`);
  }

  if (avisos.length === 0) {
    console.log("No hay avisos correctivos AA que requieran AA-GRAL.");
    console.log("Para ver el desglose: --diagnostico --centro " + (opts.centro ?? "PC01"));
    return;
  }

  console.log(`Avisos a vincular: ${avisos.length}`);
  console.log(`OTs a alinear: ${ots.length}\n`);

  for (const a of avisos.slice(0, opts.muestra)) {
    console.log(`  ${a.n_aviso}  [${a.centro}]  (${a.motivo})`);
    console.log(`    asset: ${a.asset_id || "—"} → ${a.asset_id_nuevo}`);
    if (a.texto_corto) console.log(`    ${a.texto_corto}`);
  }
  if (avisos.length > opts.muestra) {
    console.log(`  … y ${avisos.length - opts.muestra} más`);
  }

  if (!opts.apply) {
    console.log("\nSimulación. Para aplicar:");
    console.log("  npx tsx scripts/vincular-avisos-correctivos-aa-gral.ts --apply --seed-activos");
    return;
  }

  if (!opts.yes) {
    const ok = await confirmar(`\nAplicar ${avisos.length} avisos y ${ots.length} OTs? (si/no): `);
    if (!ok) {
      console.log("Cancelado.");
      return;
    }
  }

  const res = await aplicar({ avisos, ots, seedActivos: opts.seedActivos });
  if (res.activosSeed.length) {
    console.log(`\nActivos sintéticos: ${res.activosSeed.join(", ")}`);
  }
  console.log(`\n✓ ${res.avisosOk} avisos y ${res.otsOk} OTs actualizados.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
