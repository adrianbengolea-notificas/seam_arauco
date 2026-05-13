"use client";

import { AssetQrScanner } from "@/components/assets/AssetQrScanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function EscanerActivosPage() {
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
