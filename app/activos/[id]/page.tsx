"use client";

import { actionUpdateAsset } from "@/app/actions/assets";
import { AssetQrCard } from "@/components/assets/AssetQrCard";
import { AssetWorkOrdersHistorial } from "@/components/assets/AssetWorkOrdersHistorial";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isCentroInKnownList, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { cn } from "@/lib/utils";
import { useAssetLive } from "@/modules/assets/hooks";
import type { EspecialidadActivo } from "@/modules/assets/types";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { getClientIdToken } from "@/modules/users/hooks";
import { usuarioTieneCentro } from "@/modules/users/centros-usuario";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";

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
  { value: "HG", label: "HG" },
];

export default function ActivoDetallePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : undefined;
  const { asset, loading, error } = useAssetLive(id);

  const { puede, user, profile, authLoading, rol } = usePermisos();
  const canEdit = puede("activos:crear_editar");
  const authBusy = authLoading;

  const [editing, setEditing] = useState(false);
  const [codigo_legacy, setCodigoLegacy] = useState("");
  const [denominacion, setDenominacion] = useState("");
  const [ubicacion_tecnica, setUbicacionTecnica] = useState("");
  const [centro, setCentro] = useState("");
  const [clase, setClase] = useState("");
  const [grupo_planificacion, setGrupoPlanificacion] = useState("");
  const [especialidad_predeterminada, setEspecialidad] = useState<"" | EspecialidadActivo>("");
  const [activo_operativo, setActivoOperativo] = useState(true);
  // Datos técnicos GG
  const [gg_motor_marca, setGgMotorMarca] = useState("");
  const [gg_motor_modelo, setGgMotorModelo] = useState("");
  const [gg_motor_serie, setGgMotorSerie] = useState("");
  const [gg_gen_marca, setGgGenMarca] = useState("");
  const [gg_gen_modelo, setGgGenModelo] = useState("");
  const [gg_gen_serie, setGgGenSerie] = useState("");
  const [gg_gen_kva, setGgGenKva] = useState("");
  const [gg_combustible, setGgCombustible] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const centroSelectIds = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (raw: string | undefined) => {
      const t = (raw ?? "").trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      ordered.push(t);
    };
    for (const c of KNOWN_CENTROS) push(c);
    push(asset?.centro);
    if (editing) push(centro);
    return ordered;
  }, [asset?.centro, editing, centro]);

  const centroAssetEsDesconocido =
    !!asset?.centro && !isCentroInKnownList(asset.centro.trim());

  const resetFormFromAsset = useCallback(() => {
    if (!asset) return;
    setCodigoLegacy(asset.codigo_legacy ?? "");
    setDenominacion(asset.denominacion);
    setUbicacionTecnica(asset.ubicacion_tecnica);
    setCentro(asset.centro.trim());
    setClase(asset.clase ?? "");
    setGrupoPlanificacion(asset.grupo_planificacion ?? "");
    setEspecialidad(asset.especialidad_predeterminada ?? "");
    setActivoOperativo(asset.activo_operativo);
    setGgMotorMarca(asset.gg_motor_marca ?? "");
    setGgMotorModelo(asset.gg_motor_modelo ?? "");
    setGgMotorSerie(asset.gg_motor_serie ?? "");
    setGgGenMarca(asset.gg_gen_marca ?? "");
    setGgGenModelo(asset.gg_gen_modelo ?? "");
    setGgGenSerie(asset.gg_gen_serie ?? "");
    setGgGenKva(asset.gg_gen_kva ?? "");
    setGgCombustible(asset.gg_combustible ?? "");
    setMessage(null);
  }, [asset]);

  useLayoutEffect(() => {
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
        gg_motor_marca,
        gg_motor_modelo,
        gg_motor_serie,
        gg_gen_marca,
        gg_gen_modelo,
        gg_gen_serie,
        gg_gen_kva,
        gg_combustible,
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
      {error ? <p className="text-sm text-red-600">{mensajeErrorFirebaseParaUsuario(error)}</p> : null}
      {!loading && !error && !asset ? (
        <p className="text-sm text-zinc-600">No se encontró el activo.</p>
      ) : null}

      {asset ? (
        <div className="space-y-6">
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
                    <div className="space-y-1.5">
                      <label
                        htmlFor="campo-centro"
                        className="block text-sm font-medium text-foreground"
                      >
                        Centro *
                      </label>
                      <select
                        id="campo-centro"
                        className={selectClassName}
                        value={
                          centroSelectIds.includes(centro.trim())
                            ? centro.trim()
                            : (centroSelectIds[0] ?? "")
                        }
                        onChange={(e) => setCentro(e.target.value)}
                        required
                        aria-describedby={centroAssetEsDesconocido ? "centro-hint" : undefined}
                      >
                        <optgroup label="Centros habilitados">
                          {KNOWN_CENTROS.map((id) => (
                            <option key={id} value={id}>
                              {nombreCentro(id)}
                            </option>
                          ))}
                        </optgroup>
                        {centroAssetEsDesconocido && (
                          <optgroup label="Valor guardado">
                            <option value={asset!.centro.trim()}>
                              Otro ({nombreCentro(asset!.centro.trim())})
                            </option>
                          </optgroup>
                        )}
                      </select>
                      {centroAssetEsDesconocido && (
                        <p
                          id="centro-hint"
                          className="text-xs text-amber-700 dark:text-amber-400"
                          role="note"
                        >
                          El código «{asset!.centro.trim()}» no figura en la lista habilitada del sitio.
                          Podés elegir uno de los centros de la lista, o pedirle al administrador que lo
                          agregue a la variable{" "}
                          <code className="font-mono">NEXT_PUBLIC_KNOWN_CENTROS</code>.
                        </p>
                      )}
                    </div>
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
                  {especialidad_predeterminada === "GG" ? (
                    <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Datos técnicos del equipo GG
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Motor — Marca
                          <Input value={gg_motor_marca} onChange={(e) => setGgMotorMarca(e.target.value)} maxLength={200} />
                        </label>
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Motor — Modelo
                          <Input value={gg_motor_modelo} onChange={(e) => setGgMotorModelo(e.target.value)} maxLength={200} />
                        </label>
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Motor — N° de serie
                          <Input value={gg_motor_serie} onChange={(e) => setGgMotorSerie(e.target.value)} maxLength={200} />
                        </label>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Generador — Marca
                          <Input value={gg_gen_marca} onChange={(e) => setGgGenMarca(e.target.value)} maxLength={200} />
                        </label>
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Generador — Modelo
                          <Input value={gg_gen_modelo} onChange={(e) => setGgGenModelo(e.target.value)} maxLength={200} />
                        </label>
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Generador — N° de serie
                          <Input value={gg_gen_serie} onChange={(e) => setGgGenSerie(e.target.value)} maxLength={200} />
                        </label>
                        <label className="block space-y-1.5 text-sm font-medium text-foreground">
                          Generador — Potencia KVA
                          <Input value={gg_gen_kva} onChange={(e) => setGgGenKva(e.target.value)} maxLength={50} />
                        </label>
                      </div>
                      <label className="block space-y-1.5 text-sm font-medium text-foreground">
                        Tipo de combustible
                        <Input value={gg_combustible} onChange={(e) => setGgCombustible(e.target.value)} maxLength={200} />
                      </label>
                    </div>
                  ) : null}
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
                  {nombreCentro(asset.centro ?? "")}
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
                {asset.especialidad_predeterminada === "GG" && (
                  asset.gg_motor_marca || asset.gg_motor_modelo || asset.gg_motor_serie ||
                  asset.gg_gen_marca || asset.gg_gen_modelo || asset.gg_gen_serie ||
                  asset.gg_gen_kva || asset.gg_combustible
                ) ? (
                  <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Datos técnicos GG</p>
                    {(asset.gg_motor_marca || asset.gg_motor_modelo) ? (
                      <div>
                        <span className="text-zinc-500">Motor: </span>
                        {[asset.gg_motor_marca, asset.gg_motor_modelo].filter(Boolean).join(" ")}
                      </div>
                    ) : null}
                    {asset.gg_motor_serie ? (
                      <div><span className="text-zinc-500">Motor N° serie: </span>{asset.gg_motor_serie}</div>
                    ) : null}
                    {(asset.gg_gen_marca || asset.gg_gen_modelo) ? (
                      <div>
                        <span className="text-zinc-500">Generador: </span>
                        {[asset.gg_gen_marca, asset.gg_gen_modelo].filter(Boolean).join(" ")}
                      </div>
                    ) : null}
                    {asset.gg_gen_serie ? (
                      <div><span className="text-zinc-500">Generador N° serie: </span>{asset.gg_gen_serie}</div>
                    ) : null}
                    {asset.gg_gen_kva ? (
                      <div><span className="text-zinc-500">Potencia KVA: </span>{asset.gg_gen_kva}</div>
                    ) : null}
                    {asset.gg_combustible ? (
                      <div><span className="text-zinc-500">Combustible: </span>{asset.gg_combustible}</div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
          <AssetQrCard asset={asset} />
          </div>
          <AssetWorkOrdersHistorial
            assetId={asset.id}
            centro={asset.centro}
            queryEnabled={rol === "superadmin" || usuarioTieneCentro(profile, asset.centro)}
            sessionLoading={authBusy}
          />
        </div>
      ) : null}
    </div>
  );
}
