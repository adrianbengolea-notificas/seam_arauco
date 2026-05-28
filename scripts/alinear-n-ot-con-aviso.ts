/**
 * Alinea `work_orders.n_ot` con el número de aviso SAP (`avisos.n_aviso` / `aviso_numero`).
 * No modifica OTs provisorias sin aviso ni órdenes cuyo aviso ya no existe.
 *
 * Uso: npx tsx scripts/alinear-n-ot-con-aviso.ts [--dry-run] [--centro=PI01]
 */
import "dotenv/config";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { numeroAvisoVisible, nOtDesdeNumeroAviso } from "@/modules/work-orders/n-ot-from-aviso";
import type { WorkOrder } from "@/modules/work-orders/types";
import type { Aviso } from "@/modules/notices/types";

const dryRun = process.argv.includes("--dry-run");
const centroArg = process.argv.find((a) => a.startsWith("--centro="))?.split("=")[1]?.trim();

async function main() {
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.work_orders);
  const snap = centroArg
    ? await col.where("centro", "==", centroArg).get()
    : await col.get();
  let actualizadas = 0;
  let omitidas = 0;
  let errores = 0;

  for (const doc of snap.docs) {
    const wo = { id: doc.id, ...(doc.data() as Omit<WorkOrder, "id">) };
    if (wo.provisorio_sin_aviso_sap === true) {
      omitidas += 1;
      continue;
    }

    const avisoId = wo.aviso_id?.trim();
    let numeroAviso = numeroAvisoVisible(wo.aviso_numero);

    if (!numeroAviso && avisoId) {
      const avSnap = await db.collection("avisos").doc(avisoId).get();
      if (avSnap.exists) {
        numeroAviso = numeroAvisoVisible((avSnap.data() as Aviso).n_aviso);
      }
    }

    if (!numeroAviso) {
      omitidas += 1;
      continue;
    }

    let nOtNuevo: string;
    try {
      nOtNuevo = nOtDesdeNumeroAviso(numeroAviso);
    } catch {
      errores += 1;
      continue;
    }

    const nOtActual = String(wo.n_ot ?? "").trim();
    const avisoNumActual = numeroAvisoVisible(wo.aviso_numero);
    const patch: Record<string, string> = {};
    if (nOtActual !== nOtNuevo) patch.n_ot = nOtNuevo;
    if (avisoNumActual !== nOtNuevo) patch.aviso_numero = nOtNuevo;

    if (Object.keys(patch).length === 0) {
      omitidas += 1;
      continue;
    }

    console.log(
      `${dryRun ? "[dry-run] " : ""}${wo.id} centro=${wo.centro} n_ot ${nOtActual || "—"} → ${nOtNuevo}`,
    );

    if (!dryRun) {
      await doc.ref.update(patch);
    }
    actualizadas += 1;
  }

  console.log(
    `\nListo. Actualizadas: ${actualizadas}, sin cambios/omitidas: ${omitidas}, errores: ${errores}${dryRun ? " (simulación)" : ""}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
