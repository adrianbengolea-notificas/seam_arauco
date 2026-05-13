export type Rol = "tecnico" | "supervisor" | "admin" | "superadmin" | "cliente_arauco";

export type Permiso =
  | "programa:ver"
  /** Calendario anual de avisos preventivos (`/programa/preventivos`). Supervisor+, cliente lectura; no técnico. */
  | "programa:ver_calendario_anual"
  /** Semestrales/anuales: alertas de vencimiento y seguimiento de ejecución (supervisor+). */
  | "programa:ver_vencimientos_sa"
  | "programa:filtrar"
  | "programa:crear_ot"
  | "programa:editar"
  | "ot:ver_propias"
  | "ot:ver_todas"
  | "ot:crear_manual"
  | "ot:iniciar_estado"
  | "ot:completar_planilla"
  | "ot:agregar_materiales"
  | "ot:firmar_cerrar"
  | "ot:cancelar_reasignar"
  | "ot:descargar_pdf"
  | "materiales:ver_catalogo"
  | "materiales:ver_reporting"
  | "materiales:ingresar_stock"
  | "materiales:editar_catalogo"
  | "materiales:revisar_ia"
  | "activos:ver"
  | "activos:escanear_qr"
  | "activos:crear_editar"
  | "activos:dar_de_baja"
  | "historial:ver_propios"
  | "historial:ver_todos"
  | "historial:exportar_csv"
  | "historial:informe_ia"
  | "admin:gestionar_usuarios"
  | "admin:feature_flags"
  | "admin:cargar_programa"
  | "admin:auditoria"
  | "admin:modo_mantenimiento"
  | "comentarios:crear"
  | "comentarios:ver"
  | "notificaciones:recibir"
  | "cliente:ver_dashboard"
  | "cliente:ver_ots"
  | "cliente:ver_programa"
  | "cliente:ver_activos"
  | "cliente:descargar_pdf"
  /** Reporte planificado vs ejecutado (`/reportes/cumplimiento`). Supervisor+, cliente lectura; no técnico. */
  | "reportes:ver_cumplimiento";

const NOTIF_RECIBIR: Permiso = "notificaciones:recibir";

const TECNICO: Permiso[] = [
  "programa:ver",
  "programa:filtrar",
  "ot:ver_propias",
  "ot:iniciar_estado",
  "ot:completar_planilla",
  "ot:agregar_materiales",
  "ot:firmar_cerrar",
  "ot:descargar_pdf",
  "materiales:ver_catalogo",
  "activos:ver",
  "activos:escanear_qr",
  "historial:ver_propios",
  NOTIF_RECIBIR,
];

const SUPERVISOR_EXTRA: Permiso[] = [
  "programa:ver_calendario_anual",
  "reportes:ver_cumplimiento",
  "programa:ver_vencimientos_sa",
  "programa:crear_ot",
  "ot:ver_todas",
  "ot:crear_manual",
  "ot:cancelar_reasignar",
  "materiales:ver_reporting",
  "materiales:ingresar_stock",
  "historial:ver_todos",
  "historial:exportar_csv",
  "historial:informe_ia",
  /** Alineado con Firestore `assets`: supervisores pueden crear/editar. */
  "activos:crear_editar",
  "comentarios:crear",
  "comentarios:ver",
];

const ADMIN_EXTRA: Permiso[] = [
  "programa:editar",
  "materiales:editar_catalogo",
  "materiales:revisar_ia",
  "admin:gestionar_usuarios",
  "admin:cargar_programa",
];

const SUPERADMIN_EXTRA: Permiso[] = [
  "activos:dar_de_baja",
  "admin:feature_flags",
  "admin:auditoria",
  "admin:modo_mantenimiento",
];

const CLIENTE_ARAUCO: Permiso[] = [
  "cliente:ver_dashboard",
  "cliente:ver_programa",
  "cliente:ver_activos",
  /** Solo lectura: programa semanal publicado (`/programa`). */
  "programa:ver",
  "reportes:ver_cumplimiento",
  /** Solo lectura: catálogo y reporting (`/materiales`). */
  "materiales:ver_catalogo",
  "materiales:ver_reporting",
  /** Ver fichas (`/activos`); sin escáner ni edición de maestro. */
  "activos:ver",
  "comentarios:ver",
  NOTIF_RECIBIR,
];

export const PERMISOS_POR_ROL: Record<Rol, Permiso[]> = {
  cliente_arauco: CLIENTE_ARAUCO,
  tecnico: [...TECNICO],
  supervisor: [...TECNICO, ...SUPERVISOR_EXTRA],
  admin: [...TECNICO, ...SUPERVISOR_EXTRA, ...ADMIN_EXTRA],
  superadmin: [...TECNICO, ...SUPERVISOR_EXTRA, ...ADMIN_EXTRA, ...SUPERADMIN_EXTRA],
};

export function tienePermiso(rol: Rol, permiso: Permiso): boolean {
  const perms = PERMISOS_POR_ROL[rol] ?? [];
  return perms.includes(permiso);
}

export const JERARQUIA_ROL: Record<Rol, number> = {
  cliente_arauco: 0,
  tecnico: 1,
  supervisor: 2,
  admin: 3,
  superadmin: 4,
};

export function rolMayorIgualQue(rol: Rol, minimo: Rol): boolean {
  return JERARQUIA_ROL[rol] >= JERARQUIA_ROL[minimo];
}

/** Normaliza valores legado (`super_admin`) y strings desconocidos. */
export function toPermisoRol(rol: string | undefined | null): Rol {
  if (rol === "super_admin" || rol === "superadmin") return "superadmin";
  if (rol === "admin") return "admin";
  if (rol === "supervisor") return "supervisor";
  if (rol === "cliente_arauco") return "cliente_arauco";
  return "tecnico";
}
