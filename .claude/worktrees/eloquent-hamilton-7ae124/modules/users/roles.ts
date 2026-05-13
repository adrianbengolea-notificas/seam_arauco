import type { Rol } from "@/lib/permisos/index";
import { toPermisoRol } from "@/lib/permisos/index";
import type { UserRole } from "@/modules/users/types";

/**
 * Comprueba si el rol del actor está en `allowed`, o si es `superadmin` (bypass).
 */
export function roleSatisfiesAllowed(actor: UserRole, allowed: readonly UserRole[]): boolean {
  const a = toPermisoRol(actor);
  if (a === "superadmin") return true;
  return allowed.some((r) => toPermisoRol(r) === a);
}

/** Supervisor, admin de planta o superadmin de la plataforma. */
export function isSupervisorOrAbove(rol: UserRole | undefined): boolean {
  const r = toPermisoRol(rol);
  return r === "supervisor" || r === "admin" || r === "superadmin";
}

/** Puede operar como admin de planta (no necesariamente superadmin). */
export function hasAdminCapabilities(rol: UserRole | undefined): boolean {
  const r = toPermisoRol(rol);
  return r === "admin" || r === "superadmin";
}

export function isSuperAdminRole(rol: UserRole | undefined): boolean {
  return toPermisoRol(rol) === "superadmin";
}

export function userRoleAsRol(rol: UserRole | undefined): Rol {
  return toPermisoRol(rol);
}
