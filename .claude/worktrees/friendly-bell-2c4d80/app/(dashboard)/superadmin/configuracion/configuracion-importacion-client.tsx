"use client";

import { confirmarImportAvisos, previewImportAvisos } from "@/app/actions/import";
import type { ResultadoImportacionAvisos } from "@/lib/importaciones/avisos-excel-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { useAvisosListaImportacionConfig, type TabImportacionAvisosId } from "@/modules/notices/hooks";
import type { Aviso } from "@/modules/notices/types";
import { getClientIdToken, useAuthUser } from "@/modules/users/hooks";
import type { ParseResult } from "@/lib/import/parse-avisos-excel";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
  disabled?: boolean;
}[] = [
  {
    id: "preventivos_todas",
    label: "Preventivos (completo)",
    description:
      "Archivo tipo AVISOS_PREVENTIVOS.xlsx — importa todas las hojas (mensual, trimestral, semestral, anual) detectadas. La lista muestra avisos preventivos (hasta 450 por centro o global).",
  },
  {
    id: "preventivos_mensual",
    label: "Mensual",
    description: "Mismo Excel; solo filas de hojas clasificadas como mensuales. La lista: badge M y/o frecuencia mensual.",
  },
  {
    id: "preventivos_trimestral",
    label: "Trimestral",
    description: "Solo hojas trimestrales del libro de preventivos. Lista: badge T y/o trimestral.",
  },
  {
    id: "preventivos_semestral",
    label: "Semestral",
    description: "Solo hojas semestrales. Lista: badge S y/o semestral.",
  },
  {
    id: "preventivos_anual",
    label: "Anual",
    description: "Solo hojas anuales. Lista: badge A y/o anual.",
  },
  {
    id: "mensuales_parche",
    label: "Mensuales (parche Excel)",
    description:
      "Listado MENSUALES_*.xlsx — actualiza estado/fecha/centro en avisos existentes. La lista coincide con la pestaña Mensual para revisión rápida.",
  },
  {
    id: "listado_semestral_anual",
    label: "Listado S/A",
    description: "Listado_avisos_Semestral-Anual.xlsx. Lista en Firestore: preventivos con badge S o A.",
  },
  {
    id: "correctivos",
    label: "Correctivos",
    description: "Planilla de correctivos. Lista: avisos con tipo correctivo.",
  },
  {
    id: "semanal_info",
    label: "Semanal",
    description:
      "No hay archivo estándar SAP en este flujo. Si más adelante definís un layout, se agrega acá.",
    disabled: true,
  },
];

const ESPECIALIDADES: Aviso["especialidad"][] = ["AA", "ELECTRICO", "GG", "HG"];

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
  }, [
    aviso.id,
    aviso.texto_corto,
    aviso.centro,
    aviso.especialidad,
    aviso.estado_planilla,
  ]);

  const guardar = useCallback(async () => {
    setBusy(true);
    setRetro(null);
    try {
      const db = getFirebaseDb();
      await updateDoc(doc(db, COLLECTIONS.avisos, aviso.id), {
        texto_corto: textoCorto.trim(),
        centro: centro.trim(),
        especialidad,
        estado_planilla: estadoPlanilla.trim() || null,
        updated_at: serverTimestamp(),
      });
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
            <option key={e} value={e}>
              {e}
            </option>
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
            Guardar
          </Button>
          {retro ? <span className="text-[10px] text-muted-foreground">{retro}</span> : null}
        </div>
      </td>
    </tr>
  );
}

export function ConfiguracionImportacionClient() {
  const { puede, rol, centro: perfilCentro } = usePermisos();
  const { user } = useAuthUser();
  const puedeImportar = puede("admin:cargar_programa");
  const verTodosLosCentros = rol === "superadmin";

  const [tab, setTab] = useState<TabImportacionAvisosId>("preventivos_todas");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<false | "preview" | "commit">(false);
  /** Solo «Mensuales (parche)»: respuesta de la API legada. */
  const [legacyResult, setLegacyResult] = useState<ResultadoImportacionAvisos | null>(null);
  const [lastLegacyDryRun, setLastLegacyDryRun] = useState<boolean | null>(null);
  /** Vista previa nueva (parser robusto). */
  const [parsePreview, setParsePreview] = useState<ParseResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<{
    importados: number;
    actualizados: number;
    sinActivoUt: number;
    errores: string[];
    filasParseadas: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listaRefresh, setListaRefresh] = useState(0);

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
      if (!user || !puedeImportar) return;
      if (!file) {
        setError("Elegí un archivo .xlsx");
        return;
      }
      setError(null);
      setBusy(dryRun ? "preview" : "commit");
      try {
        const token = await getClientIdToken();
        if (!token) throw new Error("Sin sesión");
        const fd = new FormData();
        fd.set("modo", tab);
        fd.set("dry_run", dryRun ? "true" : "false");
        fd.set("file", file);
        const res = await fetch("/api/admin/import-avisos", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const json = (await res.json()) as { ok: boolean; error?: string; result?: ResultadoImportacionAvisos };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? res.statusText);
        }
        setLegacyResult(json.result ?? null);
        setLastLegacyDryRun(dryRun);
        setParsePreview(null);
        setCommitSummary(null);
        if (!dryRun) recargarLista();
      } catch (e) {
        setLegacyResult(null);
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [file, puedeImportar, recargarLista, tab, user],
  );

  const runPreview = useCallback(async () => {
    if (!user || !puedeImportar) return;
    if (tab === "semanal_info") return;
    if (tab === "mensuales_parche") {
      await runLegacyParche(true);
      return;
    }
    if (!file) {
      setError("Elegí un archivo .xlsx");
      return;
    }
    setError(null);
    setCommitSummary(null);
    setLegacyResult(null);
    setBusy("preview");
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const fd = new FormData();
      fd.set("file", file);
      const res = await previewImportAvisos(token, tab, fd);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      setParsePreview(res.data);
    } catch (e) {
      setParsePreview(null);
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [file, puedeImportar, runLegacyParche, tab, user]);

  const runConfirm = useCallback(async () => {
    if (!user || !puedeImportar) return;
    if (tab === "semanal_info") return;
    if (tab === "mensuales_parche") {
      await runLegacyParche(false);
      return;
    }
    if (!parsePreview) {
      setError("Primero generá la vista previa.");
      return;
    }
    setError(null);
    setBusy("commit");
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await confirmarImportAvisos(token, tab, parsePreview);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      setCommitSummary(res.data);
      setParsePreview(null);
      recargarLista();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [parsePreview, puedeImportar, recargarLista, runLegacyParche, tab, user]);

  const cancelarPreview = useCallback(() => {
    setParsePreview(null);
    setError(null);
  }, []);

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
          En cada pestaña: importá la planilla correspondiente y trabajá la lista de avisos ya cargados en Firestore
          (edición por fila).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          role="tablist"
          aria-label="Categorías de importación y listado"
          className="flex flex-wrap gap-1 border-b border-border pb-2"
        >
          {TAB_DEFS.map((t) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={t.disabled}
                className={cn(
                  "rounded-md px-3 py-2 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                  selected
                    ? "bg-surface text-foreground ring-1 ring-brand/40"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  t.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
                )}
                onClick={() => {
                  setTab(t.id);
                  setLegacyResult(null);
                  setParsePreview(null);
                  setCommitSummary(null);
                  setError(null);
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="space-y-4">
          {def ? <p className="text-sm text-muted-foreground leading-relaxed">{def.description}</p> : null}

          <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Archivo Excel</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="file"
                accept=".xlsx,.xls"
                className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
                disabled={tab === "semanal_info" || busy !== false}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setLegacyResult(null);
                  setParsePreview(null);
                  setCommitSummary(null);
                  setError(null);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={tab === "semanal_info" || busy !== false || !file}
                  onClick={() => void runPreview()}
                >
                  {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Vista previa
                </Button>
                {tab !== "mensuales_parche" ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={tab === "semanal_info" || busy !== false || !parsePreview}
                      onClick={() => void cancelarPreview()}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      disabled={tab === "semanal_info" || busy !== false || !parsePreview}
                      onClick={() => void runConfirm()}
                    >
                      {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Confirmar importación
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    disabled={busy !== false || !file}
                    onClick={() => void runLegacyParche(false)}
                  >
                    {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Importar a Firestore
                  </Button>
                )}
              </div>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {parsePreview ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
              <p className="font-medium text-foreground">Vista previa (sin cambios en base)</p>
              <p className="text-muted-foreground">
                <span className="text-emerald-700 dark:text-emerald-300">
                  ✓ {parsePreview.avisos.length}{" "}
                  {parsePreview.avisos.length === 1 ? "aviso listo" : "avisos listos"} para importar
                </span>
                {" · "}
                <span className="text-amber-800 dark:text-amber-200">
                  ⚠ {parsePreview.advertencias.length}{" "}
                  {parsePreview.advertencias.length === 1 ? "advertencia" : "advertencias"}
                </span>
                {" · "}
                <span className="text-destructive">
                  ✗ {parsePreview.errores.length}{" "}
                  {parsePreview.errores.length === 1 ? "error" : "errores"}
                </span>
              </p>
              {parsePreview.hojasProcesadas?.length ? (
                <p className="text-xs text-muted-foreground">
                  Hojas: {parsePreview.hojasProcesadas.join(", ")} · Tipo detectado: {parsePreview.tipoDetectado}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Tipo detectado: {parsePreview.tipoDetectado}</p>
              )}
              {parsePreview.fatal ? (
                <p className="text-xs text-amber-800 dark:text-amber-200" role="status">
                  {parsePreview.fatal}
                </p>
              ) : null}
              <div>
                <p className="text-xs font-medium text-muted-foreground">Columnas detectadas</p>
                <ul className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {Object.entries(parsePreview.columnasMapeadas).map(([campo, cab]) => (
                    <li key={campo}>
                      <span className="font-mono text-foreground">
                        {CAMPO_IMPORT_LABEL[campo] ?? campo}
                      </span>
                      {" ← "}
                      <span className="italic">&quot;{cab}&quot;</span>
                      <span className="text-emerald-600 dark:text-emerald-400"> ✓</span>
                      {campo === "ubicacionTecnica" && cab.toLowerCase().includes("tenic") ? (
                        <span className="ml-1 text-[10px]">(typo tolerado)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {parsePreview.columnasNoReconocidas.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Columnas sin mapeo (ignoradas):{" "}
                    {parsePreview.columnasNoReconocidas.map((c) => (
                      <span key={c} className="mr-2 font-mono">
                        &quot;{c}&quot;
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
              {parsePreview.advertencias.length ? (
                <div className="text-amber-800 dark:text-amber-200">
                  <p className="text-xs font-medium">Advertencias</p>
                  <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-4 text-xs">
                    {parsePreview.advertencias.slice(0, 25).map((a, i) => (
                      <li key={i}>{a.mensaje}</li>
                    ))}
                  </ul>
                  {parsePreview.advertencias.length > 25 ? (
                    <p className="mt-1 text-[10px] opacity-80">… y más (revisá el Excel)</p>
                  ) : null}
                </div>
              ) : null}
              {parsePreview.errores.length ? (
                <div className="text-destructive">
                  <p className="text-xs font-medium">Errores de fila</p>
                  <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-xs">
                    {parsePreview.errores.slice(0, 20).map((e, i) => (
                      <li key={i}>
                        Fila {e.fila}: {e.campo} — {e.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Primeros avisos parseados (máx. 5)
                </p>
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
                    {parsePreview.avisos.slice(0, 5).map((a, i) => (
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
          ) : null}

          {commitSummary ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4 text-sm">
              <p className="font-medium text-foreground">Importación aplicada</p>
              <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                <li>Filas parseadas: {commitSummary.filasParseadas}</li>
                <li>Documentos nuevos (estimado): {commitSummary.importados}</li>
                <li>Merge sobre existentes (estimado): {commitSummary.actualizados}</li>
                <li>Sin activo para UT: {commitSummary.sinActivoUt}</li>
              </ul>
              {commitSummary.errores.length ? (
                <div className="text-destructive">
                  <p className="text-xs font-medium">Detalle</p>
                  <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-xs">
                    {commitSummary.errores.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {legacyResult ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
              <p className="font-medium text-foreground">
                {lastLegacyDryRun ? "Vista previa (parche, sin cambios en base)" : "Importación parche aplicada"}
              </p>
              <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                <li>Filas leídas: {legacyResult.filasLeidas}</li>
                <li>Registros a escribir (payload): {legacyResult.procesados}</li>
                <li>Sin nº aviso: {legacyResult.sinNumeroAviso}</li>
                <li>Sin activo para UT: {legacyResult.sinActivoUt}</li>
                <li>Altas nuevas (doc): {legacyResult.nuevosDocumentos}</li>
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
                            <td key={ci} className="max-w-[12rem] truncate px-2 py-1">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab !== "semanal_info" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">Avisos en Firestore (esta categoría)</h3>
                <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={recargarLista}>
                  Recargar lista
                </Button>
              </div>
              {listaError ? (
                <p className="text-sm text-destructive" role="alert">
                  {listaError.message}
                </p>
              ) : null}
              {listaLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando avisos…
                </p>
              ) : avisos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay avisos que coincidan con esta pestaña (límite {450} filas).</p>
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
                        <th className="px-2 py-2"> </th>
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
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
