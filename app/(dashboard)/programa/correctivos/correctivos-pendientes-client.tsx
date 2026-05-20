"use client";

import { ProgramaSeccionNav } from "@/app/(dashboard)/programa/programa-seccion-nav";
import { actionAddAvisoToProgramaPublicado } from "@/app/actions/schedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_CENTRO,
  isCentroInKnownList,
  KNOWN_CENTROS,
  nombreCentro,
} from "@/lib/config/app-config";
import { usePermisos } from "@/lib/permisos/usePermisos";
import {
  diaIsoSemanaADiaPrograma,
  getIsoWeekId,
  isoDiaSemanaDesdeDateLocal,
  parseIsoWeekToBounds,
} from "@/modules/scheduling/iso-week";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";
import type { Aviso } from "@/modules/notices/types";
import { useAvisosCorrectivosPendientes } from "@/modules/notices/hooks";
import { isSuperAdminRole } from "@/modules/users/roles";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

function avisoTieneOt(a: Aviso): boolean {
  return Boolean(a.work_order_id?.trim());
}

function fechaAvisoAInput(a: Aviso): string {
  const fp = a.fecha_programada;
  if (fp != null && typeof (fp as { toDate?: () => Date }).toDate === "function") {
    const d = (fp as { toDate: () => Date }).toDate();
    if (!Number.isNaN(d.getTime())) {
      return format(d, "yyyy-MM-dd");
    }
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

function hrefPrograma(centro: string, weekId: string): string {
  const p = new URLSearchParams();
  p.set("semana", weekId);
  p.set("centro", centro);
  return `/programa?${p.toString()}`;
}

export function CorrectivosPendientesClient() {
  const { user } = useAuthUser();
  const { profile } = useUserProfile(user?.uid);
  const { puede, rol } = usePermisos();
  const puedeActuar = puede("programa:crear_ot") || puede("programa:editar");
  const superadmin = isSuperAdminRole(profile?.rol);
  const centroPerfil = (profile?.centro?.trim() || DEFAULT_CENTRO).trim();
  const [centroF, setCentroF] = useState("");
  const centroEfectivo = superadmin && centroF && isCentroInKnownList(centroF) ? centroF : centroPerfil;
  const [busqueda, setBusqueda] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<Aviso | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [fechaRealizacion, setFechaRealizacion] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);

  const { avisos, loading, error } = useAvisosCorrectivosPendientes({
    authUid: user?.uid,
    centro: centroEfectivo,
    verTodosLosCentros: superadmin && !centroF,
    enabled: puedeActuar || rol === "admin" || superadmin,
  });

  const previewSemana = useMemo(() => {
    if (!fechaRealizacion.trim()) return null;
    const { weekId, dia } = semanaYDiaDesdeFecha(fechaRealizacion);
    const { start, end } = parseIsoWeekToBounds(weekId);
    return {
      weekId,
      dia,
      label: `${weekId} · ${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })} (${dia})`,
    };
  }, [fechaRealizacion]);

  const filas = useMemo(() => {
    const needle = busqueda.trim().toLowerCase();
    let list = avisos;
    if (needle) {
      list = list.filter(
        (a) =>
          a.n_aviso.toLowerCase().includes(needle) ||
          (a.texto_corto ?? "").toLowerCase().includes(needle) ||
          (a.ubicacion_tecnica ?? "").toLowerCase().includes(needle),
      );
    }
    return [...list].sort((a, b) => {
      const ao = avisoTieneOt(a) ? 1 : 0;
      const bo = avisoTieneOt(b) ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return a.n_aviso.localeCompare(b.n_aviso, "es", { numeric: true });
    });
  }, [avisos, busqueda]);

  const cuentaSinOt = useMemo(() => filas.filter((a) => !avisoTieneOt(a)).length, [filas]);

  const openAsignar = (a: Aviso) => {
    setPick(a);
    setFechaRealizacion(fechaAvisoAInput(a));
    setMsg(null);
    setDialogError(null);
    setDialogOpen(true);
  };

  const asignarEnPrograma = useCallback(async () => {
    if (!pick) return;
    const fecha = fechaRealizacion.trim();
    if (!fecha) {
      setMsg("Elegí la fecha de realización.");
      return;
    }
    const { weekId, dia } = semanaYDiaDesdeFecha(fecha);
    const c = (pick.centro ?? centroEfectivo).trim();
    if (!c) {
      setDialogError("El aviso no tiene centro asignado.");
      return;
    }
    setBusy(true);
    setDialogError(null);
    setMsg(null);
    try {
      const tok = await getClientIdToken();
      if (!tok) throw new Error("Sin sesión");
      const res = await actionAddAvisoToProgramaPublicado(tok, {
        weekId,
        avisoFirestoreId: pick.id,
        dia,
        localidad: pick.ubicacion_tecnica,
      });
      if (!res.ok) throw new Error(res.error.message);
      const dest = hrefPrograma(c, weekId);
      setDialogOpen(false);
      setPick(null);
      window.location.assign(dest);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Error al guardar";
      setDialogError(text);
      setMsg(text);
    } finally {
      setBusy(false);
    }
  }, [pick, fechaRealizacion, centroEfectivo]);

  if (!puedeActuar && rol !== "admin" && !superadmin) {
    return (
      <p className="text-sm text-muted-foreground">
        No tenés permiso para gestionar correctivos en el programa. Pedí acceso a un supervisor o administrador.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <ProgramaSeccionNav vistaActual="correctivos" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Correctivos</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Avisos de rotura (Excel). Con <strong className="text-foreground">fecha de realización</strong> pasan al
          calendario de esa semana — vía OT o con <strong className="text-foreground">Ubicar en calendario</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          <Link
            href="/superadmin/configuracion?tab=importacion"
            className="text-primary underline underline-offset-2"
          >
            Importar Excel
          </Link>
          {cuentaSinOt > 0 ? (
            <>
              {" "}
              · {cuentaSinOt} sin OT
            </>
          ) : null}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        {superadmin ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Centro</span>
            <select
              className="h-9 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
              value={centroF}
              onChange={(e) => setCentroF(e.target.value)}
            >
              <option value="">Todos (máx. 450 avisos)</option>
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>
                  {nombreCentro(c)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">
            Centro: <span className="font-medium text-foreground">{nombreCentro(centroEfectivo)}</span>
          </p>
        )}
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Buscar</span>
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nº aviso, texto o ubicación…"
          />
        </label>
      </div>

      {msg ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground" role="status">
          {msg}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Listado</h2>
          <Badge variant="default">{loading ? "…" : filas.length}</Badge>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Nº aviso</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Ubicación</th>
                <th className="px-3 py-2">Centro</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => {
                const tieneOt = avisoTieneOt(a);
                const c = (a.centro ?? centroEfectivo).trim();
                const sem =
                  /^\d{4}-W\d{2}$/.test(String(a.incluido_en_semana ?? "").trim())
                    ? String(a.incluido_en_semana).trim()
                    : getIsoWeekId(new Date());
                return (
                  <tr key={a.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{a.n_aviso}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2" title={a.texto_corto}>
                      {a.texto_corto}
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-xs text-muted-foreground">
                      {a.ubicacion_tecnica}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{nombreCentro(a.centro)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={tieneOt ? "default" : "correctivo"} className="font-normal">
                        {tieneOt ? "Con OT" : "Sin OT"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {tieneOt ? (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" asChild>
                            <Link href={`/tareas/${a.work_order_id!.trim()}`}>OT</Link>
                          </Button>
                          <Button type="button" variant="ghost" size="sm" asChild>
                            <Link href={hrefPrograma(c, sem)}>Programa</Link>
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" asChild>
                            <Link href={`/tareas/nueva?avisoId=${encodeURIComponent(a.id)}`}>Crear OT</Link>
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => openAsignar(a)}>
                            Ubicar en calendario
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No hay correctivos abiertos con estos filtros.{" "}
              <Link href="/superadmin/configuracion?tab=importacion" className="text-primary underline">
                Importar Excel
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      {dialogOpen && pick ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ubicar en calendario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Aviso <span className="font-mono">{pick.n_aviso}</span>
              </p>
              <label className="flex flex-col gap-1 font-medium">
                Fecha de realización <span className="font-normal text-destructive">*</span>
                <Input
                  type="date"
                  required
                  value={fechaRealizacion}
                  onChange={(e) => setFechaRealizacion(e.target.value)}
                />
              </label>
              {previewSemana ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                  Semana del programa: <span className="font-medium text-foreground">{previewSemana.label}</span>
                </p>
              ) : null}
              {dialogError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {dialogError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDialogOpen(false);
                    setDialogError(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={() => void asignarEnPrograma()} disabled={busy}>
                  {busy ? "Guardando…" : "Guardar y ver programa"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
