import { Suspense } from "react";
import { SuperadminMaterialesClient } from "./superadmin-materiales-client";

export default function SuperadminMaterialesPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">Cargando inventario…</div>
      }
    >
      <SuperadminMaterialesClient />
    </Suspense>
  );
}
