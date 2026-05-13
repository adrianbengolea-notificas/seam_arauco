import type { Especialidad } from "@/modules/notices/types";

/** Flags de módulos controlables por centro (Firestore + UI). */
export type CentroModulosConfig = {
  materiales: boolean;
  activos: boolean;
  ia: boolean;
};

/**
 * Documento `centros/{centroId}`.
 * Campos opcionales: si falta el documento se usan defaults en `mergeCentroConfig`.
 */
/** Parámetros del motor de propuestas (opcional en `centros/{id}`). */
export type ConfigMotorFirestore = {
  horas_por_dia: number;
  dias_habiles: string[];
  dias_antes_alerta_proximo: number;
  max_ots_por_dia_aire: number;
  max_ots_por_dia_electrico: number;
  max_ots_por_dia_gg: number;
  agrupar_por_localidad: boolean;
  incluir_correctivos_en_propuesta: boolean;
  hora_generacion_diaria: string;
};

export type CentroFirestoreDoc = {
  modulos?: Partial<CentroModulosConfig>;
  /** Subconjunto de especialidades habilitadas para filtros / altas. Vacío → todas. */
  especialidades_activas?: Especialidad[];
  /** Si es false, el cierre con firmas pad puede omitir la firma del usuario de planta. */
  requiere_firma_usuario_cierre?: boolean;
  /** Motor diario de OTs propuestas (merge con defaults en `mergeCentroConfig`). */
  config_motor?: Partial<ConfigMotorFirestore>;
  /**
   * Si true: el cron puede publicar propuestas pendientes tras 48h sin intervención.
   * También aplica cuando no hay supervisores/admin en el centro (piloto).
   */
  auto_publicar_propuesta?: boolean;
};

export type CentroConfigEffective = {
  modulos: CentroModulosConfig;
  especialidades_activas: Especialidad[];
  requiere_firma_usuario_cierre: boolean;
  config_motor: ConfigMotorFirestore;
  auto_publicar_propuesta: boolean;
};

export const TODAS_ESPECIALIDADES: readonly Especialidad[] = ["AA", "ELECTRICO", "GG", "HG"];
