"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePlanillaTemplatesLive } from "@/modules/planillas/hooks";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { hasAdminCapabilities } from "@/modules/users/roles";
import type { PlanillaTemplate, SeccionTemplate } from "@/lib/firestore/types";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PlanillaTemplateEditor } from "./planilla-template-editor";

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

function TemplateCard({
  t,
  editing,
  onEdit,
  onCloseEditor,
  onSaved,
}: {
  t: PlanillaTemplate;
  editing: boolean;
  onEdit: () => void;
  onCloseEditor: () => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const itemsTotal = t.secciones.reduce((n, s) => n + (s.items?.length ?? 0), 0);

  if (editing) {
    return (
      <li>
        <PlanillaTemplateEditor template={t} onCancel={onCloseEditor} onSaved={onSaved} />
      </li>
    );
  }

  return (
    <li>
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex min-h-11 min-w-0 flex-1 items-start gap-2 text-left"
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
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={onEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar
            </Button>
          </div>
        </CardHeader>
        {open ? (
          <CardContent className="space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            {t.secciones.map((sec) => (
              <div
                key={sec.id}
                className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{sec.titulo}</p>
                <p className="text-xs text-zinc-500">
                  <span className="font-mono">{sec.id}</span> · {tipoSeccionLabel(sec.tipo)}
                  {sec.soloAdmin ? " · solo admin" : ""}
                  {sec.obligatorio ? " · obligatorio" : ""}
                  {sec.grillaColumnas?.length ? ` · columnas: ${sec.grillaColumnas.join(", ")}` : ""}
                </p>
                {sec.items?.length ? (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-700 dark:text-zinc-300">
                    {sec.items.map((it) => (
                      <li
                        key={it.id}
                        className="flex gap-2 border-b border-zinc-100/80 pb-1 last:border-0 dark:border-zinc-800"
                      >
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
    </li>
  );
}

type SuperadminPlanillasClientProps = {
  /** Dentro de Configuración general: sin cabecera propia ni enlace «volver». */
  embedded?: boolean;
};

export function SuperadminPlanillasClient({ embedded = false }: SuperadminPlanillasClientProps) {
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading, error } = useUserProfile(user?.uid);
  const { templates, loading: tplLoading, error: tplError } = usePlanillaTemplatesLive();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

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
    <div
      className={cn("space-y-6", embedded ? "py-0" : "mx-auto max-w-4xl py-2")}
    >
      {embedded ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Plantillas de planilla</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Definiciones en <span className="font-mono text-xs">planilla_templates</span>. Editá y guardá; los cambios
              se aplican en tiempo real para nuevas planillas.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/superadmin">← Configuración general</Link>
          </Button>
        </div>
      )}

      {savedFlash ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          {savedFlash}
        </p>
      ) : null}

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
            <TemplateCard
              key={t.id}
              t={t}
              editing={editingId === t.id}
              onEdit={() => {
                setSavedFlash(null);
                setEditingId(t.id);
              }}
              onCloseEditor={() => setEditingId(null)}
              onSaved={() => {
                setSavedFlash("Cambios guardados en Firestore.");
                setEditingId(null);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
