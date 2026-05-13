export type ModoImportacionAvisos =
  | "preventivos_todas"
  | "preventivos_mensual"
  | "preventivos_trimestral"
  | "preventivos_semestral"
  | "preventivos_anual"
  /** Solo `meses_programados` en avisos ya existentes; exige columnas de mes marcadas (Excel Arauco). */
  | "calendario_mensual"
  | "calendario_trimestral"
  | "mensuales_parche"
  | "listado_semestral_anual"
  | "correctivos";
