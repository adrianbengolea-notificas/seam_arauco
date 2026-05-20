import { Suspense } from "react";
import { CorrectivosPendientesClient } from "./correctivos-pendientes-client";

export default function CorrectivosPendientesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Cargando correctivos…</p>}>
      <CorrectivosPendientesClient />
    </Suspense>
  );
}
