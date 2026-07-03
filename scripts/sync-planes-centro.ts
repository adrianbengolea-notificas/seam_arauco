/* eslint-disable no-console */
/**
 * Sincroniza plan_mantenimiento tras cambios de centro en avisos.
 * Uso: npx tsx --env-file=.env.local scripts/sync-planes-centro.ts PM02 PF01
 */
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { ensurePlansForCentro } from "@/lib/plan-mantenimiento/admin";

async function main() {
  const centros = process.argv.slice(2).map((c) => c.trim()).filter(Boolean);
  if (!centros.length) {
    console.error("Indicá uno o más centros (ej. PM02 PF01)");
    process.exit(1);
  }
  for (const c of centros) {
    const r = await ensurePlansForCentro(c);
    console.log(`${c}: ${r.upserts} planes sincronizados`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
