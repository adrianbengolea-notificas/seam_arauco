"use client";

import { ProgramaSemanalClient } from "@/app/programa-semanal/programa-semanal-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";
import { useProgramaSemana, useSemanasDisponibles } from "@/modules/scheduling/hooks";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import type {
  AvisoSlot,
  DiaSemanaPrograma,
  EspecialidadPrograma,
  ProgramaSemana,
  SlotSemanal,
} from "@/modules/scheduling/types";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useAuth } from "@/modules/users/hooks";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const DIAS_ORDEN: DiaSemanaPrograma[] = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const DIA_LABEL: Record<DiaSemanaPrograma, string> = {
  lunes: "Lun",
  martes: "Mar",
  miercoles: "Mié",
  jueves: "Jue",
  viernes: "Vie",
  sabado: "Sáb",
};

const DIA_LABEL_LARGO: Record<DiaSemanaPrograma, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
};

type FiltroEspecialidad = EspecialidadPrograma | "todos";
type FiltroDia = DiaSemanaPrograma | "todos";
type FiltroTipo = "todos" | "correctivo" | "urgente";

function avisoVariant(a: AvisoSlot): "urgente" | "correctivo" | "preventivo" {
  if (a.urgente) return "urgente";
  if (a.tipo === "correctivo") return "correctivo";
  return "preventivo";
}

function avisoPasaTipo(a: AvisoSlot, filtro: FiltroTipo): boolean {
  if (filtro === "todos") return true;
  if (filtro === "correctivo") return a.tipo === "correctivo";
  return a.urgente === true;
}

function slotsFiltrados(
  programa: ProgramaSemana | null,
  esp: FiltroEspecialidad,
  dia: FiltroDia,
  tipo: FiltroTipo,
): SlotSemanal[] {
  if (!programa?.slots?.length) return [];
  return programa.slots.filter((s) => {
    if (esp !== "todos" && s.especialidad !== esp) return false;
    if (dia !== "todos" && s.dia !== dia) return false;
    const avisosOk = (s.avisos ?? []).filter((a) => avisoPasaTipo(a, tipo));
    return avisosOk.length > 0;
  });
}

function celdasPorLocalidad(
  slots: SlotSemanal[],
  tipo: FiltroTipo,
): Map<string, Map<DiaSemanaPrograma, AvisoSlot[]>> {
  const out = new Map<string, Map<DiaSemanaPrograma, AvisoSlot[]>>();

  for (const slot of slots) {
    const loc = slot.localidad?.trim() || "—";
    const avisos = (slot.avisos ?? []).filter((a) => avisoPasaTipo(a, tipo));
    if (!avisos.length) continue;

    let byDay = out.get(loc);
    if (!byDay) {
      byDay = new Map();
      out.set(loc, byDay);
    }
    const cur = byDay.get(slot.dia) ?? [];
    byDay.set(slot.dia, [...cur, ...avisos]);
  }

  return out;
}

type DrawerState = { aviso: AvisoSlot; slot: SlotSemanal } | null;

function AvisoDrawer({
  open,
  onClose,
  estado,
  puedeCrearOt,
}: {
  open: boolean;
  onClose: () => void;
  estado: DrawerState;
  puedeCrearOt: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !estado) return null;

  const { aviso, slot } = estado;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
        aria-label="Cerrar panel"
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aviso-drawer-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aviso</p>
            <h2 id="aviso-drawer-title" className="truncate font-mono text-lg font-semibold">
              {aviso.numero}
            </h2>
            <p className="text-xs text-muted-foreground">
              {slot.localidad} · {slot.especialidad === "Electrico" ? "Eléctrico" : slot.especialidad} ·{" "}
              {DIA_LABEL_LARGO[slot.dia]}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Descripción</p>
            <p className="mt-1 leading-relaxed text-foreground">{aviso.descripcion}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Equipo</p>
              <p className="mt-1 font-mono text-foreground">{aviso.equipoCodigo ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ubicación</p>
              <p className="mt-1 text-foreground">{aviso.ubicacion ?? "—"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={avisoVariant(aviso)}>
              {aviso.urgente ? "Urgente" : aviso.tipo === "correctivo" ? "Correctivo" : "Preventivo"}
            </Badge>
          </div>
        </div>
        {puedeCrearOt ? (
          <div className="border-t border-border p-4">
            <Button className="w-full" asChild>
              <Link href={`/tareas/nueva?avisoId=${encodeURIComponent(aviso.numero)}`}>+ Crear OT</Link>
            </Button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

export function ProgramaClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const vistaOperativo = searchParams.get("vista") === "operativo";

  const { user, profile, loading: authLoading } = useAuth();
  const centro = profile?.centro ?? DEFAULT_CENTRO;

  const { semanas, loading: semanasLoading, error: semanasError } = useSemanasDisponibles(centro, user?.uid);

  function setVistaPublicada() {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("vista");
    const q = p.toString();
    router.replace(q ? `/programa?${q}` : "/programa");
  }

  function setVistaOperativa() {
    const p = new URLSearchParams(searchParams.toString());
    p.set("vista", "operativo");
    router.replace(`/programa?${p.toString()}`);
  }

  const [semanaIdElegida, setSemanaIdElegida] = useState<string | null>(null);
  const [filtroEsp, setFiltroEsp] = useState<FiltroEspecialidad>("todos");
  const [filtroDia, setFiltroDia] = useState<FiltroDia>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [localidadTab, setLocalidadTab] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);

  const semanaId = useMemo(() => {
    if (!semanas.length) return "";
    if (semanaIdElegida && semanas.some((s) => s.id === semanaIdElegida)) return semanaIdElegida;
    const hoyIso = getIsoWeekId(new Date());
    if (semanas.some((s) => s.id === hoyIso)) return hoyIso;
    return semanas[0]!.id;
  }, [semanas, semanaIdElegida]);

  const { programa, loading: programaLoading, error: programaError } = useProgramaSemana(
    semanaId || undefined,
    user?.uid,
  );

  const slotsVisibles = useMemo(
    () => slotsFiltrados(programa, filtroEsp, filtroDia, filtroTipo),
    [programa, filtroEsp, filtroDia, filtroTipo],
  );

  const grid = useMemo(() => celdasPorLocalidad(slotsVisibles, filtroTipo), [slotsVisibles, filtroTipo]);

  const localidades = useMemo(() => Array.from(grid.keys()).sort((a, b) => a.localeCompare(b, "es")), [grid]);

  const localidadMobile = useMemo(() => {
    if (!localidades.length) return "";
    if (localidadTab && localidades.includes(localidadTab)) return localidadTab;
    return localidades[0]!;
  }, [localidades, localidadTab]);

  const diasColumnas = useMemo(
    () => (filtroDia === "todos" ? DIAS_ORDEN : [filtroDia]),
    [filtroDia],
  );

  const { puede } = usePermisos();
  const puedeCrearOt = puede("programa:crear_ot");
  const esAdmin = puede("programa:editar");

  const cerrarDrawer = useCallback(() => setDrawer(null), []);

  const tablaLoading = authLoading || semanasLoading || (Boolean(semanaId) && programaLoading);

  if (authLoading) {
    return <p className="text-sm text-muted-foreground">Cargando sesión…</p>;
  }

  if (vistaOperativo) {
    return (
      <div className="space-y-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Programa semanal</h1>
              <p className="text-sm text-muted-foreground">
                Centro <span className="font-mono">{centro}</span>
                {profile?.rol ? ` · ${profile.rol}` : null}
              </p>
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
            <Button
              type="button"
              variant={vistaOperativo ? "ghost" : "secondary"}
              size="sm"
              className={cn(!vistaOperativo && "shadow-sm")}
              onClick={setVistaPublicada}
            >
              Grilla publicada
            </Button>
            <Button
              type="button"
              variant={vistaOperativo ? "secondary" : "ghost"}
              size="sm"
              className={cn(vistaOperativo && "shadow-sm")}
              onClick={setVistaOperativa}
            >
              OT, texto e importar Excel
            </Button>
          </div>
        </header>
        <ProgramaSemanalClient embedded />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Programa semanal</h1>
            <p className="text-sm text-muted-foreground">
              Centro <span className="font-mono">{centro}</span>
              {profile?.rol ? ` · ${profile.rol}` : null}
            </p>
          </div>
          <label className="flex min-w-[min(100%,20rem)] flex-col gap-1 text-sm font-medium text-foreground">
            Semana
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal shadow-sm"
              value={semanaId}
              onChange={(e) => setSemanaIdElegida(e.target.value)}
              disabled={semanasLoading || !semanas.length}
            >
              {!semanas.length ? <option value="">— Sin semanas —</option> : null}
              {semanas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-muted/30 p-1">
          <Button type="button" variant="secondary" size="sm" className="shadow-sm" onClick={setVistaPublicada}>
            Grilla publicada
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={setVistaOperativa}>
            OT, texto e importar Excel
          </Button>
        </div>
      </header>

      {semanasError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          <p className="font-medium">No se pudieron cargar las semanas publicadas</p>
          <p className="mt-1">{semanasError.message}</p>
          {(semanasError as { code?: string }).code === "permission-denied" ? (
            <p className="mt-2 text-foreground">
              Comprobá que en Firebase estén desplegadas las reglas del repo (colección{" "}
              <span className="font-mono">programa_semanal</span>, lectura para usuarios
              con sesión) y que exista tu perfil en la colección <span className="font-mono">users</span> con rol
              válido. Mientras tanto podés usar la pestaña{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={setVistaOperativa}
              >
                OT, texto e importar Excel
              </button>{" "}
              (plan en <span className="font-mono">weekly_schedule</span>).
            </p>
          ) : null}
        </div>
      ) : null}
      {programaError ? (
        <p className="text-sm text-destructive" role="alert">
          No se pudo cargar el programa: {programaError.message}
        </p>
      ) : null}

      <section className="flex flex-wrap gap-3">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Especialidad
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal capitalize text-foreground shadow-sm"
            value={filtroEsp}
            onChange={(e) => setFiltroEsp(e.target.value as FiltroEspecialidad)}
          >
            <option value="todos">Todos</option>
            <option value="Aire">Aire</option>
            <option value="Electrico">Eléctrico</option>
            <option value="GG">GG</option>
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Día
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
            value={filtroDia}
            onChange={(e) => setFiltroDia(e.target.value as FiltroDia)}
          >
            <option value="todos">Todos</option>
            {DIAS_ORDEN.map((d) => (
              <option key={d} value={d}>
                {DIA_LABEL_LARGO[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tipo
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)}
          >
            <option value="todos">Todos</option>
            <option value="correctivo">Correctivo</option>
            <option value="urgente">Urgente</option>
          </select>
        </label>
      </section>

      {!semanas.length && !semanasLoading ? (
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
            <p>No hay programas publicados en la grilla clásica (colección programa_semanal) para este centro.</p>
            <p>
              Para cargar el plan con Excel, texto manual u OT en calendario, abrí la pestaña{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={setVistaOperativa}
              >
                OT, texto e importar Excel
              </button>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}

      {semanaId && !programaLoading && !programa ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Sin programa cargado para esta semana.</p>
            {esAdmin ? (
              <Button variant="outline" type="button" onClick={setVistaOperativa}>
                Cargar / importar Excel
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tablaLoading ? (
        <p className="text-sm text-muted-foreground">Cargando grilla…</p>
      ) : programa && localidades.length ? (
        <>
          {/* Móvil: una localidad + días en columnas */}
          <div className="md:hidden space-y-3">
            <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
              {localidades.map((loc) => (
                <Button
                  key={loc}
                  type="button"
                  size="sm"
                  variant={localidadMobile === loc ? "default" : "secondary"}
                  className="shrink-0 rounded-full"
                  onClick={() => setLocalidadTab(loc)}
                >
                  {loc}
                </Button>
              ))}
            </div>
            {localidadMobile ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[20rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-foreground/[0.03]">
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Día</th>
                      <th className="px-2 py-2 text-left font-semibold text-foreground">Avisos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diasColumnas.map((d) => {
                      const avisos = grid.get(localidadMobile)?.get(d) ?? [];
                      return (
                        <tr key={d} className="border-b border-border last:border-0">
                          <td className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">
                            {DIA_LABEL_LARGO[d]}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex flex-wrap gap-1">
                              {avisos.map((a, i) => (
                                <button
                                  key={`${a.numero}-${i}`}
                                  type="button"
                                  onClick={() => {
                                    const slot = (programa?.slots ?? []).find(
                                      (s) =>
                                        (s.localidad?.trim() || "—") === localidadMobile &&
                                        s.dia === d &&
                                        (s.avisos ?? []).some((x) => x.numero === a.numero),
                                    );
                                    if (slot) setDrawer({ aviso: a, slot });
                                  }}
                                  className="inline-block min-w-0 max-w-full"
                                >
                                  <Badge variant={avisoVariant(a)} className="max-w-[10rem] cursor-pointer truncate">
                                    {a.numero}
                                  </Badge>
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* Desktop: localidades en filas */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-foreground/[0.03]">
                  <th className="sticky left-0 z-10 min-w-[8rem] border-r border-border bg-foreground/[0.03] px-3 py-2 text-left font-semibold text-foreground">
                    Localidad
                  </th>
                  {diasColumnas.map((d) => (
                    <th key={d} className="px-2 py-2 text-center font-semibold text-muted-foreground">
                      {DIA_LABEL[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {localidades.map((loc) => (
                  <tr key={loc} className="border-b border-border last:border-0">
                    <td className="sticky left-0 z-10 border-r border-border bg-background px-3 py-2 font-medium text-foreground">
                      {loc}
                    </td>
                    {diasColumnas.map((d) => {
                      const avisos = grid.get(loc)?.get(d) ?? [];
                      return (
                        <td key={`${loc}-${d}`} className="align-top px-2 py-2">
                          <div className="flex min-h-[2rem] flex-wrap justify-center gap-1">
                            {avisos.map((a, i) => (
                              <button
                                key={`${a.numero}-${i}`}
                                type="button"
                                onClick={() => {
                                  const slot = (programa?.slots ?? []).find(
                                    (s) =>
                                      (s.localidad?.trim() || "—") === loc &&
                                      s.dia === d &&
                                      (s.avisos ?? []).some((x) => x.numero === a.numero),
                                  );
                                  if (slot) setDrawer({ aviso: a, slot });
                                }}
                                className="inline-block min-w-0 max-w-full"
                              >
                                <Badge variant={avisoVariant(a)} className="max-w-[6rem] cursor-pointer truncate">
                                  {a.numero}
                                </Badge>
                              </button>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : programa && !localidades.length ? (
        <p className="text-sm text-muted-foreground">No hay avisos con los filtros seleccionados.</p>
      ) : null}

      <AvisoDrawer open={drawer !== null} onClose={cerrarDrawer} estado={drawer} puedeCrearOt={puedeCrearOt} />
    </div>
  );
}
