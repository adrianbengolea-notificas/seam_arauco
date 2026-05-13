"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { useProgramaSemana, useSemanasDisponibles } from "@/modules/scheduling/hooks";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import type { DiaSemanaPrograma, EspecialidadPrograma, ProgramaSemana } from "@/modules/scheduling/types";
import { useWorkOrdersByEspecialidad } from "@/modules/work-orders/hooks";
import {
  workOrderSubtipo,
  workOrderVistaStatus,
  type WorkOrder,
  type WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { useAuth } from "@/modules/users/hooks";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import {
  collection,
  getCountFromServer,
  query,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const DIAS: DiaSemanaPrograma[] = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIA_CORTO: Record<DiaSemanaPrograma, string> = {
  lunes: "L",
  martes: "M",
  miercoles: "X",
  jueves: "J",
  viernes: "V",
  sabado: "S",
};

const ESPECIALIDAD_LABEL: Record<EspecialidadPrograma, string> = {
  Aire: "AA",
  Electrico: "E",
  GG: "GG",
};

function statusBadgeClass(s: WorkOrderVistaStatus): string {
  switch (s) {
    case "PENDIENTE":
      return "border-zinc-400/40 bg-zinc-500/15 text-zinc-800 dark:text-zinc-200";
    case "EN_CURSO":
      return "border-blue-600/40 bg-blue-600/15 text-blue-950 dark:text-blue-100";
    case "COMPLETADA":
      return "border-emerald-600/40 bg-emerald-600/15 text-emerald-950 dark:text-emerald-100";
    case "CANCELADA":
      return "border-red-600/45 bg-red-600/15 text-red-950 dark:text-red-100";
    default:
      return "";
  }
}

function inicioMes(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function dotColorPrograma(
  programa: ProgramaSemana | null,
  esp: EspecialidadPrograma,
  dia: DiaSemanaPrograma,
): "red" | "amber" | "zinc" {
  const slots = programa?.slots?.filter((s) => s.especialidad === esp && s.dia === dia) ?? [];
  for (const s of slots) {
    for (const a of s.avisos ?? []) {
      if (a.urgente) return "red";
      if (a.tipo === "correctivo") return "amber";
    }
  }
  return "zinc";
}

export function ClienteDashboardClient() {
  const { user, profile } = useAuth();
  const centro = profile?.centro ?? DEFAULT_CENTRO;
  const { ots, loading: otsLoading } = useWorkOrdersByEspecialidad(centro, "ALL", "ALL", {
    uid: user?.uid ?? "",
    rol: profile?.rol ?? "cliente_arauco",
  });

  const now = useMemo(() => new Date(), []);
  const desdeMes = useMemo(() => inicioMes(now), [now]);

  const { semanas } = useSemanasDisponibles(centro, user?.uid);
  const semanaId = useMemo(() => {
    if (!semanas.length) return "";
    const hoy = getIsoWeekId(new Date());
    if (semanas.some((s) => s.id === hoy)) return hoy;
    return semanas[0]!.id;
  }, [semanas]);

  const { programa } = useProgramaSemana(semanaId || undefined, user?.uid);

  const kpis = useMemo(() => {
    let abiertas = 0;
    let cerradasFirmadas = 0;
    let correctivosMes = 0;
    for (const o of ots) {
      const vista = workOrderVistaStatus(o);
      const created = o.created_at?.toDate?.() ?? null;
      const inMonth = created != null && created >= desdeMes;
      if (inMonth && vista !== "COMPLETADA" && vista !== "CANCELADA") abiertas++;
      if (inMonth && vista === "COMPLETADA") cerradasFirmadas++;
      if (created != null && created >= desdeMes && workOrderSubtipo(o) === "correctivo") {
        correctivosMes++;
      }
    }
    return { abiertas, cerradasFirmadas, correctivosMes };
  }, [ots, desdeMes]);

  const [extLines, setExtLines] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const slice = ots.slice(0, 60);
      if (!slice.length) {
        setExtLines(0);
        return;
      }
      const db = getFirebaseDb();
      let sum = 0;
      for (const wo of slice) {
        if (cancelled) return;
        try {
          const q = query(
            collection(db, COLLECTIONS.work_orders, wo.id, "materiales_ot"),
            where("origen", "==", "EXTERNO"),
          );
          const c = await getCountFromServer(q);
          sum += c.data().count;
        } catch {
          /* reglas / índice */
        }
      }
      if (!cancelled) setExtLines(sum);
    })();
    return () => {
      cancelled = true;
    };
  }, [ots]);

  const ultimasOts = useMemo(() => sortByUpdated(ots).slice(0, 10), [ots]);

  const activosTop = useMemo(() => {
    const m = new Map<string, { id: string; n: number; codigo: string }>();
    for (const o of ots) {
      const aid = o.asset_id || "";
      if (!aid) continue;
      const cur = m.get(aid) ?? {
        id: aid,
        n: 0,
        codigo: o.equipo_codigo ?? o.codigo_activo_snapshot ?? aid,
      };
      cur.n++;
      m.set(aid, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [ots]);

  const espRows: EspecialidadPrograma[] = ["Aire", "Electrico", "GG"];

  const nombre = profile?.display_name?.trim() || profile?.email || "Cliente";

  return (
    <div className="space-y-8 pb-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bienvenido, {nombre} — Arauco
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Seguimiento SEAM · Centro <span className="font-mono">{centro}</span>
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">OTs abiertas (mes)</CardTitle>
            <CardDescription>En curso o pendientes del período</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {otsLoading ? "…" : kpis.abiertas}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">OTs cerradas y firmadas</CardTitle>
            <CardDescription>Mes en curso</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {otsLoading ? "…" : kpis.cerradasFirmadas}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Correctivos del mes</CardTitle>
            <CardDescription>Por subtipo en el centro</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {otsLoading ? "…" : kpis.correctivosMes}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Materiales externos</CardTitle>
            <CardDescription>Líneas EXTERNO (muestra reciente de OTs)</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {extLines === null ? "…" : extLines}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2">
          <div>
            <CardTitle>Programa semanal</CardTitle>
            <CardDescription>Resumen por especialidad · semana actual</CardDescription>
          </div>
          <Link href="/programa" className="text-sm font-medium text-brand underline-offset-4 hover:underline">
            Ver programa completo
          </Link>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Esp. / Día</th>
                {DIAS.map((d) => (
                  <th key={d} className="px-1 py-2 text-center font-medium">
                    {DIA_CORTO[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {espRows.map((esp) => (
                <tr key={esp} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-mono text-xs font-semibold">{ESPECIALIDAD_LABEL[esp]}</td>
                  {DIAS.map((dia) => {
                    const tone = dotColorPrograma(programa, esp, dia);
                    return (
                      <td key={`${esp}-${dia}`} className="px-1 py-2 text-center">
                        <span
                          className={cn(
                            "inline-block h-2.5 w-2.5 rounded-full",
                            tone === "red" && "bg-red-500",
                            tone === "amber" && "bg-amber-500",
                            tone === "zinc" && "bg-zinc-300 dark:bg-zinc-600",
                          )}
                          title={tone === "red" ? "Urgente" : tone === "amber" ? "Correctivo" : "Preventivo / otro"}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Últimas OTs</CardTitle>
            <CardDescription>Las 10 más recientes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!ultimasOts.length && !otsLoading ? (
              <p className="text-sm text-muted-foreground">Sin OTs para mostrar.</p>
            ) : (
              ultimasOts.map((wo) => {
                const vista = workOrderVistaStatus(wo);
                const d = wo.updated_at?.toDate?.() ?? wo.created_at?.toDate?.() ?? null;
                const fechaStr = d
                  ? d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })
                  : "—";
                return (
                  <Link
                    key={wo.id}
                    href={`/tareas/${wo.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-muted/40"
                  >
                    <span className="min-w-0 truncate font-mono font-medium">#{wo.n_ot}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        statusBadgeClass(vista),
                      )}
                    >
                      {vista}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fechaStr}</span>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activos con más actividad</CardTitle>
            <CardDescription>Top 5 por cantidad de OT en el conjunto cargado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!activosTop.length ? (
              <p className="text-sm text-muted-foreground">Sin datos aún.</p>
            ) : (
              activosTop.map((a) => (
                <Link
                  key={a.id}
                  href={`/activos/${encodeURIComponent(a.id)}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <span className="font-mono font-medium">{a.codigo}</span>
                  <span className="text-xs text-muted-foreground">{a.n} OTs</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function sortByUpdated(list: WorkOrder[]): WorkOrder[] {
  return [...list].sort((a, b) => {
    const tb = b.updated_at?.toMillis?.() ?? 0;
    const ta = a.updated_at?.toMillis?.() ?? 0;
    return tb - ta;
  });
}
