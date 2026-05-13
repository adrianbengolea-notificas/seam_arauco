/* eslint-disable no-console */
/**
 * Busca OTs con especialidad=ELECTRICO que tienen planilla_respuesta guardada con
 * templateId="AA" (template incorrecto) y las borra para que se puedan reiniciar
 * con el template correcto (ELEC).
 *
 * Uso:
 *   npx tsx scripts/fix-planillas-ee-template-incorrecto.ts          <- solo lista
 *   npx tsx scripts/fix-planillas-ee-template-incorrecto.ts --borrar  <- borra con confirmacion
 */

import { config as loadEnv } from "dotenv";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS, WORK_ORDER_SUB } from "@/lib/firestore/collections";
import * as readline from "readline";

loadEnv();
loadEnv({ path: ".env.local", override: true });

const BORRAR = process.argv.includes("--borrar");

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
  const db = getAdminDb();

  console.log("Buscando OTs ELECTRICO con planilla templateId=AA...\n");

  const woSnap = await db
    .collection(COLLECTIONS.work_orders)
    .where("especialidad", "==", "ELECTRICO")
    .get();

  console.log(`OTs ELECTRICO encontradas: ${woSnap.size}`);

  type Afectado = { woId: string; respuestaId: string; aviso: string; texto: string; status: string };
  const afectados: Afectado[] = [];

  for (const wo of woSnap.docs) {
    const planillasSnap = await wo.ref.collection(WORK_ORDER_SUB.planilla_respuestas)
      .where("templateId", "==", "AA")
      .get();
    if (planillasSnap.empty) continue;
    const data = wo.data() as Record<string, unknown>;
    for (const p of planillasSnap.docs) {
      const pd = p.data() as Record<string, unknown>;
      afectados.push({
        woId: wo.id,
        respuestaId: p.id,
        aviso: String(data.aviso_numero ?? data.n_ot ?? wo.id),
        texto: String(data.texto_trabajo ?? data.texto_corto ?? "").slice(0, 60),
        status: String(pd.status ?? "?"),
      });
    }
  }

  if (afectados.length === 0) {
    console.log("\nNo hay planillas incorrectas. Todo OK.");
    return;
  }

  console.log(`\nPlanillas AA en OTs ELECTRICO (${afectados.length}):\n`);
  for (const a of afectados) {
    console.log(`  Aviso ${a.aviso}  [${a.status}]  ${a.texto}`);
    console.log(`    work_orders/${a.woId}/planilla_respuestas/${a.respuestaId}`);
  }

  if (!BORRAR) {
    console.log("\nEjecuta con --borrar para eliminarlas:");
    console.log("  npx tsx scripts/fix-planillas-ee-template-incorrecto.ts --borrar");
    return;
  }

  const firmadas = afectados.filter((a) => a.status === "firmada");
  if (firmadas.length > 0) {
    console.log(`\nATENCION: ${firmadas.length} planilla(s) ya estan FIRMADAS:`);
    for (const f of firmadas) console.log(`  Aviso ${f.aviso} — ${f.texto}`);
    console.log("Estas NO se van a borrar (ya tienen firma registrada).");
  }

  const borrables = afectados.filter((a) => a.status !== "firmada");
  if (borrables.length === 0) {
    console.log("\nNada que borrar (todas firmadas).");
    return;
  }

  const ok = await confirmar(
    `\nBorrar ${borrables.length} planilla(s) no firmadas? (si/no): `,
  );
  if (!ok) {
    console.log("Cancelado.");
    return;
  }

  const batch = db.batch();
  for (const a of borrables) {
    batch.delete(
      db.collection(COLLECTIONS.work_orders)
        .doc(a.woId)
        .collection(WORK_ORDER_SUB.planilla_respuestas)
        .doc(a.respuestaId),
    );
  }
  await batch.commit();

  console.log(`\n✓ Borradas ${borrables.length} planilla(s).`);
  console.log('  Ahora podes usar "Iniciar planilla" en cada OT para crear una con template ELEC.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
