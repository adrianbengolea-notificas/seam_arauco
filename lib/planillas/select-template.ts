import type { Especialidad } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import { workOrderSubtipo } from "@/modules/work-orders/types";

const ESPECIALIDAD_VALIDAS = new Set<string>(["AA", "ELECTRICO", "GG", "HG"]);

export type SelectTemplateOptions = {
  /**
   * Especialidad del activo en catálogo (`especialidad_predeterminada`). Solo tiene prioridad
   * cuando la OT tiene especialidad genérica (`GG` o vacía); nunca pisa `ELECTRICO`/`AA`/`HG`.
   */
  especialidadActivo?: Especialidad | null;
};

/**
 * Elige el id de documento en `planilla_templates/{id}` según especialidad y subtipo de la OT.
 */
export function selectTemplate(ot: WorkOrder, opts?: SelectTemplateOptions): string {
  const espPred = opts?.especialidadActivo?.trim();
  // Asset catalog overrides OT only when the OT has the generic "GG" specialty
  // (SAP often defaults to GG). If the OT already says ELECTRICO/AA/HG, trust it.
  const otEspIsGeneric = !ot.especialidad || ot.especialidad === "GG";
  const esp: Especialidad =
    espPred && ESPECIALIDAD_VALIDAS.has(espPred) && otEspIsGeneric
      ? (espPred as Especialidad)
      : ot.especialidad;

  if (esp === "GG") return "GG";

  const sub = workOrderSubtipo(ot);
  if (sub === "correctivo") return "CORRECTIVO";

  if (esp === "ELECTRICO" && sub === "preventivo") return "ELEC";
  if (esp === "AA" && sub === "preventivo") return "AA";

  return "CORRECTIVO";
}
