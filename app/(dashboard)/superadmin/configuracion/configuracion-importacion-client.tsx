"use client";

import { actionEditAviso } from "@/app/actions/avisos";
import { actionAddAvisoToProgramaPublicado } from "@/app/actions/schedule";
import { PasoImportacionAvisos } from "@/components/importacion/paso-importacion-avisos";
import type { ResultadoImportacionAvisos } from "@/lib/importaciones/avisos-excel-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_EXCEL_IMPORT_BYTES } from "@/lib/config/limits";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import { useAvisosListaImportacionConfig, type TabImportacionAvisosId } from "@/modules/notices/hooks";
import type { Aviso, Especialidad, EstadoAviso, EstadoVencimientoAviso } from "@/modules/notices/types";
import { getClientIdToken, useAuthUser } from "@/modules/users/hooks";
import {
  diaIsoSemanaADiaPrograma,
  getIsoWeekId,
  isoDiaSemanaDesdeDateLocal,
  parseIsoWeekToBounds,
  shiftIsoWeekId,
} from "@/modules/scheduling/iso-week";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KNOWN_CENTROS,
  nombreCentro,
  PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA,
} from "@/lib/config/app-config";

const TAB_DEFS: {
  id: TabImportacionAvisosId;
  label: string;
  description: string;
  hidden?: boolean;
}[] = [
  { id: "todos", label: "Todos", description: "Todos los avisos cargados (preventivos y correctivos)." },
  {
    id: "preventivos_todas",
    label: "Preventivos",
    description: "Avisos preventivos (mensual, trimestral, semestral y anual).",
  },
  { id: "preventivos_mensual", label: "Mensual", description: "Frecuencia mensual (M)." },
  { id: "preventivos_trimestral", label: "Trimestral", description: "Frecuencia trimestral (T)." },
  { id: "preventivos_semestral", label: "Semestral", description: "Frecuencia semestral (S)." },
  { id: "preventivos_anual", label: "Anual", description: "Frecuencia anual (A)." },
  {
    id: "listado_semestral_anual",
    label: "Sem. + Anual",
    description: "Preventivos con badge semestral o anual.",
  },
  { id: "correctivos", label: "Correctivos", description: "Avisos de tipo correctivo." },
  {
    id: "mensuales_parche",
    label: "Parche mensuales",
    description: "Reimportar estado/fecha de mensuales (MENSUALES_*.xlsx).",
  },
  { id: "semanal_info", label: "Aviso semanal (futuro)", description: "", hidden: true },
];

const ESPECIALIDADES: Especialidad[] = ["AA", "ELECTRICO", "GG", "HG"];

type FiltroOtLista = "todos" | "con_ot" | "sin_ot";
type FiltroProgramaLista = "todos" | "en_semana" | "sin_semana";

const DIAS_PROG: { value: DiaSemanaPrograma; label: string }[] = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miercoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

function avisoTieneOrdenVinculada(a: Aviso): boolean {
  if (String(a.work_order_id ?? "").trim()) return true;
  if (String(a.antecesor_orden_abierta?.work_order_id ?? "").trim()) return true;
  return false;
}

function isoSemanaPrograma(a: Aviso): string | null {
  const iso = String(a.incluido_en_semana ?? "").trim();
  return /^\d{4}-W\d{2}$/.test(iso) ? iso : null;
}

function hrefProgramaSemanal(centro: string, weekId: string): string {
  const p = new URLSearchParams();
  p.set("semana", weekId);
  if (centro.trim()) p.set("centro", centro.trim());
  return `/programa?${p.toString()}`;
}

function fechaAvisoAInput(a: Aviso): string {
  const fp = a.fecha_programada;
  if (fp != null && typeof (fp as { toDate?: () => Date }).toDate === "function") {
    const d = (fp as { toDate: () => Date }).toDate();
    if (!Number.isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
  }
  return format(new Date(), "yyyy-MM-dd");
}

function semanaYDiaDesdeFecha(fechaYmd: string): { weekId: string; dia: DiaSemanaPrograma } {
  const d = new Date(`${fechaYmd}T12:00:00`);
  return {
    weekId: getIsoWeekId(d),
    dia: diaIsoSemanaADiaPrograma(isoDiaSemanaDesdeDateLocal(d)),
  };
}

// ─── Editable row (auditing table) ───────────────────────────────────────────

function FilaAvisoEditable({
  aviso,
  alGuardar,
  puedeProgramar,
  onAsignarPrograma,
}: {
  aviso: Aviso;
  alGuardar: () => void;
  puedeProgramar: boolean;
  onAsignarPrograma: (a: Aviso) => void;
}) {
  const [textoCorto, setTextoCorto] = useState(aviso.texto_corto ?? "");
  const [centro, setCentro] = useState(aviso.centro ?? "");
  const [especialidad, setEspecialidad] = useState<Aviso["especialidad"]>(aviso.especialidad);
  const [estadoPlanilla, setEstadoPlanilla] = useState(aviso.estado_planilla ?? "");
  const [busy, setBusy] = useState(false);
  const [retro, setRetro] = useState<string | null>(null);

  useEffect(() => {
    setTextoCorto(aviso.texto_corto ?? "");
    setCentro(aviso.centro ?? "");
    setEspecialidad(aviso.especialidad);
    setEstadoPlanilla(aviso.estado_planilla ?? "");
  }, [aviso.id, aviso.texto_corto, aviso.centro, aviso.especialidad, aviso.estado_planilla]);

  const guardar = useCallback(async () => {
    setBusy(true);
    setRetro(null);
    try {
      const token = await getClientIdToken();
      if (!token) {
        setRetro("Sesión expirada; volvé a iniciar sesión.");
        return;
      }
      const res = await actionEditAviso(token, {
        avisoId: aviso.id,
        texto_corto: textoCorto.trim(),
        centro: centro.trim(),
        especialidad,
        estado_planilla: estadoPlanilla.trim() || null,
      });
      if (!res.ok) {
        setRetro(res.error.message);
        return;
      }
      alGuardar();
      setRetro("OK");
      window.setTimeout(() => setRetro(null), 1600);
    } catch (e) {
      setRetro(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }, [alGuardar, aviso.id, centro, especialidad, estadoPlanilla, textoCorto]);

  const tieneOt = avisoTieneOrdenVinculada(aviso);
  const isoProg = isoSemanaPrograma(aviso);
  const centroHref = (centro.trim() || aviso.centro?.trim() || "").trim();
  const otId =
    aviso.work_order_id?.trim() ||
    aviso.antecesor_orden_abierta?.work_order_id?.trim() ||
    aviso.ultima_ejecucion_ot_id?.trim();

  return (
    <tr className="border-t border-border align-top">
      <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-foreground">{aviso.n_aviso}</td>
      <td className="min-w-[12rem] px-2 py-1.5">
        <Input value={textoCorto} onChange={(e) => setTextoCorto(e.target.value)} className="text-xs" />
      </td>
      <td className="min-w-[5rem] max-w-[7rem] px-2 py-1.5">
        <Input value={centro} onChange={(e) => setCentro(e.target.value)} className="font-mono text-xs" />
      </td>
      <td className="min-w-[6rem] px-2 py-1.5">
        <select
          className={cn(
            "h-10 w-full rounded-lg border border-border bg-surface px-2 text-xs",
            "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
          value={especialidad}
          onChange={(e) => setEspecialidad(e.target.value as Aviso["especialidad"])}
        >
          {ESPECIALIDADES.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-center text-xs text-muted-foreground">
        {aviso.frecuencia_plan_mtsa ?? "—"}
      </td>
      <td className="min-w-[6rem] px-2 py-1.5">
        <Input
          value={estadoPlanilla}
          onChange={(e) => setEstadoPlanilla(e.target.value)}
          className="text-xs"
          placeholder="—"
        />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">
        <div className="flex min-w-[10rem] flex-col items-stretch gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="inline-flex items-center gap-1.5 text-xs"
            disabled={busy}
            onClick={() => void guardar()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : null}
            Guardar cambios
          </Button>
          {puedeProgramar ? (
            <div className="flex flex-col gap-0.5 border-t border-border/60 pt-1">
              {tieneOt && otId ? (
                <Link
                  href={`/tareas/${otId}`}
                  className="text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Ver OT
                </Link>
              ) : (
                <Link
                  href={`/tareas/nueva?avisoId=${encodeURIComponent(aviso.id)}`}
                  className="text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Crear OT
                </Link>
              )}
              {isoProg && centroHref ? (
                <Link
                  href={hrefProgramaSemanal(centroHref, isoProg)}
                  className="text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Programa {isoProg}
                </Link>
              ) : !tieneOt ? (
                <button
                  type="button"
                  className="text-left text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onAsignarPrograma(aviso)}
                >
                  {aviso.tipo === "CORRECTIVO" ? "Ubicar en semana" : "Asignar a semana"}
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground">Sin semana en grilla</span>
              )}
            </div>
          ) : null}
          {retro ? <span className="text-[10px] text-muted-foreground">{retro}</span> : null}
        </div>
      </td>
    </tr>
  );
}

type SeccionPrincipalAvisos = "listado" | "importacion";

const SECCION_PRINCIPAL_DEFS: { id: SeccionPrincipalAvisos; label: string }[] = [
  { id: "listado", label: "Ver / editar avisos existentes" },
  { id: "importacion", label: "Importación (Excel)" },
];

// ─── Main component ───────────────────────────────────────────────────────────

export function ConfiguracionImportacionClient() {
  const { puede, rol, centro: perfilCentro } = usePermisos();
  const { user } = useAuthUser();
  const puedeImportar = puede("admin:cargar_programa");
  const puedeProgramar = puede("programa:crear_ot") || puede("programa:editar");
  const verTodosLosCentros = rol === "superadmin";

  const [seccionPrincipal, setSeccionPrincipal] = useState<SeccionPrincipalAvisos>("listado");
  const [tab, setTab] = useState<TabImportacionAvisosId>("todos");
  const [listaRefresh, setListaRefresh] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [filtroCentroLista, setFiltroCentroLista] = useState("");
  const [filtroEspLista, setFiltroEspLista] = useState<"" | Especialidad>("");
  const [filtroOtLista, setFiltroOtLista] = useState<FiltroOtLista>("todos");
  const [filtroProgramaLista, setFiltroProgramaLista] = useState<FiltroProgramaLista>("todos");
  const [filtroEstadoLista, setFiltroEstadoLista] = useState<"" | EstadoAviso>("");
  const [filtroVencLista, setFiltroVencLista] = useState<"" | EstadoVencimientoAviso>("");

  /* Legacy parche (mensuales_parche) — kept for the tab panel */
  const [legacyFile, setLegacyFile] = useState<File | null>(null);
  const [legacyBusy, setLegacyBusy] = useState<false | "preview" | "commit">(false);
  const [legacyResult, setLegacyResult] = useState<ResultadoImportacionAvisos | null>(null);
  const [lastLegacyDryRun, setLastLegacyDryRun] = useState<boolean | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);

  const { avisos, loading: listaLoading, error: listaError } = useAvisosListaImportacionConfig({
    tabId: tab,
    authUid: user?.uid,
    centro: perfilCentro,
    verTodosLosCentros,
    refreshToken: listaRefresh,
  });

  const recargarLista = useCallback(() => setListaRefresh((n) => n + 1), []);

  const [dialogProgramaOpen, setDialogProgramaOpen] = useState(false);
  const [pickPrograma, setPickPrograma] = useState<Aviso | null>(null);
  const [weekIdProg, setWeekIdProg] = useState(() => getIsoWeekId(new Date()));
  const [diaProg, setDiaProg] = useState<DiaSemanaPrograma>("lunes");
  const [fechaCorrectivo, setFechaCorrectivo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [progBusy, setProgBusy] = useState(false);
  const [progMsg, setProgMsg] = useState<string | null>(null);

  const esDialogCorrectivo = pickPrograma?.tipo === "CORRECTIVO";

  const opcionesSemanaIso = useMemo(() => {
    const hoy = getIsoWeekId(new Date());
    const out: { id: string; label: string }[] = [];
    for (let d = -8; d <= 24; d++) {
      const id = shiftIsoWeekId(hoy, d);
      const { start, end } = parseIsoWeekToBounds(id);
      const rango = `${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`;
      out.push({ id, label: `${id} · ${rango}` });
    }
    return out;
  }, []);

  const previewSemanaCorrectivo = useMemo(() => {
    if (!esDialogCorrectivo || !fechaCorrectivo.trim()) return null;
    const { weekId, dia } = semanaYDiaDesdeFecha(fechaCorrectivo);
    const { start, end } = parseIsoWeekToBounds(weekId);
    return {
      weekId,
      dia,
      label: `${weekId} · ${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })} (${dia})`,
    };
  }, [esDialogCorrectivo, fechaCorrectivo]);

  const abrirDialogoPrograma = useCallback((a: Aviso) => {
    setPickPrograma(a);
    setWeekIdProg(getIsoWeekId(new Date()));
    setDiaProg("lunes");
    setFechaCorrectivo(fechaAvisoAInput(a));
    setProgMsg(null);
    setDialogProgramaOpen(true);
  }, []);

  const agregarAlPrograma = useCallback(async () => {
    if (!pickPrograma) return;
    const c = (pickPrograma.centro ?? "").trim();
    if (!c) {
      setProgMsg("El aviso no tiene centro asignado.");
      return;
    }
    let weekId = weekIdProg;
    let dia = diaProg;
    if (esDialogCorrectivo) {
      const fecha = fechaCorrectivo.trim();
      if (!fecha) {
        setProgMsg("Elegí la fecha de realización.");
        return;
      }
      ({ weekId, dia } = semanaYDiaDesdeFecha(fecha));
    }
    setProgBusy(true);
    setProgMsg(null);
    try {
      const tok = await getClientIdToken();
      if (!tok) throw new Error("Sin sesión");
      const res = await actionAddAvisoToProgramaPublicado(tok, {
        weekId,
        avisoFirestoreId: pickPrograma.id,
        dia,
        localidad: pickPrograma.ubicacion_tecnica,
      });
      if (!res.ok) throw new Error(res.error.message);
      setDialogProgramaOpen(false);
      setPickPrograma(null);
      recargarLista();
      setProgMsg("Aviso agregado al programa semanal.");
      window.setTimeout(() => setProgMsg(null), 4000);
    } catch (e) {
      setProgMsg(e instanceof Error ? e.message : "Error al asignar");
    } finally {
      setProgBusy(false);
    }
  }, [pickPrograma, weekIdProg, diaProg, fechaCorrectivo, esDialogCorrectivo, recargarLista]);

  const resetFiltrosLista = useCallback(() => {
    setBusqueda("");
    setFiltroCentroLista("");
    setFiltroEspLista("");
    setFiltroOtLista("todos");
    setFiltroProgramaLista("todos");
    setFiltroEstadoLista("");
    setFiltroVencLista("");
  }, []);

  const hayFiltrosListaActivos = useMemo(
    () =>
      Boolean(busqueda.trim()) ||
      Boolean(filtroCentroLista) ||
      Boolean(filtroEspLista) ||
      filtroOtLista !== "todos" ||
      filtroProgramaLista !== "todos" ||
      Boolean(filtroEstadoLista) ||
      Boolean(filtroVencLista),
    [
      busqueda,
      filtroCentroLista,
      filtroEspLista,
      filtroOtLista,
      filtroProgramaLista,
      filtroEstadoLista,
      filtroVencLista,
    ],
  );

  const avisosFiltrados = useMemo(() => {
    let list = avisos;

    if (filtroCentroLista) {
      list = list.filter((a) => (a.centro ?? "").trim() === filtroCentroLista);
    }
    if (filtroEspLista) {
      list = list.filter((a) => a.especialidad === filtroEspLista);
    }
    if (filtroOtLista === "con_ot") {
      list = list.filter((a) => avisoTieneOrdenVinculada(a));
    } else if (filtroOtLista === "sin_ot") {
      list = list.filter((a) => !avisoTieneOrdenVinculada(a));
    }
    if (filtroProgramaLista === "en_semana") {
      list = list.filter((a) => Boolean(isoSemanaPrograma(a)));
    } else if (filtroProgramaLista === "sin_semana") {
      list = list.filter((a) => !isoSemanaPrograma(a));
    }
    if (filtroEstadoLista) {
      list = list.filter((a) => a.estado === filtroEstadoLista);
    }
    if (filtroVencLista) {
      list = list.filter((a) => a.estado_vencimiento === filtroVencLista);
    }

    const needle = busqueda.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (a) =>
        a.n_aviso.toLowerCase().includes(needle) ||
        (a.texto_corto ?? "").toLowerCase().includes(needle) ||
        (a.centro ?? "").toLowerCase().includes(needle) ||
        (a.ubicacion_tecnica ?? "").toLowerCase().includes(needle) ||
        (a.estado_planilla ?? "").toLowerCase().includes(needle) ||
        (a.estado ?? "").toLowerCase().includes(needle),
    );
  }, [
    avisos,
    busqueda,
    filtroCentroLista,
    filtroEspLista,
    filtroOtLista,
    filtroProgramaLista,
    filtroEstadoLista,
    filtroVencLista,
  ]);

  const runLegacyParche = useCallback(
    async (dryRun: boolean) => {
      if (!user || !puedeImportar || !legacyFile) {
        setLegacyError("Elegí un archivo .xlsx");
        return;
      }
      if (legacyFile.size > MAX_EXCEL_IMPORT_BYTES) {
        setLegacyError("Archivo muy grande (máximo 20 MB).");
        return;
      }
      setLegacyError(null);
      setLegacyBusy(dryRun ? "preview" : "commit");
      try {
        const token = await getClientIdToken();
        if (!token) throw new Error("Sin sesión");
        const fd = new FormData();
        fd.set("modo", "mensuales_parche");
        fd.set("dry_run", dryRun ? "true" : "false");
        fd.set("file", legacyFile);
        const res = await fetch("/api/admin/import-avisos", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const json = (await res.json()) as { ok: boolean; error?: string; result?: ResultadoImportacionAvisos };
        if (!res.ok || !json.ok) throw new Error(json.error ?? res.statusText);
        setLegacyResult(json.result ?? null);
        setLastLegacyDryRun(dryRun);
        if (!dryRun) recargarLista();
      } catch (e) {
        setLegacyResult(null);
        setLegacyError(e instanceof Error ? e.message : "Error");
      } finally {
        setLegacyBusy(false);
      }
    },
    [legacyFile, puedeImportar, recargarLista, user],
  );

  if (!puedeImportar) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Importación de avisos</CardTitle>
          <CardDescription>
            Solo perfiles con permiso <span className="font-mono">admin:cargar_programa</span> (administrador de planta
            o súper admin).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const def = TAB_DEFS.find((t) => t.id === tab);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" aria-hidden />
          Importación de avisos (Excel)
        </CardTitle>
        <CardDescription>
          <span className="block text-xs text-muted-foreground">
            Cada importación hace <strong>merge</strong> — actualiza lo existente sin borrar nada.
            El <strong>calendario semanal publicado</strong> va en{" "}
            <Link
              href={PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? "/programa?vista=operativo" : "/programa"}
              className="font-semibold text-primary underline underline-offset-2"
            >
              {PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? "Programa → Editar esta semana" : "Programa → semana (grilla)"}
            </Link>
            , no acá. La carga semanal de <strong>correctivos</strong> está en{" "}
            <Link href="/programa/correctivos" className="font-semibold text-primary underline underline-offset-2">
              Programa → Correctivos
            </Link>
            .
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div
          role="tablist"
          aria-label="Sección principal de avisos"
          className="flex flex-wrap gap-1 border-b border-border pb-2"
        >
          {SECCION_PRINCIPAL_DEFS.map((s) => {
            const selected = seccionPrincipal === s.id;
            return (
              <button
                key={s.id}
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
                onClick={() => setSeccionPrincipal(s.id)}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {seccionPrincipal === "importacion" ? (
          <div role="tabpanel" className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Usá esta sección cuando recibas planillas nuevas de Arauco o SAP (preventivos). Los correctivos semanales
              se cargan en{" "}
              <Link href="/programa/correctivos" className="font-medium text-primary underline underline-offset-2">
                Programa → Correctivos
              </Link>
              .
            </p>

            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground">Carga de preventivos (maestro + calendario M/T)</h2>
              <PasoImportacionAvisos
                paso={1}
                tab="listado_semestral_anual"
                tituloArchivo="Listado_avisos_Semestral-Anual.xlsx"
                descripcionArchivo="Export SAP con una sola hoja y la columna CePl (centro). Carga los avisos semestrales y anuales con el centro correcto (PT01, PC01, PM02…)."
                user={user}
                puedeImportar={puedeImportar}
                onImportado={recargarLista}
              />
              <PasoImportacionAvisos
                paso={2}
                tab="preventivos_todas"
                tituloArchivo="AVISOS PREVENTIVOS Abril 26 - Marzo 27.xlsx"
                descripcionArchivo="Maestro con hojas MEN / TRIM / SEM / ANU. Los meses del calendario anual para mensual y trimestral no se generan acá: deben venir de los Excel de Arauco (pasos 3 y 4). Semestral/anual pueden seguir usando columnas de mes en este archivo."
                user={user}
                puedeImportar={puedeImportar}
                onImportado={recargarLista}
              />
              <PasoImportacionAvisos
                paso={3}
                tab="calendario_mensual"
                tituloArchivo="Calendario_avisos_MENSUAL_Arauco.xlsx"
                descripcionArchivo="Planilla oficial con nº de aviso SAP y marcas en columnas de mes (enero…diciembre). Solo actualiza meses en avisos ya cargados con frecuencia mensual; no crea avisos nuevos."
                user={user}
                puedeImportar={puedeImportar}
                onImportado={recargarLista}
              />
              <PasoImportacionAvisos
                paso={4}
                tab="calendario_trimestral"
                tituloArchivo="Calendario_avisos_TRIMESTRAL_Arauco.xlsx"
                descripcionArchivo="Igual que el mensual pero para hoja trimestral: marcas en meses y nº de aviso. Solo actualiza avisos trimestrales existentes."
                user={user}
                puedeImportar={puedeImportar}
                onImportado={recargarLista}
              />
            </div>
          </div>
        ) : (
          <div role="tabpanel" className="space-y-4">
            <div
              role="tablist"
              aria-label="Filtros de avisos en base de datos"
              className="flex flex-wrap gap-1 border-b border-border pb-2"
            >
            {TAB_DEFS.filter((t) => !t.hidden).map((t) => {
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    "rounded-md px-3 py-2 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                    selected
                      ? "bg-surface text-foreground ring-1 ring-brand/40"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                  onClick={() => {
                    setTab(t.id);
                    resetFiltrosLista();
                    setLegacyResult(null);
                    setLegacyError(null);
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" className="space-y-4">
            {def ? <p className="text-sm text-muted-foreground leading-relaxed">{def.description}</p> : null}

            {/* Mensuales parche: legacy upload inside the tab panel */}
            {tab === "mensuales_parche" ? (
              <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Archivo MENSUALES_*.xlsx</p>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
                    disabled={legacyBusy !== false}
                    onChange={(e) => {
                      setLegacyFile(e.target.files?.[0] ?? null);
                      setLegacyResult(null);
                      setLegacyError(null);
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={legacyBusy !== false || !legacyFile}
                      onClick={() => void runLegacyParche(true)}
                    >
                      {legacyBusy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Vista previa
                    </Button>
                    <Button
                      type="button"
                      disabled={legacyBusy !== false || !legacyFile}
                      onClick={() => void runLegacyParche(false)}
                    >
                      {legacyBusy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Importar a la base de datos
                    </Button>
                  </div>
                </div>
                {legacyError ? (
                  <p className="text-sm text-destructive" role="alert">{legacyError}</p>
                ) : null}
                {legacyResult ? (
                  <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
                    <p className="font-medium text-foreground">
                      {lastLegacyDryRun ? "Vista previa (sin cambios)" : "Importación parche aplicada"}
                    </p>
                    <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                      <li>Filas leídas: {legacyResult.filasLeidas}</li>
                      <li>Registros a escribir: {legacyResult.procesados}</li>
                      <li>Sin nº aviso: {legacyResult.sinNumeroAviso}</li>
                      <li>Sin activo para UT: {legacyResult.sinActivoUt}</li>
                      <li>Altas nuevas: {legacyResult.nuevosDocumentos}</li>
                      <li>Merge sobre existentes: {legacyResult.existentesMerge}</li>
                    </ul>
                    {legacyResult.hojasConsideradas.length ? (
                      <p className="text-xs text-muted-foreground">Hojas: {legacyResult.hojasConsideradas.join(", ")}</p>
                    ) : null}
                    {legacyResult.advertencias.length ? (
                      <div className="text-amber-800 dark:text-amber-200">
                        <p className="text-xs font-medium">Advertencias</p>
                        <ul className="mt-1 list-disc pl-4 text-xs">
                          {legacyResult.advertencias.map((a, i) => (
                            <li key={i}>{typeof a === "string" ? a : String(a)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {legacyResult.vistaPrevia.length ? (
                      <div className="overflow-x-auto">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Muestra (hasta 10 filas)</p>
                        <table className="w-full min-w-[28rem] border-collapse text-xs">
                          <tbody>
                            {legacyResult.vistaPrevia.map((row, ri) => (
                              <tr key={ri} className="border-t border-border">
                                {row.map((c, ci) => (
                                  <td key={ci} className="max-w-[12rem] truncate px-2 py-1">{c}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Avisos list */}
            <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground">
                    Avisos ya en la base de datos — vista «{def?.label ?? tab}»
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={recargarLista}
                  >
                    Recargar lista
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Muestra avisos que <strong className="text-foreground/90">ya existen en la base de datos</strong> filtrados por la pestaña activa.
                  Usá <strong className="text-foreground/90">Guardar cambios</strong> para editar texto corto, centro,
                  especialidad o estado de planilla.
                  {puedeProgramar ? (
                    <>
                      {" "}
                      Con permiso de programa también podés <strong className="text-foreground/90">crear OT</strong> o{" "}
                      <strong className="text-foreground/90">asignar a una semana</strong> del calendario publicado (igual que en
                      Vencimientos o Correctivos).
                    </>
                  ) : null}
                </p>
                {progMsg && !dialogProgramaOpen ? (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground" role="status">
                    {progMsg}
                  </p>
                ) : null}

                <div className="rounded-xl border border-border bg-muted/15 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">Filtros</span>
                    {hayFiltrosListaActivos ? (
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFiltrosLista}>
                        Limpiar filtros
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {verTodosLosCentros ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Centro</span>
                        <select
                          className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
                          value={filtroCentroLista}
                          disabled={listaLoading}
                          onChange={(e) => setFiltroCentroLista(e.target.value)}
                        >
                          <option value="">Todos</option>
                          {[...KNOWN_CENTROS].map((c) => (
                            <option key={c} value={c}>
                              {nombreCentro(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Especialidad</span>
                      <select
                        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
                        value={filtroEspLista}
                        disabled={listaLoading}
                        onChange={(e) => setFiltroEspLista(e.target.value as "" | Especialidad)}
                      >
                        <option value="">Todas</option>
                        {ESPECIALIDADES.map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Orden de trabajo</span>
                      <select
                        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
                        value={filtroOtLista}
                        disabled={listaLoading}
                        onChange={(e) => setFiltroOtLista(e.target.value as FiltroOtLista)}
                      >
                        <option value="todos">Todas</option>
                        <option value="con_ot">Con OT</option>
                        <option value="sin_ot">Sin OT</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Programa semanal</span>
                      <select
                        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
                        value={filtroProgramaLista}
                        disabled={listaLoading}
                        onChange={(e) => setFiltroProgramaLista(e.target.value as FiltroProgramaLista)}
                      >
                        <option value="todos">Todos</option>
                        <option value="en_semana">En semana</option>
                        <option value="sin_semana">Sin semana</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Estado aviso</span>
                      <select
                        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
                        value={filtroEstadoLista}
                        disabled={listaLoading}
                        onChange={(e) => setFiltroEstadoLista(e.target.value as "" | EstadoAviso)}
                      >
                        <option value="">Todos</option>
                        <option value="ABIERTO">Abierto</option>
                        <option value="OT_GENERADA">OT generada</option>
                        <option value="CERRADO">Cerrado</option>
                        <option value="ANULADO">Anulado</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Vencimiento</span>
                      <select
                        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
                        value={filtroVencLista}
                        disabled={listaLoading}
                        onChange={(e) => setFiltroVencLista(e.target.value as "" | EstadoVencimientoAviso)}
                      >
                        <option value="">Todos</option>
                        <option value="ok">Al día</option>
                        <option value="proximo">Próximo</option>
                        <option value="vencido">Vencido</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-foreground">Buscar</span>
                    <Input
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      placeholder="Nº aviso, texto, centro, ubicación, estado…"
                      disabled={listaLoading}
                    />
                  </label>
                </div>
                {listaError ? (
                  <p className="text-sm text-destructive" role="alert">{listaError.message}</p>
                ) : null}
                {listaLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando avisos…
                  </p>
                ) : avisos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay avisos que coincidan con esta pestaña (límite 450 filas).
                  </p>
                ) : avisosFiltrados.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {hayFiltrosListaActivos
                      ? "Ningún aviso coincide con los filtros activos."
                      : "No hay avisos en esta categoría."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {hayFiltrosListaActivos ? (
                      <p className="text-xs text-muted-foreground">
                        {avisosFiltrados.length} de {avisos.length} avisos
                      </p>
                    ) : null}
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full min-w-[56rem] border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/30 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <th className="px-2 py-2">Nº aviso</th>
                            <th className="px-2 py-2">Texto corto</th>
                            <th className="px-2 py-2">Centro</th>
                            <th className="px-2 py-2">Esp.</th>
                            <th className="px-2 py-2 text-center">M/T/S/A</th>
                            <th className="px-2 py-2">Est. planilla</th>
                            <th className="px-2 py-2">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {avisosFiltrados.map((a) => (
                            <FilaAvisoEditable
                              key={a.id}
                              aviso={a}
                              alGuardar={recargarLista}
                              puedeProgramar={puedeProgramar}
                              onAsignarPrograma={abrirDialogoPrograma}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
        )}
      </CardContent>

      {dialogProgramaOpen && pickPrograma && puedeProgramar ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cfg-prog-dlg-title"
        >
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader className="pb-2">
              <CardTitle id="cfg-prog-dlg-title" className="text-base">
                {esDialogCorrectivo ? "Ubicar correctivo en semana" : "Asignar aviso a semana del programa"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Aviso <span className="font-mono">{pickPrograma.n_aviso}</span>
                {pickPrograma.texto_corto ? (
                  <>
                    {" "}
                    · {(pickPrograma.texto_corto ?? "").slice(0, 100)}
                  </>
                ) : null}
              </p>
              {esDialogCorrectivo ? (
                <>
                  <label className="flex flex-col gap-1 font-medium">
                    Fecha de realización
                    <Input
                      type="date"
                      value={fechaCorrectivo}
                      onChange={(e) => setFechaCorrectivo(e.target.value)}
                    />
                  </label>
                  {previewSemanaCorrectivo ? (
                    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                      Semana:{" "}
                      <span className="font-medium text-foreground">{previewSemanaCorrectivo.label}</span>
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    Semana (ISO)
                    <select
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={weekIdProg}
                      onChange={(e) => setWeekIdProg(e.target.value)}
                    >
                      {opcionesSemanaIso.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    Día
                    <select
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={diaProg}
                      onChange={(e) => setDiaProg(e.target.value as DiaSemanaPrograma)}
                    >
                      {DIAS_PROG.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {progMsg && dialogProgramaOpen ? (
                <p className="text-sm text-destructive" role="alert">
                  {progMsg}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={progBusy}
                  onClick={() => {
                    setDialogProgramaOpen(false);
                    setPickPrograma(null);
                    setProgMsg(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="button" disabled={progBusy} onClick={() => void agregarAlPrograma()}>
                  {progBusy ? "Guardando…" : "Agregar al programa"}
                </Button>
                {pickPrograma.centro?.trim() ? (
                  <Button type="button" variant="outline" disabled={progBusy} asChild>
                    <Link
                      href={hrefProgramaSemanal(
                        pickPrograma.centro!.trim(),
                        esDialogCorrectivo && previewSemanaCorrectivo
                          ? previewSemanaCorrectivo.weekId
                          : weekIdProg,
                      )}
                    >
                      Ver grilla
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </Card>
  );
}
