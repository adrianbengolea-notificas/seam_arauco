import type { WorkOrder } from "@/modules/work-orders/types";
import { workOrderSubtipo } from "@/modules/work-orders/types";

/**
 * Elige el id de documento en `planilla_templates/{id}` según especialidad y subtipo de la OT.
 */
export function selectTemplate(ot: WorkOrder): string {
  if (ot.especialidad === "GG") return "GG";

  const sub = workOrderSubtipo(ot);
  if (sub === "correctivo") return "CORRECTIVO";

  if (ot.especialidad === "ELECTRICO" && sub === "preventivo") return "ELEC";
  if (ot.especialidad === "AA" && sub === "preventivo") return "AA";

  return "CORRECTIVO";
}
