/**
 * Limpia `antecesor_orden_abierta` en avisos SAP nuevos cuando la OT antecesora
 * ya está cerrada/anulada pero el vínculo quedó stale (cierre fuera del flujo normal).
 *
 * Uso:
 *   npx tsx scripts/reconciliar-antecesores-obsoletos.ts --aviso 11375260
 *   npx tsx scripts/reconciliar-antecesores-obsoletos.ts --wo zfnklTDnjcFAl7xNigFB
 *   npx tsx scripts/reconciliar-antecesores-obsoletos.ts --centro PC01
 *   npx tsx scripts/reconciliar-antecesores-obsoletos.ts --centro PC01 --dry-run
 */

/* eslint-disable no-console */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { reconcileAntecesoresObsoletosAdmin } from "@/lib/mantenimiento/antecesor-orden-admin";

function parseArgs(): {
  centro?: string;
  workOrderId?: string;
  avisoId?: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let centro: string | undefined;
  let workOrderId: string | undefined;
  let avisoId: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--centro" && args[i + 1]) centro = args[++i]!.trim();
    else if (a === "--wo" && args[i + 1]) workOrderId = args[++i]!.trim();
    else if (a === "--aviso" && args[i + 1]) avisoId = args[++i]!.trim();
  }
  return { centro, workOrderId, avisoId, dryRun };
}

async function main() {
  const opts = parseArgs();
  if (!opts.centro && !opts.workOrderId && !opts.avisoId) {
    console.error("Indicá --aviso, --wo o --centro");
    process.exit(1);
  }
  console.log("Opciones:", opts);
  const res = await reconcileAntecesoresObsoletosAdmin(opts);
  console.log(
    opts.dryRun
      ? `[dry-run] Órdenes revisadas: ${res.ordenesProcesadas}, avisos que se limpiarían: ${res.avisosAfectados}`
      : `Listo. Órdenes procesadas: ${res.ordenesProcesadas}, avisos afectados: ${res.avisosAfectados}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
