import { ConfiguracionGeneralClient } from "./configuracion-general-client";
import { Suspense } from "react";

function ConfiguracionFallback() {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <p className="text-sm text-muted-foreground">Cargando configuración…</p>
    </div>
  );
}

export default function SuperadminConfiguracionPage() {
  return (
    <Suspense fallback={<ConfiguracionFallback />}>
      <ConfiguracionGeneralClient />
    </Suspense>
  );
}
