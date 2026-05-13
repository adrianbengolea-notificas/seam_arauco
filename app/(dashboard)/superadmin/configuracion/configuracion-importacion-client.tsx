"use client";

import { confirmarImportAvisos, previewImportAvisos } from "@/app/actions/import";
import { actionEditAviso } from "@/app/actions/avisos";
import type { ResultadoImportacionAvisos } from "@/lib/importaciones/avisos-excel-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_EXCEL_IMPORT_BYTES } from "@/lib/config/limits";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import { useAvisosListaImportacionConfig, type TabImportacionAvisosId } from "@/modules/notices/hooks";
import type { Aviso } from "@/modules/notices/types";
import { getClientIdToken, useAuthUser } from "@/modules/users/hooks";
import type { ParseResult } from "@/lib/import/parse-avisos-excel";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  KNOWN_CENTROS,
  nombreCentro,
  PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA,
} from "@/lib/config/app-config";

const CAMPO_IMPORT_LABEL: Record<string, string> = {
  numero: "Número de aviso",
  descripcion: "Descripción",
  ubicacionTecnica: "Ubicación técnica",
  denomUbicTecnica: "Denominación UT",
  especialidad: "Especialidad",
  frecuencia: "Frecuencia",
  tipo: "Tipo",
  status: "Estado",
  centro: "Centro",
  ptoTrbRes: "Puesto trabajo / responsable",
  autAviso: "Autor aviso",
  fecha: "Fecha",
};

const TAB_DEFS: {
  id: TabImportacionAvisosId;
  label: string;
  description: string;
  hidden?: boolean;
}[] = [
  {
    id: "preventivos_todas",
    label: "Todos los preventivos",
    description: "Muestra todos los avisos preventivos (mensual, trimestral, semestral y anual) que ya están en la base de datos.",
  },
  {
    id: "preventivos_mensual",
    label: "Mensual",
    description: "Filtra los avisos con frecuencia mensual.",
  },
  {
    id: "preventivos_trimestral",
    label: "Trimestral",
    description: "Filtra los avisos con frecuencia trimestral.",
  },
  {
    id: "preventivos_semestral",
    label: "Semestral",
    description: "Filtra los avisos con frecuencia semestral.",
  },
  {
    id: "preventivos_anual",
    label: "Anual",
    description: "Filtra los avisos con frecuencia anual.",
  },
  {
    id: "correctivos",
    label: "Correctivos",
    description: "Filtra los avisos de tipo correctivo.",
  },
  {
    id: "mensuales_parche",
    label: "Parche mensuales",
    description: "Herramienta para reimportar solo el estado y fecha de avisos mensuales desde un Excel legado (MENSUALES_*.xlsx), sin tocar el resto.",
  },
  // Ocultos de la barra pero usables internamente
  { id: "listado_semestral_anual", label: "Listado S/A", description: "", hidden: true },
  { id: "semanal_info", label: "Aviso semanal (futuro)", description: "", hidden: true },
];

const ESPECIALIDADES: Aviso["especialidad"][] = ["AA", "ELECTRICO", "GG"];

// ─── Preview & commit result panels ──────────────────────────────────────────

function PreviewPanel({
  preview,
  centroForzado,
}: {
  preview: ParseResult;
  centroForzado: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
      <p className="font-medium text-foreground">Vista previa (sin cambios en la base de datos)</p>
      {centroForzado ? (
        <p className="text-xs font-medium text-sky-700 dark:text-sky-300">
          Centro destino forzado: <span className="font-medium">{nombreCentro(centroForzado)}</span>
          {nombreCentro(centroForzado) !== centroForzado.trim() ? (
            <span className="font-mono text-[0.95em] text-sky-800/90 dark:text-sky-200/90">
              {" "}
              ({centroForzado.trim()})
            </span>
          ) : null}{" "}
          — todos los avisos de este lote se asignarán a este centro.
        </p>
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Centro: detección automática (columna &quot;CePl&quot; del Excel o prefijo de ubicación técnica).
        </p>
      )}
      <p className="text-muted-foreground">
        <span className="text-emerald-700 dark:text-emerald-300">
          ✓ {preview.avisos.length} {preview.avisos.length === 1 ? "aviso listo" : "avisos listos"} para importar
        </span>
        {" · "}
        <span className="text-amber-800 dark:text-amber-200">
          ⚠ {preview.advertencias.length} {preview.advertencias.length === 1 ? "advertencia" : "advertencias"}
        </span>
        {" · "}
        <span className="text-destructive">
          ✗ {preview.errores.length} {preview.errores.length === 1 ? "error" : "errores"}
        </span>
      </p>
      {preview.hojasProcesadas?.length ? (
        <p className="text-xs text-muted-foreground">
          Hojas: {preview.hojasProcesadas.join(", ")} · Tipo detectado: {preview.tipoDetectado}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Tipo detectado: {preview.tipoDetectado}</p>
      )}
      {preview.fatal ? (
        <p className="text-xs text-amber-800 dark:text-amber-200" role="status">
          {preview.fatal}
        </p>
      ) : null}
      <div>
        <p className="text-xs font-medium text-muted-foreground">Columnas detectadas</p>
        <ul className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          {Object.entries(preview.columnasMapeadas).map(([campo, cab]) => (
            <li key={campo}>
              <span className="font-mono text-foreground">{CAMPO_IMPORT_LABEL[campo] ?? campo}</span>
              {" ← "}
              <span className="italic">&quot;{cab}&quot;</span>
              <span className="text-emerald-600 dark:text-emerald-400"> ✓</span>
            </li>
          ))}
        </ul>
        {preview.columnasNoReconocidas.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Columnas sin mapeo (ignoradas):{" "}
            {preview.columnasNoReconocidas.map((c) => (
              <span key={c} className="mr-2 font-mono">&quot;{c}&quot;</span>
            ))}
          </p>
        ) : null}
      </div>
      {preview.advertencias.length ? (
        <div className="text-amber-800 dark:text-amber-200">
          <p className="text-xs font-medium">Advertencias</p>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-4 text-xs">
            {preview.advertencias.slice(0, 25).map((a, i) => (
              <li key={i}>{a.mensaje}</li>
            ))}
          </ul>
          {preview.advertencias.length > 25 ? (
            <p className="mt-1 text-[10px] opacity-80">… y más (revisá el Excel)</p>
          ) : null}
        </div>
      ) : null}
      {preview.errores.length ? (
        <div className="text-destructive">
          <p className="text-xs font-medium">Errores de fila</p>
          <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-xs">
            {preview.errores.slice(0, 20).map((e, i) => (
              <li key={i}>
                Fila {e.fila}: {e.campo} — {e.motivo}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Primeros avisos parseados (máx. 5)</p>
        <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5">Nº</th>
              <th className="px-2 py-1.5">Descripción</th>
              <th className="px-2 py-1.5">UT</th>
              <th className="px-2 py-1.5">Tipo</th>
              <th className="px-2 py-1.5">Frec.</th>
              <th className="px-2 py-1.5">Esp.</th>
            </tr>
          </thead>
          <tbody>
            {preview.avisos.slice(0, 5).map((a, i) => (
              <tr key={i} className="border-t border-border">
                <td className="whitespace-nowrap px-2 py-1 font-mono">{a.numero}</td>
                <td className="max-w-[14rem] truncate px-2 py-1" title={a.descripcion}>
                  {a.descripcion ?? "—"}
                </td>
                <td className="max-w-[8rem] truncate px-2 py-1 font-mono text-[10px]" title={a.ubicacionTecnica}>
                  {a.ubicacionTecnica ?? "—"}
                </td>
                <td className="px-2 py-1">{a.tipo ?? "—"}</td>
                <td className="px-2 py-1">{a.frecuencia ?? "—"}</td>
                <td className="px-2 py-1">{a.especialidad ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type CommitSummary = {
  importados: number;
  actualizados: number;
  sinActivoUt: number;
  errores: string[];
  filasParseadas: number;
  utSinActivo?: string[];
  centrosDesconocidos?: string[];
};

function CommitPanel({ summary }: { summary: CommitSummary }) {
  const [expandUt, setExpandUt] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
      <p className="font-medium text-foreground">Importación aplicada</p>
      <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
        <li>
          <span className="text-emerald-700 dark:text-emerald-300">
            ✓ Filas parseadas / escritura: {summary.filasParseadas}
          </span>
        </li>
        <li>Documentos nuevos (estimado): {summary.importados}</li>
        <li>Merge sobre existentes (estimado): {summary.actualizados}</li>
        <li>
          <span className={summary.sinActivoUt > 0 ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground"}>
            ⚠ Sin activo para UT (descartados): {summary.sinActivoUt}
          </span>
        </li>
      </ul>
      {summary.centrosDesconocidos?.length ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
          Centros en el Excel no reconocidos:{" "}
          <span className="font-mono">{summary.centrosDesconocidos.join(", ")}</span>. Agregá el código en{" "}
          <span className="font-mono">NEXT_PUBLIC_KNOWN_CENTROS</span> y redesplegá.
        </p>
      ) : null}
      {summary.sinActivoUt > 0 ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            ¿Faltan activos?{" "}
            <Link href="/activos" className="font-medium text-primary underline underline-offset-2">
              Cargalos en Activos
            </Link>{" "}
            y reimportá.
          </p>
          {(summary.utSinActivo?.length ?? 0) > 0 ? (
            <div>
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => setExpandUt((e) => !e)}
              >
                {expandUt ? "Ocultar" : "Ver"} lista de UTs sin activo ({summary.utSinActivo?.length ?? 0})
              </button>
              {expandUt ? (
                <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-4 text-[11px] text-muted-foreground">
                  {summary.utSinActivo!.map((u, i) => (
                    <li key={i} className="font-mono">{u}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {summary.errores.length ? (
        <div className="text-destructive">
          <p className="text-xs font-medium">Detalle de errores</p>
          <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-xs">
            {summary.errores.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ─── Self-contained upload block for one paso ─────────────────────────────────

function PasoImportacion({
  paso,
  tituloArchivo,
  descripcionArchivo,
  tab,
  user,
  puedeImportar,
  onImportado,
}: {
  paso: 1 | 2 | 3 | 4;
  tituloArchivo: string;
  descripcionArchivo: string;
  tab: ModoImportacionAvisos;
  user: { uid: string } | null | undefined;
  puedeImportar: boolean;
  onImportado?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [centroForzado, setCentroForzado] = useState<string>("");
  const [busy, setBusy] = useState<false | "preview" | "commit">(false);
  const [parsePreview, setParsePreview] = useState<ParseResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setParsePreview(null);
    setCommitSummary(null);
    setError(null);
  };

  const runPreview = useCallback(async () => {
    if (!user || !puedeImportar || !file) return;
    if (file.size > MAX_EXCEL_IMPORT_BYTES) {
      setError("Archivo muy grande (máximo 20 MB).");
      return;
    }
    setError(null);
    setCommitSummary(null);
    setParsePreview(null);
    setBusy("preview");
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const fd = new FormData();
      fd.set("file", file);
      const res = await previewImportAvisos(token, tab, fd);
      if (!res.ok) throw new Error(res.error.message);
      setParsePreview(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [file, puedeImportar, tab, user]);

  const runConfirm = useCallback(async () => {
    if (!user || !puedeImportar || !parsePreview) return;
    setError(null);
    setBusy("commit");
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await confirmarImportAvisos(token, tab, parsePreview, centroForzado || undefined);
      if (!res.ok) throw new Error(res.error.message);
      setCommitSummary(res.data);
      setParsePreview(null);
      onImportado?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [centroForzado, onImportado, parsePreview, puedeImportar, tab, user]);

  const stepBg = paso === 1 ? "bg-sky-500/10 border-sky-500/30" : "bg-violet-500/10 border-violet-500/30";
  const stepBadge = paso === 1 ? "bg-sky-600 text-white" : "bg-violet-600 text-white";

  return (
    <div className={cn("rounded-xl border p-5 space-y-4", stepBg)}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", stepBadge)}>
          {paso}
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            Archivo:{" "}
            <span className="font-mono font-medium">{tituloArchivo}</span>
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{descripcionArchivo}</p>
        </div>
      </div>

      {/* File input row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex-1 min-w-[12rem]">
          <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Seleccioná el archivo .xlsx
          </label>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
            disabled={busy !== false}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              reset();
              setCentroForzado("");
            }}
          />
        </div>

        <div className="min-w-[12rem]">
          <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide" htmlFor={`centro-forzado-${paso}`}>
            Centro destino (opcional)
          </label>
          <select
            id={`centro-forzado-${paso}`}
            className={cn(
              "h-9 w-full rounded-md border border-border bg-surface px-2 text-xs",
              "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
            )}
            disabled={busy !== false}
            value={centroForzado}
            onChange={(e) => {
              setCentroForzado(e.target.value);
              reset();
            }}
          >
            <option value="">— Detectar automáticamente —</option>
            {[...KNOWN_CENTROS].map((c) => (
              <option key={c} value={c}>
                {nombreCentro(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== false || !file}
          onClick={() => void runPreview()}
        >
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          1. Vista previa
        </Button>
        {parsePreview ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== false}
              onClick={() => { setParsePreview(null); setError(null); }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy !== false}
              onClick={() => void runConfirm()}
            >
              {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              2. Confirmar importación
            </Button>
          </>
        ) : null}
      </div>

      {/* Error */}
      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : null}

      {/* Preview results */}
      {parsePreview ? (
        <PreviewPanel preview={parsePreview} centroForzado={centroForzado} />
      ) : null}

      {/* Commit results */}
      {commitSummary ? (
        <CommitPanel summary={commitSummary} />
      ) : null}
    </div>
  );
}

// ─── Editable row (auditing table) ───────────────────────────────────────────

function FilaAvisoEditable({ aviso, alGuardar }: { aviso: Aviso; alGuardar: () => void }) {
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
        <div className="flex flex-col items-stretch gap-1">
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
          {retro ? <span className="text-[10px] text-muted-foreground">{retro}</span> : null}
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConfiguracionImportacionClient() {
  const { puede, rol, centro: perfilCentro } = usePermisos();
  const { user } = useAuthUser();
  const puedeImportar = puede("admin:cargar_programa");
  const verTodosLosCentros = rol === "superadmin";

  const [tab, setTab] = useState<TabImportacionAvisosId>("preventivos_todas");
  const [listaRefresh, setListaRefresh] = useState(0);

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
            , no acá.
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Preventivos: two-step upload blocks ── */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Carga de preventivos (maestro + calendario M/T)</h2>
          <PasoImportacion
            paso={1}
            tab="listado_semestral_anual"
            tituloArchivo="Listado_avisos_Semestral-Anual.xlsx"
            descripcionArchivo="Export SAP con una sola hoja y la columna CePl (centro). Carga los avisos semestrales y anuales con el centro correcto (PT01, PC01, PM02…)."
            user={user}
            puedeImportar={puedeImportar}
            onImportado={recargarLista}
          />
          <PasoImportacion
            paso={2}
            tab="preventivos_todas"
            tituloArchivo="AVISOS PREVENTIVOS Abril 26 - Marzo 27.xlsx"
            descripcionArchivo="Maestro con hojas MEN / TRIM / SEM / ANU. Los meses del calendario anual para mensual y trimestral no se generan acá: deben venir de los Excel de Arauco (pasos 3 y 4). Semestral/anual pueden seguir usando columnas de mes en este archivo."
            user={user}
            puedeImportar={puedeImportar}
            onImportado={recargarLista}
          />
          <PasoImportacion
            paso={3}
            tab="calendario_mensual"
            tituloArchivo="Calendario_avisos_MENSUAL_Arauco.xlsx"
            descripcionArchivo="Planilla oficial con nº de aviso SAP y marcas en columnas de mes (enero…diciembre). Solo actualiza meses en avisos ya cargados con frecuencia mensual; no crea avisos nuevos."
            user={user}
            puedeImportar={puedeImportar}
            onImportado={recargarLista}
          />
          <PasoImportacion
            paso={4}
            tab="calendario_trimestral"
            tituloArchivo="Calendario_avisos_TRIMESTRAL_Arauco.xlsx"
            descripcionArchivo="Igual que el mensual pero para hoja trimestral: marcas en meses y nº de aviso. Solo actualiza avisos trimestrales existentes."
            user={user}
            puedeImportar={puedeImportar}
            onImportado={recargarLista}
          />
        </div>

        <hr className="border-border" />

        {/* ── Correctivos ── */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Carga de correctivos (semanal)</h2>
          <PasoImportacion
            paso={1}
            tab="correctivos"
            tituloArchivo="CORRECTIVOS-MES AÑO.xlsx"
            descripcionArchivo="Planilla de correctivos con columnas: N° DE AVISO · UBICACIÓN TÉCNICA · DESCRIPCIÓN · ESPECIALIDAD · FECHA REALIZACIÓN. El centro se detecta automáticamente por el prefijo de la UT (PIRA→PT01, ESP→PC01…). Podés forzarlo si todos los avisos son del mismo centro."
            user={user}
            puedeImportar={puedeImportar}
            onImportado={recargarLista}
          />
        </div>

        <hr className="border-border" />

        {/* ── Auditing tabs (filtros de visualización) ── */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Ver / editar avisos existentes</h2>
          <p className="text-xs text-muted-foreground -mt-2">
            Las pestañas de abajo son <strong>filtros</strong> — no importan nada, solo muestran lo que ya está en la base de datos.
          </p>

          <div
            role="tablist"
            aria-label="Categorías de importación y listado"
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
                  especialidad o estado de planilla de una fila (no reimporta el Excel).
                </p>
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
                ) : (
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
                        {avisos.map((a) => (
                          <FilaAvisoEditable key={a.id} aviso={a} alGuardar={recargarLista} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
