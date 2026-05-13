"use client";

import { actionEjecutarMotorManual, actionResetearPropuestaSemanaMotor } from "@/app/actions/motor-admin";
import type { MotorOtDiarioResult } from "@/lib/motor/motor-ot-diario";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { getIsoWeekId, parseIsoWeekToBounds, shiftIsoWeekId } from "@/modules/scheduling/iso-week";
import { getClientIdToken, useAuthUser } from "@/modules/users/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import { doc, onSnapshot } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

function mensajeTrasEjecutarMotor(res: MotorOtDiarioResult): string {
  const { semanaId, centros } = res;
  return centros
    .map((c) => {
      if (c.skipped && c.reason) {
        return `${nombreCentro(c.centro)}: no se ejecutó — ${c.reason}`;
      }
      if (c.items === 0) {
        return `${nombreCentro(c.centro)}: 0 ítems en la propuesta (${semanaId}). Revisá planes de mantenimiento, cupos del motor o si ya están en programa u OT.`;
      }
      return `${nombreCentro(c.centro)}: ${c.items} ítem${c.items !== 1 ? "s" : ""} en la propuesta (${semanaId}).`;
    })
    .join(" · ");
}

type CentroDiaState = {
  propuestaStatus: string | null;
  /** Ítems con status `propuesta` (pendientes de aprobación). */
  propuestaItems: number;
  /** Total de filas en `items` (incluye ya procesados). */
  propuestaItemsTotal: number;
  programaOk: boolean;
  programaStatus: string | null;
};


function CentroDiagnosticoCard({
  centro,
  semanaId,
  uid,
  puedeReset,
}: {
  centro: string;
  semanaId: string;
  uid: string | undefined;
  puedeReset: boolean;
}) {
  const propuestaId = useMemo(() => propuestaSemanaDocId(centro, semanaId), [centro, semanaId]);
  const [s, setS] = useState<CentroDiaState>({
    propuestaStatus: null,
    propuestaItems: 0,
    propuestaItemsTotal: 0,
    programaOk: false,
    programaStatus: null,
  });
  const [busyMotor, setBusyMotor] = useState(false);
  const [busyReset, setBusyReset] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  useEffect(() => {
    if (!uid || !centro) return;
    const db = getFirebaseDb();

    const u1 = onSnapshot(doc(db, COLLECTIONS.propuestas_semana, propuestaId), (snap) => {
      if (!snap.exists()) {
        setS((prev) => ({ ...prev, propuestaStatus: null, propuestaItems: 0, propuestaItemsTotal: 0 }));
        return;
      }
      const d = snap.data() as { status?: string; items?: Array<{ status?: string }> };
      const items = Array.isArray(d.items) ? d.items : [];
      const pendientes = items.filter((i) => i.status === "propuesta").length;
      setS((prev) => ({
        ...prev,
        propuestaStatus: d.status ?? "—",
        propuestaItems: pendientes,
        propuestaItemsTotal: items.length,
      }));
    });

    const u2 = onSnapshot(doc(db, COLLECTIONS.programa_semanal, propuestaId), (snap) => {
      if (!snap.exists()) {
        setS((prev) => ({ ...prev, programaOk: false, programaStatus: null }));
        return;
      }
      const d = snap.data() as { status?: string };
      setS((prev) => ({
        ...prev,
        programaOk: true,
        programaStatus: d.status ?? "—",
      }));
    });

    return () => {
      u1();
      u2();
    };
  }, [centro, propuestaId, uid]);

  const runMotorCentro = useCallback(async () => {
    if (!uid) return;
    setBusyMotor(true);
    setMsg(null);
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await actionEjecutarMotorManual(token, { centro, semanaId });
      if (!res.ok) throw new Error(res.error.message);
      setMsg(mensajeTrasEjecutarMotor(res.data));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyMotor(false);
    }
  }, [centro, semanaId, uid]);

  const runReset = useCallback(async () => {
    if (!uid || !puedeReset) return;
    setBusyReset(true);
    setMsg(null);
    try {
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await actionResetearPropuestaSemanaMotor(token, { centro, semanaId });
      if (!res.ok) throw new Error(res.error.message);
      setMsg("Propuesta reseteada y motor ejecutado. Revisá el resultado JSON en consola de respuesta.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyReset(false);
    }
  }, [centro, semanaId, uid, puedeReset]);

  const ejecutarResetConfirmado = useCallback(() => {
    setConfirmResetOpen(false);
    void runReset();
  }, [runReset]);

  const statusText = (): string => {
    if (s.programaOk) return "Publicado — visible para la planta";
    if (s.propuestaStatus === "pendiente_aprobacion") {
      if (s.propuestaItemsTotal === 0) {
        return "Propuesta sin ítems (revisá datos o volvé a generar con el motor / Regenerar).";
      }
      return `${s.propuestaItems} ítem${s.propuestaItems !== 1 ? "s" : ""} pendientes de aprobación`;
    }
    if (s.propuestaStatus === "aprobada") return "Aprobada — verificar publicación";
    if (s.propuestaStatus && s.propuestaStatus !== "—") return `Propuesta: ${s.propuestaStatus}`;
    return "Sin propuesta para esta semana";
  };

  const accionPrincipal = () => {
    if (s.programaOk) {
      return (
        <Button type="button" size="sm" variant="outline" asChild>
          <Link href={`/programa?semana=${encodeURIComponent(semanaId)}`}>Ver publicado</Link>
        </Button>
      );
    }
    if (s.propuestaStatus === "pendiente_aprobacion" && s.propuestaItems > 0) {
      return (
        <Button type="button" size="sm" asChild>
          <Link
            href={`/programa/aprobacion?semana=${encodeURIComponent(semanaId)}&centro=${encodeURIComponent(centro)}`}
          >
            Revisar y aprobar
          </Link>
        </Button>
      );
    }
    if (s.propuestaStatus === "pendiente_aprobacion" && s.propuestaItemsTotal === 0) {
      return (
        <Button type="button" size="sm" variant="outline" disabled={busyMotor || !uid} onClick={() => void runMotorCentro()}>
          {busyMotor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Generar propuesta
        </Button>
      );
    }
    if (s.propuestaStatus === "pendiente_aprobacion") {
      return (
        <Button type="button" size="sm" variant="outline" asChild>
          <Link
            href={`/programa/aprobacion?semana=${encodeURIComponent(semanaId)}&centro=${encodeURIComponent(centro)}`}
          >
            Ver detalle
          </Link>
        </Button>
      );
    }
    return (
      <Button type="button" size="sm" variant="outline" disabled={busyMotor || !uid} onClick={() => void runMotorCentro()}>
        {busyMotor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Generar propuesta
      </Button>
    );
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{nombreCentro(centro)}</p>
            <p className={cn(
              "mt-0.5 text-sm",
              s.propuestaStatus === "pendiente_aprobacion" ? "text-amber-800 dark:text-amber-200" :
              s.programaOk ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
            )}>
              {statusText()}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {accionPrincipal()}
            {puedeReset ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10"
                disabled={busyReset || !uid}
                onClick={() => setConfirmResetOpen(true)}
              >
                {busyReset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Regenerar
              </Button>
            ) : null}
          </div>
        </div>

        {msg ? <p className="text-xs leading-relaxed text-foreground">{msg}</p> : null}

        {confirmResetOpen ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="diagnostico-reset-title"
          >
            <Card className="max-w-md w-full shadow-lg">
              <CardHeader>
                <CardTitle id="diagnostico-reset-title">¿Regenerar propuesta?</CardTitle>
                <CardDescription>
                  Se eliminará el estado de aprobación de la propuesta para{" "}
                  <span className="font-medium text-foreground">{nombreCentro(centro)}</span> en la semana{" "}
                  <span className="font-mono">{semanaId}</span> y se volverá a ejecutar el motor. Esta acción no se puede
                  deshacer desde aquí.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmResetOpen(false)} disabled={busyReset}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  disabled={busyReset}
                  onClick={ejecutarResetConfirmado}
                >
                  Confirmar
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function semanaLabel(weekId: string): string {
  const { start, end } = parseIsoWeekToBounds(weekId);
  const dStart = `${start.getDate()} ${MESES[start.getMonth()]}`;
  const dEnd = `${end.getDate()} ${MESES[end.getMonth()]}`;
  return `${weekId} · ${dStart} – ${dEnd}`;
}

function generarOpcionesSemanas(base: string): { id: string; label: string }[] {
  const opts = [];
  for (let i = -8; i <= 2; i++) {
    const id = shiftIsoWeekId(base, i);
    opts.push({ id, label: semanaLabel(id) });
  }
  return opts.reverse();
}

export function DiagnosticoClient({ embedInConfiguracion = false }: { embedInConfiguracion?: boolean } = {}) {
  const { user } = useAuthUser();
  const { puede } = usePermisos();
  const puedeVer = puede("admin:gestionar_usuarios");
  const puedeReset = puede("admin:feature_flags");
  const semanaDef = useMemo(() => getIsoWeekId(new Date()), []);
  const [semanaId, setSemanaId] = useState(semanaDef);
  const opcionesSemanas = useMemo(() => generarOpcionesSemanas(semanaDef), [semanaDef]);

  if (!puedeVer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>
            Solo administración de planta o superadmin (permiso{" "}
            <span className="font-mono">admin:gestionar_usuarios</span>).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedInConfiguracion ? (
            <h2 className="text-lg font-semibold tracking-tight">Estado por planta</h2>
          ) : (
            <h1 className="text-xl font-semibold tracking-tight">Estado por planta</h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Propuesta y programa publicado para la semana seleccionada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {embedInConfiguracion ? null : (
            <Button variant="outline" size="sm" asChild>
              <Link href="/superadmin/configuracion">Volver a configuración</Link>
            </Button>
          )}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="sem-iso">
              Semana
            </label>
            <select
              id="sem-iso"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm"
              value={opcionesSemanas.some((o) => o.id === semanaId) ? semanaId : semanaDef}
              onChange={(e) => setSemanaId(e.target.value)}
            >
              {opcionesSemanas.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {KNOWN_CENTROS.map((c) => (
          <CentroDiagnosticoCard
            key={c}
            centro={c}
            semanaId={semanaId}
            uid={user?.uid}
            puedeReset={puedeReset}
          />
        ))}
      </div>
    </div>
  );
}
