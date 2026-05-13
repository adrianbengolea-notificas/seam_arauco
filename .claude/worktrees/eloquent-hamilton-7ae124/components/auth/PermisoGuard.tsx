"use client";

import type { Permiso } from "@/lib/permisos/index";
import { usePermisos } from "@/lib/permisos/usePermisos";
import type { ReactNode } from "react";

export type PermisoGuardProps = {
  permiso: Permiso;
  fallback?: ReactNode;
  children: ReactNode;
};

export function PermisoGuard({ permiso, fallback = null, children }: PermisoGuardProps) {
  const { puede } = usePermisos();
  if (!puede(permiso)) return <>{fallback}</>;
  return <>{children}</>;
}
