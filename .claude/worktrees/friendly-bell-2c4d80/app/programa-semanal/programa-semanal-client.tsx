"use client";

import {
  actionAddWeeklyPlanRow,
  actionDeleteWeeklyPlanRow,
  actionPatchWeeklyPlanRow,
  actionReplaceWeeklyPlanRows,
} from "@/app/actions/weekly-plan";
import {
  actionAddAvisoToProgramaPublicado,
  actionRemoveWeekSlot,
  actionScheduleWorkOrderInWeek,
} from "@/app/actions/schedule";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import {
  useAvisosVencimientos,
  useAvisosPreventivosMT,
  useWeeklyPlanRowsLive,
  useWeeklySlotsLive,
} from "@/modules/scheduling/hooks";
import { getIsoWeekId, shiftIsoWeekId } from "@/modules/scheduling/iso-week";
import {
  parseProgramaSemanalWorkbook,
  type ParsedWeekPlan,
} from "@/modules/scheduling/parse-programa-excel";
import type { DiaSemanaPrograma, WeeklyPlanRow, WeeklyScheduleSlot } from "@/modules/scheduling/types";
import type { Aviso } from "@/modules/notices/types";
import { useTodaysWorkOrdersCached } from "@/modules/work-orders/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { useEffect, useMemo, useRef, useState } from "react";

const DIA_NUM_A_DIA_PROGRAMA: Record<number, DiaSemanaPrograma> = {
  1: "lunes",
  2: "martes",
  3: "miercoles",
  4: "jueves",
  5: "viernes",
  6: "sabado",
  7: "sabado",
};

function especialidadAvisoALabelProg(esp: string): string {
  if (esp === "ELECTRICO" || esp === "HG") return "Electrico";
  if (esp === "AA") return "Aire";
  return "GG";
}

const DIA_LABEL: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

function groupSlotsByDay(rows: WeeklyScheduleSlot[], centro: string): Map<number, WeeklyScheduleSlot[]> {
  const m = new Map<number, WeeklyScheduleSlot[]>();
  for (const r of rows) {
    if (r.centro !== centro) continue;
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

function groupPlanRowsByDay(rows: WeeklyPlanRow[], centro: string): Map<number, WeeklyPlanRow[]> {
  const m = new Map<number, WeeklyPlanRow[]>();
  for (const r of rows) {
    if (r.centro !== centro) continue;
    const arr = m.get(r.dia_semana) ?? [];
    arr.push(r);
    m.set(r.dia_semana, arr);
  }
  for (const [k, arr] of m) {
    arr.sort((a, b) => a.orden - b.orden);
    m.set(k, arr);
  }
  return m;
}

export function ProgramaSemanalClient({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  const { puede } = usePermisos();
  const [weekId, setWeekId] = useState(() => getIsoWeekId(new Date()));

  const centro = profile?.centro ?? DEFAULT_CENTRO;
  const canEdit = puede("programa:editar");
  const puedePlanOperativo = puede("programa:crear_ot") || puede("programa:editar");

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!puedePlanOperativo) router.replace("/programa");
  }, [authLoading, profileLoading, puedePlanOperativo, router]);

  const { slots, loading: slotsLoading, error: slotsError } = useWeeklySlotsLive(weekId, user?.uid);
  const {
    rows: planRows,
    loading: planLoading,
    error: planError,
  } = useWeeklyPlanRowsLive(weekId, user?.uid);
  const { rows: workOrders, loading: woLoading, error: woError } = useTodaysWorkOrdersCached(
    centro,
    {
      uid: user?.uid ?? "",
      rol: profile?.rol ?? "tecnico",
    },
    { enabled: !user?.uid || !profileLoading },
  );
  const puedePublicarAvisoSa = puede("programa:crear_ot");

  const [workOrderId, setWorkOrderId] = useState("");
  const [dia, setDia] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [turno, setTurno] = useState<"" | "A" | "B" | "C">("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [manualLocalidad, setManualLocalidad] = useState("");
  const [manualEsp, setManualEsp] = useState("");
  const [manualDia, setManualDia] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [manualTexto, setManualTexto] = useState("");
  const [importScope, setImportScope] = useState<"current" | "all">("current");
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [excelParsed, setExcelParsed] = useState<ParsedWeekPlan[] | null>(null);
  const [excelFileLabel, setExcelFileLabel] = useState<string | null>(null);
  const [excelReadError, setExcelReadError] = useState<string | null>(null);
  const [manualFuente, setManualFuente] = useState<"periodo" | "sa">("periodo");

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editLocalidad, setEditLocalidad] = useState("");
  const [editEsp, setEditEsp] = useState("");
  const [editDia, setEditDia] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [editTexto, setEditTexto] = useState("");

  const slotsByDay = useMemo(() => groupSlotsByDay(slots, centro), [slots, centro]);
  const planByDay = useMemo(() => groupPlanRowsByDay(planRows, centro), [planRows, centro]);

  const excelToImport = useMemo(() => {
    if (!excelParsed?.length) return [];
    return importScope === "current" ? excelParsed.filter((p) => p.weekId === weekId) : excelParsed;
  }, [excelParsed, importScope, weekId]);

  const superadminProg = profile?.rol === "superadmin" || profile?.rol === "super_admin";
  const { avisos: avisosMT, loading: mtLoading } = useAvisosPreventivosMT({
    authUid: user?.uid,
    centro,
    verTodosLosCentros: false,
  });
  const { avisos: avisosSA, loading: saVLoading } = useAvisosVencimientos({
    authUid: user?.uid,
    centro,
    verTodosLosCentros: Boolean(superadminProg),
  });
  const saUrgentes = useMemo(() => {
    return avisosSA
      .filter(
        (a) =>
          a.estado_vencimiento_live === "vencido" ||
          a.estado_vencimiento_live === "proximo" ||
          a.estado_vencimiento_live === "sin_fecha",
      )
      .slice(0, 100);
  }, [avisosSA]);

  const scheduleableWos = useMemo(
    () =>
      workOrders.filter(
        (w) =>
          w.centro === centro && w.estado !== "CERRADA" && w.estado !== "ANULADA" && w.estado !== "BORRADOR",
      ),
    [workOrders, centro],
  );

  async function token(): Promise<string> {
    const t = await getClientIdToken();
    if (!t) throw new Error("Sin sesión");
    return t;
  }

  async function onAdd() {
    setMsg(null);
    if (!workOrderId) {
      setMsg("Elegí una orden de trabajo");
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

  async function onAddSaToProgramaPublicado(avisoFirestoreId: string) {
    setMsg(null);
    setBusy(true);
    try {
      const res = await actionAddAvisoToProgramaPublicado(await token(), {
        weekId,
        avisoFirestoreId,
        dia: DIA_NUM_A_DIA_PROGRAMA[manualDia],
      });
      setMsg(res.ok ? "Aviso agregado al programa publicado (grilla)" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function aplicarAvisoMTaManual(a: Pick<Aviso, "n_aviso" | "texto_corto" | "especialidad">) {
    setManualEsp(especialidadAvisoALabelProg(a.especialidad));
    setManualTexto(`${a.n_aviso} · ${a.texto_corto}`.trim());
    setMsg("Datos copiados al cuadro de texto; revisá y pulsá Agregar al plan.");
  }

  async function onAddManualPlan() {
    setMsg(null);
    if (!manualLocalidad.trim() || !manualEsp.trim() || !manualTexto.trim()) {
      setMsg("Completá localidad, especialidad y texto");
      return;
    }
    setBusy(true);
    try {
      const res = await actionAddWeeklyPlanRow(await token(), {
        weekId,
        dia_semana: manualDia,
        localidad: manualLocalidad.trim(),
        especialidad: manualEsp.trim(),
        texto: manualTexto.trim(),
      });
      setMsg(res.ok ? "Nota agregada al plan" : res.error.message);
      if (res.ok) {
        setManualTexto("");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePlanRow(rowId: string) {
    if (!confirm("¿Eliminar esta entrada del plan?")) return;
    setMsg(null);
    setBusy(true);
    try {
      const res = await actionDeleteWeeklyPlanRow(await token(), { weekId, rowId });
      setMsg(res.ok ? "Entrada eliminada" : res.error.message);
      if (editingPlanId === rowId) setEditingPlanId(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function startEditPlan(row: WeeklyPlanRow) {
    setEditingPlanId(row.id);
    setEditLocalidad(row.localidad);
    setEditEsp(row.especialidad);
    setEditDia(row.dia_semana);
    setEditTexto(row.texto);
  }

  async function saveEditPlan() {
    if (!editingPlanId) return;
    setMsg(null);
    setBusy(true);
    try {
      const res = await actionPatchWeeklyPlanRow(await token(), {
        weekId,
        rowId: editingPlanId,
        localidad: editLocalidad.trim(),
        especialidad: editEsp.trim(),
        texto: editTexto.trim(),
        dia_semana: editDia,
      });
      setMsg(res.ok ? "Guardado" : res.error.message);
      if (res.ok) setEditingPlanId(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function clearExcelSelection() {
    setExcelParsed(null);
    setExcelFileLabel(null);
    setExcelReadError(null);
    if (excelInputRef.current) excelInputRef.current.value = "";
  }

  async function onExcelFileChosen(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setExcelReadError(null);
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const parsed = parseProgramaSemanalWorkbook(wb);
      setExcelFileLabel(file.name);
      if (!parsed.length) {
        setExcelParsed(null);
        setExcelReadError(
          "No se encontraron hojas con formato Localidad / Especialidad y días Lunes–Sábado. Revisá el archivo.",
        );
        return;
      }
      setExcelParsed(parsed);
    } catch (e) {
      setExcelParsed(null);
      setExcelFileLabel(null);
      setExcelReadError(e instanceof Error ? e.message : "Error al leer Excel");
    } finally {
      setBusy(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  }

  async function onImportExcelToPlan() {
    if (!excelParsed?.length || !excelToImport.length) return;
    setMsg(null);
    const ok = confirm(
      importScope === "current"
        ? `Se reemplazará el texto del plan de la semana ${weekId} (${excelToImport[0]?.rows.length ?? 0} bloques). Las OTs agendadas no se modifican. ¿Continuar?`
        : `Se reemplazará el texto del plan en ${excelToImport.length} semana(s). Las OTs agendadas no se modifican. ¿Continuar?`,
    );
    if (!ok) {
      setMsg("Importación cancelada");
      return;
    }
    setBusy(true);
    try {
      const tok = await token();
      for (const block of excelToImport) {
        const res = await actionReplaceWeeklyPlanRows(tok, {
          weekId: block.weekId,
          rows: block.rows,
        });
        if (!res.ok) {
          setMsg(`Error en ${block.sheetName} (${block.weekId}): ${res.error.message}`);
          return;
        }
      }
      const labels = excelToImport.map((p) => p.weekId).join(", ");
      setMsg(`Plan importado: ${labels}`);
      clearExcelSelection();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al importar");
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
              <h2 className="text-lg font-semibold tracking-tight">Armar o cargar el plan</h2>
              <p className="text-xs text-muted-foreground">
                OT en calendario, texto línea a línea o importar Excel · Centro{" "}
                <span className="font-mono">{centro}</span>
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
              <span className="min-w-[7.5rem] text-center font-mono text-base font-semibold">{weekId}</span>
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
              <h1 className="text-2xl font-semibold tracking-tight">Programa semanal</h1>
              <p className="text-sm text-muted-foreground">
                Centro <span className="font-mono">{centro}</span>
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
              <span className="min-w-[7.5rem] text-center font-mono text-lg font-semibold">{weekId}</span>
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
          Error al cargar OTs del programa: {slotsError.message}.
          {(slotsError as { code?: string }).code === "permission-denied"
            ? " Revisá sesión y reglas de Firestore (colección weekly_schedule, subcolección slots)."
            : " Si la consola de Firebase pide un índice, desplegá los definidos en firestore.indexes.json."}
        </p>
      ) : null}

      {planError ? (
        <p className="text-sm text-destructive">
          Error al cargar texto del plan: {planError.message}.
          {(planError as { code?: string }).code === "permission-denied"
            ? " Revisá reglas para weekly_schedule/plan_rows."
            : " Desplegá índices en Firebase si hace falta."}
        </p>
      ) : null}

      {canEdit ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agendar OT</CardTitle>
              <CardDescription className="space-y-1.5">
                <span>
                  Solo supervisores y administradores pueden editar el programa. Acá elegís una{" "}
                  <strong>orden de trabajo que ya exista</strong> en el sistema (colección de órdenes de trabajo / OT) para
                  asignarla
                  a un día de esta semana. No es el mismo flujo que importar texto desde Excel: es enlazar una OT
                  concreta al calendario.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {woError ? (
                <p className="text-sm text-destructive" role="alert">
                  No se pudieron cargar las órdenes de trabajo: {woError.message}
                  {(woError as { code?: string }).code === "permission-denied"
                    ? ". Revisá reglas de Firestore para la colección work_orders."
                    : null}
                </p>
              ) : null}
              {!woLoading && !woError && scheduleableWos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay OTs elegibles para <span className="font-mono">{centro}</span>: o no hay órdenes de trabajo en
                  las últimas cargadas, o todas están cerradas/anuladas/en borrador, o el campo{" "}
                  <span className="font-mono">centro</span> de las OT no coincide. Podés revisar en{" "}
                  <Link href="/tareas" className="font-medium text-primary underline underline-offset-2">
                    Órdenes de trabajo
                  </Link>{" "}
                  y crear o reabrir OTs según tu proceso.
                </p>
              ) : null}
              <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[12rem] flex-col gap-1 text-sm">
                Orden de trabajo
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={workOrderId}
                  onChange={(e) => setWorkOrderId(e.target.value)}
                  disabled={woLoading || busy}
                >
                  <option value="">— Elegir —</option>
                  {scheduleableWos.map((w) => (
                    <option key={w.id} value={w.id}>
                      OT {w.n_ot} · {w.codigo_activo_snapshot} · {w.estado}
                    </option>
                  ))}
                </select>
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
              <Button type="button" onClick={() => void onAdd()} disabled={busy || woLoading}>
                Agregar al programa
              </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan por texto (Excel o manual)</CardTitle>
              <CardDescription>
                Mismo estilo que la grilla semanal en Excel: localidad, especialidad y trabajos por día. No reemplaza
                las OT vinculadas arriba.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Elegí el Excel, revisá el resumen y pulsá <strong>Importar al plan</strong>. Las OT del calendario de
                arriba no cambian.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  Alcance importación
                  <select
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={importScope}
                    onChange={(e) => setImportScope(e.target.value as "current" | "all")}
                    disabled={busy}
                  >
                    <option value="current">Solo semana en pantalla</option>
                    <option value="all">Todas las semanas del archivo</option>
                  </select>
                </label>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => void onExcelFileChosen(e.target.files?.[0])}
                />
                <div className="flex flex-wrap items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={() => excelInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Elegir Excel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    disabled={
                      busy ||
                      !excelParsed?.length ||
                      !excelToImport.length ||
                      !!excelReadError
                    }
                    onClick={() => void onImportExcelToPlan()}
                  >
                    Importar al plan
                  </Button>
                  {excelFileLabel || excelParsed ? (
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clearExcelSelection}>
                      Quitar archivo
                    </Button>
                  ) : null}
                </div>
              </div>
              {excelFileLabel ? (
                <p className="text-sm text-muted-foreground">
                  Archivo: <span className="font-medium text-foreground">{excelFileLabel}</span>
                </p>
              ) : null}
              {excelReadError ? (
                <p className="text-sm text-destructive" role="alert">
                  {excelReadError}
                </p>
              ) : null}
              {excelParsed?.length ? (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {importScope === "current" ? (
                    excelToImport.length ? (
                      <p>
                        Listo para importar la semana <span className="font-mono font-medium">{weekId}</span>:{" "}
                        {excelToImport[0]?.rows.length ?? 0} bloque(s) de texto (hoja “
                        {excelToImport[0]?.sheetName}”).
                      </p>
                    ) : (
                      <p className="text-amber-700 dark:text-amber-500">
                        Ninguna hoja del archivo coincide con la semana <span className="font-mono">{weekId}</span>.
                        Cambiá el calendario, usá “Todas las semanas del archivo”, o revisá que la fecha del lunes en el
                        Excel corresponda a esa semana ISO.
                      </p>
                    )
                  ) : (
                    <p>
                      Se importarán <span className="font-medium">{excelToImport.length}</span> semana(s) del archivo:{" "}
                      {excelToImport.map((p) => `${p.weekId} (${p.rows.length})`).join(", ")}.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">Carga manual</p>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={manualFuente === "periodo" ? "secondary" : "outline"}
                    onClick={() => setManualFuente("periodo")}
                  >
                    Avisos del período (M/T)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={manualFuente === "sa" ? "secondary" : "outline"}
                    onClick={() => setManualFuente("sa")}
                  >
                    Semestrales / anuales (urgentes)
                  </Button>
                </div>
                {manualFuente === "periodo" ? (
                  <div className="mb-4 max-h-48 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-xs">
                    {mtLoading ? (
                      <p className="text-muted-foreground">Cargando avisos M/T…</p>
                    ) : avisosMT.length === 0 ? (
                      <p className="text-muted-foreground">Sin avisos mensuales/trimestrales en este centro.</p>
                    ) : (
                      <ul className="space-y-1">
                        {avisosMT.slice(0, 60).map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                            <span className="min-w-0">
                              <span className="font-mono">{a.n_aviso}</span> ·{" "}
                              <span className="text-muted-foreground">{(a.texto_corto ?? "").slice(0, 72)}</span>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 text-xs"
                              disabled={busy}
                              onClick={() => aplicarAvisoMTaManual(a)}
                            >
                              Usar en texto
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="mb-4 max-h-48 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-xs">
                    {saVLoading ? (
                      <p className="text-muted-foreground">Cargando S/A…</p>
                    ) : saUrgentes.length === 0 ? (
                      <p className="text-muted-foreground">No hay S/A vencidos, próximos o sin historial.</p>
                    ) : (
                      <ul className="space-y-1">
                        {saUrgentes.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                            <span className="min-w-0">
                              <span className="font-mono">{a.n_aviso}</span> ·{" "}
                              <span className="text-muted-foreground">{(a.texto_corto ?? "").slice(0, 56)}</span>
                              {a.estado_vencimiento_live === "vencido" ? (
                                <span className="ml-1 text-destructive">· vencido</span>
                              ) : null}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 text-xs"
                              disabled={busy || !puedePublicarAvisoSa}
                              onClick={() => void onAddSaToProgramaPublicado(a.id)}
                            >
                              A la grilla
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[0.65rem] leading-snug text-muted-foreground">
                      Usa el día seleccionado arriba y la semana <span className="font-mono">{weekId}</span>. También
                      podés armar el detalle en{" "}
                      <Link className="text-primary underline" href="/programa/vencimientos">
                        Vencimientos S/A
                      </Link>
                      .
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-sm">
                    Localidad
                    <input
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={manualLocalidad}
                      onChange={(e) => setManualLocalidad(e.target.value)}
                      disabled={busy}
                      placeholder="Ej. Celulosa"
                    />
                  </label>
                  <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-sm">
                    Especialidad
                    <input
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={manualEsp}
                      onChange={(e) => setManualEsp(e.target.value)}
                      disabled={busy}
                      placeholder="Ej. Aire"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Día
                    <select
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={manualDia}
                      onChange={(e) => setManualDia(Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7)}
                      disabled={busy}
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <option key={d} value={d}>
                          {DIA_LABEL[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  Trabajos / notas
                  <textarea
                    className="min-h-[5rem] rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={manualTexto}
                    onChange={(e) => setManualTexto(e.target.value)}
                    disabled={busy}
                    placeholder="Texto libre del programa…"
                  />
                </label>
                <Button type="button" className="mt-2" onClick={() => void onAddManualPlan()} disabled={busy}>
                  Agregar al plan
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      <div className="space-y-4">
        {slotsLoading || planLoading ? (
          <p className="text-sm text-muted-foreground">Cargando programa…</p>
        ) : null}
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const daySlots = slotsByDay.get(d) ?? [];
          const dayPlans = planByDay.get(d) ?? [];
          if (!daySlots.length && !dayPlans.length && (slotsLoading || planLoading)) return null;

          return (
            <Card key={d}>
              <CardHeader className="py-3">
                <CardTitle className="text-base">{DIA_LABEL[d]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Órdenes de trabajo
                  </p>
                  {daySlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin OT en esta semana.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border">
                      {daySlots.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <div>
                            <Link
                              href={`/tareas/${s.work_order_id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              OT {s.n_ot_snapshot ?? s.work_order_id.slice(0, 8)}
                            </Link>
                            <span className="text-muted-foreground">
                              {" "}
                              · {s.ubicacion_tecnica} · {s.especialidad}
                              {s.turno ? ` · turno ${s.turno}` : ""}
                            </span>
                          </div>
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9 p-0 text-destructive hover:bg-destructive/10"
                              aria-label="Quitar del programa"
                              disabled={busy}
                              onClick={() => void onRemove(s.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Texto del plan
                  </p>
                  {dayPlans.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin bloques de texto para este día.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border bg-muted/20">
                      {dayPlans.map((row) => (
                        <li key={row.id} className="px-3 py-2 text-sm">
                          {editingPlanId === row.id ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <input
                                  className="min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                                  value={editLocalidad}
                                  onChange={(e) => setEditLocalidad(e.target.value)}
                                  disabled={busy}
                                />
                                <input
                                  className="min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                                  value={editEsp}
                                  onChange={(e) => setEditEsp(e.target.value)}
                                  disabled={busy}
                                />
                                <select
                                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                                  value={editDia}
                                  onChange={(e) =>
                                    setEditDia(Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7)
                                  }
                                  disabled={busy}
                                >
                                  {[1, 2, 3, 4, 5, 6, 7].map((di) => (
                                    <option key={di} value={di}>
                                      {DIA_LABEL[di]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <textarea
                                className="min-h-[6rem] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                                value={editTexto}
                                onChange={(e) => setEditTexto(e.target.value)}
                                disabled={busy}
                              />
                              <div className="flex gap-2">
                                <Button type="button" size="sm" onClick={() => void saveEditPlan()} disabled={busy}>
                                  Guardar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingPlanId(null)}
                                  disabled={busy}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">{row.localidad}</span>
                                  {" · "}
                                  <span>{row.especialidad}</span>
                                </p>
                                <p className="whitespace-pre-wrap text-sm leading-snug">{row.texto}</p>
                              </div>
                              {canEdit ? (
                                <div className="flex shrink-0 gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    aria-label="Editar"
                                    disabled={busy}
                                    onClick={() => startEditPlan(row)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                                    aria-label="Eliminar"
                                    disabled={busy}
                                    onClick={() => void onDeletePlanRow(row.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
