"use client";

import { actionImportAssetsExcel } from "@/app/actions/assets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_CENTRO, KNOWN_CENTROS } from "@/lib/config/app-config";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { FileSpreadsheet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const OTRO_CENTRO_VALUE = "__otro__";

const SELECT_CENTRO_CLASS =
  "flex h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm transition-[border-color,box-shadow] duration-150 sm:min-w-[14rem] sm:w-auto focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function AssetExcelImportPanel() {
  const { puede } = usePermisos();
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileInitRef = useRef(false);
  const [centroMode, setCentroMode] = useState<"lista" | "otro">("lista");
  const [centroLista, setCentroLista] = useState<string>(() => KNOWN_CENTROS[0] ?? DEFAULT_CENTRO);
  const [centroOtro, setCentroOtro] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const loading = authLoading || profileLoading;
  const canImport = puede("activos:crear_editar");

  useEffect(() => {
    profileInitRef.current = false;
  }, [user?.uid]);

  useEffect(() => {
    if (profileInitRef.current || profileLoading || !profile) return;
    profileInitRef.current = true;
    const c = (profile.centro ?? "").trim();
    if (c && KNOWN_CENTROS.includes(c)) {
      setCentroMode("lista");
      setCentroLista(c);
      setCentroOtro("");
    } else if (c) {
      setCentroMode("otro");
      setCentroOtro(c);
    }
  }, [profile, profileLoading]);

  const effectiveSector =
    centroMode === "lista" ? centroLista.trim() : centroOtro.trim();

  const applyCentroPerfil = useCallback(() => {
    const c = (profile?.centro ?? "").trim();
    if (!c) return;
    if (KNOWN_CENTROS.includes(c)) {
      setCentroMode("lista");
      setCentroLista(c);
      setCentroOtro("");
    } else {
      setCentroMode("otro");
      setCentroOtro(c);
    }
  }, [profile?.centro]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMessage(null);
    setWarnings([]);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!canImport) {
      setMessage("Solo administradores pueden importar equipos.");
      return;
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      setMessage("Usá un archivo Excel (.xlsx o .xls).");
      return;
    }
    const sec =
      effectiveSector ||
      (profile?.centro ?? "").trim() ||
      (KNOWN_CENTROS[0] ?? DEFAULT_CENTRO);
    if (!sec.trim()) {
      setMessage("Elegí un centro de la lista o escribí uno en «Otro».");
      return;
    }

    setBusy(true);
    try {
      const fileBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const token = await getClientIdToken();
      if (!token) {
        setMessage("Sesión expirada; volvé a iniciar sesión.");
        return;
      }
      const res = await actionImportAssetsExcel(token, {
        fileBase64,
        sectorCentro: sec.trim(),
      });
      if (!res.ok) {
        setMessage(res.error.message);
        return;
      }
      setWarnings(res.data.warnings);
      setMessage(
        res.data.imported === 0
          ? "No se importó ninguna fila. Revisá el formato del Excel y las advertencias."
          : `Importación lista: ${res.data.imported} equipos.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al importar");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return null;
  }

  if (!canImport) {
    return null;
  }

  return (
    <Card className="border-amber-200/80 dark:border-amber-900/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="h-4 w-4 opacity-90" aria-hidden />
          Carga masiva desde Excel
        </CardTitle>
        <CardDescription className="text-balance">
          Subí el listado (.xlsx) y elegí la planta o centro por defecto del listado (se configura por entorno con
          variables públicas; si no está tu código, usá «Otro»). Mismo formato que el script: AA y GG. Si el Excel
          trae «Centro» o «Planta», ese valor manda fila a fila.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-[14rem]">
            <label htmlFor="asset-import-centro" className="text-xs font-medium text-muted">
              Centro / planta (sector)
            </label>
            <select
              id="asset-import-centro"
              className={SELECT_CENTRO_CLASS}
              value={centroMode === "lista" ? centroLista : OTRO_CENTRO_VALUE}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTRO_CENTRO_VALUE) {
                  setCentroMode("otro");
                  setCentroOtro((o) => (o.trim() ? o : centroLista));
                } else {
                  setCentroMode("lista");
                  setCentroLista(v);
                }
              }}
            >
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={OTRO_CENTRO_VALUE}>Otro (escribir…)</option>
            </select>
            {centroMode === "otro" ? (
              <Input
                id="asset-import-centro-otro"
                placeholder="Código de planta"
                value={centroOtro}
                onChange={(e) => setCentroOtro(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyCentroPerfil}
              disabled={busy || !(profile?.centro ?? "").trim()}
              title={
                !(profile?.centro ?? "").trim()
                  ? "Tu perfil no tiene centro asignado"
                  : "Rellenar con el centro de tu usuario"
              }
            >
              Usar mi centro del perfil
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
              {busy ? "Importando…" : "Elegir Excel"}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={onFileChange}
          />
        </div>
        {message ? (
          <p className="text-sm font-medium text-foreground" role="status">
            {message}
          </p>
        ) : null}
        {warnings.length ? (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border/80 bg-muted/30 p-3 text-xs text-muted">
            <p className="mb-2 font-medium text-foreground">Advertencias</p>
            <ul className="list-inside list-disc space-y-0.5">
              {warnings.slice(0, 80).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {warnings.length > 80 ? (
              <p className="mt-2 text-[11px]">… y {warnings.length - 80} más</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
