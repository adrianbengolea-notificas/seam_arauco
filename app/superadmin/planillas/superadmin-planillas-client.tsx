"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePlanillaTemplatesLive } from "@/modules/planillas/hooks";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { hasAdminCapabilities } from "@/modules/users/roles";
import type { PlanillaTemplate, SeccionTemplate } from "@/lib/firestore/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

function tipoSeccionLabel(tipo: SeccionTemplate["tipo"]): string {
  switch (tipo) {
    case "checklist":
      return "Checklist";
    case "grilla":
      return "Grilla";
    case "libre":
      return "Texto libre";
    case "datos_equipo":
      return "Datos equipo";
    case "datos_persona":
      return "Personal";
    case "estado_final":
      return "Estado final";
    default:
      return tipo;
  }
}

function TemplateCard({ t }: { t: PlanillaTemplate }) {
  const [open, setOpen] = useState(false);
  const itemsTotal = t.secciones.reduce((n, s) => n + (s.items?.length ?? 0), 0);

  return (
    <Card className="border-zinc-200 dark:border-zinc-800">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start gap-2 text-left min-h-11"
        >
          {open ? (
            <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" />
          )}
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-mono">
              {t.id}
              <span className="ml-2 font-sans font-normal text-zinc-600 dark:text-zinc-400">· {t.nombre}</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Especialidad <span className="font-mono">{t.especialidad}</span> · Subtipo{" "}
              <span className="font-mono">{t.subTipo}</span> · {t.secciones.length} secciones
              {itemsTotal ? ` · ${itemsTotal} ítems` : null}
            </CardDescription>
          </div>
        </button>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          {t.secciones.map((sec) => (
            <div key={sec.id} className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{sec.titulo}</p>
              <p className="text-xs text-zinc-500">
                <span className="font-mono">{sec.id}</span> · {tipoSeccionLabel(sec.tipo)}
                {sec.soloAdmin ? " · solo admin" : ""}
                {sec.obligatorio ? " · obligatorio" : ""}
                {sec.grillaColumnas?.length ? ` · columnas: ${sec.grillaColumnas.join(", ")}` : ""}
              </p>
              {sec.items?.length ? (
                <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sec.items.map((it) => (
                    <li key={it.id} className="flex gap-2 border-b border-zinc-100/80 pb-1 last:border-0 dark:border-zinc-800">
                      <span className="shrink-0 font-mono text-zinc-400">{it.id}</span>
                      <span className="min-w-0 flex-1">{it.label}</span>
                      {it.obligatorio ? (
                        <span className="shrink-0 text-amber-700 dark:text-amber-400">req.</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function SuperadminPlanillasClient() {
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading, error } = useUserProfile(user?.uid);
  const { templates, loading: tplLoading, error: tplError } = usePlanillaTemplatesLive();

  const loading = authLoading || profileLoading;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-600 dark:text-zinc-400">
        Cargando…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">Error de perfil: {error.message}</p>;
  }

  if (!user || !hasAdminCapabilities(profile?.rol)) {
    return (
      <Card className="max-w-lg border-amber-200 dark:border-amber-900">
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>Solo administradores pueden ver esta página.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/superadmin">Volver</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Plantillas de planilla</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Definiciones en{" "}
            <span className="font-mono text-xs">planilla_templates</span> (solo lectura).
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/superadmin">← Superadmin</Link>
        </Button>
      </div>

      {tplError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          No se pudieron cargar las plantillas: {tplError.message}
        </p>
      ) : null}

      {tplLoading ? (
        <p className="text-sm text-zinc-500">Cargando plantillas…</p>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No hay documentos en <span className="font-mono">planilla_templates</span>. Ejecutá{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run seed:templates</code>.
          </CardContent>
        </Card>
      ) : (
        <ul className={cn("space-y-4")}>
          {templates.map((t) => (
            <li key={t.id}>
              <TemplateCard t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
