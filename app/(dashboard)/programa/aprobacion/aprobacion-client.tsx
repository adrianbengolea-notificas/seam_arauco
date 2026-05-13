"use client";

import {
  actionAprobarItemsPropuestaMotor,
  actionRegistrarVistaPropuestaSupervisor,
  actionRechazarItemPropuestaMotor,
  actionRechazarItemsPropuestaMotor,
} from "@/app/actions/schedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_CENTRO, isCentroInKnownList, nombreCentro } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import type { OtPropuestaFirestore, PropuestaSemanaStatus } from "@/lib/firestore/plan-mantenimiento-types";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { usePropuestaMotorSemana } from "@/modules/scheduling/hooks";
import { getIsoWeekId, parseIsoWeekIdFromSemanaParam } from "@/modules/scheduling/iso-week";
import type { Especialidad } from "@/modules/notices/types";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { isSuperAdminRole } from "@/modules/users/roles";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DIAS_ORDEN = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;

const DIA_LABEL: Record<(typeof DIAS_ORDEN)[number], string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};

const ESP_LABEL: Partial<Record<Especialidad, string>> = {
  AA: "AA",
  ELECTRICO: "Eléctrico",
  GG: "GG",
  HG: "HG",
};

/** Ítems de calendario (planificado) primero; el resto (urgencias, legacy sin origen, correctivos) después. */
function partitionPorOrigenPropuesta(items: OtPropuestaFirestore[]): {
  planificados: OtPropuestaFirestore[];
  resto: OtPropuestaFirestore[];
} {
  const planificados = items.filter(
    (i) => i.kind === "preventivo_plan" && i.origen === "planificado",
  );
  const resto = items.filter(
    (i) => !(i.kind === "preventivo_plan" && i.origen === "planificado"),
  );
  return { planificados, resto };
}

function PropuestaItemFila(props: {
  item: OtPropuestaFirestore;
  origenUi: "planificado" | "urgencia";
  seleccionado: boolean;
  busy: boolean;
  onToggle: () => void;
  onAprobarUno: () => void | Promise<void>;
  onRechazarUno: () => void | Promise<void>;
}) {
  const { item, origenUi, seleccionado, busy, onToggle, onAprobarUno, onRechazarUno } = props;
  const selectable = item.status === "propuesta";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between",
        seleccionado && "ring-1 ring-primary/40",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        {selectable ? (
          <input
            type="checkbox"
            checked={seleccionado}
            onChange={onToggle}
            className="mt-1 size-4 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            aria-label={seleccionado ? "Quitar de la selección" : "Incluir para aprobar"}
          />
        ) : (
          <span className="mt-1 w-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.prioridad === 1 ? "urgente" : item.prioridad === 2 ? "correctivo" : "preventivo"}>
              P{item.prioridad}
            </Badge>
            {origenUi === "planificado" ? (
              <Badge
                variant="default"
                className="border border-green-600/50 bg-green-50/90 font-medium text-green-800 dark:bg-green-950/40 dark:text-green-400"
              >
                Planificado
              </Badge>
            ) : (
              <Badge variant="urgente" className="font-medium">
                Urgencia
              </Badge>
            )}
            <span className="font-mono text-xs text-muted-foreground">{item.dia_semana}</span>
            <Badge variant={item.kind === "correctivo_existente" ? "correctivo" : "preventivo"}>
              {item.kind === "correctivo_existente" ? "Correctivo" : "Preventivo"}
            </Badge>
            <Badge variant="default" className="font-normal opacity-90">
              {ESP_LABEL[item.especialidad]} · {item.localidad}
            </Badge>
            <Badge variant="default" className="capitalize">
              {item.status}
            </Badge>
          </div>
          <p className="text-sm font-medium text-foreground">
            #{item.numero} · {item.descripcion.slice(0, 120)}
            {item.descripcion.length > 120 ? "…" : ""}
          </p>
          <p className="text-xs text-muted-foreground">{item.razon_incluida}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:pt-0">
        {selectable ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-green-600/50 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
              disabled={busy}
              onClick={() => void onAprobarUno()}
            >
              Aprobar
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onRechazarUno()}>
              Rechazar
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

const ETIQUETA_ESTADO_PROPUESTA: Record<PropuestaSemanaStatus, string> = {
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobada: "Aprobada",
  ejecutando: "Ejecutando",
  cerrada: "Cerrada",
};

function etiquetaEstadoPropuestaSemana(status: string): string {
  return ETIQUETA_ESTADO_PROPUESTA[status as PropuestaSemanaStatus] ?? status.replace(/_/g, " ");
}

const selectClass = cn(
  "flex h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm",
  "text-foreground transition-[border-color,box-shadow] duration-150",
  "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
);

export function AprobacionPropuestaClient() {
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede } = usePermisos();
  const puedeActuar = puede("programa:crear_ot");
  const searchParams = useSearchParams();
  const semanaDesdeUrl = searchParams.get("semana")?.trim() ?? null;
  const centroParam = searchParams.get("centro")?.trim() ?? "";
  const semanaEfectiva = useMemo(() => {
    const iso = semanaDesdeUrl ? parseIsoWeekIdFromSemanaParam(semanaDesdeUrl) : null;
    if (iso) return iso;
    return getIsoWeekId(new Date());
  }, [semanaDesdeUrl]);
  const perfilCentro = (profile?.centro?.trim() || DEFAULT_CENTRO).trim();
  const viewerSuperadmin = isSuperAdminRole(profile?.rol);
  const centro = useMemo(() => {
    if (!viewerSuperadmin) return perfilCentro;
    if (centroParam && isCentroInKnownList(centroParam)) return centroParam;
    return perfilCentro;
  }, [viewerSuperadmin, perfilCentro, centroParam]);
  const propuestaId = useMemo(() => propuestaSemanaDocId(centro, semanaEfectiva), [centro, semanaEfectiva]);

  const hrefVolverPrograma = useMemo(() => {
    const p = new URLSearchParams();
    if (semanaEfectiva) p.set("semana", semanaEfectiva);
    if (viewerSuperadmin && isCentroInKnownList(centro) && centro !== perfilCentro) {
      p.set("centro", centro);
    }
    const q = p.toString();
    return q ? `/programa?${q}` : "/programa";
  }, [semanaEfectiva, viewerSuperadmin, centro, perfilCentro]);

  const { propuesta, loading, error } = usePropuestaMotorSemana(
    puedeActuar ? propuestaId : undefined,
    user?.uid,
  );

  const propuestaSinItems = useMemo(() => {
    if (!propuesta) return false;
    return (propuesta.items?.length ?? 0) === 0;
  }, [propuesta]);

  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [filtroDia, setFiltroDia] = useState<string>("todos");
  const [filtroKind, setFiltroKind] = useState<"todos" | OtPropuestaFirestore["kind"]>("todos");
  const [filtroPrioridad, setFiltroPrioridad] = useState<"todos" | "1" | "2" | "3">("todos");
  const [filtroEsp, setFiltroEsp] = useState<"todos" | Especialidad>("todos");
  const [filtroLoc, setFiltroLoc] = useState<string>("todos");
  /** Pendientes = solo status propuesta; ver también aprobadas/rechazadas. */
  const [filtroVistaEstado, setFiltroVistaEstado] = useState<"pendientes" | "todos">("pendientes");

  const vistaPropuestaRegistrada = useRef(false);
  useEffect(() => {
    if (!puedeActuar || !user?.uid || !propuesta?.id) return;
    if (propuesta.status !== "pendiente_aprobacion") return;
    if (propuesta.propuesta_vista_supervisor_at) return;
    if (vistaPropuestaRegistrada.current) return;
    vistaPropuestaRegistrada.current = true;
    void (async () => {
      try {
        const token = await getClientIdToken();
        if (!token) {
          vistaPropuestaRegistrada.current = false;
          return;
        }
        await actionRegistrarVistaPropuestaSupervisor(token, { propuestaId: propuesta.id });
      } catch {
        vistaPropuestaRegistrada.current = false;
      }
    })();
  }, [puedeActuar, user?.uid, propuesta?.id, propuesta?.status, propuesta?.propuesta_vista_supervisor_at]);

  const opcionesDia = useMemo(() => {
    const set = new Set<string>();
    for (const d of DIAS_ORDEN) set.add(d);
    for (const it of propuesta?.items ?? []) {
      if (it.dia_semana?.trim()) set.add(it.dia_semana.trim());
    }
    return [...set].sort((a, b) => {
      const ia = (DIAS_ORDEN as readonly string[]).indexOf(a);
      const ib = (DIAS_ORDEN as readonly string[]).indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, "es");
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [propuesta?.items]);

  const opcionesLoc = useMemo(() => {
    const set = new Set<string>();
    for (const it of propuesta?.items ?? []) {
      const L = it.localidad?.trim();
      if (L) set.add(L);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [propuesta?.items]);

  const opcionesEsp = useMemo(() => {
    const set = new Set<Especialidad>();
    for (const it of propuesta?.items ?? []) set.add(it.especialidad);
    return [...set].sort();
  }, [propuesta?.items]);

  const itemsFiltrados = useMemo(() => {
    if (!propuesta?.items?.length) return [];
    const q = busqueda.trim().toLowerCase();
    return propuesta.items.filter((item) => {
      if (filtroVistaEstado === "pendientes" && item.status !== "propuesta") return false;
      if (filtroDia !== "todos" && item.dia_semana !== filtroDia) return false;
      if (filtroKind !== "todos" && item.kind !== filtroKind) return false;
      if (filtroPrioridad !== "todos" && String(item.prioridad) !== filtroPrioridad) return false;
      if (filtroEsp !== "todos" && item.especialidad !== filtroEsp) return false;
      if (filtroLoc !== "todos" && item.localidad !== filtroLoc) return false;
      if (q) {
        const blob = `${item.numero} ${item.descripcion} ${item.razon_incluida} ${item.tecnico_sugerido_nombre ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [
    propuesta?.items,
    busqueda,
    filtroDia,
    filtroKind,
    filtroPrioridad,
    filtroEsp,
    filtroLoc,
    filtroVistaEstado,
  ]);

  const { planificados: itemsPlanFiltrados, resto: itemsUrgenciaFiltrados } = useMemo(
    () => partitionPorOrigenPropuesta(itemsFiltrados),
    [itemsFiltrados],
  );

  const pendientesFiltrados = useMemo(() => {
    const pendPlan = itemsPlanFiltrados.filter((i) => i.status === "propuesta");
    const pendRest = itemsUrgenciaFiltrados.filter((i) => i.status === "propuesta");
    return [...pendPlan, ...pendRest];
  }, [itemsPlanFiltrados, itemsUrgenciaFiltrados]);

  const totalPendientesPropuesta = useMemo(
    () => (propuesta?.items ?? []).filter((i) => i.status === "propuesta").length,
    [propuesta?.items],
  );

  /** Solo IDs pendientes (propuesta) aún seleccionados — coherente si cambian filtros después de marcar. */
  const idsElegidosPendientes = useMemo(() => {
    const pendiente = new Set(
      (propuesta?.items ?? []).filter((i) => i.status === "propuesta").map((i) => i.id),
    );
    return [...elegidos].filter((id) => pendiente.has(id));
  }, [elegidos, propuesta?.items]);
  const nSeleccionadosPendientes = idsElegidosPendientes.length;

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = headerCheckboxRef.current;
    if (!el) return;
    const n = pendientesFiltrados.length;
    const sel = pendientesFiltrados.filter((i) => elegidos.has(i.id)).length;
    el.indeterminate = n > 0 && sel > 0 && sel < n;
    el.checked = n > 0 && sel === n;
  }, [pendientesFiltrados, elegidos]);

  const seleccionarPendientesVisibles = useCallback(() => {
    setElegidos((prev) => {
      const n = new Set(prev);
      for (const item of pendientesFiltrados) n.add(item.id);
      return n;
    });
  }, [pendientesFiltrados]);

  const quitarSeleccionVisibles = useCallback(() => {
    const ids = new Set(pendientesFiltrados.map((i) => i.id));
    setElegidos((prev) => new Set([...prev].filter((id) => !ids.has(id))));
  }, [pendientesFiltrados]);

  const seleccionarTodosPendientesPropuesta = useCallback(() => {
    if (!propuesta?.items) return;
    setElegidos((prev) => {
      const n = new Set(prev);
      for (const item of propuesta.items) {
        if (item.status === "propuesta") n.add(item.id);
      }
      return n;
    });
  }, [propuesta?.items]);

  const limpiarSeleccion = useCallback(() => setElegidos(new Set()), []);

  const onHeaderCheckboxChange = useCallback(() => {
    const n = pendientesFiltrados.length;
    const sel = pendientesFiltrados.filter((i) => elegidos.has(i.id)).length;
    if (n > 0 && sel === n) quitarSeleccionVisibles();
    else seleccionarPendientesVisibles();
  }, [pendientesFiltrados, elegidos, quitarSeleccionVisibles, seleccionarPendientesVisibles]);

  const toggle = useCallback((id: string) => {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const feedbackRef = useRef<HTMLDivElement>(null);
  const idsElegidosRef = useRef<string[]>([]);
  idsElegidosRef.current = idsElegidosPendientes;

  useEffect(() => {
    if (!msg && !busy) return;
    const id = requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [msg, busy]);

  const ejecutarAprobar = useCallback(async (itemIds: string[]) => {
    const ids = [...new Set(itemIds.map((x) => String(x).trim()).filter((x) => x.length > 0))];
    if (ids.length === 0) {
      setMsg(
        "No hay ítems pendientes válidos para aprobar. Marcá filas con la casilla o usá «Aprobar visibles» / «Aprobar todos los pendientes».",
      );
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await actionAprobarItemsPropuestaMotor(token, {
        propuestaId,
        itemIds: ids,
      });
      if (!res.ok) {
        setMsg(res.error?.message ?? "Error al aprobar");
        return;
      }
      setMsg(
        res.data.mensaje ??
          `Listo: ${res.data.creadas.length} orden(es) de servicio nueva(s) · programa ${res.data.programaId}`,
      );
      setElegidos(new Set());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [propuestaId]);

  const aprobarSeleccionados = useCallback(() => {
    void ejecutarAprobar([...idsElegidosRef.current]);
  }, [ejecutarAprobar]);

  const aprobarVisibles = useCallback(
    () => void ejecutarAprobar(pendientesFiltrados.map((i) => i.id)),
    [pendientesFiltrados, ejecutarAprobar],
  );

  const aprobarTodosLosPendientes = useCallback(() => {
    const ids = (propuesta?.items ?? []).filter((i) => i.status === "propuesta").map((i) => i.id);
    void ejecutarAprobar(ids);
  }, [propuesta?.items, ejecutarAprobar]);

  const totalPlanificadosPendientesGlobales = useMemo(
    () =>
      (propuesta?.items ?? []).filter(
        (i) => i.status === "propuesta" && i.kind === "preventivo_plan" && i.origen === "planificado",
      ).length,
    [propuesta?.items],
  );

  const aprobarTodosLosPlanificadosPendientes = useCallback(() => {
    const ids = (propuesta?.items ?? [])
      .filter((i) => i.status === "propuesta" && i.kind === "preventivo_plan" && i.origen === "planificado")
      .map((i) => i.id);
    void ejecutarAprobar(ids);
  }, [propuesta?.items, ejecutarAprobar]);

  const ejecutarRechazarVarios = useCallback(
    async (itemIds: string[], options?: { confirm?: boolean }) => {
      if (itemIds.length === 0) return;
      if (options?.confirm !== false) {
        const ok = window.confirm(
          `¿Rechazar ${itemIds.length} ítem(es)? No se generarán OTs para ellos.`,
        );
        if (!ok) return;
      }
      setBusy(true);
      setMsg(null);
      try {
        const token = await getClientIdToken();
        if (!token) throw new Error("Sin sesión");
        const res = await actionRechazarItemsPropuestaMotor(token, { propuestaId, itemIds });
        if (!res.ok) {
          setMsg(res.error?.message ?? "Error al rechazar");
          return;
        }
        setMsg(`Listo: ${res.data.rechazadas} ítem(es) rechazado(s).`);
        const rm = new Set(itemIds);
        setElegidos((prev) => new Set([...prev].filter((id) => !rm.has(id))));
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [propuestaId],
  );

  const rechazarVisibles = useCallback(
    () => void ejecutarRechazarVarios(pendientesFiltrados.map((i) => i.id)),
    [pendientesFiltrados, ejecutarRechazarVarios],
  );

  const rechazarTodosLosPendientes = useCallback(() => {
    const ids = (propuesta?.items ?? []).filter((i) => i.status === "propuesta").map((i) => i.id);
    void ejecutarRechazarVarios(ids);
  }, [propuesta?.items, ejecutarRechazarVarios]);

  const rechazar = useCallback(
    async (itemId: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const token = await getClientIdToken();
        if (!token) throw new Error("Sin sesión");
        const res = await actionRechazarItemPropuestaMotor(token, { propuestaId, itemId });
        if (!res.ok) setMsg(res.error?.message ?? "Error");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [propuestaId],
  );

  if (!puedeActuar) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>Necesitás permisos de supervisor o administración para aprobar propuestas.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Aprobación de propuesta semanal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Semana <span className="font-mono">{semanaEfectiva}</span> · Planta{" "}
            <span className="font-medium text-foreground">{nombreCentro(centro)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end">
          <nav className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 text-[0.8rem]" aria-label="Programa relacionado">
            <Link className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="/programa/preventivos">
              Calendario anual de avisos
            </Link>
            {puede("programa:ver_vencimientos_sa") ? (
              <>
                <span className="text-muted-foreground/70">·</span>
                <Link
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  href="/programa/preventivos?pestana=vencimientos"
                >
                  Alertas vencimiento
                </Link>
              </>
            ) : null}
          </nav>
          <Button variant="outline" size="sm" asChild>
            <Link href={hrefVolverPrograma}>Volver al programa</Link>
          </Button>
        </div>
      </div>

      <div
        ref={feedbackRef}
        tabIndex={-1}
        className="scroll-mt-24 rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {busy ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground" role="status">
            Procesando aprobación o rechazo…
          </p>
        ) : null}
        {!busy && msg ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm" role="status">
            {msg}
          </p>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Cargando propuesta…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {mensajeErrorFirebaseParaUsuario(error)}
        </p>
      ) : null}

      {!loading && !propuesta ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin propuesta para esta semana</CardTitle>
            <CardDescription>
              El motor todavía no generó la propuesta para la semana{" "}
              <span className="font-mono">{semanaEfectiva}</span>. El motor corre automáticamente cada
              día a las 6 AM. Si necesitás generarla ahora, andá a{" "}
              <Link href="/superadmin/configuracion?tab=motor" className="underline underline-offset-2">
                Configuración → Propuestas semanales
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {propuesta ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">{etiquetaEstadoPropuestaSemana(propuesta.status)}</Badge>
            <span className="text-sm text-muted-foreground">
              {propuesta.items?.filter((i) => i.status === "propuesta").length ?? 0} pendientes ·{" "}
              {propuesta.items?.length ?? 0} total
              {!propuestaSinItems && itemsFiltrados.length !== (propuesta.items?.length ?? 0) ? (
                <>
                  {" "}
                  · mostrando <span className="font-medium text-foreground">{itemsFiltrados.length}</span> con filtros
                </>
              ) : null}
            </span>
          </div>

          {propuestaSinItems && propuesta.status === "pendiente_aprobacion" ? (
            <Card className="border-amber-500/40 bg-amber-50/90 dark:border-amber-500/30 dark:bg-amber-950/25">
              <CardHeader className="py-3">
                <CardTitle className="text-base">Propuesta sin ítems</CardTitle>
                <CardDescription className="text-foreground/90">
                  El registro quedó en «pendiente de aprobación» pero la lista está vacía (no hay nada para aprobar). Suele
                  indicar una corrida del motor incompleta, un merge o un reset. Volvé a ejecutar el motor para{" "}
                  <span className="font-medium text-foreground">{nombreCentro(centro)}</span> en{" "}
                  <span className="font-mono">{semanaEfectiva}</span> desde{" "}
                  <Link href="/superadmin/diagnostico" className="font-medium underline underline-offset-2">
                    Diagnóstico por planta
                  </Link>{" "}
                  o desde configuración de propuestas.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {!propuestaSinItems ? (
            <>
            <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Filtros</CardTitle>
              <CardDescription>Acotá la lista y marcá en bloque solo lo que corresponda.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar</label>
                  <Input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="N.º orden, descripción, motivo, técnico sugerido…"
                    aria-label="Buscar en propuesta"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Estado en lista</label>
                  <select
                    className={selectClass}
                    value={filtroVistaEstado}
                    onChange={(e) => setFiltroVistaEstado(e.target.value as "pendientes" | "todos")}
                    aria-label="Filtrar por estado del ítem"
                  >
                    <option value="pendientes">Solo pendientes de aprobación</option>
                    <option value="todos">Todos (incluye ya procesados)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Día</label>
                  <select
                    className={selectClass}
                    value={filtroDia}
                    onChange={(e) => setFiltroDia(e.target.value)}
                    aria-label="Filtrar por día"
                  >
                    <option value="todos">Todos los días</option>
                    {opcionesDia.map((d) => (
                      <option key={d} value={d}>
                        {DIA_LABEL[d as keyof typeof DIA_LABEL] ?? d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo</label>
                  <select
                    className={selectClass}
                    value={filtroKind}
                    onChange={(e) => setFiltroKind(e.target.value as typeof filtroKind)}
                    aria-label="Filtrar por tipo"
                  >
                    <option value="todos">Preventivo y correctivo</option>
                    <option value="preventivo_plan">Preventivo</option>
                    <option value="correctivo_existente">Correctivo</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Prioridad</label>
                  <select
                    className={selectClass}
                    value={filtroPrioridad}
                    onChange={(e) => setFiltroPrioridad(e.target.value as typeof filtroPrioridad)}
                    aria-label="Filtrar por prioridad"
                  >
                    <option value="todos">Todas</option>
                    <option value="1">P1</option>
                    <option value="2">P2</option>
                    <option value="3">P3</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Especialidad</label>
                  <select
                    className={selectClass}
                    value={filtroEsp}
                    onChange={(e) => setFiltroEsp(e.target.value as typeof filtroEsp)}
                    aria-label="Filtrar por especialidad"
                  >
                    <option value="todos">Todas</option>
                    {opcionesEsp.map((e) => (
                      <option key={e} value={e}>
                        {ESP_LABEL[e]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Localidad</label>
                  <select
                    className={selectClass}
                    value={filtroLoc}
                    onChange={(e) => setFiltroLoc(e.target.value)}
                    aria-label="Filtrar por localidad"
                  >
                    <option value="todos">Todas</option>
                    {opcionesLoc.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button type="button" size="sm" variant="secondary" disabled={pendientesFiltrados.length === 0} onClick={seleccionarPendientesVisibles}>
                  Seleccionar visibles ({pendientesFiltrados.length})
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={pendientesFiltrados.length === 0} onClick={quitarSeleccionVisibles}>
                  Quitar selección en lista filtrada
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={seleccionarTodosPendientesPropuesta}>
                  Seleccionar todos los pendientes
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={elegidos.size === 0} onClick={limpiarSeleccion}>
                  Limpiar toda la selección
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-brand/25">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Aprobar o rechazar</CardTitle>
              <CardDescription className="text-pretty space-y-2 [&>span]:block">
                <span>
                  Los ítems planificados fueron asignados por vos desde el calendario anual.
                </span>
                <span>
                  Las urgencias fueron detectadas automáticamente por el motor (vencidos, críticos o próximos a vencer
                  sin semana asignada).
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy || nSeleccionadosPendientes === 0}
                  onClick={aprobarSeleccionados}
                >
                  Aprobar seleccionados ({nSeleccionadosPendientes})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  disabled={busy || nSeleccionadosPendientes === 0}
                  onClick={() =>
                    void ejecutarRechazarVarios(
                      [...new Set(idsElegidosRef.current.map((x) => String(x).trim()).filter(Boolean))],
                    )
                  }
                >
                  Rechazar seleccionados ({nSeleccionadosPendientes})
                </Button>
              </div>
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Sin usar checkboxes — actúa sobre todos los visibles con los filtros actuales
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || pendientesFiltrados.length === 0}
                    onClick={() => void aprobarVisibles()}
                  >
                    Aprobar visibles ({pendientesFiltrados.length})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    disabled={busy || pendientesFiltrados.length === 0}
                    onClick={() => void rechazarVisibles()}
                  >
                    Rechazar visibles ({pendientesFiltrados.length})
                  </Button>
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Acción global — aplica a todos los pendientes ignorando filtros
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || totalPendientesPropuesta === 0}
                    onClick={() => void aprobarTodosLosPendientes()}
                  >
                    Aprobar todos ({totalPendientesPropuesta})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    disabled={busy || totalPendientesPropuesta === 0}
                    onClick={() => void rechazarTodosLosPendientes()}
                  >
                    Rechazar todos ({totalPendientesPropuesta})
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {itemsFiltrados.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              Ningún ítem coincide con los filtros. Probá limpiar criterios o cambiar «Estado en lista».
            </p>
          ) : (
            <div className="space-y-8">
              {pendientesFiltrados.length > 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    className="size-4 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    onChange={onHeaderCheckboxChange}
                    aria-label="Seleccionar o quitar todos los pendientes visibles"
                  />
                  <span className="text-sm text-muted-foreground">
                    Marcar / desmarcar todos los pendientes de esta vista ({pendientesFiltrados.length})
                  </span>
                </div>
              ) : null}
              {itemsPlanFiltrados.length > 0 ? (
                <section className="space-y-3" aria-labelledby="aprobacion-planificados-heading">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                    <div>
                      <h2 id="aprobacion-planificados-heading" className="text-base font-semibold tracking-tight">
                        Planificados para esta semana
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Asignados desde el calendario anual para esta semana ISO.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="border-green-600/40 text-green-800 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
                      disabled={busy || totalPlanificadosPendientesGlobales === 0}
                      onClick={() => void aprobarTodosLosPlanificadosPendientes()}
                    >
                      Aprobar todos los planificados ({totalPlanificadosPendientesGlobales})
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {itemsPlanFiltrados.map((item) => (
                      <PropuestaItemFila
                        key={item.id}
                        item={item}
                        origenUi="planificado"
                        seleccionado={elegidos.has(item.id)}
                        busy={busy}
                        onToggle={() => toggle(item.id)}
                        onAprobarUno={() => ejecutarAprobar([item.id])}
                        onRechazarUno={() => void rechazar(item.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
              {itemsUrgenciaFiltrados.length > 0 ? (
                <section className="space-y-3" aria-labelledby="aprobacion-urgencias-heading">
                  <div className="border-b border-border pb-3">
                    <h2 id="aprobacion-urgencias-heading" className="text-base font-semibold tracking-tight">
                      Urgencias detectadas por el motor
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Vencidos, equipos críticos sin semana o próximos a vencer sin asignar.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {itemsUrgenciaFiltrados.map((item) => (
                      <PropuestaItemFila
                        key={item.id}
                        item={item}
                        origenUi="urgencia"
                        seleccionado={elegidos.has(item.id)}
                        busy={busy}
                        onToggle={() => toggle(item.id)}
                        onAprobarUno={() => ejecutarAprobar([item.id])}
                        onRechazarUno={() => void rechazar(item.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
            </>
          ) : null}

          {(propuesta.advertencias ?? []).length ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Advertencias del motor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm text-muted-foreground">
                {propuesta.advertencias!.map((a, i) => (
                  <p key={i}>• {a}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}

        </div>
      ) : null}
    </div>
  );
}
