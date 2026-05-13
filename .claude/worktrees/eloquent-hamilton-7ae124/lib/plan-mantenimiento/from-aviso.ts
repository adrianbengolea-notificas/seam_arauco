import type {
  EstadoVencimientoPlan,
  FrecuenciaPlan,
  PlanMantenimientoFirestore,
} from "@/lib/firestore/plan-mantenimiento-types";
import { diasPorMtsa, inferMtsaDesdeAviso, type MtsaBadge } from "@/lib/vencimientos";
import type { Aviso } from "@/modules/notices/types";
import { extractLocalidadFromUbicacionTecnica } from "@/lib/plan-mantenimiento/localidad";
import { FieldValue } from "firebase-admin/firestore";

function frecuenciaPlanDesdeMtsa(m: MtsaBadge): FrecuenciaPlan {
  return m;
}

function estadoPlanDesdeAviso(a: Aviso): EstadoVencimientoPlan {
  if (!a.ultima_ejecucion_fecha) return "nunca_ejecutado";
  if (a.estado_vencimiento === "vencido") return "vencido";
  if (a.estado_vencimiento === "proximo") return "proximo";
  if (a.estado_vencimiento === "ok") return "ok";
  return "nunca_ejecutado";
}

/** Crea el objeto inicial para `plan_mantenimiento/{avisoId}`. */
export function planMantenimientoSeedFromAviso(
  a: Aviso,
  importadoPor: string,
): Record<string, unknown> {
  const mtsa = inferMtsaDesdeAviso(a);
  const dias = diasPorMtsa(mtsa);
  const freqPlan = frecuenciaPlanDesdeMtsa(mtsa);
  const base: Record<string, unknown> = {
    id: a.id,
    numero: a.n_aviso,
    descripcion: a.texto_corto ?? a.n_aviso,
    especialidad: a.especialidad,
    frecuencia: freqPlan,
    frecuencia_badge: a.frecuencia,
    ubicacion_tecnica: a.ubicacion_tecnica,
    denom_ubic_tecnica: (a.texto_largo ?? "").slice(0, 2000),
    localidad: extractLocalidadFromUbicacionTecnica(a.ubicacion_tecnica),
    centro: a.centro,
    asset_id: a.asset_id,
    activo: a.estado !== "ANULADO",
    dias_ciclo: dias,
    ultima_ejecucion_fecha: a.ultima_ejecucion_fecha ?? null,
    ultima_ejecucion_ot_id: a.ultima_ejecucion_ot_id ?? null,
    proxima_fecha_objetivo: a.proximo_vencimiento ?? null,
    dias_para_vencer: a.dias_para_vencimiento ?? null,
    estado_vencimiento: estadoPlanDesdeAviso(a),
    incluido_en_ot_pendiente: null,
    prioridad_motor: null,
    nivel_riesgo_equipo: null,
    duracion_estimada_min: null,
    importado_en: FieldValue.serverTimestamp(),
    importado_por: importadoPor,
    fuente: "avisos",
    updated_at: FieldValue.serverTimestamp(),
  };
  return base;
}

/** Campos de vencimiento que se copian desde `avisos` sin tocar reservas del motor. */
export function planVencimientoPatchFromAviso(a: Aviso): Record<string, unknown> {
  return {
    ultima_ejecucion_fecha: a.ultima_ejecucion_fecha ?? null,
    ultima_ejecucion_ot_id: a.ultima_ejecucion_ot_id ?? null,
    proxima_fecha_objetivo: a.proximo_vencimiento ?? null,
    dias_para_vencer: a.dias_para_vencimiento ?? null,
    estado_vencimiento: estadoPlanDesdeAviso(a),
    descripcion: a.texto_corto ?? a.n_aviso,
    ubicacion_tecnica: a.ubicacion_tecnica,
    denom_ubic_tecnica: (a.texto_largo ?? "").slice(0, 2000),
    localidad: extractLocalidadFromUbicacionTecnica(a.ubicacion_tecnica),
    especialidad: a.especialidad,
    activo: a.estado !== "ANULADO",
    updated_at: FieldValue.serverTimestamp(),
  };
}

export type PlanMantenimiento = PlanMantenimientoFirestore;
