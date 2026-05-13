import type { Timestamp } from "firebase/firestore";
import type { Especialidad, FrecuenciaMantenimiento, TipoAviso } from "@/modules/notices/types";

/** Subtipo operativo para vistas de órdenes de trabajo (además de `tipo_trabajo`). */
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

/** Firma digital: preferir Storage (`storage_path` + `download_url`); base64 solo legado. */
export type FirmaDigital = {
  signer_user_id: string;
  signer_display_name: string;
  /** Rol o capacidad declarada al firmar */
  signer_capacity: SignerCapacity;
  signed_at: Timestamp;
  /** Legado: data URL completa; no escribir en altas nuevas. */
  image_data_url_base64?: string;
  storage_path?: string;
  download_url?: string;
};

/** URL para mostrar o exportar (Storage o data URL histórica). */
export function firmaDigitalDisplaySrc(f: FirmaDigital | null | undefined): string | null {
  if (!f) return null;
  const u = f.download_url?.trim();
  if (u) return u;
  const legacy = f.image_data_url_base64?.trim();
  return legacy || null;
}

export function firmaPadTecnicoDisplaySrc(wo: WorkOrder): string | null {
  const u = wo.firma_tecnico_pad_download_url?.trim();
  if (u) return u;
  const legacy = wo.firma_tecnico_pad?.trim();
  return legacy || null;
}

export function firmaPadUsuarioDisplaySrc(wo: WorkOrder): string | null {
  const u = wo.firma_usuario_pad_download_url?.trim();
  if (u) return u;
  const legacy = wo.firma_usuario_pad?.trim();
  return legacy || null;
}

/** OT principal — colección `work_orders` */
export type WorkOrder = {
  id: string;
  n_ot: string;
  /** Opcional: misma clave que `avisos`/`plan_mantenimiento` si la orden sale del plan maestro. */
  plan_id?: string;
  /** Referencia a `avisos/{id}`; vacío si la orden es manual y solo hay número de aviso papel/programa. */
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
  /** Alineado con `avisos.clave_mantenimiento` (mismo mantenimiento aunque cambie el n° SAP). */
  clave_mantenimiento?: string;
  /** SAP emitió un aviso nuevo para el mismo mantenimiento: cerrar esta orden antes de operar el nuevo número. */
  alerta_cerrar_para_aviso_sap?: { aviso_id: string; n_aviso: string };
  /**
   * Correctivo: equipo/ubicación descrita por el técnico porque no existe en el catálogo de activos (`asset_id` vacío).
   * En preventivos no se usa — siempre debe haber activo maestro vinculado.
   */
  activo_fuera_catalogo?: boolean;
  /**
   * Correctivo creado sin vínculo a aviso en Firestore ni número de aviso informado (trabajo provisorio fuera de SAP).
   */
  provisorio_sin_aviso_sap?: boolean;
  sub_tipo?: WorkOrderSubTipo;
  /** Badge M/T/S/A para preventivos (opcional override; si no, se infiere de `frecuencia`). */
  frecuencia_plan_mtsa?: "M" | "T" | "S" | "A";
  equipo_codigo?: string;
  denom_ubic_tecnica?: string;
  /**
   * Firmas pad: legado en data URL base64; nuevas altas usan *_download_url y dejan estos vacíos o ausentes.
   */
  firma_usuario_pad?: string;
  firma_tecnico_pad?: string;
  firma_usuario_pad_nombre?: string;
  firma_tecnico_pad_nombre?: string;
  firma_usuario_pad_storage_path?: string;
  firma_usuario_pad_download_url?: string;
  firma_tecnico_pad_storage_path?: string;
  firma_tecnico_pad_download_url?: string;
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
  /** Quién cerró la OT (nombre legible; superadmin en cierre histórico). */
  cerrada_por_nombre?: string;
  /** Soft-delete (solo superadmin vía servidor). Oculta la OT en listados y lectura normal. */
  archivada?: boolean;
  archivada_at?: Timestamp | null;
  archivada_por_uid?: string;
  motivo_cierre?: string;
  /** `empalme_documentado` = cierre histórico fuera del flujo normal (planilla papel previa al CMMS). */
  cierre_modo?: "normal" | "empalme_documentado";
  cierre_motivo?: string;
  cierre_evidencia_url?: string;
  /** Técnico en planta (texto libre; no requiere usuario del sistema). */
  cierre_tecnico_nombre?: string;
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

/** Campos de la OT a persistir al crear un ítem en `materiales_ot` (Pascal/snake en Firestore). */
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
  | "CIERRE_HISTORICO"
  | "INFORME_ACTUALIZADO"
  | "PLANILLA_INICIADA"
  | "PLANILLA_FIRMADA"
  | "COMENTARIO"
  | "MATERIAL_NORMALIZADO_IA"
  | "ARCHIVADA";

export type WorkOrderHistorialEvent = {
  id: string;
  tipo: HistorialEventoTipo;
  payload: Record<string, unknown>;
  actor_uid: string;
  created_at: Timestamp;
};
