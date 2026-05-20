/**
 * Corrige `ubicacion_tecnica` de un activo (por `codigo_nuevo`) y propaga a avisos,
 * `plan_mantenimiento` y OTs vinculadas. Útil cuando un equipo PF01 figura bajo Yporá
 * (prefijo YPOR-…) pero debe estar en Bossetti (prefijo BOSS-…).
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/corregir-ut-activo-por-codigo.ts --codigo PF01VBO01 --ut BOSS-BOS-ADM-VIVERO-CAMARASE
 *   npx tsx --env-file=.env.local scripts/corregir-ut-activo-por-codigo.ts --codigo PF01VBO01 --ut BOSS-BOS-ADM-VIVERO-CAMARASE --commit
 *
 * Por defecto solo muestra el plan (dry-run). Con --commit escribe en Firestore.
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { extractLocalidadFromUbicacionTecnica } from "@/lib/plan-mantenimiento/localidad";

function parseArgs() {
  const argv = process.argv.slice(2);
  let codigo = "";
  let ut = "";
  let commit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--codigo" || a === "-c") codigo = (argv[++i] ?? "").trim();
    if (a === "--ut" || a === "-u") ut = (argv[++i] ?? "").trim();
    if (a === "--commit") commit = true;
  }
  return { codigo, ut, commit };
}

async function main() {
  const { codigo, ut, commit } = parseArgs();
  if (!codigo || !ut) {
    console.error("Indicá --codigo <SAP> y --ut <ubicacion_tecnica completa>.");
    process.exit(1);
  }

  const db = getAdminDb();
  const assetSnap = await db.collection(COLLECTIONS.assets).where("codigo_nuevo", "==", codigo).limit(2).get();
  if (assetSnap.empty) {
    console.error(`No hay activo con codigo_nuevo=${codigo}`);
    process.exit(1);
  }
  if (assetSnap.size > 1) {
    console.error(`Hay ${assetSnap.size} activos con el mismo codigo_nuevo; revisar manualmente.`);
    process.exit(1);
  }

  const assetDoc = assetSnap.docs[0]!;
  const assetId = assetDoc.id;
  const utAntes = String(assetDoc.get("ubicacion_tecnica") ?? "").trim();
  const localidadNueva = extractLocalidadFromUbicacionTecnica(ut);

  console.log(`Activo: ${assetId} (${codigo})`);
  console.log(`  UT actual:  ${utAntes || "(vacío)"}`);
  console.log(`  UT nueva:   ${ut}`);
  console.log(`  localidad:  ${extractLocalidadFromUbicacionTecnica(utAntes)} → ${localidadNueva}`);

  const avisosSnap = await db.collection(COLLECTIONS.avisos).where("asset_id", "==", assetId).get();
  const otSnap = await db.collection(COLLECTIONS.work_orders).where("asset_id", "==", assetId).get();

  console.log(`\nAvisos a actualizar: ${avisosSnap.size}`);
  for (const d of avisosSnap.docs) {
    const n = String(d.get("n_aviso") ?? d.id);
    const utA = String(d.get("ubicacion_tecnica") ?? "").trim();
    console.log(`  avisos/${d.id} (${n})  ${utA} → ${ut}`);
  }

  console.log(`OTs a actualizar: ${otSnap.size}`);
  for (const d of otSnap.docs) {
    console.log(`  work_orders/${d.id} (${String(d.get("n_ot") ?? "")})`);
  }

  const planIds = avisosSnap.docs.map((d) => d.id);
  let planes = 0;
  for (const pid of planIds) {
    const p = await db.collection(COLLECTIONS.plan_mantenimiento).doc(pid).get();
    if (p.exists) {
      planes += 1;
      console.log(`  plan_mantenimiento/${pid}`);
    }
  }

  if (!commit) {
    console.log("\nDry-run. Para aplicar: agregá --commit al comando.");
    return;
  }

  const batch = db.batch();
  batch.update(assetDoc.ref, {
    ubicacion_tecnica: ut,
    updated_at: FieldValue.serverTimestamp(),
  });

  for (const d of avisosSnap.docs) {
    batch.update(d.ref, {
      ubicacion_tecnica: ut,
      updated_at: FieldValue.serverTimestamp(),
    });
    const planRef = db.collection(COLLECTIONS.plan_mantenimiento).doc(d.id);
    const planExists = (await planRef.get()).exists;
    if (planExists) {
      batch.update(planRef, {
        ubicacion_tecnica: ut,
        localidad: localidadNueva,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
  }

  for (const d of otSnap.docs) {
    batch.update(d.ref, {
      ubicacion_tecnica: ut,
      updated_at: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log("\n✓ Cambios aplicados. Revisá programa_semanal si el aviso ya estaba en una grilla con localidad antigua.");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
