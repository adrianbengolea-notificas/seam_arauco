"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nombreCentro } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { cn } from "@/lib/utils";
import { useWorkOrdersForAssetLive } from "@/modules/work-orders/hooks";
import { historialEstadoEtiqueta } from "@/modules/work-orders/historial-labels";
import {
  workOrderFrecuenciaBadge,
  workOrderSubtipo,
  workOrderVistaStatus,
  type WorkOrder,
  type WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import Link from "next/link";

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

function fechaRefUi(wo: WorkOrder): string {
  const d =
    wo.fecha_fin_ejecucion?.toDate?.() ??
    wo.fecha_inicio_ejecucion?.toDate?.() ??
    wo.fecha_inicio_programada?.toDate?.() ??
    wo.updated_at?.toDate?.() ??
    null;
  return d
    ? d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
}

function OtRow({ wo }: { wo: WorkOrder }) {
  const vista = workOrderVistaStatus(wo);
  const badge = workOrderFrecuenciaBadge(wo);
  return (
    <li className="last:pb-0">
      <Link
        href={`/tareas/${wo.id}`}
        className="-mx-2 block rounded-lg px-2 py-3 text-sm transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05]"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold text-foreground">{wo.n_ot || wo.id.slice(0, 8)}</span>
              {(wo.aviso_numero ?? wo.aviso_id) ? (
                <span className="text-xs text-muted-foreground">
                  Aviso {wo.aviso_numero ?? wo.aviso_id}
                </span>
              ) : null}
            </div>
            <p className="line-clamp-2 text-muted-foreground">{wo.texto_trabajo || "—"}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{fechaRefUi(wo)}</span>
              {wo.tecnico_asignado_nombre?.trim() ? (
                <span>· {wo.tecnico_asignado_nombre.trim()}</span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                statusBadgeClass(vista),
              )}
            >
              {vista === "EN_CURSO" ? "EN CURSO" : vista}
            </span>
            <span className="text-[10px] text-muted-foreground">{historialEstadoEtiqueta(wo.estado)}</span>
            {workOrderSubtipo(wo) === "preventivo" && badge ? (
              <Badge variant="preventivo" className="text-[10px]">
                {badge}
              </Badge>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

type AssetWorkOrdersHistorialProps = {
  assetId: string;
  centro: string | null | undefined;
  /** Si false, no se consulta Firestore (evita permission-denied si el equipo es de otra planta). */
  queryEnabled?: boolean;
  sessionLoading?: boolean;
};

export function AssetWorkOrdersHistorial({
  assetId,
  centro: centroProp,
  queryEnabled = true,
  sessionLoading = false,
}: AssetWorkOrdersHistorialProps) {
  const centro = String(centroProp ?? "").trim();
  const { rows, loading, error } = useWorkOrdersForAssetLive(assetId, centro || undefined, {
    enabled: queryEnabled && !sessionLoading && Boolean(centro),
  });

  if (sessionLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial en este equipo</CardTitle>
          <CardDescription>Cargando…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!queryEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial en este equipo</CardTitle>
          <CardDescription>
            El historial de órdenes en este equipo solo está disponible para personal asignado a la misma planta
            {centro ? ` (${nombreCentro(centro)})` : ""}.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!centro.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial en este equipo</CardTitle>
          <CardDescription>
            Este activo no tiene centro cargado. Cargá el centro en la ficha para vincular el historial de órdenes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial en este equipo</CardTitle>
        <CardDescription>
          OTs vinculadas a este activo en {nombreCentro(centro)}. Tocá una fila para abrir el detalle.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-muted-foreground">Cargando historial…</p> : null}
        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{mensajeErrorFirebaseParaUsuario(error)}</p>
        ) : null}
        {!loading && !error && !rows.length ? (
          <p className="text-sm text-muted-foreground">
            No hay órdenes registradas con este activo todavía, o las órdenes más antiguas no tenían vínculo al
            equipo en el sistema.
          </p>
        ) : null}
        {!loading && !error && rows.length ? (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/80">{rows.map((w) => <OtRow key={w.id} wo={w} />)}</ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
