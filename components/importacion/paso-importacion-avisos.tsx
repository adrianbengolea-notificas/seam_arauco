"use client";

import { confirmarImportAvisos, previewImportAvisos } from "@/app/actions/import";
import { Button } from "@/components/ui/button";
import { MAX_EXCEL_IMPORT_BYTES } from "@/lib/config/limits";
import { KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import type { ModoImportacionAvisos } from "@/lib/import/modo-importacion";
import type { ParseResult } from "@/lib/import/parse-avisos-excel";
import { cn } from "@/lib/utils";
import { getClientIdToken } from "@/modules/users/hooks";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

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

export type CommitSummaryImportacion = {
  importados: number;
  actualizados: number;
  sinActivoUt: number;
  errores: string[];
  filasParseadas: number;
  utSinActivo?: string[];
  centrosDesconocidos?: string[];
};

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
              <span key={c} className="mr-2 font-mono">
                &quot;{c}&quot;
              </span>
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

function CommitPanel({ summary }: { summary: CommitSummaryImportacion }) {
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
                    <li key={i} className="font-mono">
                      {u}
                    </li>
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

export function PasoImportacionAvisos({
  paso,
  tituloArchivo,
  descripcionArchivo,
  tab,
  user,
  puedeImportar,
  onImportado,
  variant = "default",
}: {
  paso: 1 | 2 | 3 | 4;
  tituloArchivo: string;
  descripcionArchivo: string;
  tab: ModoImportacionAvisos;
  user: { uid: string } | null | undefined;
  puedeImportar: boolean;
  onImportado?: () => void;
  /** `correctivos` usa estilo ámbar para la carga semanal en Programa. */
  variant?: "default" | "correctivos";
}) {
  const [file, setFile] = useState<File | null>(null);
  const [centroForzado, setCentroForzado] = useState<string>("");
  const [busy, setBusy] = useState<false | "preview" | "commit">(false);
  const [parsePreview, setParsePreview] = useState<ParseResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<CommitSummaryImportacion | null>(null);
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

  const stepBg =
    variant === "correctivos"
      ? "bg-amber-500/10 border-amber-500/30"
      : paso === 1
        ? "bg-sky-500/10 border-sky-500/30"
        : "bg-violet-500/10 border-violet-500/30";
  const stepBadge =
    variant === "correctivos"
      ? "bg-amber-600 text-white"
      : paso === 1
        ? "bg-sky-600 text-white"
        : "bg-violet-600 text-white";

  return (
    <div className={cn("rounded-xl border p-5 space-y-4", stepBg)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            stepBadge,
          )}
        >
          {paso}
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            Archivo: <span className="font-mono font-medium">{tituloArchivo}</span>
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{descripcionArchivo}</p>
        </div>
      </div>

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
          <label
            className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide"
            htmlFor={`centro-forzado-${tab}-${paso}`}
          >
            Centro destino (opcional)
          </label>
          <select
            id={`centro-forzado-${tab}-${paso}`}
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

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy !== false || !file} onClick={() => void runPreview()}>
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          1. Vista previa
        </Button>
        {parsePreview ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== false}
              onClick={() => {
                setParsePreview(null);
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={busy !== false} onClick={() => void runConfirm()}>
              {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              2. Confirmar importación
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {parsePreview ? <PreviewPanel preview={parsePreview} centroForzado={centroForzado} /> : null}

      {commitSummary ? <CommitPanel summary={commitSummary} /> : null}
    </div>
  );
}
