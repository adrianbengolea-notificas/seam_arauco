"use client";

import type { ResultadoImportacionAvisos } from "@/lib/importaciones/avisos-excel-admin";
import { Button } from "@/components/ui/button";
import { MAX_EXCEL_IMPORT_BYTES } from "@/lib/config/limits";
import { cn } from "@/lib/utils";
import { getClientIdToken } from "@/modules/users/hooks";
import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

export function PasoImportacionParcheMensuales({
  paso,
  user,
  puedeImportar,
  onImportado,
}: {
  paso: number;
  user: { uid: string } | null | undefined;
  puedeImportar: boolean;
  onImportado?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<false | "preview" | "commit">(false);
  const [result, setResult] = useState<ResultadoImportacionAvisos | null>(null);
  const [lastDryRun, setLastDryRun] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (dryRun: boolean) => {
      if (!user || !puedeImportar || !file) {
        setError("Elegí un archivo .xlsx");
        return;
      }
      if (file.size > MAX_EXCEL_IMPORT_BYTES) {
        setError("Archivo muy grande (máximo 20 MB).");
        return;
      }
      setError(null);
      setBusy(dryRun ? "preview" : "commit");
      try {
        const token = await getClientIdToken();
        if (!token) throw new Error("Sin sesión");
        const fd = new FormData();
        fd.set("modo", "mensuales_parche");
        fd.set("dry_run", dryRun ? "true" : "false");
        fd.set("file", file);
        const res = await fetch("/api/admin/import-avisos", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const json = (await res.json()) as { ok: boolean; error?: string; result?: ResultadoImportacionAvisos };
        if (!res.ok || !json.ok) throw new Error(json.error ?? res.statusText);
        setResult(json.result ?? null);
        setLastDryRun(dryRun);
        if (!dryRun) onImportado?.();
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [file, onImportado, puedeImportar, user],
  );

  return (
    <div className={cn("rounded-xl border p-5 space-y-4", "bg-emerald-500/10 border-emerald-500/30")}>
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
          {paso}
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-foreground">Parche mensuales — avisos nuevos del mes</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Actualiza avisos mensuales <strong className="text-foreground/90">ya existentes</strong> con estado,
            fecha programada y centro. Usalo cada mes cuando SAP emite números nuevos (ej. junio, julio).
          </p>
          <p className="text-xs text-muted-foreground">
            Archivo de ejemplo:{" "}
            <span className="font-mono text-foreground/80">MENSUALES_[mes]_[año].xlsx</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Columnas: <span className="font-mono">Aviso</span>,{" "}
            <span className="font-mono">Descripción</span> (obligatorias); opcionales{" "}
            <span className="font-mono">Status</span>, <span className="font-mono">CePl</span>,{" "}
            <span className="font-mono">Fecha</span>. Una fila = un aviso.
          </p>
          <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-950 dark:text-amber-100">
            <strong>No confundir</strong> con el paso 3 (calendario anual): el calendario marca en qué meses corre
            cada tarea; el parche trae los <strong>números SAP del mes corriente</strong>.
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Seleccioná el archivo .xlsx
        </label>
        <input
          type="file"
          accept=".xlsx,.xls"
          className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
          disabled={busy !== false}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy !== false || !file} onClick={() => void run(true)}>
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          1. Vista previa
        </Button>
        <Button type="button" disabled={busy !== false || !file} onClick={() => void run(false)}>
          {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          2. Confirmar importación
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
          <p className="font-medium text-foreground">
            {lastDryRun ? "Vista previa (sin cambios)" : "Parche mensual aplicado"}
          </p>
          <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
            <li>Filas leídas: {result.filasLeidas}</li>
            <li>Registros a escribir: {result.procesados}</li>
            <li>Merge sobre existentes: {result.existentesMerge}</li>
            <li>Altas nuevas: {result.nuevosDocumentos}</li>
          </ul>
          {result.advertencias.length ? (
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-800 dark:text-amber-200">
              {result.advertencias.slice(0, 10).map((a, i) => (
                <li key={i}>{typeof a === "string" ? a : String(a)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
