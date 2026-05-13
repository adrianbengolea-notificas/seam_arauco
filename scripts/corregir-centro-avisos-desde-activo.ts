/**
 * Alinea `avisos.centro` con el `centro` del activo vinculado cuando difieren
 * (mismo caso que audita `auditar-centro-aviso-vs-activo.ts`).
 *
 * Por defecto solo muestra qué haría. Para escribir en Firestore:
 *   npx tsx scripts/corregir-centro-avisos-desde-activo.ts --centro PF01 --commit
 *
 * Antes de --commit conviene --dry-run (es el default).
 *
 * Entorno: credenciales Admin (`.env.local`, etc.).
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";

const CHUNK = 400;

function parseArgs() {
  const argv = process.argv.slice(2);
  let filtroCentro = "";
  let limit = 50_000;
  let commit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--centro" || a === "-c") filtroCentro = (argv[++i] ?? "").trim();
    if (a === "--limit" || a === "-l") limit = Math.max(1, parseInt(argv[++i] ?? "50000", 10) || 50_000);
    if (a === "--commit") commit = true;
  }
  return { filtroCentro, limit, commit };
}

async function main() {
  const { filtroCentro, limit, commit } = parseArgs();
  if (!filtroCentro) {
    console.error("Indicá --centro <CODIGO> (ej. PF01) para acotar la corrección.");
    process.exit(1);
  }

  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const snap = await col.where("centro", "==", filtroCentro).limit(limit).get();

  const docs = snap.docs;
  const assetIds = [...new Set(docs.map((d) => String(d.get("asset_id") ?? "").trim()).filter(Boolean))];
  const assetCentroById = new Map<string, { centro: string; codigo: string }>();

  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.assets).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      assetCentroById.set(s.id, {
        centro: String(s.get("centro") ?? "").trim(),
        codigo: String(s.get("codigo_nuevo") ?? "").trim(),
      });
    }
  }

  type Plan = {
    avisoId: string;
    n_aviso: string;
    de: string;
    a: string;
    codigo: string;
  };
  const plan: Plan[] = [];

  for (const d of docs) {
    const avisoCentro = String(d.get("centro") ?? "").trim();
    const assetId = String(d.get("asset_id") ?? "").trim();
    const n_aviso = String(d.get("n_aviso") ?? "").trim();
    if (!assetId || !n_aviso) continue;
    const meta = assetCentroById.get(assetId);
    if (!meta?.centro || !avisoCentro || meta.centro === avisoCentro) continue;
    plan.push({
      avisoId: d.id,
      n_aviso,
      de: avisoCentro,
      a: meta.centro,
      codigo: meta.codigo || assetId,
    });
  }

  const bloqueados: string[] = [];
  const ok: Plan[] = [];

  for (const p of plan) {
    const q = col.where("centro", "==", p.a).where("n_aviso", "==", p.n_aviso).limit(2);
    const clash = await q.get();
    const otros = clash.docs.filter((x) => x.id !== p.avisoId);
    if (otros.length) {
      bloqueados.push(
        `${p.avisoId} n_aviso=${p.n_aviso}: ya existe otro aviso en centro ${p.a} (ids: ${otros.map((x) => x.id).join(", ")})`,
      );
      continue;
    }
    ok.push(p);
  }

  console.log(
    `Avisos en centro ${filtroCentro}: ${docs.length}. ` +
      `A corregir (sin choque n_aviso+centro destino): ${ok.length}. ` +
      `Bloqueados por duplicado lógico: ${bloqueados.length}.`,
  );

  for (const p of ok) {
    console.log(`  → ${p.avisoId} | ${p.n_aviso} | centro ${p.de} → ${p.a} | ${p.codigo}`);
  }
  for (const b of bloqueados) {
    console.log(`  ✗ ${b}`);
  }

  if (!commit) {
    console.log("\nSimulación solamente. Para aplicar: añadí --commit");
    return;
  }

  if (!ok.length) {
    console.log("Nada que commitear.");
    return;
  }

  const BATCH_MAX = 450;
  let n = 0;
  for (let i = 0; i < ok.length; i += BATCH_MAX) {
    const slice = ok.slice(i, i + BATCH_MAX);
    const batch = db.batch();
    for (const p of slice) {
      batch.update(col.doc(p.avisoId), {
        centro: p.a,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    n += slice.length;
    console.log(`Commit lote: ${slice.length} (total ${n}/${ok.length})`);
  }

  console.log("Listo. Revisá planes/vencimientos si aplica; el centro del aviso afecta consultas por planta.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
