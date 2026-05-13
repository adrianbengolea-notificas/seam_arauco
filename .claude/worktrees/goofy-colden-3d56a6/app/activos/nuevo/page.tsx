"use client";

import { actionCreateAsset } from "@/app/actions/assets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import type { EspecialidadActivo } from "@/modules/assets/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

export default function NuevoActivoPage() {
  const router = useRouter();
  const { puede } = usePermisos();
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);

  const [codigo_nuevo, setCodigoNuevo] = useState("");
  const [codigo_legacy, setCodigoLegacy] = useState("");
  const [denominacion, setDenominacion] = useState("");
  const [ubicacion_tecnica, setUbicacionTecnica] = useState("");
  const [centro, setCentro] = useState("");
  const [clase, setClase] = useState("");
  const [grupo_planificacion, setGrupoPlanificacion] = useState("");
  const [especialidad_predeterminada, setEspecialidad] = useState<"" | EspecialidadActivo>("");
  const [activo_operativo, setActivoOperativo] = useState(true);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loading = authLoading || profileLoading;
  const canCreate = puede("activos:crear_editar");
  const seededCentro = useRef(false);

  useEffect(() => {
    if (seededCentro.current || profileLoading) return;
    if (profile?.centro?.trim()) {
      setCentro(profile.centro.trim());
      seededCentro.current = true;
      return;
    }
    if (user) {
      setCentro(DEFAULT_CENTRO);
      seededCentro.current = true;
    }
  }, [profile?.centro, profileLoading, user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!canCreate) {
      setMessage("No tenés permisos para crear activos.");
      return;
    }
    setBusy(true);
    try {
      const token = await getClientIdToken();
      if (!token) {
        setMessage("Sesión expirada; volvé a iniciar sesión.");
        return;
      }
      const res = await actionCreateAsset(token, {
        codigo_nuevo,
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
      router.push(`/activos/${res.data.id}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="border-l-4 border-accent-warm pl-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Inventario
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Nuevo activo</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Mismos datos que en la importación Excel: código, nombre, ubicación técnica, centro y campos opcionales.
          </p>
        </div>
        <Link href="/activos" className="text-sm font-medium text-foreground underline underline-offset-2">
          Volver a activos
        </Link>
      </div>

      {!loading && user && !canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin permiso</CardTitle>
            <CardDescription>Solo supervisores y administradores pueden dar de alta activos manualmente.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link href="/activos">Ir al listado</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Datos del equipo</CardTitle>
            <CardDescription>
              El ID en Firestore se genera a partir del código nuevo (caracteres «/» se reemplazan por «-»), igual que en la importación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-medium text-foreground">
                  Código del equipo *
                  <Input
                    value={codigo_nuevo}
                    onChange={(e) => setCodigoNuevo(e.target.value)}
                    required
                    maxLength={200}
                    autoComplete="off"
                    className="font-mono"
                    placeholder="p. ej. AA-12345"
                  />
                </label>
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
                  placeholder="Descripción del activo"
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
                  <Input
                    value={centro}
                    onChange={(e) => setCentro(e.target.value)}
                    required
                    maxLength={120}
                  />
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
                <Button type="submit" disabled={busy || loading}>
                  {busy ? "Guardando…" : "Guardar activo"}
                </Button>
                <Button type="button" variant="ghost" asChild>
                  <Link href="/activos">Cancelar</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
