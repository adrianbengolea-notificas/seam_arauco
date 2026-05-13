/* eslint-disable no-console */
/**
 * Borra la planilla_respuesta de una OT específica (por número de aviso SAP),
 * permitiendo que al "Iniciar planilla" se cree una nueva con el template correcto.
 *
 * Uso:
 *   npx tsx scripts/borrar-planilla-respuesta.ts <aviso>
 *   npx tsx scripts/borrar-planilla-respuesta.ts 11284160
 *   npx tsx --env-file=.env.local scripts/borrar-planilla-respuesta.ts 11284160
 *
 * Pide confirmación antes de borrar. No borra la OT, solo la subcolección planilla_respuestas.
 */

import { config as loadEnv } from "dotenv";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import { avisoDocId } from "@/lib/import/aviso-numero-canonical";
import * as readline from "readline";

loadEnv();
loadEnv({ path: ".env.local", override: true });

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(pregunta, (resp) => {
      rl.close();
      resolve(resp.trim().toLowerCase() === "si");
    });
  });
}

async function main() {
  const avisoArg = process.argv[2]?.trim();
  if (!avisoArg) {
    console.error("Uso: npx tsx scripts/borrar-planilla-respuesta.ts <numero_aviso>");
    process.exit(1);
  }

  const db = getAdminDb();
  const workOrderId = avisoDocId(avisoArg);
  const woRef = db.collection(COLLECTIONS.work_orders).doc(workOrderId);

  const woSnap = await woRef.get();
  if (!woSnap.exists) {
    console.error(`OT no encontrada: work_orders/${workOrderId}`);
    process.exit(1);
  }

  const wo = woSnap.data() as Record<string, unknown>;
  console.log(`\nOT encontrada: work_orders/${workOrderId}`);
  console.log(`  n_ot:       ${wo.n_ot ?? "(sin n_ot)"}`);
  console.log(`  aviso:      ${wo.aviso_numero ?? avisoArg}`);
  console.log(`  texto:      ${wo.texto_trabajo ?? wo.texto_corto ?? "(sin texto)"}`);
  console.log(`  especialidad: ${wo.especialidad}`);
  console.log(`  asset_id:   ${wo.asset_id ?? "(sin activo)"}`);

  const planillasSnap = await woRef.collection(WORK_ORDER_SUB.planilla_respuestas).get();
  if (planillasSnap.empty) {
    console.log("\nNo hay planilla_respuestas para esta OT. Nada que borrar.");
    process.exit(0);
  }

  console.log(`\nPlanillas encontradas (${planillasSnap.size}):`);
  for (const doc of planillasSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    console.log(`  - ${doc.id}  templateId=${d.templateId}  status=${d.status}`);
  }

  const ok = await confirmar("\n¿Borrar todas las planilla_respuestas de esta OT? (si/no): ");
  if (!ok) {
    console.log("Cancelado.");
    process.exit(0);
  }

  const batch = db.batch();
  for (const doc of planillasSnap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();

  console.log(`\n✓ Borradas ${planillasSnap.size} planilla_respuesta(s) de work_orders/${workOrderId}.`);
  console.log('  Ahora podes usar "Iniciar planilla" en la OT para crear una nueva con el template correcto.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
