/**
 * Carga preventivos GG semestrales/anuales (SERVIS ANUAL + CHECK) desde JSON.
 * Fuente: scripts/seed/data/preventivos-gg-sem-anual.json
 *
 *   npx tsx --env-file=.env.local scripts/seed/seed-activos-gg.ts
 *   npx tsx --env-file=.env.local scripts/importar-preventivos-gg-sem-anual.ts
 *   npx tsx --env-file=.env.local scripts/importar-preventivos-gg-sem-anual.ts --dry-run
 */
/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { avisoDocId } from "@/lib/import/aviso-numero-canonical";
import { resolveAssetIdFromLookup } from "@/lib/import/asset-ut-lookup";
import { inferFrecuenciaMTSADescripcion, normalizeImportKey } from "@/lib/import/normalize-values";
import { ASSETS_COLLECTION, AVISOS_COLLECTION } from "@/lib/firestore/collections";
import { normalizeCentro } from "@/lib/firestore/derive-centro";
import { buildClaveMantenimiento } from "@/lib/mantenimiento/clave-mantenimiento";
import { reconcileAntecesorTrasImportar } from "@/lib/mantenimiento/antecesor-orden-admin";
import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";
import type { Especialidad, EstadoAviso, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";
import { FieldValue } from "firebase-admin/firestore";

type RowJson = {
  numero: string;
  descripcion: string;
  ubicacion_tecnica: string;
  denom_ubicacion?: string;
};

const CODIGO_ALIASES: Record<string, string> = {
  "gge pm02ch50kva": "PM02CH50KVA",
  "pmota31kva": "PM0TA31KVA",
};

function mtsaToFrecuencia(m: "M" | "T" | "S" | "A"): FrecuenciaMantenimiento {
  const map: Record<string, FrecuenciaMantenimiento> = {
    M: "MENSUAL",
    T: "TRIMESTRAL",
    S: "SEMESTRAL",
    A: "ANUAL",
  };
  return map[m] ?? "MENSUAL";
}

function codigoEquipoDesdeDescripcion(descripcion: string): string {
  const d = descripcion.trim();
  const mAnual = /^servis\s+anual\s+(.+)$/i.exec(d);
  if (mAnual?.[1]) return mAnual[1].trim();
  const mCheck = /^check\s+(.+)$/i.exec(d);
  if (mCheck?.[1]) return mCheck[1].trim();
  const parts = d.split(/\s+/);
  return parts[parts.length - 1]?.trim() ?? d;
}

function normalizarCodigoEquipo(raw: string): string {
  const key = normalizeImportKey(raw);
  return CODIGO_ALIASES[key] ?? raw.trim().toUpperCase();
}

async function loadAssetLookups(): Promise<{
  codigoToId: Map<string, string>;
  utToAsset: Map<string, string>;
  centroPorAssetId: Map<string, string>;
}> {
  const db = getAdminDb();
  const snap = await db.collection(ASSETS_COLLECTION).get();
  const codigoToId = new Map<string, string>();
  const utToAsset = new Map<string, string>();
  const centroPorAssetId = new Map<string, string>();

  for (const d of snap.docs) {
    const cod = String(d.get("codigo_nuevo") ?? "").trim().toUpperCase();
    const ut = String(d.get("ubicacion_tecnica") ?? "").trim();
    const centro = String(d.get("centro") ?? "").trim();
    if (cod) codigoToId.set(cod, d.id);
    if (ut && !utToAsset.has(ut)) utToAsset.set(ut, d.id);
    if (centro) centroPorAssetId.set(d.id, centro);
  }
  return { codigoToId, utToAsset, centroPorAssetId };
}

function resolveAssetId(
  descripcion: string,
  ut: string,
  codigoToId: Map<string, string>,
  utToAsset: Map<string, string>,
): string {
  const codigo = normalizarCodigoEquipo(codigoEquipoDesdeDescripcion(descripcion));
  const byCodigo = codigoToId.get(codigo);
  if (byCodigo) return byCodigo;
  return resolveAssetIdFromLookup(utToAsset, ut) ?? "";
}

async function commitBatch(payloads: Array<{ id: string; data: Record<string, unknown> }>): Promise<void> {
  const db = getAdminDb();
  const col = db.collection(AVISOS_COLLECTION);
  const chunkSize = 450;
  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const { id, data } of chunk) {
      const ref = col.doc(id);
      const snap = await ref.get();
      const base = { ...data, updated_at: FieldValue.serverTimestamp() };
      if (!snap.exists) (base as Record<string, unknown>).created_at = FieldValue.serverTimestamp();
      batch.set(ref, base, { merge: true });
    }
    await batch.commit();
    console.log(`  Escritos ${Math.min(i + chunkSize, payloads.length)}/${payloads.length}`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const dataPath = path.join(process.cwd(), "scripts", "seed", "data", "preventivos-gg-sem-anual.json");
  if (!fs.existsSync(dataPath)) {
    console.error(`No se encontró ${dataPath}`);
    process.exit(1);
  }

  const rowsJson = JSON.parse(fs.readFileSync(dataPath, "utf8")) as RowJson[];
  const { codigoToId, utToAsset, centroPorAssetId } = await loadAssetLookups();

  const payloads: Array<{ id: string; data: Record<string, unknown> }> = [];
  const errores: string[] = [];
  const centros = new Set<string>();

  for (const row of rowsJson) {
    const numero = row.numero.trim();
    const descripcion = row.descripcion.trim();
    const ut = row.ubicacion_tecnica.trim();
    const denom = row.denom_ubicacion?.trim() ?? "";
    const mtsa = inferFrecuenciaMTSADescripcion(descripcion);
    const freq = mtsaToFrecuencia(mtsa);
    const esp: Especialidad = "GG";
    const assetId = resolveAssetId(descripcion, ut, codigoToId, utToAsset);

    if (!assetId) {
      errores.push(`Aviso ${numero}: sin activo para «${codigoEquipoDesdeDescripcion(descripcion)}» / UT ${ut}`);
      continue;
    }

    const centro =
      centroPorAssetId.get(assetId) ||
      normalizeCentro("", ut, normalizarCodigoEquipo(codigoEquipoDesdeDescripcion(descripcion)));
    centros.add(centro);

    const clave = buildClaveMantenimiento({
      ubicacion_tecnica: ut,
      frecuencia: freq,
      especialidad: esp,
      tipo: "PREVENTIVO",
    });

    payloads.push({
      id: avisoDocId(numero),
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
        texto_corto: descripcion.slice(0, 500),
        texto_largo: denom ? `${denom} — ${descripcion}` : descripcion,
        estado: "ABIERTO" as EstadoAviso,
        fecha_programada: null,
      },
    });
  }

  console.log(`\nFilas JSON: ${rowsJson.length}`);
  console.log(`A importar: ${payloads.length}`);
  if (errores.length) {
    console.log("\nErrores:");
    for (const e of errores) console.log(`  - ${e}`);
  }

  for (const p of payloads.slice(0, 5)) {
    console.log(`  ${p.data.n_aviso} → ${p.data.especialidad} ${p.data.frecuencia_plan_mtsa} asset=${p.data.asset_id}`);
  }

  if (dryRun || !payloads.length) {
    console.log(dryRun ? "\n--dry-run: sin escritura." : "\nSin filas válidas.");
    return;
  }

  await commitBatch(payloads);
  const ids = payloads.map((p) => p.id);
  const claveMap = new Map<string, string>();
  for (const p of payloads) {
    const cl = p.data.clave_mantenimiento;
    if (typeof cl === "string") claveMap.set(p.id, cl);
  }
  await reconcileAntecesorTrasImportar({ avisoIds: ids, clavePorAvisoId: claveMap });
  for (const c of centros) await ensurePlansForCentro(c);

  console.log("\nListo. Preventivos GG semestrales/anuales cargados.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
