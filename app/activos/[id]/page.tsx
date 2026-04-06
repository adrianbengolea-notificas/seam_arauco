"use client";

import { actionUpdateAsset } from "@/app/actions/assets";
import { AssetQrCard } from "@/components/assets/AssetQrCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAssetLive } from "@/modules/assets/hooks";
import type { EspecialidadActivo } from "@/modules/assets/types";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const selectClassName = cn(
  "h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm",
  "text-foreground",
  "transition-[border-color,box-shadow] duration-150",
  "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
);

const ESPECIALIDAD_OPTIONS: Array<{ value: "" | EspecialidadActivo; label: string }> = [
  { value: "", label: "Sin asignar" },
  { value: "AA", label: "AA" },
  { value: "ELECTRICO", label: "Eléctrico" },
  { value: "GG", label: "GG" },
];

export default function ActivoDetallePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : undefined;
  const { asset, loading, error } = useAssetLive(id);

  const { puede } = usePermisos();
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  const canEdit = puede("activos:crear_editar");
  const authBusy = authLoading || profileLoading;

  const [editing, setEditing] = useState(false);
  const [codigo_legacy, setCodigoLegacy] = useState("");
  const [denominacion, setDenominacion] = useState("");
  const [ubicacion_tecnica, setUbicacionTecnica] = useState("");
  const [centro, setCentro] = useState("");
  const [clase, setClase] = useState("");
  const [grupo_planificacion, setGrupoPlanificacion] = useState("");
  const [especialidad_predeterminada, setEspecialidad] = useState<"" | EspecialidadActivo>("");
  const [activo_operativo, setActivoOperativo] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resetFormFromAsset = useCallback(() => {
    if (!asset) return;
    setCodigoLegacy(asset.codigo_legacy ?? "");
    setDenominacion(asset.denominacion);
    setUbicacionTecnica(asset.ubicacion_tecnica);
    setCentro(asset.centro);
    setClase(asset.clase ?? "");
    setGrupoPlanificacion(asset.grupo_planificacion ?? "");
    setEspecialidad(asset.especialidad_predeterminada ?? "");
    setActivoOperativo(asset.activo_operativo);
    setMessage(null);
  }, [asset]);

  useEffect(() => {
    if (editing && asset) resetFormFromAsset();
  }, [editing, asset, resetFormFromAsset]);

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !canEdit) return;
    setMessage(null);
    setSaveBusy(true);
    try {
      const token = await getClientIdToken();
      if (!token) {
        setMessage("Sesión expirada; volvé a iniciar sesión.");
        return;
      }
      const res = await actionUpdateAsset(token, {
        assetId: id,
        codigo_legacy,
        denominacion,
        ubicacion_tecnica,
        centro,
        clase,
        grupo_planificacion,
        especialidad_predeterminada,
        activo_operativo,
      });
      if (!res.ok) {
        setMessage(res.error.message);
        return;
      }
      setEditing(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activo</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Ficha y QR para campo.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm font-medium">
          {canEdit && asset && !editing ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Editar ficha
            </Button>
          ) : null}
          <Link href="/activos" className="text-zinc-700 underline dark:text-zinc-300">
            Lista
          </Link>
          <Link href="/activos/escaner" className="text-zinc-700 underline dark:text-zinc-300">
            Escaner
          </Link>
        </div>
      </div>

      {!authBusy && user && !canEdit ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Solo administradores pueden editar la ficha del activo.
        </p>
      ) : null}

      {loading ? <p className="text-sm text-zinc-600">Cargando…</p> : null}
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
      {!loading && !error && !asset ? (
        <p className="text-sm text-zinc-600">No se encontró el activo.</p>
      ) : null}

      {asset ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {editing && canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Editar activo</CardTitle>
                <CardDescription>
                  El código del equipo no se puede cambiar (define el id en el sistema). El resto de los datos se
                  actualizan en Firestore.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSaveEdit} className="space-y-5">
                  <label className="block space-y-1.5 text-sm font-medium text-foreground">
                    Código del equipo
                    <Input value={asset.codigo_nuevo} readOnly className="font-mono bg-muted/50" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Código legacy
                      <Input
                        value={codigo_legacy}
                        onChange={(e) => setCodigoLegacy(e.target.value)}
                        maxLength={200}
                        autoComplete="off"
                        className="font-mono"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1.5 text-sm font-medium text-foreground">
                    Nombre del equipo (denominación) *
                    <Input
                      value={denominacion}
                      onChange={(e) => setDenominacion(e.target.value)}
                      required
                      maxLength={500}
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Ubicación técnica *
                      <Input
                        value={ubicacion_tecnica}
                        onChange={(e) => setUbicacionTecnica(e.target.value)}
                        required
                        maxLength={500}
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Centro *
                      <Input value={centro} onChange={(e) => setCentro(e.target.value)} required maxLength={120} />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Clase
                      <Input value={clase} onChange={(e) => setClase(e.target.value)} maxLength={200} />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Grupo planificación
                      <Input
                        value={grupo_planificacion}
                        onChange={(e) => setGrupoPlanificacion(e.target.value)}
                        maxLength={200}
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Especialidad predeterminada
                      <select
                        className={selectClassName}
                        value={especialidad_predeterminada}
                        onChange={(e) => setEspecialidad(e.target.value as "" | EspecialidadActivo)}
                        aria-label="Especialidad predeterminada"
                      >
                        {ESPECIALIDAD_OPTIONS.map((o) => (
                          <option key={o.value || "none"} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium text-foreground">
                      Estado operativo
                      <select
                        className={selectClassName}
                        value={activo_operativo ? "yes" : "no"}
                        onChange={(e) => setActivoOperativo(e.target.value === "yes")}
                        aria-label="Estado operativo"
                      >
                        <option value="yes">Operativo</option>
                        <option value="no">No operativo</option>
                      </select>
                    </label>
                  </div>
                  {message ? <p className="text-sm font-medium text-red-700 dark:text-red-300">{message}</p> : null}
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={saveBusy}>
                      {saveBusy ? "Guardando…" : "Guardar cambios"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={saveBusy}
                      onClick={() => {
                        setEditing(false);
                        resetFormFromAsset();
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-lg">{asset.codigo_nuevo}</CardTitle>
                <CardDescription>{asset.denominacion}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-zinc-500">Ubicación técnica: </span>
                  {asset.ubicacion_tecnica}
                </div>
                <div>
                  <span className="text-zinc-500">Centro: </span>
                  {asset.centro}
                </div>
                <div>
                  <span className="text-zinc-500">Operativo: </span>
                  {asset.activo_operativo ? "Sí" : "No"}
                </div>
                {asset.clase ? (
                  <div>
                    <span className="text-zinc-500">Clase: </span>
                    {asset.clase}
                  </div>
                ) : null}
                {asset.grupo_planificacion ? (
                  <div>
                    <span className="text-zinc-500">Grupo planificación: </span>
                    {asset.grupo_planificacion}
                  </div>
                ) : null}
                {asset.especialidad_predeterminada ? (
                  <div>
                    <span className="text-zinc-500">Especialidad: </span>
                    {asset.especialidad_predeterminada}
                  </div>
                ) : null}
                {asset.codigo_legacy ? (
                  <div>
                    <span className="text-zinc-500">Código legacy: </span>
                    {asset.codigo_legacy}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
          <AssetQrCard asset={asset} />
        </div>
      ) : null}
    </div>
  );
}
