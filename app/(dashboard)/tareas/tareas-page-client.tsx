"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import type { Especialidad } from "@/modules/notices/types";
import {
  useWorkOrdersByEspecialidad,
  type WorkOrderEspecialidadTab,
} from "@/modules/work-orders/hooks";
import {
  workOrderFrecuenciaBadge,
  workOrderSubtipo,
  workOrderVistaStatus,
  type WorkOrder,
  type WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { useAuth } from "@/modules/users/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function statusBadgeClass(s: WorkOrderVistaStatus): string {
  switch (s) {
    case "PENDIENTE":
      return "border-zinc-400/40 bg-zinc-500/15 text-zinc-800 dark:text-zinc-200";
    case "EN_CURSO":
      return "border-blue-600/40 bg-blue-600/15 text-blue-950 dark:text-blue-100";
    case "COMPLETADA":
      return "border-emerald-600/40 bg-emerald-600/15 text-emerald-950 dark:text-emerald-100";
    case "CANCELADA":
      return "border-red-600/45 bg-red-600/15 text-red-950 dark:text-red-100";
    default:
      return "";
  }
}

function statusLabel(s: WorkOrderVistaStatus): string {
  switch (s) {
    case "PENDIENTE":
      return "PENDIENTE";
    case "EN_CURSO":
      return "EN CURSO";
    case "COMPLETADA":
      return "COMPLETADA";
    case "CANCELADA":
      return "CANCELADA";
    default:
      return s;
  }
}

function OtCard({ wo }: { wo: WorkOrder }) {
  const vista = workOrderVistaStatus(wo);
  const badge = workOrderFrecuenciaBadge(wo);
  const fecha =
    wo.fecha_inicio_programada?.toDate?.() ?? wo.updated_at?.toDate?.() ?? null;
  const fechaStr = fecha
    ? fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

  return (
    <Link
      href={`/tareas/${wo.id}`}
      className="block rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono font-semibold text-foreground">
              Aviso {(wo.aviso_numero ?? wo.aviso_id) || "—"}
            </span>
            {workOrderSubtipo(wo) === "preventivo" && badge ? (
              <Badge variant="preventivo" className="text-[10px]">
                {badge}
              </Badge>
            ) : null}
          </div>
          <p className="line-clamp-2 text-sm leading-snug text-foreground">{wo.texto_trabajo}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {wo.equipo_codigo ?? wo.codigo_activo_snapshot}
            {wo.ubicacion_tecnica ? ` · ${wo.ubicacion_tecnica}` : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase",
              statusBadgeClass(vista),
            )}
          >
            {statusLabel(vista)}
          </span>
          <span className="text-[10px] text-zinc-500">{fechaStr}</span>
        </div>
      </div>
    </Link>
  );
}

function CollapseSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {title}
          <span className="rounded-md bg-zinc-100 px-1.5 py-0 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {count}
          </span>
        </span>
      </button>
      {open ? <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">{children}</div> : null}
    </div>
  );
}

const ESP_TAB_LABEL: Record<Especialidad, string> = {
  AA: "Aire (AA)",
  ELECTRICO: "Eléctrico",
  GG: "GG",
  HG: "HG",
};

const STATUS_FILTERS: { id: WorkOrderVistaStatus | "ALL"; label: string }[] = [
  { id: "ALL", label: "Todos" },
  { id: "PENDIENTE", label: "Pendiente" },
  { id: "EN_CURSO", label: "En curso" },
  { id: "COMPLETADA", label: "Completada" },
  { id: "CANCELADA", label: "Cancelada" },
];

export function TareasPageClient() {
  const { user, profile } = useAuth();
  const { puede } = usePermisos();
  const centro = profile?.centro ?? DEFAULT_CENTRO;
  const { config: centroCfg } = useCentroConfigLive(centro);
  const tabMeta = useMemo(() => {
    const base = centroCfg.especialidades_activas.map((id) => ({
      id: id as WorkOrderEspecialidadTab,
      label: ESP_TAB_LABEL[id],
    }));
    return [...base, { id: "ALL" as const, label: "Todas" }];
  }, [centroCfg.especialidades_activas]);

  const [tab, setTab] = useState<WorkOrderEspecialidadTab>("AA");
  const [statusFilter, setStatusFilter] = useState<WorkOrderVistaStatus | "ALL">("ALL");

  useEffect(() => {
    const allowed = new Set<WorkOrderEspecialidadTab>([...centroCfg.especialidades_activas, "ALL"]);
    if (!allowed.has(tab)) {
      setTab((centroCfg.especialidades_activas[0] as WorkOrderEspecialidadTab | undefined) ?? "ALL");
    }
  }, [centroCfg.especialidades_activas, tab]);

  const { ots, loading, error } = useWorkOrdersByEspecialidad(centro, tab, statusFilter, {
    uid: user?.uid ?? "",
    rol: profile?.rol ?? "tecnico",
  });

  const { primaryTitle, primaryList, correctivos } = useMemo(() => {
    const checklist = ots.filter((o) => workOrderSubtipo(o) === "checklist");
    const preventivos = ots.filter((o) => workOrderSubtipo(o) === "preventivo");
    const corr = ots.filter((o) => workOrderSubtipo(o) === "correctivo");
    if (tab === "GG") {
      return { primaryTitle: "Checklist / Service", primaryList: checklist, correctivos: corr };
    }
    return { primaryTitle: "Preventivos", primaryList: preventivos, correctivos: corr };
  }, [ots, tab]);

  const puedeCrearOt = puede("programa:crear_ot");

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tareas</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Órdenes de trabajo por especialidad · {centro}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        {tabMeta.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition",
              tab === t.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStatusFilter(s.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              statusFilter === s.id
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-zinc-600">Cargando…</p> : null}
      {error ? (
        <p className="text-sm text-red-600">
          Error al cargar OT. {error.message}
        </p>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-3">
          <CollapseSection title={primaryTitle} count={primaryList.length}>
            {primaryList.length ? (
              primaryList.map((wo) => <OtCard key={wo.id} wo={wo} />)
            ) : (
              <p className="text-sm text-zinc-500">Sin órdenes en esta sección.</p>
            )}
          </CollapseSection>
          <CollapseSection title="Correctivos" count={correctivos.length}>
            {correctivos.length ? (
              correctivos.map((wo) => <OtCard key={wo.id} wo={wo} />)
            ) : (
              <p className="text-sm text-zinc-500">Sin correctivos.</p>
            )}
          </CollapseSection>
        </div>
      ) : null}

      {puedeCrearOt ? (
        <Link
          href="/tareas/nueva"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          aria-label="Nueva OT"
        >
          <Plus className="h-7 w-7" />
        </Link>
      ) : null}

      <div className="pt-4">
        <Button variant="outline" asChild>
          <Link href="/dashboard">Volver al panel</Link>
        </Button>
      </div>
    </div>
  );
}
