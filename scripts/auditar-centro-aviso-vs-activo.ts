/**
 * Lista avisos cuyo `centro` no coincide con el `centro` del activo vinculado (`asset_id`).
 * Caso típico: import de avisos con derive solo por UT (p. ej. BOSS→PF01) y equipo PM02xxx en maestro.
 *
 * Uso:
 *   npx tsx scripts/auditar-centro-aviso-vs-activo.ts [--centro PF01] [--limit 8000]
 *
 * Entorno: credenciales Admin (como `scripts/migrate-centro-normalize.ts`).
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

const CHUNK = 400;

function parseArgs() {
  const argv = process.argv.slice(2);
  let filtroCentro = "";
  let limit = 50_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" || a === "-c") filtroCentro = (argv[++i] ?? "").trim();
    if (a === "--limit" || a === "-l") limit = Math.max(1, parseInt(argv[++i] ?? "50000", 10) || 50_000);
  }
  return { filtroCentro, limit };
}

async function main() {
  const { filtroCentro, limit } = parseArgs();
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const q = filtroCentro ? col.where("centro", "==", filtroCentro) : col;
  const snap = await q.limit(limit).get();

  const mismatches: {
    avisoId: string;
    n_aviso: string;
    centroAviso: string;
    assetId: string;
    codigo: string;
    centroAsset: string;
  }[] = [];
  const sinActivo: string[] = [];

  const byChunk = snap.docs;
  const assetIds = [...new Set(byChunk.map((d) => String(d.get("asset_id") ?? "").trim()).filter(Boolean))];
  const assetCentroById = new Map<string, { centro: string; codigo: string }>();

  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.assets).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const centro = String(s.get("centro") ?? "").trim();
      const codigo = String(s.get("codigo_nuevo") ?? "").trim();
      assetCentroById.set(s.id, { centro, codigo });
    }
  }

  for (const d of byChunk) {
    const avisoCentro = String(d.get("centro") ?? "").trim();
    const assetId = String(d.get("asset_id") ?? "").trim();
    const n_aviso = String(d.get("n_aviso") ?? "").trim();
    if (!assetId) continue;
    const meta = assetCentroById.get(assetId);
    if (!meta) {
      sinActivo.push(`${d.id} n_aviso=${n_aviso} asset_id=${assetId} (activo no encontrado)`);
      continue;
    }
    if (meta.centro && avisoCentro && meta.centro !== avisoCentro) {
      mismatches.push({
        avisoId: d.id,
        n_aviso,
        centroAviso: avisoCentro,
        assetId,
        codigo: meta.codigo || "—",
        centroAsset: meta.centro,
      });
    }
  }

  console.log(
    `Revisados ${byChunk.length} avisos${filtroCentro ? ` (centro=${filtroCentro})` : ""}. ` +
      `Conflictos aviso.centro ≠ asset.centro: ${mismatches.length}. ` +
      `Activos faltantes: ${sinActivo.length}.`,
  );

  for (const m of mismatches.slice(0, 200)) {
    console.log(
      `  · aviso ${m.n_aviso || m.avisoId} | aviso.centro=${m.centroAviso} | activo ${m.codigo} | asset.centro=${m.centroAsset} | asset_id=${m.assetId}`,
    );
  }
  if (mismatches.length > 200) {
    console.log(`  … y ${mismatches.length - 200} más`);
  }
  if (sinActivo.length) {
    console.log("Activos no encontrados (muestra):");
    sinActivo.slice(0, 30).forEach((s) => console.log(`  - ${s}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
