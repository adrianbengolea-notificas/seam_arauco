import type { Timestamp } from "firebase/firestore";
import type { Especialidad, FrecuenciaMantenimiento } from "@/modules/notices/types";

/** M/T/S/A + única para tareas one-shot. */
export type FrecuenciaPlan = "M" | "T" | "S" | "A" | "UNICA";

export type EstadoVencimientoPlan = "ok" | "proximo" | "vencido" | "nunca_ejecutado";

export type NivelRiesgoEquipo = "bajo" | "medio" | "alto" | "critico";

/**
 * Documento `plan_mantenimiento/{avisoFirestoreId}` (id alineado con `avisos`).
 * Campos en snake_case en Firestore.
 */
export type PlanMantenimientoFirestore = {
  id: string;
  numero: string;
  descripcion: string;
  especialidad: Especialidad;
  /** Ciclo M/T/S/A o UNICA (derivado del aviso). */
  frecuencia: FrecuenciaPlan;
  frecuencia_badge?: FrecuenciaMantenimiento;
  ubicacion_tecnica: string;
  denom_ubic_tecnica: string;
  localidad: string;
  centro: string;
  asset_id: string;
  equipo_codigo?: string;
  activo: boolean;
  dias_ciclo: number;
  ultima_ejecucion_fecha?: Timestamp | null;
  ultima_ejecucion_ot_id?: string | null;
  proxima_fecha_objetivo?: Timestamp | null;
  dias_para_vencer?: number | null;
  estado_vencimiento: EstadoVencimientoPlan;
  incluido_en_ot_pendiente?: string | null;
  /** Meses del año en que está programado (1=ene…12=dic). Vacío/null = cualquier mes. */
  meses_programados?: number[] | null;
  /**
   * Semana ISO asignada por planificación (`YYYY-Www`). Opcional; prioriza contra qué semana ejecutar ese ítem preventivo.
   */
  semana_asignada?: string | null;
  prioridad_motor?: 1 | 2 | 3 | null;
  nivel_riesgo_equipo?: NivelRiesgoEquipo | null;
  sugerencia_mantenimiento?: string;
  duracion_estimada_min?: number | null;
  importado_en: Timestamp;
  importado_por: string;
  fuente: string;
  updated_at?: Timestamp;
};

export type PropuestaSemanaStatus =
  | "pendiente_aprobacion"
  | "aprobada"
  | "ejecutando"
  | "cerrada";

export type OtPropuestaStatus = "propuesta" | "aprobada" | "rechazada" | "manual";

export type OtPropuestaKind = "preventivo_plan" | "correctivo_existente";

/** Ítem planificado en `propuestas_semana`. */
export type OtPropuestaFirestore = {
  id: string;
  kind: OtPropuestaKind;
  plan_id?: string;
  /** Si kind === correctivo_existente */
  work_order_id?: string;
  numero: string;
  descripcion: string;
  especialidad: Especialidad;
  localidad: string;
  duracion_estimada_min: number;
  prioridad: 1 | 2 | 3;
  razon_incluida: string;
  tecnico_sugerido_id?: string;
  tecnico_sugerido_nombre?: string;
  status: OtPropuestaStatus;
  dia_semana: string;
  /** Inicio de día programado (timezone local al generar). */
  fecha: Timestamp;
  /** Origen del ítem en la propuesta (solo preventivos; correctivos sin campo).
   *  "planificado" = supervisor asignó esta semana vía semana_asignada.
   *  "urgencia" = motor lo detectó vencido/crítico/próximo sin planificar.
   */
  origen?: "planificado" | "urgencia";
};

export type PropuestaSemanaFirestore = {
  id: string;
  centro: string;
  semana: string;
  generada_en: Timestamp;
  generada_por: "motor_ia" | "manual";
  status: PropuestaSemanaStatus;
  items: OtPropuestaFirestore[];
  advertencias: string[];
  metricas: {
    total_ots_propuestas: number;
    vencidos_incluidos: number;
    vencidos_postergados: number;
    /** Preventivos incluidos con origen === "planificado". */
    planificados_incluidos: number;
    /** Preventivos incluidos con origen === "urgencia". */
    urgencias_incluidas: number;
    carga_por_especialidad: Record<string, number>;
  };
  /** Histórico: quedó true si en el pasado la propuesta se publicó vía flujo automático (hoy deshabilitado en producto). */
  aprobado_automaticamente?: boolean;
  /** Primera apertura de la pantalla de aprobación por un supervisor (no implica aprobar ítems). */
  propuesta_vista_supervisor_at?: Timestamp;
  propuesta_vista_supervisor_uid?: string;
  updated_at?: Timestamp;
};
