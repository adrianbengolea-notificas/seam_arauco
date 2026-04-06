"use client";

import {
  type Permiso,
  type Rol,
  rolMayorIgualQue,
  tienePermiso,
  toPermisoRol,
} from "@/lib/permisos/index";
import { useAuth } from "@/modules/users/hooks";

export function usePermisos(): {
  rol: Rol;
  centro: string;
  puede: (permiso: Permiso) => boolean;
  esMinimo: (minimo: Rol) => boolean;
} {
  const { profile } = useAuth();
  const rol = toPermisoRol(profile?.rol);
  const centro = profile?.centro?.trim() ?? "";

  return {
    rol,
    centro,
    puede: (permiso: Permiso) => tienePermiso(rol, permiso),
    esMinimo: (minimo: Rol) => rolMayorIgualQue(rol, minimo),
  };
}
