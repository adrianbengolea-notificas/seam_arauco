"use client";

import type { Rol } from "@/lib/permisos/index";
import { usePermisos } from "@/lib/permisos/usePermisos";
import type { ReactNode } from "react";

export type RolGuardProps = {
  minimo: Rol;
  fallback?: ReactNode;
  children: ReactNode;
};

export function RolGuard({ minimo, fallback = null, children }: RolGuardProps) {
  const { esMinimo } = usePermisos();
  if (!esMinimo(minimo)) return <>{fallback}</>;
  return <>{children}</>;
}
