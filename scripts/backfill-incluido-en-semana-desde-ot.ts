/**
 * Rellena `incluido_en_semana` en `avisos` que ya tienen `work_order_id`, usando la misma lógica que
 * `createWorkOrderFromAviso`: prioridad a `fecha_inicio_programada` de la OT; si no hay fecha válida en la OT,
 * conserva `incluido_en_semana` del aviso si ya es ISO válido; si no, usa la semana ISO actual.
 *
 * Simulación:
 *   npx tsx scripts/backfill-incluido-en-semana-desde-ot.ts
 * Una planta:
 *   npx tsx scripts/backfill-incluido-en-semana-desde-ot.ts --centro PM02
 * Aplicar:
 *   npx tsx scripts/backfill-incluido-en-semana-desde-ot.ts --commit
 *   npx tsx scripts/backfill-incluido-en-semana-desde-ot.ts --centro PM02 --commit
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";

const BATCH_MAX = 400;

function parseArgs(): { centro: string | null; commit: boolean; limiteMuestra: number } {
  const argv = process.argv.slice(2);
  let centro: string | null = null;
  let commit = false;
  let limiteMuestra = 15;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--centro" && argv[i + 1]) {
      centro = argv[i + 1]!.trim();
      i++;
    } else if (argv[i] === "--commit") {
      commit = true;
    } else if (argv[i] === "--muestra" && argv[i + 1]) {
      limiteMuestra = Math.max(0, parseInt(argv[i + 1]!, 10) || 0);
      i++;
    }
  }
  return { centro: centro?.length ? centro : null, commit, limiteMuestra };
}

function isoValido(s: string): boolean {
  return /^\d{4}-W\d{2}$/.test(s.trim());
}

/** Misma regla que en `createWorkOrderFromAviso` al vincular OT al aviso. */
function semanaDesdeOtYAviso(
  woData: Record<string, unknown>,
  incluidoActual: string | null,
): string | undefined {
  const fp = woData.fecha_inicio_programada as { toDate?: () => Date } | null | undefined;
  let semanaIsoParaAviso: string | undefined;
  if (fp != null && typeof fp.toDate === "function") {
    const d = fp.toDate();
    if (!Number.isNaN(d.getTime())) {
      semanaIsoParaAviso = getIsoWeekId(d);
    }
  }
  if (semanaIsoParaAviso == null) {
    const prevIso = (incluidoActual ?? "").trim();
    if (!isoValido(prevIso)) {
      semanaIsoParaAviso = getIsoWeekId(new Date());
    }
  }
  return semanaIsoParaAviso;
}

async function main() {
  const { centro, commit, limiteMuestra } = parseArgs();
  const db = getAdminDb();
  const colAv = db.collection(COLLECTIONS.avisos);
  const colWo = db.collection(COLLECTIONS.work_orders);

  const centros = centro ? [centro] : [...KNOWN_CENTROS];

  console.log(
    commit
      ? "MODO COMMIT — se actualizará incluido_en_semana en avisos con OT\n"
      : "Simulación (sin --commit no se escribe nada)\n",
  );

  type Par = {
    avisoId: string;
    woId: string;
    incluidoAntes: string | null;
  };
  const pares: Par[] = [];

  for (const c of centros) {
    const snap = await colAv.where("centro", "==", c).get();
    for (const d of snap.docs) {
      const dat = d.data() as Record<string, unknown>;
      const woId = typeof dat.work_order_id === "string" ? dat.work_order_id.trim() : "";
      if (!woId) continue;
      const inc =
        typeof dat.incluido_en_semana === "string" ? dat.incluido_en_semana.trim() || null : null;
      pares.push({ avisoId: d.id, woId, incluidoAntes: inc });
    }
  }

  console.log(`Avisos con work_order_id (alcance): ${pares.length}`);
  if (!pares.length) {
    console.log("Nada para hacer.");
    return;
  }

  type Cambio = { avisoId: string; woId: string; antes: string | null; despues: string };
  const cambios: Cambio[] = [];
  let sinOt = 0;

  const chunk = 200;
  for (let i = 0; i < pares.length; i += chunk) {
    const slice = pares.slice(i, i + chunk);
    const woSnaps = await db.getAll(...slice.map((p) => colWo.doc(p.woId)));
    const woPorId = new Map(woSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as Record<string, unknown>]));

    for (const p of slice) {
      const woData = woPorId.get(p.woId);
      if (!woData) {
        sinOt += 1;
        continue;
      }
      const despues = semanaDesdeOtYAviso(woData, p.incluidoAntes);
      if (despues == null) continue;
      const antesNorm = (p.incluidoAntes ?? "").trim();
      if (antesNorm === despues) continue;
      cambios.push({ avisoId: p.avisoId, woId: p.woId, antes: p.incluidoAntes, despues });
    }
  }

  if (sinOt) {
    console.log(`Advertencia: ${sinOt} avisos referencian un work_order_id inexistente (se omiten).`);
  }
  console.log(`Avisos a actualizar (incluido_en_semana distinto al calculado): ${cambios.length}`);

  if (limiteMuestra > 0 && cambios.length) {
    console.log("\nMuestra de cambios:");
    for (const row of cambios.slice(0, limiteMuestra)) {
      console.log(
        `  aviso ${row.avisoId} (OT ${row.woId}): incluido_en_semana ${row.antes ?? "—"} → ${row.despues}`,
      );
    }
    if (cambios.length > limiteMuestra) {
      console.log(`  … y ${cambios.length - limiteMuestra} más`);
    }
  }

  if (!commit) {
    console.log("\nPara aplicar: npx tsx scripts/backfill-incluido-en-semana-desde-ot.ts --commit");
    return;
  }

  let batch = db.batch();
  let n = 0;
  let batches = 0;

  async function flush() {
    if (n === 0) return;
    await batch.commit();
    batches += 1;
    batch = db.batch();
    n = 0;
  }

  for (const row of cambios) {
    batch.update(colAv.doc(row.avisoId), {
      incluido_en_semana: row.despues,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
    n += 1;
    if (n >= BATCH_MAX) await flush();
  }
  await flush();

  console.log(`\nListo: ${cambios.length} avisos actualizados en ${batches} batch(es).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
