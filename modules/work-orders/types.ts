import type { Timestamp } from "firebase/firestore";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";

/** Subtipo operativo para vistas Tareas (además de `tipo_trabajo`). */
export type WorkOrderSubTipo = "preventivo" | "correctivo" | "checklist";

/** Estado simplificado para UI de listados y filtros. */
export type WorkOrderVistaStatus = "PENDIENTE" | "EN_CURSO" | "COMPLETADA" | "CANCELADA";

export type WorkOrderEstado =
  | "BORRADOR"
  | "ABIERTA"
  | "EN_EJECUCION"
  | "PENDIENTE_FIRMA_SOLICITANTE"
  | "LISTA_PARA_CIERRE"
  | "CERRADA"
  | "ANULADA";

export type SignerCapacity = "TECNICO" | "USUARIO_PLANTA" | "SUPERVISOR";

/** Firma digital almacenada (PNG en data URL base64) */
export type FirmaDigital = {
  signer_user_id: string;
  signer_display_name: string;
  /** Rol o capacidad declarada al firmar */
  signer_capacity: SignerCapacity;
  image_data_url_base64: string;
  signed_at: Timestamp;
};

/** OT principal — `work_orders` */
export type WorkOrder = {
  id: string;
  n_ot: string;
  /** Referencia a `avisos/{id}`; vacío si la OT es manual y solo hay número de aviso papel/programa. */
  aviso_id: string;
  asset_id: string;
  codigo_activo_snapshot: string;
  ubicacion_tecnica: string;
  centro: string;
  frecuencia: FrecuenciaMantenimiento;
  especialidad: Especialidad;
  tipo_trabajo: TipoAviso;
  estado: WorkOrderEstado;
  texto_trabajo: string;
  /** Número de aviso visible (p. ej. correlativo de origen). */
  aviso_numero?: string;
  sub_tipo?: WorkOrderSubTipo;
  /** Badge M/T/S/A para preventivos (opcional override; si no, se infiere de `frecuencia`). */
  frecuencia_plan_mtsa?: "M" | "T" | "S" | "A";
  equipo_codigo?: string;
  denom_ubic_tecnica?: string;
  /** Firmas de cierre campo (data URL PNG/JPEG base64). */
  firma_usuario_pad?: string;
  firma_tecnico_pad?: string;
  firma_usuario_pad_nombre?: string;
  firma_tecnico_pad_nombre?: string;
  firmado_at?: Timestamp | null;
  prioridad?: "BAJA" | "MEDIA" | "ALTA" | "CRITICA";
  tecnico_asignado_uid?: string;
  tecnico_asignado_nombre?: string;
  supervisor_uid?: string;
  fecha_inicio_programada?: Timestamp | null;
  fecha_inicio_ejecucion?: Timestamp | null;
  fecha_fin_ejecucion?: Timestamp | null;
  firma_tecnico?: FirmaDigital | null;
  firma_usuario?: FirmaDigital | null;
  cerrada_por_uid?: string;
  motivo_cierre?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type MaterialNormalizacion =
  | "pendiente"
  | "confirmada"
  | "auto_confirmada"
  | "revision_pendiente"
  | "sin_match";

/** Ítem en `work_orders/{id}/materiales_ot` cargado desde campo (schema explícito). */
export type MaterialOT = {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  origen: "ARAUCO" | "EXTERNO";
  observaciones?: string;
  creado_at: Timestamp;
  creado_por: string;
  schema_version: 1;
  catalogo_id?: string;
  codigo_material?: string;
  descripcion_match?: string;
  nombre_normalizado?: string;
  confianza_ia?: number;
  normalizacion?: MaterialNormalizacion;
  /**
   * Copia de datos de la OT padre para consultas collectionGroup sin joins.
   * Opcional en documentos históricos (antes de la denormalización).
   */
  ot_id?: string;
  ot_tipo?: "preventivo" | "correctivo";
  ot_especialidad?: Especialidad;
  ot_numero_aviso?: string;
  ot_descripcion?: string;
  ot_fecha_completada?: Timestamp | null;
  ot_centro?: string;
};

/** Campos de OT a persistir al crear un ítem en `materiales_ot` (Pascal/snake en Firestore). */
export type MaterialOTDenormFromWorkOrder = Pick<
  MaterialOT,
  | "ot_id"
  | "ot_tipo"
  | "ot_especialidad"
  | "ot_numero_aviso"
  | "ot_descripcion"
  | "ot_fecha_completada"
  | "ot_centro"
>;

export function workOrderVistaStatus(wo: WorkOrder): WorkOrderVistaStatus {
  switch (wo.estado) {
    case "BORRADOR":
    case "ABIERTA":
      return "PENDIENTE";
    case "EN_EJECUCION":
    case "PENDIENTE_FIRMA_SOLICITANTE":
    case "LISTA_PARA_CIERRE":
      return "EN_CURSO";
    case "CERRADA":
      return "COMPLETADA";
    case "ANULADA":
      return "CANCELADA";
    default:
      return "PENDIENTE";
  }
}

export function workOrderSubtipo(wo: WorkOrder): WorkOrderSubTipo {
  if (wo.sub_tipo) return wo.sub_tipo;
  if (wo.tipo_trabajo === "CORRECTIVO" || wo.tipo_trabajo === "EMERGENCIA") return "correctivo";
  return "preventivo";
}

/** Para reporting: preventivo | correctivo (checklist cuenta como preventivo). */
export function materialOtTipoReporte(wo: WorkOrder): "preventivo" | "correctivo" {
  const s = workOrderSubtipo(wo);
  return s === "correctivo" ? "correctivo" : "preventivo";
}

export function materialOtDenormFromWorkOrder(wo: WorkOrder, workOrderId: string): MaterialOTDenormFromWorkOrder {
  return {
    ot_id: workOrderId,
    ot_tipo: materialOtTipoReporte(wo),
    ot_especialidad: wo.especialidad,
    ot_numero_aviso: wo.aviso_numero?.trim() || wo.n_ot || "",
    ot_descripcion: wo.texto_trabajo || "",
    ot_fecha_completada: wo.fecha_fin_ejecucion ?? null,
    ot_centro: wo.centro || "",
  };
}

const FREC_BADGE: Partial<Record<FrecuenciaMantenimiento, "M" | "T" | "S" | "A">> = {
  MENSUAL: "M",
  TRIMESTRAL: "T",
  SEMESTRAL: "S",
  ANUAL: "A",
};

export function workOrderFrecuenciaBadge(wo: WorkOrder): "M" | "T" | "S" | "A" | null {
  if (wo.frecuencia_plan_mtsa) return wo.frecuencia_plan_mtsa;
  const b = FREC_BADGE[wo.frecuencia];
  return b ?? null;
}

export type ChecklistItemTipo = "BOOLEANO" | "TEXTO" | "NUMERICO" | "SELECCION";

export type ChecklistItem = {
  id: string;
  orden: number;
  descripcion: string;
  tipo: ChecklistItemTipo;
  opciones?: string[];
  respuesta_boolean?: boolean | null;
  respuesta_texto?: string | null;
  respuesta_numero?: number | null;
  respuesta_seleccion?: string | null;
  obligatorio: boolean;
  cumplido_en?: Timestamp | null;
  cumplido_por_uid?: string | null;
};

export type EvidenciaOT = {
  id: string;
  storage_path: string;
  download_url: string;
  content_type: string;
  tamano_bytes: number;
  descripcion?: string;
  subido_por_uid: string;
  created_at: Timestamp;
};

export type HistorialEventoTipo =
  | "CREADA"
  | "ESTADO_CAMBIO"
  | "ASIGNACION"
  | "MATERIAL"
  | "EVIDENCIA"
  | "FIRMA_TECNICO"
  | "FIRMA_USUARIO"
  | "CIERRE"
  | "INFORME_ACTUALIZADO"
  | "PLANILLA_INICIADA"
  | "PLANILLA_FIRMADA";

export type WorkOrderHistorialEvent = {
  id: string;
  tipo: HistorialEventoTipo;
  payload: Record<string, unknown>;
  actor_uid: string;
  created_at: Timestamp;
};
