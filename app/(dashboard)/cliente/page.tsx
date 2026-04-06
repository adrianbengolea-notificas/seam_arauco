"use client";

import { ClienteDashboardClient } from "@/app/(dashboard)/cliente/cliente-dashboard-client";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ClienteAraucoPage() {
  const { puede } = usePermisos();
  const router = useRouter();
  const ok = puede("cliente:ver_dashboard");

  useEffect(() => {
    if (!ok) router.replace("/dashboard");
  }, [ok, router]);

  if (!ok) {
    return (
      <p className="text-sm text-muted-foreground">Redirigiendo…</p>
    );
  }

  return <ClienteDashboardClient />;
}
