"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { cn } from "@/lib/utils";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import type { Especialidad } from "@/modules/notices/types";
import {
  useWorkOrdersByEspecialidad,
  type WorkOrderEspecialidadTab,
} from "@/modules/work-orders/hooks";
import { historialEstadoEtiqueta } from "@/modules/work-orders/historial-labels";
import {
  workOrderFrecuenciaBadge,
  workOrderSubtipo,
  workOrderVistaStatus,
  type WorkOrder,
  type WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import { useAuth } from "@/modules/users/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { toPermisoRol } from "@/lib/permisos/index";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

function OtCard({ wo, showCentro }: { wo: WorkOrder; showCentro?: boolean }) {
  const vista = workOrderVistaStatus(wo);
  const badge = workOrderFrecuenciaBadge(wo);
  const fecha =
    wo.fecha_inicio_programada?.toDate?.() ?? wo.updated_at?.toDate?.() ?? null;
  const fechaStr = fecha
    ? fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
  const tecnicoAsignado =
    wo.tecnico_asignado_nombre?.trim() || (wo.tecnico_asignado_uid?.trim() ? "Asignado" : null);
  const hasAlerta = Boolean(wo.alerta_cerrar_para_aviso_sap?.n_aviso);

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600",
        hasAlerta && "border-red-300/70 dark:border-red-500/40",
      )}
    >
      <Link href={`/tareas/${wo.id}`} className="block p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(wo.aviso_numero ?? wo.aviso_id) ? (
                <span className="font-mono font-semibold text-foreground">
                  Aviso {wo.aviso_numero ?? wo.aviso_id}
                </span>
              ) : null}
              {wo.n_ot ? (
                <span className="font-mono text-muted-foreground" title="Referencia interna (correlativo)">
                  Ref. {wo.n_ot}
                </span>
              ) : null}
              {workOrderSubtipo(wo) === "preventivo" && badge ? (
                <Badge variant="preventivo" className="text-[10px]">
                  {badge}
                </Badge>
              ) : null}
              {wo.provisorio_sin_aviso_sap ? (
                <Badge
                  variant="default"
                  className="border border-amber-600/45 bg-amber-500/10 text-[10px] text-amber-950 dark:text-amber-100"
                  title="Correctivo sin aviso SAP vinculado ni número informado al crear la orden"
                >
                  Provisorio sin aviso SAP
                </Badge>
              ) : null}
            </div>
            <p className="line-clamp-2 text-sm leading-snug text-foreground">{wo.texto_trabajo}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              <span className="text-zinc-600 dark:text-zinc-300">Técnico asignado:</span>{" "}
              {tecnicoAsignado ?? <span className="italic opacity-80">Sin asignar</span>}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {wo.equipo_codigo ?? wo.codigo_activo_snapshot}
              {wo.ubicacion_tecnica ? ` · ${wo.ubicacion_tecnica}` : null}
              {showCentro && wo.centro?.trim() ? (
                <>
                  {" · "}
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">{nombreCentro(wo.centro.trim())}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase",
                statusBadgeClass(vista),
              )}
              title="Estado exacto en el sistema"
            >
              {historialEstadoEtiqueta(wo.estado)}
            </span>
            <span className="text-[9px] font-medium text-zinc-500 dark:text-zinc-400">
              Resumen: {statusLabel(vista)}
            </span>
            <span className="text-[10px] text-zinc-500">{fechaStr}</span>
          </div>
        </div>
      </Link>
      {hasAlerta ? (
        <div
          className="rounded-b-lg border-t border-red-300/60 bg-red-50 px-3 py-2 dark:border-red-500/35 dark:bg-red-500/10"
          role="alert"
        >
          <p className="text-[11px] font-medium leading-snug text-red-950 dark:text-red-100">
            Hay aviso SAP nuevo (
            <span className="font-mono">{wo.alerta_cerrar_para_aviso_sap!.n_aviso}</span>
            ) para el mismo mantenimiento — terminá esta orden primero.{" "}
            <Link
              href="/programa/preventivos?pestana=vencimientos"
              className="font-semibold underline underline-offset-2"
            >
              Ver en programa →
            </Link>
          </p>
        </div>
      ) : null}
    </div>
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
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
          )}
          <span className="text-base font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
            {title}
          </span>
          <span className="rounded-md bg-zinc-200/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { puede } = usePermisos();
  const centrosPerfil = useMemo(() => centrosEfectivosDelUsuario(profile), [profile]);
  const centro = (centrosPerfil[0] ?? DEFAULT_CENTRO).trim();
  const esCliente = toPermisoRol(profile?.rol) === "cliente_arauco";
  const alcanceOtGlobal = esCliente || puede("ot:ver_todas");
  const esTecnicoMulti = toPermisoRol(profile?.rol) === "tecnico" && centrosPerfil.length > 1;
  const puedeFiltrarCentroPlanta = alcanceOtGlobal || esTecnicoMulti;

  const centroParamFiltro = useMemo(() => {
    const c = searchParams.get("centro")?.trim() ?? "";
    if (!c || c.toLowerCase() === "todas" || c.toLowerCase() === "all") return null;
    if (alcanceOtGlobal) return KNOWN_CENTROS.includes(c) ? c : null;
    if (esTecnicoMulti) return centrosPerfil.includes(c) ? c : null;
    return null;
  }, [searchParams, alcanceOtGlobal, esTecnicoMulti, centrosPerfil]);

  const centrosOpcionesFiltro = useMemo(() => {
    if (alcanceOtGlobal) return [...KNOWN_CENTROS];
    if (esTecnicoMulti) return [...centrosPerfil];
    return [];
  }, [alcanceOtGlobal, esTecnicoMulti, centrosPerfil]);

  const centroParaTabs = useMemo(() => {
    if (alcanceOtGlobal && centroParamFiltro) return centroParamFiltro;
    return centro;
  }, [alcanceOtGlobal, centroParamFiltro, centro]);

  const { config: centroCfg } = useCentroConfigLive(centroParaTabs);
  const tabMeta = useMemo(() => {
    const base = centroCfg.especialidades_activas.map((id) => ({
      id: id as WorkOrderEspecialidadTab,
      label: ESP_TAB_LABEL[id],
    }));
    return [...base, { id: "ALL" as const, label: "Todas" }];
  }, [centroCfg.especialidades_activas]);

  const [tab, setTab] = useState<WorkOrderEspecialidadTab>("ALL");
  const [statusFilter, setStatusFilter] = useState<WorkOrderVistaStatus | "ALL">("ALL");
  const [soloOrdenPreviaSap, setSoloOrdenPreviaSap] = useState(false);

  useEffect(() => {
    const st = searchParams.get("estado");
    if (st === "PENDIENTE" || st === "EN_CURSO" || st === "COMPLETADA" || st === "CANCELADA") {
      setStatusFilter(st);
    }
    if (searchParams.get("aviso_nuevo") === "1") {
      setSoloOrdenPreviaSap(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const allowed = new Set<WorkOrderEspecialidadTab>([...centroCfg.especialidades_activas, "ALL"]);
    if (!allowed.has(tab)) {
      setTab((centroCfg.especialidades_activas[0] as WorkOrderEspecialidadTab | undefined) ?? "ALL");
    }
  }, [centroCfg.especialidades_activas, tab]);

  // No disparar el query hasta tener perfil completo: evita que un técnico haga
  // una consulta con DEFAULT_CENTRO (centro incorrecto) o sin uid, lo que puede
  // generar "permission-denied" en las reglas de Firestore.
  const centroParaQuery = useMemo(() => {
    if (authLoading || !profile) return undefined;
    if (alcanceOtGlobal) {
      return centroParamFiltro;
    }
    if (esTecnicoMulti) {
      if (centroParamFiltro && centrosPerfil.includes(centroParamFiltro)) {
        return centroParamFiltro;
      }
      return centrosPerfil;
    }
    return (centrosPerfil[0] ?? DEFAULT_CENTRO).trim();
  }, [authLoading, profile, alcanceOtGlobal, esTecnicoMulti, centroParamFiltro, centrosPerfil]);

  const { ots, loading, error } = useWorkOrdersByEspecialidad(centroParaQuery, tab, statusFilter, {
    uid: user?.uid ?? "",
    rol: profile?.rol ?? "tecnico",
  });

  const otsFiltradas = useMemo(() => {
    if (!soloOrdenPreviaSap) return ots;
    return ots.filter((o) => Boolean(o.alerta_cerrar_para_aviso_sap?.n_aviso?.trim()));
  }, [ots, soloOrdenPreviaSap]);

  const { primaryTitle, primaryList, correctivos } = useMemo(() => {
    const checklist = otsFiltradas.filter((o) => workOrderSubtipo(o) === "checklist");
    const preventivos = otsFiltradas.filter((o) => workOrderSubtipo(o) === "preventivo");
    const corr = otsFiltradas.filter((o) => workOrderSubtipo(o) === "correctivo");
    if (tab === "GG") {
      return { primaryTitle: "Checklist / Service", primaryList: checklist, correctivos: corr };
    }
    return { primaryTitle: "Preventivos", primaryList: preventivos, correctivos: corr };
  }, [otsFiltradas, tab]);

  const puedeCrearOt = puede("ot:crear_manual");
  const homeHref = esCliente ? "/cliente" : "/dashboard";
  const mostrarCentroEnTarjeta = puedeFiltrarCentroPlanta && !centroParamFiltro;

  const hrefSoloCompletadas = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("estado", "COMPLETADA");
    return `/tareas?${p.toString()}`;
  }, [searchParams]);

  const hrefVerTodasEstado = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("estado");
    const q = p.toString();
    return q ? `/tareas?${q}` : "/tareas";
  }, [searchParams]);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Órdenes de trabajo</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {alcanceOtGlobal ? (
              centroParamFiltro ? (
                <>
                  Planta:{" "}
                  <span className="font-medium text-foreground">{nombreCentro(centroParamFiltro)}</span>
                  {" · "}
                  Podés cambiar el centro arriba en «Centro» o ampliar a todas las plantas
                </>
              ) : (
                <>
                  Alcance: <span className="font-mono font-medium text-foreground">todas las plantas</span> — filtrá por
                  centro y especialidad abajo
                </>
              )
            ) : esTecnicoMulti ? (
              centroParamFiltro ? (
                <>
                  Centro activo:{" "}
                  <span className="font-medium text-foreground">{nombreCentro(centroParamFiltro)}</span>
                  {" · "}
                  <span className="text-muted-foreground">O mostrá todos tus centros desde el filtro</span>
                </>
              ) : (
                <>
                  {centrosPerfil.length > 1 ? "Centros" : "Centro"}:{" "}
                  <span className="font-medium text-foreground">
                    {centrosPerfil.map((c) => nombreCentro(c)).join(" · ")}
                  </span>
                  {" — filtrá por centro si querés ver uno solo"}
                </>
              )
            ) : (
              <>
                {centrosPerfil.length > 1 ? "Centros" : "Centro"}:{" "}
                <span className="font-medium text-foreground">
                  {centrosPerfil.length > 1
                    ? centrosPerfil.map((c) => nombreCentro(c)).join(" · ")
                    : nombreCentro(centro)}
                </span>{" "}
                · Filtrá por especialidad abajo
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Link href={hrefSoloCompletadas} className="font-medium text-primary underline underline-offset-2">
              Ver solo órdenes completadas
            </Link>
            {" · "}
            <Link href={hrefVerTodasEstado} className="font-medium text-primary underline underline-offset-2">
              Ver todas (estados)
            </Link>
          </p>
        </div>
        {puedeCrearOt ? (
          <Button asChild className="shrink-0 whitespace-normal text-center text-xs font-semibold uppercase leading-tight sm:max-w-[min(100%,18rem)]">
            <Link href="/tareas/nueva">CREAR NUEVA OT MANUAL</Link>
          </Button>
        ) : null}
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

      <div className="flex flex-wrap items-center gap-3">
        {puedeFiltrarCentroPlanta ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label htmlFor="filtro-centro-ot" className="text-sm font-medium text-foreground">
              Centro
            </label>
            <select
              id="filtro-centro-ot"
              className={cn(
                "h-9 min-w-[12rem] rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-foreground shadow-sm dark:border-zinc-700 dark:bg-zinc-950",
              )}
              value={centroParamFiltro ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                const params = new URLSearchParams(searchParams.toString());
                if (!v) params.delete("centro");
                else params.set("centro", v);
                const qs = params.toString();
                router.replace(qs ? `/tareas?${qs}` : "/tareas", { scroll: false });
              }}
            >
              <option value="">{alcanceOtGlobal ? "Todas las plantas" : "Todos mis centros"}</option>
              {centrosOpcionesFiltro.map((k) => (
                <option key={k} value={k}>
                  {nombreCentro(k)} ({k})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={statusFilter === s.id}
              onClick={() => {
                setStatusFilter(s.id);
                const params = new URLSearchParams(searchParams.toString());
                if (s.id === "ALL") params.delete("estado");
                else params.set("estado", s.id);
                router.replace(`/tareas?${params.toString()}`, { scroll: false });
              }}
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
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
            checked={soloOrdenPreviaSap}
            onChange={(e) => {
              setSoloOrdenPreviaSap(e.target.checked);
              const params = new URLSearchParams(searchParams.toString());
              if (e.target.checked) params.set("aviso_nuevo", "1");
              else params.delete("aviso_nuevo");
              router.replace(`/tareas?${params.toString()}`, { scroll: false });
            }}
          />
          <span>
            Solo órdenes <span className="font-medium">en proceso</span> con aviso SAP nuevo vinculado (revisar y cerrar
            primero)
          </span>
        </label>
      </div>

      {loading ? <p className="text-sm text-zinc-600">Cargando…</p> : null}
      {error ? (
        <p className="text-sm text-red-600">
          Error al cargar las órdenes de trabajo. {mensajeErrorFirebaseParaUsuario(error)}
        </p>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-3">
          <CollapseSection title="Correctivos" count={correctivos.length}>
            {correctivos.length ? (
              correctivos.map((wo) => (
                <OtCard key={wo.id} wo={wo} showCentro={mostrarCentroEnTarjeta} />
              ))
            ) : (
              <p className="py-2 text-center text-sm text-zinc-400">Sin correctivos con los filtros actuales.</p>
            )}
          </CollapseSection>
          <CollapseSection title={primaryTitle} count={primaryList.length}>
            {primaryList.length ? (
              primaryList.map((wo) => (
                <OtCard key={wo.id} wo={wo} showCentro={mostrarCentroEnTarjeta} />
              ))
            ) : (
              <p className="py-2 text-center text-sm text-zinc-400">
                Sin órdenes en esta especialidad con los filtros actuales.
              </p>
            )}
          </CollapseSection>
        </div>
      ) : null}

      {puedeCrearOt ? (
        <Link
          href="/tareas/nueva"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          aria-label="Nueva orden de trabajo"
        >
          <Plus className="h-7 w-7" />
        </Link>
      ) : null}

      <div className="pt-4">
        <Button variant="outline" asChild>
          <Link href={homeHref}>Volver al panel</Link>
        </Button>
      </div>
    </div>
  );
}
