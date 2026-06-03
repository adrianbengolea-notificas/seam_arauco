import type { Especialidad } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import { workOrderSubtipo } from "@/modules/work-orders/types";

const ESPECIALIDAD_VALIDAS = new Set<string>(["AA", "ELECTRICO", "GG", "HG"]);

function especialidadValida(raw: string | null | undefined): Especialidad | null {
  const t = raw?.trim();
  return t && ESPECIALIDAD_VALIDAS.has(t) ? (t as Especialidad) : null;
}

function esEspecialidadGenerica(esp: Especialidad | null | undefined): boolean {
  return !esp || esp === "GG";
}

export type SelectTemplateOptions = {
  /**
   * Especialidad del aviso en `avisos/{id}.especialidad`. Corrige la OT cuando esta es genérica
   * (`GG` o vacía), p. ej. aviso AA sobre OT GG. No pisa una especialidad concreta ya definida en la OT.
   */
  especialidadAviso?: Especialidad | null;
  /**
   * Especialidad del activo en catálogo (`especialidad_predeterminada`). Misma regla que el aviso:
   * solo corrige cuando la OT (y el aviso) siguen siendo genéricos.
   */
  especialidadActivo?: Especialidad | null;
};

/** Combina OT, aviso y activo: gana la primera especialidad concreta (AA, ELECTRICO, HG); GG al final. */
export function resolveEspecialidadParaPlantilla(
  ot: Pick<WorkOrder, "especialidad">,
  opts?: SelectTemplateOptions,
): Especialidad {
  const fuentes: (Especialidad | null | undefined)[] = [
    ot.especialidad,
    opts?.especialidadAviso,
    opts?.especialidadActivo,
  ];

  for (const raw of fuentes) {
    const esp = especialidadValida(raw);
    if (esp && !esEspecialidadGenerica(esp)) return esp;
  }
  for (const raw of fuentes) {
    const esp = especialidadValida(raw);
    if (esp) return esp;
  }
  return ot.especialidad;
}

/**
 * Elige el id de documento en `planilla_templates/{id}` según especialidad resuelta y subtipo de la OT.
 */
export function selectTemplate(ot: WorkOrder, opts?: SelectTemplateOptions): string {
  const esp = resolveEspecialidadParaPlantilla(ot, opts);

  if (esp === "GG") return "GG";

  const sub = workOrderSubtipo(ot);
  if (sub === "correctivo") return "CORRECTIVO";

  if (esp === "ELECTRICO" && sub === "preventivo") return "ELEC";
  if (esp === "AA" && sub === "preventivo") return "AA";

  return "CORRECTIVO";
}
