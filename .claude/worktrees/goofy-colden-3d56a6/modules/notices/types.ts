import type { Timestamp } from "firebase/firestore";

export type FrecuenciaMantenimiento =
  | "UNICA"
  | "DIARIA"
  | "SEMANAL"
  | "QUINCENAL"
  | "MENSUAL"
  | "TRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL";

export type TipoAviso = "PREVENTIVO" | "CORRECTIVO" | "PREDICTIVO" | "EMERGENCIA";

export type Especialidad = "AA" | "ELECTRICO" | "GG" | "HG";

export type EstadoAviso = "ABIERTO" | "OT_GENERADA" | "CERRADO" | "ANULADO";

/**
 * Aviso (solicitud / notificación de trabajo) — `avisos`
 * 1 Aviso = 1 Activo + 1 Frecuencia + 1 Ubicación (en planta)
 */
export type Aviso = {
  id: string;
  n_aviso: string;
  asset_id: string;
  ubicacion_tecnica: string;
  centro: string;
  frecuencia: FrecuenciaMantenimiento;
  tipo: TipoAviso;
  especialidad: Especialidad;
  texto_corto: string;
  texto_largo?: string;
  solicitante_nombre?: string;
  solicitante_user_id?: string;
  estado: EstadoAviso;
  work_order_id?: string;
  prioridad?: "BAJA" | "MEDIA" | "ALTA" | "CRITICA";
  /** Bandera de urgencia en programa / grilla (p. ej. correctivo urgente). */
  urgente?: boolean;
  fecha_programada?: Timestamp | null;
  /** Badge M/T/S/A desde planilla de preventivos (opcional). */
  frecuencia_plan_mtsa?: "M" | "T" | "S" | "A";
  /** Estado legible en planillas tipo MENSUALES (p. ej. PDTE). */
  estado_planilla?: string;

  /** Trazabilidad de ejecución y vencimientos (M/T/S/A). */
  ultima_ejecucion_ot_id?: string;
  ultima_ejecucion_fecha?: Timestamp;
  proximo_vencimiento?: Timestamp;
  /** Diferencia en días respecto a hoy (actualizado en cierre/cron). */
  dias_para_vencimiento?: number;
  estado_vencimiento?: "ok" | "proximo" | "vencido";
  /** ISO semana en la que el aviso fue incluido en el programa publicado (evitar duplicados). */
  incluido_en_semana?: string;

  created_at: Timestamp;
  updated_at: Timestamp;
};

export type EstadoVencimientoAviso = NonNullable<Aviso["estado_vencimiento"]>;

export type AvisoCreateInput = Omit<Aviso, "id" | "created_at" | "updated_at" | "estado"> & {
  estado?: EstadoAviso;
};
