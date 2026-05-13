import type { Especialidad } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import { workOrderSubtipo } from "@/modules/work-orders/types";

const ESPECIALIDAD_VALIDAS = new Set<string>(["AA", "ELECTRICO", "GG", "HG"]);

export type SelectTemplateOptions = {
  /**
   * Especialidad del aviso en `avisos/{id}.especialidad`. Si está definida y es válida, manda
   * para elegir plantilla (p. ej. AA vs GG) aunque la OT o el activo difieran.
   */
  especialidadAviso?: Especialidad | null;
  /**
   * Especialidad del activo en catálogo (`especialidad_predeterminada`). Solo se usa si no hay
   * `especialidadAviso` válida; y solo corrige cuando la OT tiene especialidad genérica (`GG` o vacía).
   */
  especialidadActivo?: Especialidad | null;
};

/**
 * Elige el id de documento en `planilla_templates/{id}` según especialidad (prioriza aviso si se
 * informa) y subtipo de la OT.
 */
export function selectTemplate(ot: WorkOrder, opts?: SelectTemplateOptions): string {
  const avisoEsp = opts?.especialidadAviso?.trim();
  const espFromAviso =
    avisoEsp && ESPECIALIDAD_VALIDAS.has(avisoEsp) ? (avisoEsp as Especialidad) : null;

  let esp: Especialidad;
  if (espFromAviso) {
    esp = espFromAviso;
  } else {
    const espPred = opts?.especialidadActivo?.trim();
    const otEspIsGeneric = !ot.especialidad || ot.especialidad === "GG";
    esp =
      espPred && ESPECIALIDAD_VALIDAS.has(espPred) && otEspIsGeneric
        ? (espPred as Especialidad)
        : ot.especialidad;
  }

  if (esp === "GG") return "GG";

  const sub = workOrderSubtipo(ot);
  if (sub === "correctivo") return "CORRECTIVO";

  if (esp === "ELECTRICO" && sub === "preventivo") return "ELEC";
  if (esp === "AA" && sub === "preventivo") return "AA";

  return "CORRECTIVO";
}
