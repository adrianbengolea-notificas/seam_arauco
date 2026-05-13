"use client";

import { ClienteDashboardClient } from "@/app/(dashboard)/cliente/cliente-dashboard-client";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ClienteAraucoPage() {
  const { puede, authLoading } = usePermisos();
  const router = useRouter();
  const ok = puede("cliente:ver_dashboard");

  useEffect(() => {
    if (authLoading) return;
    if (!ok) router.replace("/dashboard");
  }, [authLoading, ok, router]);

  if (authLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (!ok) {
    return (
      <p className="text-sm text-muted-foreground">Redirigiendo…</p>
    );
  }

  return <ClienteDashboardClient />;
}
