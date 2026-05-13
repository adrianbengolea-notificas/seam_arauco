import { TareasPageClient } from "@/app/(dashboard)/tareas/tareas-page-client";
import { Suspense } from "react";

export default function TareasDashboardPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Cargando órdenes de trabajo…</p>}>
      <TareasPageClient />
    </Suspense>
  );
}
