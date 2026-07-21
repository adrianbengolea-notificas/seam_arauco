/**
 * Mueve preventivos/correctivos ELECTRICO con UT BOSS-* de PF01 (Predio Forestal)
 * a PM02 (Bossetti), reasignando asset sintético ee-gral-pm02 y OTs/planes vinculados.
 *
 *   npx tsx --env-file=.env.local scripts/corregir-electricos-boss-a-pm02.ts
 *   npx tsx --env-file=.env.local scripts/corregir-electricos-boss-a-pm02.ts --commit
 */
/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { syntheticEeAssetId, CODIGO_EE_GRAL } from "@/lib/assets/synthetic-gral-asset";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { isUtPrefijoBoss } from "@/lib/firestore/derive-centro";
import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";

const FROM = "PF01";
const TO = "PM02";
const ASSET_TO = syntheticEeAssetId(TO);

function parseArgs() {
  return { commit: process.argv.includes("--commit") };
}

async function ensureEeAsset(centro: string): Promise<void> {
  const db = getAdminDb();
  const id = syntheticEeAssetId(centro);
  const ref = db.collection(COLLECTIONS.assets).doc(id);
  const snap = await ref.get();
  const data: Record<string, unknown> = {
    codigo_nuevo: CODIGO_EE_GRAL,
    denominacion: "Eléctrico General",
    ubicacion_tecnica: `EE-GRAL-${centro}`,
    centro,
    especialidad_predeterminada: "ELECTRICO",
    activo_operativo: true,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (!snap.exists) data.created_at = FieldValue.serverTimestamp();
  await ref.set(data, { merge: true });
  console.log(`assets/${id}: ${snap.exists ? "actualizado" : "creado"}`);
}

async function main() {
  const { commit } = parseArgs();
  const db = getAdminDb();

  console.log(commit ? "[WRITE] Aplicando corrección…" : "[DRY-RUN] Simulación (añadir --commit para persistir)");
  await ensureEeAsset("PC01");
  await ensureEeAsset("PF01");
  await ensureEeAsset("PM02");
  await ensureEeAsset("PT01");

  const snap = await db
    .collection(COLLECTIONS.avisos)
    .where("centro", "==", FROM)
    .where("especialidad", "==", "ELECTRICO")
    .get();

  type Row = {
    id: string;
    n_aviso: string;
    ut: string;
    asset_id: string;
    work_order_id: string;
  };
  const rows: Row[] = [];
  for (const d of snap.docs) {
    const ut = String(d.get("ubicacion_tecnica") ?? "");
    if (!isUtPrefijoBoss(ut)) continue;
    rows.push({
      id: d.id,
      n_aviso: String(d.get("n_aviso") ?? d.id),
      ut,
      asset_id: String(d.get("asset_id") ?? ""),
      work_order_id: String(d.get("work_order_id") ?? "").trim(),
    });
  }

  console.log(`\nAvisos ELECTRICO ${FROM} con UT BOSS: ${rows.length}`);
  for (const r of rows.slice(0, 40)) {
    console.log(`  → ${r.n_aviso} | ${r.ut.slice(0, 40)} | asset=${r.asset_id} | ot=${r.work_order_id || "—"}`);
  }
  if (rows.length > 40) console.log(`  … y ${rows.length - 40} más`);

  if (!commit) {
    console.log("\nSimulación solamente. Para aplicar: --commit");
    return;
  }

  const BATCH = 200;
  let nAvisos = 0;
  let nPlanes = 0;
  let nOts = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const batch = db.batch();
    for (const r of slice) {
      batch.update(db.collection(COLLECTIONS.avisos).doc(r.id), {
        centro: TO,
        asset_id: ASSET_TO,
        updated_at: FieldValue.serverTimestamp(),
      });
      nAvisos++;
      const planRef = db.collection(COLLECTIONS.plan_mantenimiento).doc(r.id);
      batch.set(
        planRef,
        {
          centro: TO,
          asset_id: ASSET_TO,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      nPlanes++;
    }
    await batch.commit();
    console.log(`Lote avisos/planes: ${slice.length}`);
  }

  const woIds = [...new Set(rows.map((r) => r.work_order_id).filter(Boolean))];
  for (let i = 0; i < woIds.length; i += 30) {
    const chunk = woIds.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(COLLECTIONS.work_orders).doc(id)));
    const batch = db.batch();
    let n = 0;
    for (const s of snaps) {
      if (!s.exists) continue;
      batch.update(s.ref, {
        centro: TO,
        asset_id: ASSET_TO,
        codigo_activo_snapshot: CODIGO_EE_GRAL,
        updated_at: FieldValue.serverTimestamp(),
      });
      n++;
      nOts++;
    }
    if (n) await batch.commit();
  }

  // OTs ELECTRICO BOSS que quedaron en PF01 sin work_order_id en el aviso
  const woPf = await db
    .collection(COLLECTIONS.work_orders)
    .where("centro", "==", FROM)
    .where("especialidad", "==", "ELECTRICO")
    .get();
  const woExtra = woPf.docs.filter((d) => isUtPrefijoBoss(String(d.get("ubicacion_tecnica") ?? "")));
  if (woExtra.length) {
    for (let i = 0; i < woExtra.length; i += BATCH) {
      const slice = woExtra.slice(i, i + BATCH);
      const batch = db.batch();
      for (const d of slice) {
        batch.update(d.ref, {
          centro: TO,
          asset_id: ASSET_TO,
          codigo_activo_snapshot: CODIGO_EE_GRAL,
          updated_at: FieldValue.serverTimestamp(),
        });
        nOts++;
      }
      await batch.commit();
    }
    console.log(`OTs extra ELECTRICO BOSS en ${FROM} corregidas: ${woExtra.length}`);
  }

  const syncPm02 = await ensurePlansForCentro(TO);
  const syncPf01 = await ensurePlansForCentro(FROM);
  console.log(`\nensurePlansForCentro(${TO}): ${syncPm02.upserts}`);
  console.log(`ensurePlansForCentro(${FROM}): ${syncPf01.upserts}`);
  console.log(`Listo. avisos=${nAvisos} planes≈${nPlanes} ots≈${nOts}`);
  console.log(
    "Nota: chips ya publicados en programa PF01_* con UT BOSS pueden seguir visibles ahí hasta reprogramar/republicar en PM02.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
