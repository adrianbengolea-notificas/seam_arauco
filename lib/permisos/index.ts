export type Rol = "tecnico" | "supervisor" | "admin" | "superadmin";

export type Permiso =
  | "programa:ver"
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
  | "admin:modo_mantenimiento";

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
];

const SUPERVISOR_EXTRA: Permiso[] = [
  "programa:crear_ot",
  "ot:ver_todas",
  "ot:crear_manual",
  "ot:cancelar_reasignar",
  "materiales:ver_reporting",
  "materiales:ingresar_stock",
  "historial:ver_todos",
  "historial:exportar_csv",
  "historial:informe_ia",
];

const ADMIN_EXTRA: Permiso[] = [
  "programa:editar",
  "materiales:editar_catalogo",
  "materiales:revisar_ia",
  "activos:crear_editar",
  "admin:gestionar_usuarios",
  "admin:cargar_programa",
];

const SUPERADMIN_EXTRA: Permiso[] = [
  "activos:dar_de_baja",
  "admin:feature_flags",
  "admin:auditoria",
  "admin:modo_mantenimiento",
];

export const PERMISOS_POR_ROL: Record<Rol, Permiso[]> = {
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
  return "tecnico";
}
