"use client";

import { AssetQrScanner } from "@/components/assets/AssetQrScanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePermisos } from "@/lib/permisos/usePermisos";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function EscanerActivosPage() {
  const { rol, authLoading } = usePermisos();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (rol === "cliente_arauco") router.replace("/activos");
  }, [authLoading, rol, router]);

  if (!authLoading && rol === "cliente_arauco") {
    return <p className="p-6 text-sm text-muted-foreground">Redirigiendo a activos…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Escanear activo</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Leé el QR colocado en equipo para abrir su ficha en Arauco-Seam.
          </p>
        </div>
        <Link href="/activos" className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300">
          Volver a activos
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Cámara</CardTitle>
          <CardDescription>Permití el acceso a la cámara cuando el navegador lo solicite.</CardDescription>
        </CardHeader>
        <CardContent>
          <AssetQrScanner />
        </CardContent>
      </Card>
    </div>
  );
}
