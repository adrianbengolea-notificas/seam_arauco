"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { usePermisos } from "@/lib/permisos/usePermisos";
import Link from "next/link";
import { ConfiguracionImportacionClient } from "./configuracion-importacion-client";

export function ConfiguracionGeneralClient() {
  const { puede } = usePermisos();
  const puedeOperativo = puede("admin:gestionar_usuarios");
  const puedeImportar = puede("admin:cargar_programa");

  if (!puedeOperativo && !puedeImportar) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>
            Necesitás permiso de <span className="font-mono">admin:gestionar_usuarios</span> y/o{" "}
            <span className="font-mono">admin:cargar_programa</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configuración general</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Datos maestros, importación de planillas SAP/Excel y referencia del motor. El panel clásico sigue en{" "}
          <Link href="/superadmin" className="text-primary underline underline-offset-2">
            Superadmin
          </Link>
          .
        </p>
      </div>

      {puedeImportar ? <ConfiguracionImportacionClient /> : null}

      {puedeOperativo ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tareas programadas (HTTP)</CardTitle>
              <div className="space-y-2 text-sm leading-relaxed text-muted">
                <p>
                  Usá cualquier programador que haga <span className="font-mono">GET</span> con{" "}
                  <span className="font-mono">Authorization: Bearer {"{CRON_SECRET}"}</span>.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  <li>
                    <span className="font-mono">/api/cron/actualizar-vencimientos</span> — vencimientos (p. ej. diario).
                  </li>
                  <li>
                    <span className="font-mono">/api/cron/motor-ot-diario</span> — propuesta semanal del motor.
                  </li>
                </ul>
                <p>
                  Ejemplo: <span className="font-mono">scripts/cron/http-daily.example.sh</span> con{" "}
                  <span className="font-mono">BASE_URL</span> y <span className="font-mono">CRON_SECRET</span>.
                </p>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Centros conocidos (entorno)</CardTitle>
              <CardDescription>
                El cron <span className="font-mono">motor-ot-diario</span> usa: {KNOWN_CENTROS.join(", ")}. Variable{" "}
                <span className="font-mono">NEXT_PUBLIC_KNOWN_CENTROS</span> para ampliar.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Motor y plan maestro</CardTitle>
              <div className="space-y-2 text-sm leading-relaxed text-muted">
                <p>
                  <span className="font-mono">plan_mantenimiento</span> se alinea con <span className="font-mono">avisos</span>{" "}
                  al ejecutar el motor; vencimientos al cerrar OT.
                </p>
                <p>
                  <span className="font-mono">propuestas_semana</span> — revisión en{" "}
                  <Link href="/programa/aprobacion" className="text-primary underline underline-offset-2">
                    /programa/aprobacion
                  </Link>
                  .
                </p>
                <p>
                  <span className="font-mono">config_motor</span> en <span className="font-mono">centros/{"{id}"}</span>{" "}
                  (<span className="font-mono">modules/centros/types.ts</span>).
                </p>
                <p>
                  Aviso si el motor agrega ítems tras merge: <span className="font-mono">CRON_NOTIFY_PROPUESTA_MERGE_NUEVOS=true</span>.
                </p>
                <p>
                  Auto-publicación tras 48&nbsp;h: flag <span className="font-mono">auto_publicar_propuesta</span> en{" "}
                  <span className="font-mono">centros/{"{id}"}</span> (UI en Superadmin) y variable{" "}
                  <span className="font-mono">CRON_AUTOPUBLISH_ACTOR_UID</span> opcional (si falta, se usa un superadmin
                  activo).
                </p>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scripts locales (alternativa)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>
                <span className="font-mono">npm run seed:import</span> · <span className="font-mono">npm run seed:sem-anual</span> · carpeta{" "}
                <span className="font-mono">scripts/seed/data/</span>
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
