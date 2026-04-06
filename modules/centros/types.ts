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
export type CentroFirestoreDoc = {
  modulos?: Partial<CentroModulosConfig>;
  /** Subconjunto de especialidades habilitadas para filtros / altas. Vacío → todas. */
  especialidades_activas?: Especialidad[];
  /** Si es false, el cierre con firmas pad puede omitir la firma del usuario de planta. */
  requiere_firma_usuario_cierre?: boolean;
};

export type CentroConfigEffective = {
  modulos: CentroModulosConfig;
  especialidades_activas: Especialidad[];
  requiere_firma_usuario_cierre: boolean;
};

export const TODAS_ESPECIALIDADES: readonly Especialidad[] = ["AA", "ELECTRICO", "GG", "HG"];
