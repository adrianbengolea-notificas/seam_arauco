export const COLLECTIONS = {
  users: "users",
  /** Configuración operativa y feature flags por planta — `centros/{centroId}`. */
  centros: "centros",
  assets: "assets",
  avisos: "avisos",
  /** Catálogo de equipos por código (seed Excel Arauco). */
  equipos: "equipos",
  work_orders: "work_orders",
  /** Definiciones fijas de planillas digitales (AA / Elec / GG / Correctivos). */
  planilla_templates: "planilla_templates",
  materials: "materials",
  stock_movimientos: "stock_movimientos",
  weekly_schedule: "weekly_schedule",
  programa_semanal: "programa_semanal",
} as const;

/** Alias explícitos para scripts / repositorios (misma colección que `COLLECTIONS`). */
export const ASSETS_COLLECTION = COLLECTIONS.assets;
export const AVISOS_COLLECTION = COLLECTIONS.avisos;
export const EQUIPOS_COLLECTION = COLLECTIONS.equipos;
export const STOCK_MOVIMIENTOS_COLLECTION = COLLECTIONS.stock_movimientos;

export const WORK_ORDER_SUB = {
  checklist: "checklist",
  materiales_ot: "materiales_ot",
  evidencias: "evidencias",
  historial: "historial",
  planilla_respuestas: "planilla_respuestas",
} as const;
