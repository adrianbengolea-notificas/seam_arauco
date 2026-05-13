"use client";

import {
  type Permiso,
  type Rol,
  rolMayorIgualQue,
  tienePermiso,
  toPermisoRol,
} from "@/lib/permisos/index";
import type { UserProfile } from "@/modules/users/types";
import { useAuth } from "@/modules/users/hooks";
import type { User } from "firebase/auth";

export function usePermisos(): {
  rol: Rol;
  centro: string;
  puede: (permiso: Permiso) => boolean;
  esMinimo: (minimo: Rol) => boolean;
  /** Misma señal que `useAuth().loading`: Auth + primer snapshot útil de `users/{uid}`. */
  authLoading: boolean;
  user: User | null;
  profile: UserProfile | null;
} {
  const { profile, loading: authLoading, user } = useAuth();
  const rol = toPermisoRol(profile?.rol);
  const centro = profile?.centro?.trim() ?? "";

  return {
    rol,
    centro,
    puede: (permiso: Permiso) => tienePermiso(rol, permiso),
    esMinimo: (minimo: Rol) => rolMayorIgualQue(rol, minimo),
    authLoading,
    user,
    profile,
  };
}
