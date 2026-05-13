"use client";

import { DiagnosticoClient } from "../diagnostico/diagnostico-client";
import { SuperadminCentroFlagsPanel } from "@/app/superadmin/superadmin-centro-flags-panel";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { ConfiguracionImportacionClient } from "./configuracion-importacion-client";

type SeccionConfigId = "importacion" | "motor" | "centros";

const SECCION_TABS: { id: SeccionConfigId; label: string; short: string; requiere: "import" | "operativo" }[] = [
  { id: "importacion", label: "Importación (Excel y avisos)", short: "Importación", requiere: "import" },
  { id: "motor", label: "Propuestas semanales (motor y estado)", short: "Propuestas", requiere: "operativo" },
  { id: "centros", label: "Planta, módulos y cierre de OT", short: "Planta", requiere: "operativo" },
];

export function ConfiguracionGeneralClient() {
  const { puede } = usePermisos();
  const puedeOperativo = puede("admin:gestionar_usuarios");
  const puedeImportar = puede("admin:cargar_programa");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("tab") === "diagnostico") {
      router.replace(`${pathname}?tab=motor`, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const seccionesVisibles = useMemo(() => {
    return SECCION_TABS.filter((t) => {
      if (t.requiere === "import") return puedeImportar;
      return puedeOperativo;
    });
  }, [puedeImportar, puedeOperativo]);

  const tabParam = searchParams.get("tab");
  const seccionActiva = useMemo(() => {
    if (seccionesVisibles.length === 0) return null;
    const validIds = new Set(seccionesVisibles.map((s) => s.id));
    const raw = tabParam === "diagnostico" ? "motor" : tabParam;
    if (raw && validIds.has(raw as SeccionConfigId)) return raw as SeccionConfigId;
    return seccionesVisibles[0]!.id;
  }, [seccionesVisibles, tabParam]);

  function irATab(id: SeccionConfigId) {
    router.replace(`${pathname}?tab=${id}`, { scroll: false });
  }

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

  const mostrarPestañas = seccionesVisibles.length > 1;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configuración e importación</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Tres bloques:{" "}
          <strong className="font-medium text-foreground/90">importar</strong> avisos y Excel;{" "}
          <strong className="font-medium text-foreground/90">motor de propuestas</strong> (diagnóstico, publicación y
          estado semanal por centro); y{" "}
          <strong className="font-medium text-foreground/90">reglas por planta</strong> (qué módulos ven, especialidades
          en OTs, firma de planta al cerrar).
          {mostrarPestañas
            ? " Elegí la pestaña abajo; cada sección carga sola, no hace falta desplazarse por todo el panel de una."
            : null}
        </p>
      </div>

      {mostrarPestañas ? (
        <div
          role="tablist"
          aria-label="Secciones de configuración"
          className="sticky top-0 z-20 flex flex-wrap gap-1 border-b border-border bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          {seccionesVisibles.map((t) => {
            const selected = seccionActiva === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                  selected
                    ? "bg-surface text-foreground ring-1 ring-brand/40"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
                onClick={() => irATab(t.id)}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div role="tabpanel" className="min-h-[12rem]">
        {seccionActiva === "importacion" && puedeImportar ? <ConfiguracionImportacionClient /> : null}
        {seccionActiva === "motor" && puedeOperativo ? <DiagnosticoClient embedInConfiguracion /> : null}
        {seccionActiva === "centros" && puedeOperativo ? <SuperadminCentroFlagsPanel /> : null}
      </div>
    </div>
  );
}
