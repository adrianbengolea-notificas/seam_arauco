"use client";

import {
  actionMoveWeekSlotToDay,
  actionRemoveWeekSlot,
  actionScheduleWorkOrderInWeek,
  actionSearchWorkOrdersForAgenda,
} from "@/app/actions/schedule";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpIconTooltip } from "@/components/ui/help-icon-tooltip";
import { Input } from "@/components/ui/input";
import { DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { useWeeklySlotsLive } from "@/modules/scheduling/hooks";
import {
  getIsoWeekId,
  parseIsoWeekIdFromSemanaParam,
  parseIsoWeekToBounds,
  shiftIsoWeekId,
} from "@/modules/scheduling/iso-week";
import type { WeeklyScheduleSlot } from "@/modules/scheduling/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import type { WorkOrderAgendaSearchRow } from "@/modules/work-orders/search-weekly-agenda-admin";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";


const DIA_LABEL: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

function formatWeekRange(weekId: string): string {
  const { start, end } = parseIsoWeekToBounds(weekId);
  const fmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" });
  const fmtDay = new Intl.DateTimeFormat("es-AR", { day: "numeric" });
  if (start.getMonth() === end.getMonth()) {
    return `${fmtDay.format(start)} al ${fmt.format(end)}`;
  }
  return `${fmt.format(start)} al ${fmt.format(end)}`;
}

function groupSlotsByDay(rows: WeeklyScheduleSlot[]): Map<number, WeeklyScheduleSlot[]> {
  const m = new Map<number, WeeklyScheduleSlot[]>();
  for (const r of rows) {
    const arr = m.get(r.dia_semana) ?? [];
    arr.push(r);
    m.set(r.dia_semana, arr);
  }
  for (const [k, arr] of m) {
    arr.sort((a, b) => a.orden_en_dia - b.orden_en_dia);
    m.set(k, arr);
  }
  return m;
}

function labelOrdenAgendaSemanal(
  w: Pick<WorkOrder, "n_ot" | "codigo_activo_snapshot" | "estado"> & { centro?: string },
  opts?: { variosCentros?: boolean },
): string {
  const base = `OT n.º ${w.n_ot} · ${w.codigo_activo_snapshot} · ${w.estado}`;
  if (opts?.variosCentros && w.centro?.trim()) {
    return `${base} · ${nombreCentro(w.centro.trim())}`;
  }
  return base;
}

const WEEKLY_SLOT_DRAG_MIME = "application/json";

function parseWeeklySlotDragPayload(raw: string): { slotId: string; fromDia: number } | null {
  try {
    const o = JSON.parse(raw) as { slotId?: unknown; fromDia?: unknown };
    if (typeof o.slotId !== "string" || o.slotId.length === 0) return null;
    const fd = Number(o.fromDia);
    if (!Number.isInteger(fd) || fd < 1 || fd > 7) return null;
    return { slotId: o.slotId, fromDia: fd };
  } catch {
    return null;
  }
}


export function ProgramaSemanalClient({
  embedded = false,
  centroTrabajo,
  /** Semana ISO al abrir desde /programa (misma que la grilla publicada). */
  initialWeekId,
}: {
  embedded?: boolean;
  /** Centro de contexto cuando el padre ya resolvió planta (p. ej. superadmin por URL). */
  centroTrabajo?: string;
  initialWeekId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const semanaEnUrl = searchParams.get("semana")?.trim() ?? null;
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  const { puede } = usePermisos();
  const [weekId, setWeekId] = useState(() => {
    if (embedded) {
      return (
        parseIsoWeekIdFromSemanaParam(semanaEnUrl) ??
          parseIsoWeekIdFromSemanaParam(initialWeekId) ??
          getIsoWeekId(new Date())
      );
    }
    return parseIsoWeekIdFromSemanaParam(initialWeekId) ?? getIsoWeekId(new Date());
  });

  const centro =
    (centroTrabajo?.trim() || profile?.centro?.trim() || DEFAULT_CENTRO).trim();
  const centrosOpcionesBusqueda = useMemo(() => {
    const rol = profile?.rol?.trim();
    const list =
      rol === "superadmin" ? [...KNOWN_CENTROS] : centrosEfectivosDelUsuario(profile ?? null);
    return [...new Set(list.map((c) => c.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [profile]);
  const [centroFiltroBusquedaOt, setCentroFiltroBusquedaOt] = useState<"__ALL__" | string>("__ALL__");
  const centroParamBusqueda =
    centroFiltroBusquedaOt === "__ALL__" ? undefined : centroFiltroBusquedaOt.trim();
  const canEdit = puede("programa:editar");
  const puedePlanOperativo = puede("programa:crear_ot") || puede("programa:editar");

  useEffect(() => {
    /** En `/programa?vista=operativo` el padre ya validó permisos; no rebobinar por carreras entre hooks de perfil. */
    if (embedded) return;
    if (authLoading || profileLoading) return;
    if (!puedePlanOperativo) router.replace("/programa");
  }, [embedded, authLoading, profileLoading, puedePlanOperativo, router]);

  // No suscribir hasta que el perfil cargó: evita que centro = DEFAULT_CENTRO filtre slots reales
  const uidParaSlots = profileLoading ? undefined : user?.uid;
  const { slots, loading: slotsLoading, error: slotsError } = useWeeklySlotsLive(weekId, uidParaSlots, centro);
  const [agendaWos, setAgendaWos] = useState<WorkOrderAgendaSearchRow[]>([]);
  const [agendaSearchLoading, setAgendaSearchLoading] = useState(false);
  const [agendaListError, setAgendaListError] = useState<string | null>(null);
  const [workOrderId, setWorkOrderId] = useState("");
  const [selectedWoSnapshot, setSelectedWoSnapshot] = useState<WorkOrderAgendaSearchRow | null>(null);
  const [woPickerOpen, setWoPickerOpen] = useState(false);
  const [woSearchQuery, setWoSearchQuery] = useState("");
  const woComboboxRef = useRef<HTMLDivElement>(null);
  const [dia, setDia] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [turno, setTurno] = useState<"" | "A" | "B" | "C">("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agendaBootLoading, setAgendaBootLoading] = useState(true);
  const [dropTargetDia, setDropTargetDia] = useState<number | null>(null);

  const slotsByDay = useMemo(() => groupSlotsByDay(slots), [slots]);

  const selectedScheduleableWo = useMemo(() => {
    const fromList = agendaWos.find((w) => w.id === workOrderId);
    if (fromList) return fromList;
    if (selectedWoSnapshot?.id === workOrderId) return selectedWoSnapshot;
    return undefined;
  }, [agendaWos, workOrderId, selectedWoSnapshot]);

  useEffect(() => {
    if (!canEdit || !user?.uid || profileLoading) {
      setAgendaBootLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setAgendaBootLoading(true);
      try {
        const tok = await getClientIdToken();
        if (!tok || cancelled) return;
        const res = await actionSearchWorkOrdersForAgenda(tok, {
          centro: centroParamBusqueda,
          query: "",
        });
        if (cancelled) return;
        if (res.ok) {
          setAgendaWos(res.data);
          setAgendaListError(null);
        } else {
          setAgendaListError(res.error.message);
        }
      } finally {
        if (!cancelled) setAgendaBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, centroParamBusqueda, user?.uid, profileLoading]);

  useEffect(() => {
    if (!woPickerOpen || !canEdit || !user?.uid || profileLoading) return;
    let cancelled = false;
    const delayMs = woSearchQuery.trim() ? 300 : 0;
    const t = setTimeout(() => {
      void (async () => {
        const tok = await getClientIdToken();
        if (!tok || cancelled) return;
        setAgendaSearchLoading(true);
        try {
          const res = await actionSearchWorkOrdersForAgenda(tok, {
            centro: centroParamBusqueda,
            query: woSearchQuery.trim(),
          });
          if (cancelled) return;
          if (res.ok) {
            setAgendaWos(res.data);
            setAgendaListError(null);
          } else {
            setAgendaListError(res.error.message);
          }
        } finally {
          if (!cancelled) setAgendaSearchLoading(false);
        }
      })();
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [woPickerOpen, woSearchQuery, centroParamBusqueda, canEdit, user?.uid, profileLoading]);

  useEffect(() => {
    if (!woPickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (woComboboxRef.current?.contains(e.target as Node)) return;
      setWoPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [woPickerOpen]);

  async function token(): Promise<string> {
    const t = await getClientIdToken();
    if (!t) throw new Error("Sin sesión");
    return t;
  }

  async function onAdd() {
    setMsg(null);
    if (!workOrderId) {
      setMsg("Elegí una OT");
      return;
    }
    setBusy(true);
    try {
      const res = await actionScheduleWorkOrderInWeek(await token(), {
        weekId,
        workOrderId,
        dia_semana: dia,
        turno: turno || undefined,
      });
      setMsg(res.ok ? "Agregado al programa" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(slotId: string) {
    if (!confirm("¿Quitar esta OT del programa?")) return;
    setMsg(null);
    setBusy(true);
    try {
      const res = await actionRemoveWeekSlot(await token(), { weekId, slotId });
      setMsg(res.ok ? "Quitado del programa" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function onMoveSlotToDay(slotId: string, fromDia: number, destDia: 1 | 2 | 3 | 4 | 5 | 6 | 7) {
    if (fromDia === destDia) return;
    setMsg(null);
    setBusy(true);
    try {
      const res = await actionMoveWeekSlotToDay(await token(), {
        weekId,
        slotId,
        dia_semana: destDia,
      });
      setMsg(res.ok ? "Movido al día elegido" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || profileLoading) {
    return <p className="text-sm text-muted-foreground">Cargando perfil…</p>;
  }

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {embedded ? (
          <>
            <div>
              <div className="flex items-start gap-2">
                <h2 className="text-lg font-semibold tracking-tight">Agendar OTs</h2>
                <HelpIconTooltip
                  variant="info"
                  className="mt-0.5"
                  ariaLabel="Cómo se arma la semana y cómo se ve en consulta"
                  panelClassName="right-0 left-auto w-[min(28rem,calc(100vw-2.5rem))] sm:left-0 sm:right-auto"
                >
                  <span className="block space-y-2 text-left">
                    <p>
                      Elegí una <strong>OT existente</strong>, asignale un <strong>día de la semana</strong> y guardala. Abajo ves el resumen de todo lo agendado.
                    </p>
                    <p className="text-muted-foreground">
                      El combo lista <strong>OTs ya creadas</strong> (p. ej. desde avisos en{" "}
                      <strong>Tareas</strong>); no son las filas del Excel de preventivos.
                    </p>
                    <p className="text-muted-foreground">
                      La pestaña <strong>Programa publicado</strong> muestra la grilla de consulta para toda la cuadrilla.
                    </p>
                  </span>
                </HelpIconTooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                Centro <span className="font-medium text-foreground">{nombreCentro(centro)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label="Semana anterior"
                onClick={() => setWeekId((w) => shiftIsoWeekId(w, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col items-center">
                <span className="font-mono text-base font-semibold">{weekId}</span>
                <span className="text-[10px] text-muted-foreground">{formatWeekRange(weekId)}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label="Semana siguiente"
                onClick={() => setWeekId((w) => shiftIsoWeekId(w, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setWeekId(getIsoWeekId(new Date()))}>
                Hoy
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="flex items-start gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">Programa semanal — edición</h1>
                <HelpIconTooltip
                  variant="info"
                  className="mt-1.5"
                  ariaLabel="Cómo se arma el programa en esta pantalla"
                  panelClassName="right-0 left-auto w-[min(28rem,calc(100vw-2.5rem))]"
                >
                  <span className="block space-y-2 text-left">
                    <p>
                      Asigná <strong>OTs</strong> a los <strong>días de la semana ISO</strong> para tu
                      centro (calendario operativo).
                    </p>
                    <p className="text-muted-foreground">
                      Solo podés agendar <strong>OTs</strong> que ya existan; el maestro Excel de
                      preventivos carga <strong>avisos</strong> en{" "}
                      <strong>Administración → Configuración e importación</strong>.
                    </p>
                    <p className="text-muted-foreground">
                      La grilla de consulta con avisos por localidad y día es la pestaña «Programa publicado» en{" "}
                      <strong>/programa</strong> si tu rol puede verla.
                    </p>
                  </span>
                </HelpIconTooltip>
              </div>
              <p className="text-sm text-muted-foreground">
                Centro <span className="font-medium text-foreground">{nombreCentro(centro)}</span>
                {profile?.rol ? ` · ${profile.rol}` : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label="Semana anterior"
                onClick={() => setWeekId((w) => shiftIsoWeekId(w, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col items-center">
                <span className="font-mono text-lg font-semibold">{weekId}</span>
                <span className="text-[10px] text-muted-foreground">{formatWeekRange(weekId)}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label="Semana siguiente"
                onClick={() => setWeekId((w) => shiftIsoWeekId(w, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setWeekId(getIsoWeekId(new Date()))}>
                Hoy
              </Button>
            </div>
          </>
        )}
      </div>

      {msg ? (
        <p className="text-sm" role="status">
          {msg}
        </p>
      ) : null}

      {slotsError ? (
        <p className="text-sm text-destructive">
          Error al cargar las OTs del programa: {slotsError.message}.
          {(slotsError as { code?: string }).code === "permission-denied"
            ? " Verificá que la sesión esté activa y que tu rol tenga acceso a esta sección."
            : " Contactá al administrador si el problema persiste."}
        </p>
      ) : null}

      {canEdit ? (
        <>
          {/* ── CARD 1: Agendar OT al calendario ── */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <CardDescription>
                    Elegí una orden existente, asignale un día (y turno si aplica) y guardala en la semana.
                  </CardDescription>
                  <p className="mt-2 text-xs leading-snug text-muted-foreground">
                    Solo aparecen <strong className="text-foreground">OTs</strong> ya creadas en{" "}
                    <Link href="/tareas" className="font-medium text-primary underline underline-offset-2">
                      Tareas
                    </Link>
                    . El Excel de preventivos carga el maestro de <strong className="text-foreground">avisos</strong> en{" "}
                    <Link
                      href="/superadmin/configuracion"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      Administración → Configuración e importación
                    </Link>
                    ; buscá por n.º OT, aviso SAP, código o texto.
                  </p>
                  {!embedded ? (
                    <details className="mt-3 rounded-md border border-border bg-muted/25 px-3 py-2 text-xs leading-relaxed">
                      <summary className="cursor-pointer font-medium text-foreground">
                        Cómo funciona el flujo completo
                      </summary>
                      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-muted-foreground">
                        <li>
                          Importar maestro preventivos: Administración → Configuración e importación (Excel
                          AVISOS_PREVENTIVOS).
                        </li>
                        <li>Generar o abrir órdenes desde esos avisos en Tareas.</li>
                        <li>
                          En esta pantalla, agendar cada OT en el día (y turno) de la semana ISO.
                        </li>
                        <li>La planta consulta el calendario en la pestaña Programa publicado.</li>
                      </ol>
                    </details>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {agendaListError ? (
                <p className="text-sm text-destructive" role="alert">
                  No se pudieron cargar las OTs: {agendaListError}
                </p>
              ) : null}
              {!agendaBootLoading && !agendaListError && agendaWos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay OTs activas
                  {centroParamBusqueda ? (
                    <>
                      {" "}
                      para <span className="font-medium">{nombreCentro(centroParamBusqueda)}</span>
                    </>
                  ) : centrosOpcionesBusqueda.length > 1 ? (
                    <> en los centros donde podés operar</>
                  ) : (
                    <>
                      {" "}
                      para <span className="font-medium">{nombreCentro(centrosOpcionesBusqueda[0] ?? centro)}</span>
                    </>
                  )}
                  . Podés{" "}
                  <Link href="/tareas" className="font-medium text-primary underline underline-offset-2">
                    ver o crear OTs
                  </Link>{" "}
                  y volvé acá para agendarlas.
                </p>
              ) : null}
              <div className="flex flex-wrap items-end gap-3">
              {centrosOpcionesBusqueda.length > 1 ? (
                <label className="flex min-w-[11rem] flex-col gap-1 text-sm">
                  Centro (buscar OT)
                  <select
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={centroFiltroBusquedaOt}
                    onChange={(e) =>
                      setCentroFiltroBusquedaOt(e.target.value === "__ALL__" ? "__ALL__" : e.target.value)
                    }
                    disabled={busy || agendaBootLoading}
                  >
                    <option value="__ALL__">Todas las plantas</option>
                    {centrosOpcionesBusqueda.map((c) => (
                      <option key={c} value={c}>
                        {nombreCentro(c)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex min-w-[12rem] max-w-[min(100%,28rem)] flex-col gap-1 text-sm">
                OT
                <div ref={woComboboxRef} className="relative">
                  <button
                    type="button"
                    className="flex h-10 w-full min-w-[12rem] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={agendaBootLoading || busy}
                    aria-expanded={woPickerOpen}
                    aria-haspopup="listbox"
                    onClick={() => {
                      if (agendaBootLoading || busy) return;
                      setWoPickerOpen((o) => !o);
                      setWoSearchQuery("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setWoPickerOpen(false);
                    }}
                  >
                    <span className="truncate">
                      {selectedScheduleableWo
                        ? labelOrdenAgendaSemanal(selectedScheduleableWo, {
                            variosCentros: centrosOpcionesBusqueda.length > 1,
                          })
                        : "— Elegir —"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
                  </button>
                  {woPickerOpen ? (
                    <div
                      className="absolute left-0 right-0 z-50 mt-1 rounded-md border border-border bg-surface py-1 shadow-lg"
                      role="presentation"
                    >
                      <div className="border-b border-border px-2 pb-2 pt-1">
                        <Input
                          autoFocus
                          type="search"
                          autoComplete="off"
                          placeholder="n.º OT, aviso SAP, código activo, texto…"
                          value={woSearchQuery}
                          onChange={(e) => setWoSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setWoPickerOpen(false);
                            }
                          }}
                          className="h-9 text-sm"
                        />
                        {agendaSearchLoading ? (
                          <p className="mt-1.5 text-[11px] text-muted-foreground">Buscando…</p>
                        ) : null}
                      </div>
                      <ul
                        className="max-h-60 overflow-auto py-1 text-sm"
                        role="listbox"
                        aria-label="OTs"
                      >
                        <li role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={workOrderId === ""}
                            className="w-full px-3 py-2 text-left hover:bg-muted/80"
                            onClick={() => {
                              setWorkOrderId("");
                              setSelectedWoSnapshot(null);
                              setWoPickerOpen(false);
                              setWoSearchQuery("");
                            }}
                          >
                            — Elegir —
                          </button>
                        </li>
                        {agendaSearchLoading && agendaWos.length === 0 ? (
                          <li className="px-3 py-2 text-muted-foreground" role="presentation">
                            Buscando órdenes…
                          </li>
                        ) : !agendaSearchLoading && agendaWos.length === 0 ? (
                          <li className="px-3 py-2 text-muted-foreground" role="presentation">
                            No hay resultados. Probá otro n.º de OT, aviso o texto (hasta 60 coincidencias recientes en el
                            alcance elegido).
                          </li>
                        ) : (
                          agendaWos.map((w) => (
                            <li key={w.id} role="presentation">
                              <button
                                type="button"
                                role="option"
                                aria-selected={workOrderId === w.id}
                                className="w-full px-3 py-2 text-left hover:bg-muted/80 aria-selected:bg-muted"
                                onClick={() => {
                                  setWorkOrderId(w.id);
                                  setSelectedWoSnapshot(w);
                                  setWoPickerOpen(false);
                                  setWoSearchQuery("");
                                }}
                              >
                                {labelOrdenAgendaSemanal(w, {
                                  variosCentros: centrosOpcionesBusqueda.length > 1,
                                })}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Día
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={dia}
                  onChange={(e) => setDia(Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7)}
                  disabled={busy}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {DIA_LABEL[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Turno
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={turno}
                  onChange={(e) => setTurno(e.target.value as "" | "A" | "B" | "C")}
                  disabled={busy}
                >
                  <option value="">—</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </label>
              <Button type="button" onClick={() => void onAdd()} disabled={busy || agendaBootLoading}>
                📌 Agendar en esta semana
              </Button>
              </div>
            </CardContent>
          </Card>

        </>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">
            Órdenes agendadas · {formatWeekRange(weekId)}
          </p>
          {!slotsLoading && slots.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {slots.length} {slots.length === 1 ? "orden" : "órdenes"}
            </span>
          )}
        </div>

        {slotsLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay órdenes agendadas para esta semana.</p>
        ) : (
          <div className="space-y-2">
            {canEdit ? (
              <p className="text-xs text-muted-foreground">
                Arrastrá una orden desde el ícono <GripVertical className="inline h-3.5 w-3.5 align-text-bottom opacity-70" aria-hidden /> y soltala sobre la fila de otro día (también en días sin órdenes).
              </p>
            ) : null}
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    {canEdit ? (
                      <th className="w-8 px-1 py-2 text-left font-medium text-muted-foreground" aria-label="Mover" />
                    ) : null}
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Día</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                      Centro
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Orden</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                      Ubicación · Especialidad
                    </th>
                    {canEdit ? <th className="px-3 py-2 w-10" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[1, 2, 3, 4, 5, 6, 7].flatMap((d) => {
                    const daySlots = slotsByDay.get(d) ?? [];
                    const destDia = d as 1 | 2 | 3 | 4 | 5 | 6 | 7;
                    const highlightDrop = Boolean(canEdit && dropTargetDia === d);
                    const rowDropProps = canEdit
                      ? {
                          onDragOver: (e: React.DragEvent<HTMLTableRowElement>) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDropTargetDia(d);
                          },
                          onDrop: (e: React.DragEvent<HTMLTableRowElement>) => {
                            e.preventDefault();
                            setDropTargetDia(null);
                            const raw = e.dataTransfer.getData(WEEKLY_SLOT_DRAG_MIME);
                            const parsed = parseWeeklySlotDragPayload(raw);
                            if (!parsed) return;
                            void onMoveSlotToDay(parsed.slotId, parsed.fromDia, destDia);
                          },
                        }
                      : {};

                    if (daySlots.length === 0) {
                      return [
                        <tr
                          key={`empty-${d}`}
                          className={`hover:bg-muted/20${highlightDrop ? " bg-primary/10" : ""}`}
                          {...rowDropProps}
                        >
                          {canEdit ? (
                            <td className="w-8 p-1 align-middle" aria-hidden />
                          ) : null}
                          <td className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                            {DIA_LABEL[d]}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                            —
                          </td>
                          <td className="px-3 py-2 text-muted-foreground italic">Sin órdenes</td>
                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">—</td>
                          {canEdit ? <td className="px-3 py-2" /> : null}
                        </tr>,
                      ];
                    }

                    return daySlots.map((s, i) => (
                      <tr
                        key={s.id}
                        className={`hover:bg-muted/30${highlightDrop ? " bg-primary/10" : ""}`}
                        {...rowDropProps}
                      >
                        {canEdit ? (
                          <td
                            className="w-8 cursor-grab p-1 align-middle text-muted-foreground select-none active:cursor-grabbing"
                            title="Arrastrar a otro día"
                            draggable={!busy}
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                WEEKLY_SLOT_DRAG_MIME,
                                JSON.stringify({ slotId: s.id, fromDia: d }),
                              );
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDropTargetDia(null)}
                          >
                            <GripVertical className="mx-auto h-4 w-4" aria-hidden />
                          </td>
                        ) : null}
                        <td className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                          {i === 0 ? DIA_LABEL[d] : ""}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                          {s.centro ? nombreCentro(s.centro) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/tareas/${s.work_order_id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            n.º {s.n_ot_snapshot ?? s.work_order_id.slice(0, 8)}
                          </Link>
                          {s.turno && (
                            <span className="ml-1.5 text-xs text-muted-foreground">turno {s.turno}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                          {s.ubicacion_tecnica} · {s.especialidad}
                        </td>
                        {canEdit ? (
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              aria-label="Quitar del programa"
                              disabled={busy}
                              onClick={() => void onRemove(s.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
