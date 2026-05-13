import { Suspense } from "react";
import { SuperadminPlanillasClient } from "./superadmin-planillas-client";

export default function SuperadminPlanillasPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">Cargando plantillas…</div>
      }
    >
      <SuperadminPlanillasClient />
    </Suspense>
  );
}
