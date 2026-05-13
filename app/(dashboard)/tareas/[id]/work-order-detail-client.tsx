"use client";

import { firmarPlanilla, guardarBorradorPlanilla, iniciarPlanilla } from "@/app/actions/planillas";
import {
  actionArchiveWorkOrder,
  actionAssignTechnician,
  actionCloseWorkOrderHistorico,
  addMaterialToOT,
  updateChecklistItem,
  updateWorkOrderStatus,
} from "@/app/actions/work-orders";
import { PlanillaForm } from "@/components/planilla/PlanillaForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { useOnlineStatus } from "@/hooks/use-online";
import { countOutbox, enqueueOutbox } from "@/lib/offline/ot-db";
import { MATERIALES_UI_SOLO_TEXTO_LIBRE, nombreCentro } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { cn } from "@/lib/utils";
import { usePermisos } from "@/lib/permisos/usePermisos";
import type { MaterialCatalogItem, MaterialOtListRow } from "@/modules/materials/types";
import { useMaterialSearch, useMaterialsCatalogLive } from "@/modules/materials/hooks";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import { rowsToCsv } from "@/lib/csv/escape";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";
import { useAssetLive } from "@/modules/assets/hooks";
import { TecnicoSelectParaOt } from "@/modules/work-orders/components/TecnicoSelectParaOt";
import {
  etiquetaPlanillaTemplateCorta,
  historialEstadoEtiqueta,
  historialEventoResumen,
  historialEventoTitulo,
  historialEventoTextoUsuario,
} from "@/modules/work-orders/historial-labels";
import {
  useEquipoByCodigo,
  usePlanillaRespuesta,
  usePlanillaTemplate,
  useWorkOrderChecklist,
  useHistorialActorDisplayNames,
  useWorkOrderHistorial,
  useWorkOrderLive,
  useWorkOrderMaterials,
} from "@/modules/work-orders/hooks";
import {
  workOrderSubtipo,
  workOrderVistaStatus,
  type WorkOrderSubTipo,
  type WorkOrderVistaStatus,
} from "@/modules/work-orders/types";
import { selectTemplate } from "@/lib/planillas/select-template";
import { getClientIdToken, useAuthUser } from "@/modules/users/hooks";
import { Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkOrderComentariosSection } from "@/app/(dashboard)/tareas/[id]/work-order-comentarios";
import { useAvisoLive } from "@/modules/notices/hooks";

function vistaLabel(s: WorkOrderVistaStatus): string {
  switch (s) {
    case "EN_CURSO":
      return "EN CURSO";
    default:
      return s;
  }
}

function statusBadgeClass(s: WorkOrderVistaStatus): string {
  switch (s) {
    case "PENDIENTE":
      return "border-zinc-400/40 bg-zinc-500/15 text-zinc-800 dark:text-zinc-200";
    case "EN_CURSO":
      return "border-blue-600 bg-blue-600 text-white shadow-sm dark:border-blue-500 dark:bg-blue-600 dark:text-white";
    case "COMPLETADA":
      return "border-emerald-600/40 bg-emerald-600/15 text-emerald-950 dark:text-emerald-100";
    case "CANCELADA":
      return "border-red-600/45 bg-red-600/15 text-red-950 dark:text-red-100";
    default:
      return "";
  }
}

function firestoreEsPermisoDenegado(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "permission-denied"
  );
}

function subtipoEtiqueta(st: WorkOrderSubTipo): string {
  if (st === "preventivo") return "Preventivo";
  if (st === "correctivo") return "Correctivo";
  return "Checklist";
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function materialLabel(m: MaterialOtListRow, esCliente?: boolean): string {
  if (m._kind === "field") {
    const tag = !esCliente && m.normalizacion ? ` · ${m.normalizacion}` : "";
    const cod = m.codigo_material ? ` · ${m.codigo_material}` : "";
    return `${m.descripcion} · ${m.cantidad} ${m.unidad} (${m.origen})${cod}${tag}`;
  }
  return `${m.descripcion_snapshot} · ${m.cantidad_consumida} ${m.unidad_medida}`;
}

export function WorkOrderDetailClient({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const { user } = useAuthUser();
  const { rol, puede } = usePermisos();
  const esCliente = rol === "cliente_arauco";
  const { workOrder, loading, error } = useWorkOrderLive(workOrderId);
  const avisoIdLive = workOrder?.aviso_id?.trim() || undefined;
  const { aviso: avisoLive } = useAvisoLive(avisoIdLive, user?.uid);
  const alertaAvisoId = workOrder?.alerta_cerrar_para_aviso_sap?.aviso_id;
  const { aviso: avisoNuevoLive } = useAvisoLive(alertaAvisoId, user?.uid);
  const nuevaOtHref = avisoNuevoLive?.work_order_id
    ? `/tareas/${avisoNuevoLive.work_order_id}`
    : "/programa/preventivos?pestana=vencimientos";
  const { materials, loading: matLoading } = useWorkOrderMaterials(workOrderId);
  const { items: checklistItems, loading: clLoading } = useWorkOrderChecklist(workOrderId);
  const { events: historialEvents, loading: histLoading } = useWorkOrderHistorial(workOrderId);
  const { respuesta: planillaResp, loading: planillaLoading } = usePlanillaRespuesta(workOrderId);
  const { asset: assetLive } = useAssetLive(workOrder?.asset_id?.trim() || undefined);
  const planillaTemplateIdEsperado = useMemo(
    () =>
      workOrder
        ? selectTemplate(workOrder, { especialidadActivo: assetLive?.especialidad_predeterminada })
        : "",
    [workOrder, assetLive?.especialidad_predeterminada],
  );
  const { template: planillaTemplate } = usePlanillaTemplate(
    planillaResp?.templateId || planillaTemplateIdEsperado || undefined,
  );
  const codigoEquipoOt = workOrder?.equipo_codigo?.trim() || workOrder?.codigo_activo_snapshot?.trim();
  const { equipo: equipoCatalogo } = useEquipoByCodigo(codigoEquipoOt);
  const { config: centroCfg } = useCentroConfigLive(workOrder?.centro);
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    countOutbox().then(setPendingCount).catch(() => {});
  }, []);

  const [msg, setMsg] = useState<string | null>(null);
  const [asignBusy, setAsignBusy] = useState(false);

  const [empOpen, setEmpOpen] = useState(false);
  const [empFecha, setEmpFecha] = useState(() => isoDateLocal(new Date()));
  const [empMotivo, setEmpMotivo] = useState("");
  const [empTecnico, setEmpTecnico] = useState("");
  const [empEvidencia, setEmpEvidencia] = useState("");
  const [empBusy, setEmpBusy] = useState(false);

  const [archiveBusy, setArchiveBusy] = useState(false);

  const [planillaOpen, setPlanillaOpen] = useState(false);

  const [matOpen, setMatOpen] = useState(false);
  const [matDesc, setMatDesc] = useState("");
  const [matCant, setMatCant] = useState("1");
  const [matUd, setMatUd] = useState("u");
  const [matOrigen, setMatOrigen] = useState<"ARAUCO" | "EXTERNO">("ARAUCO");
  const [matCatalogPick, setMatCatalogPick] = useState<MaterialCatalogItem | null>(null);

  const { items: catalogItems } = useMaterialsCatalogLive(MATERIALES_UI_SOLO_TEXTO_LIBRE ? 0 : 500);
  const materialSuggestions = useMaterialSearch(matDesc, catalogItems);

  const [localCheck, setLocalCheck] = useState<Record<string, boolean>>({});

  const flushOutbox = useCallback(
    async ({ type, payload }: { type: string; payload: unknown }) => {
      const t = await getClientIdToken();
      if (!t) throw new Error("Sin sesión");
      if (type === "wo_checklist") {
        const p = payload as { workOrderId: string; itemId: string; completed: boolean };
        const res = await updateChecklistItem(t, p);
        if (!res.ok) throw new Error(res.error.message);
        return;
      }
      if (type === "wo_add_material") {
        const p = payload as {
          workOrderId: string;
          material: {
            descripcion: string;
            cantidad: number;
            unidad: string;
            origen: "ARAUCO" | "EXTERNO";
            observaciones?: string;
            catalogoIdConfirmado?: string;
          };
        };
        const res = await addMaterialToOT(t, p);
        if (!res.ok) throw new Error(res.error.message);
        return;
      }
      if (type === "planilla_borrador") {
        const p = payload as {
          otId: string;
          respuestaId: string;
          datos: Parameters<typeof guardarBorradorPlanilla>[1]["datos"];
        };
        const res = await guardarBorradorPlanilla(t, p);
        if (!res.ok) throw new Error(res.error.message);
        return;
      }
      if (type === "planilla_firmar") {
        const p = payload as {
          otId: string;
          respuestaId: string;
          firmas: {
            firmaUsuario: string;
            firmaUsuarioNombre: string;
            firmaUsuarioLegajo: string;
            firmaResponsable: string;
            firmaResponsableNombre: string;
          };
        };
        const res = await firmarPlanilla(t, {
          otId: p.otId,
          respuestaId: p.respuestaId,
          firmas: p.firmas,
        });
        if (!res.ok) throw new Error(res.error.message);
      }
    },
    [],
  );

  useOfflineSync(true, flushOutbox, {
    onSyncStart: () => setSyncing(true),
    onSyncEnd: () => {
      setSyncing(false);
      countOutbox().then(setPendingCount).catch(() => {});
    },
  });

  const vista = workOrder ? workOrderVistaStatus(workOrder) : ("PENDIENTE" as const);
  const otEspIsGeneric = !workOrder?.especialidad || workOrder.especialidad === "GG";
  const especialidadEfectivaParaUi = otEspIsGeneric
    ? (assetLive?.especialidad_predeterminada ?? workOrder?.especialidad)
    : workOrder?.especialidad;
  const showChecklist =
    workOrder &&
    (especialidadEfectivaParaUi === "GG" ||
      workOrderSubtipo(workOrder) === "checklist" ||
      checklistItems.length > 0);

  const checklistDone = useMemo(() => {
    return checklistItems.filter((it) => {
      const local = localCheck[it.id];
      if (local !== undefined) return local;
      return it.respuesta_boolean === true;
    }).length;
  }, [checklistItems, localCheck]);

  const historialVisible = useMemo(() => {
    if (!esCliente) return historialEvents;
    return historialEvents.filter((ev) => ev.tipo !== "MATERIAL_NORMALIZADO_IA");
  }, [esCliente, historialEvents]);

  const historialActorUids = useMemo(
    () => historialVisible.map((e) => e.actor_uid),
    [historialVisible],
  );
  const historialActorNames = useHistorialActorDisplayNames(historialActorUids);
  async function token(): Promise<string> {
    const t = await getClientIdToken();
    if (!t) throw new Error("Sin sesión");
    return t;
  }

  function openEmpalmeModal() {
    setEmpFecha(isoDateLocal(new Date()));
    setEmpMotivo("");
    setEmpTecnico("");
    setEmpEvidencia("");
    setEmpOpen(true);
  }

  async function submitEmpalme(e: React.FormEvent) {
    e.preventDefault();
    setEmpBusy(true);
    setMsg(null);
    try {
      const t = await token();
      const res = await actionCloseWorkOrderHistorico(t, {
        workOrderId,
        fechaEjecucion: empFecha,
        motivo: empMotivo,
        evidenciaUrl: empEvidencia.trim() || undefined,
        tecnicoNombre: empTecnico.trim() || undefined,
      });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      setEmpOpen(false);
      setMsg("Empalme registrado: la orden figura como completada con la fecha indicada.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al registrar empalme");
    } finally {
      setEmpBusy(false);
    }
  }

  async function onArchivarOt() {
    if (
      !window.confirm(
        "¿Archivar esta orden? Dejará de mostrarse en listados y vínculos habituales, como si hubiera sido eliminada.",
      )
    ) {
      return;
    }
    setArchiveBusy(true);
    setMsg(null);
    try {
      const t = await token();
      const res = await actionArchiveWorkOrder(t, { workOrderId });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      void router.push("/tareas");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al archivar");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function onIniciarPlanilla() {
    setMsg(null);
    try {
      const t = await token();
      if (workOrder && workOrderVistaStatus(workOrder) === "PENDIENTE" && !esCliente) {
        const resStatus = await updateWorkOrderStatus(t, {
          workOrderId,
          status: "EN_CURSO",
        });
        if (!resStatus.ok) {
          setMsg(resStatus.error.message);
          return;
        }
      }
      setPlanillaOpen(true);
      const res = await iniciarPlanilla(await token(), { otId: workOrderId });
      if (!res.ok) {
        setPlanillaOpen(false);
        setMsg(res.error.message);
        return;
      }
      setMsg(
        res.data.existing ? "Ya tenías una planilla en curso; podés continuar." : "Planilla iniciada.",
      );
    } catch (e) {
      setPlanillaOpen(false);
      setMsg(e instanceof Error ? e.message : "Error al iniciar planilla");
    }
  }

  async function toggleCheck(itemId: string, completed: boolean, serverVal: boolean) {
    setMsg(null);
    setLocalCheck((m) => ({ ...m, [itemId]: completed }));
    try {
      if (online) {
        const res = await updateChecklistItem(await token(), {
          workOrderId,
          itemId,
          completed,
        });
        if (!res.ok) throw new Error(res.error.message);
      } else {
        await enqueueOutbox("wo_checklist", { workOrderId, itemId, completed });
        setPendingCount((c) => c + 1);
        setMsg("Sin conexión: cambio de checklist en cola.");
      }
    } catch (e) {
      setLocalCheck((m) => {
        const n = { ...m };
        n[itemId] = serverVal;
        return n;
      });
      setMsg(e instanceof Error ? e.message : "Error checklist");
    }
  }

  async function submitMaterial(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const cant = Number(matCant.replace(",", "."));
    if (!matDesc.trim() || !Number.isFinite(cant) || cant <= 0) {
      setMsg("Completá descripción y cantidad válida");
      return;
    }
    const material = {
      descripcion: matDesc.trim(),
      cantidad: cant,
      unidad: matUd.trim() || "u",
      origen: matOrigen,
      catalogoIdConfirmado: matCatalogPick?.id,
    };
    try {
      if (online) {
        const res = await addMaterialToOT(await token(), { workOrderId, material });
        if (!res.ok) {
          setMsg(res.error.message);
          return;
        }
        setMatDesc("");
        setMatCant("1");
        setMatCatalogPick(null);
        setMatOpen(false);
        setMsg("Material agregado");
      } else {
        await enqueueOutbox("wo_add_material", { workOrderId, material });
        setPendingCount((c) => c + 1);
        setMatCatalogPick(null);
        setMatOpen(false);
        setMsg("Sin conexión: material en cola de sincronización.");
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  function downloadHistorialCsv() {
    if (!workOrder) return;
    const header = ["correlativo_interno", "fecha", "tipo", "titulo", "actor_uid", "resumen", "payload_json"];
    const dataRows: string[][] = [
      header,
      ...historialVisible.map((ev) => [
        workOrder.n_ot,
        formatFirestoreDate(ev.created_at),
        ev.tipo,
        historialEventoTitulo(ev.tipo),
        ev.actor_uid,
        historialEventoResumen(ev),
        JSON.stringify(ev.payload ?? {}),
      ]),
    ];
    const csv = rowsToCsv(dataRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Arauco-Seam-historial-orden-${workOrder.n_ot}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMsg("CSV de historial descargado");
  }

  async function downloadPdf() {
    setMsg(null);
    try {
      const t = await getClientIdToken();
      if (!t) {
        setMsg("Sin sesión");
        return;
      }
      const res = await fetch(`/api/work-orders/${workOrderId}/pdf`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setMsg(txt.trim() || "No se pudo generar el PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Arauco-Seam-planilla-${workOrder?.n_ot ?? workOrderId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("PDF descargado");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al descargar PDF");
    }
  }

  if (loading) return <p className="text-sm text-zinc-600">Cargando OT…</p>;
  if (error) {
    if (firestoreEsPermisoDenegado(error)) {
      return (
        <Card className="mx-auto max-w-md border-amber-200 dark:border-amber-900">
          <CardHeader>
            <CardTitle>No podés ver esta orden</CardTitle>
            <CardDescription>
              No tenés permiso para acceder a esta OT. Suele ocurrir si está asignada a otro técnico o no
              pertenece a tu
              centro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/tareas">Ir a OTs</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }
    return <p className="text-sm text-red-600">{mensajeErrorFirebaseParaUsuario(error)}</p>;
  }
  if (!workOrder) return <p className="text-sm text-zinc-600">OT no encontrada.</p>;

  const puedeCompletar = vista === "EN_CURSO" && !esCliente;
  const planillaFirmada = planillaResp?.status === "firmada";
  const cerrada = vista === "COMPLETADA";
  const puedePdf =
    cerrada &&
    planillaFirmada &&
    (puede("ot:descargar_pdf") || puede("cliente:descargar_pdf"));
  const esSuperadmin = rol === "superadmin";
  const puedeArchivarOt = esSuperadmin && workOrder.archivada !== true;
  const puedeRegistrarEmpalme =
    esSuperadmin &&
    (workOrder.estado === "BORRADOR" ||
      workOrder.estado === "ABIERTA" ||
      workOrder.estado === "EN_EJECUCION");
  const subtipoWo = workOrderSubtipo(workOrder);
  const tituloOt = workOrder.texto_trabajo?.trim() || "Sin descripción";
  const avisoRef = workOrder.aviso_numero?.trim() || workOrder.aviso_id?.trim();
  const refOrdenServicio = avisoRef
    ? `${nombreCentro(workOrder.centro)} · Aviso ${avisoRef}`
    : `${nombreCentro(workOrder.centro)} · Ref. interna ${workOrder.n_ot}`;
  const equipoDescripcion =
    assetLive?.denominacion?.trim() || equipoCatalogo?.descripcion?.trim() || null;
  const equipoCodigo =
    workOrder.equipo_codigo?.trim() ||
    workOrder.codigo_activo_snapshot?.trim() ||
    null;

  const equipoInformadoFueraCatalogo =
    subtipoWo === "correctivo" &&
    workOrder.activo_fuera_catalogo === true &&
    (equipoCodigo?.length ?? 0) > 0;

  /** Órdenes eléctricas/HG pueden crearse sin fila en Activos; "—" confunde — explicamos explícito. */
  const ordenSinActivoEnMaestros =
    !workOrder.asset_id?.trim() &&
    (workOrder.especialidad === "ELECTRICO" || workOrder.especialidad === "HG") &&
    !equipoInformadoFueraCatalogo;
  const equipoEtiquetaSinMaestro =
    workOrder.especialidad === "HG"
      ? "Sin equipo en maestros (HG — sin activo vinculado)"
      : "Sin equipo en maestros (eléctrico — sin activo vinculado)";
  const equipoTitulo = equipoInformadoFueraCatalogo
    ? equipoCodigo ?? "—"
    : equipoDescripcion ?? equipoCodigo ?? (ordenSinActivoEnMaestros ? equipoEtiquetaSinMaestro : "—");

  const showOfflineBanner = !online || pendingCount > 0 || syncing;

  return (
    <div className="space-y-6 pb-24">
      {showOfflineBanner ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium",
            !online
              ? "border-amber-400/60 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
              : "border-sky-400/60 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100",
          )}
          role="status"
        >
          {!online ? (
            <span>
              Sin conexión — los cambios se guardan localmente
              {pendingCount > 0 ? ` (${pendingCount} en cola)` : ""}.
            </span>
          ) : syncing ? (
            <span>
              Sincronizando {pendingCount} cambio{pendingCount !== 1 ? "s" : ""} pendiente
              {pendingCount !== 1 ? "s" : ""}…
            </span>
          ) : pendingCount > 0 ? (
            <span>
              {pendingCount} cambio{pendingCount !== 1 ? "s" : ""} pendiente
              {pendingCount !== 1 ? "s" : ""} de sincronizar — reconectate para enviarlos.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              {tituloOt}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{refOrdenServicio}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex flex-col items-end gap-0.5">
              <span
                className={cn(
                  "inline-flex rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                  statusBadgeClass(vista),
                )}
                title="Estado exacto en el sistema"
              >
                {historialEstadoEtiqueta(workOrder.estado)}
              </span>
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                Resumen: {vistaLabel(vista)}
              </span>
            </div>
            {puedePdf ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void downloadPdf()}>
                <Download className="mr-2 h-4 w-4" />
                Descargar PDF
              </Button>
            ) : null}
            {puedeRegistrarEmpalme ? (
              <Button type="button" variant="outline" size="sm" onClick={openEmpalmeModal}>
                Registrar como completada (empalme)
              </Button>
            ) : null}
            {puedeArchivarOt ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                disabled={archiveBusy}
                onClick={() => void onArchivarOt()}
              >
                {archiveBusy ? "Archivando…" : "Archivar OT"}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="default"
            className="border-violet-500/40 bg-violet-500/12 font-semibold text-violet-950 dark:text-violet-100"
          >
            {nombreCentro(workOrder.centro)}
          </Badge>
          <Badge
            variant="default"
            className="border-sky-600/40 bg-sky-500/12 font-semibold text-sky-950 dark:text-sky-100"
            title={
              assetLive?.especialidad_predeterminada &&
              workOrder.especialidad !== assetLive.especialidad_predeterminada
                ? `Según catálogo de activos: ${assetLive.especialidad_predeterminada}. Valor en orden/aviso: ${workOrder.especialidad}.`
                : undefined
            }
          >
            {especialidadEfectivaParaUi}
          </Badge>
          {subtipoWo === "checklist" ? (
            <Badge
              variant="default"
              className="border-emerald-600/40 bg-emerald-600/12 font-semibold text-emerald-950 dark:text-emerald-100"
            >
              {subtipoEtiqueta(subtipoWo)}
            </Badge>
          ) : (
            <Badge variant={subtipoWo === "correctivo" ? "correctivo" : "preventivo"} className="font-semibold">
              {subtipoEtiqueta(subtipoWo)}
            </Badge>
          )}
          {workOrder.provisorio_sin_aviso_sap ? (
            <Badge
              variant="default"
              className="border border-amber-600/45 bg-amber-500/10 font-semibold text-amber-950 dark:text-amber-100"
            >
              Provisorio sin aviso SAP
            </Badge>
          ) : null}
        </div>
      </div>

      {msg ? (
        <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {msg}
        </p>
      ) : null}

      {workOrder.alerta_cerrar_para_aviso_sap?.n_aviso ? (
        <div
          className="rounded-xl border border-red-400/70 bg-red-50 px-4 py-3 text-sm text-red-950 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100"
          role="alert"
        >
          <p>
            <span className="font-semibold">Esta orden sigue en proceso</span> y es la que debe cerrarse: llegó un aviso
            SAP nuevo para el mismo mantenimiento (n.º{" "}
            <span className="font-mono">{workOrder.alerta_cerrar_para_aviso_sap.n_aviso}</span>
            ). <strong>Recomendamos terminarla</strong> (cierre con doble firma) antes de trabajar con el número nuevo;
            el sistema las mantiene vinculadas para no perder el seguimiento.
          </p>
          <p className="mt-2">
            <Link
              href={nuevaOtHref}
              className="font-semibold underline underline-offset-2"
            >
              {avisoNuevoLive?.work_order_id ? "Ver nueva orden →" : "Ver en programa →"}
            </Link>
          </p>
        </div>
      ) : null}

      {avisoLive?.antecesor_orden_abierta?.work_order_id &&
      avisoLive.antecesor_orden_abierta.work_order_id !== workOrderId ? (
        <div
          className="rounded-xl border border-amber-400/70 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          role="alert"
        >
          <p>
            <span className="font-semibold">Cerrá primero la orden anterior del mismo mantenimiento</span> (n.º{" "}
            <span className="font-mono">{avisoLive.antecesor_orden_abierta.n_ot}</span>, aviso SAP{" "}
            <span className="font-mono">{avisoLive.antecesor_orden_abierta.n_aviso}</span>). Este aviso es nuevo, pero
            el trabajo pendiente sigue en la otra orden:{" "}
            <Link
              href={`/tareas/${avisoLive.antecesor_orden_abierta.work_order_id}`}
              className="font-semibold underline underline-offset-2"
            >
              Abrir orden n.º {avisoLive.antecesor_orden_abierta.n_ot}
            </Link>
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Información</CardTitle>
          <CardDescription>Aviso, equipo y ubicación</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-zinc-500">Aviso</p>
              <p className="font-mono font-semibold">
                {workOrder.aviso_numero || workOrder.aviso_id || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500">Centro</p>
              <p className="font-medium">{nombreCentro(workOrder.centro)}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">Equipo</p>
            {centroCfg.modulos.activos && workOrder.asset_id?.trim() ? (
              <Link href={`/activos/${workOrder.asset_id}`} className="group block">
                <p className="font-medium text-blue-600 underline-offset-2 group-hover:underline dark:text-blue-400">
                  {equipoTitulo}
                </p>
                {equipoDescripcion ? (
                  <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{equipoCodigo ?? "—"}</p>
                ) : null}
              </Link>
            ) : (
              <>
                <p className="font-medium text-foreground">{equipoTitulo}</p>
                {equipoDescripcion ? (
                  <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{equipoCodigo ?? "—"}</p>
                ) : null}
                {equipoInformadoFueraCatalogo ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Equipo fuera del catálogo de Activos: la referencia fue escrita manualmente en el correctivo (no hay
                    ficha de equipo hasta que carguen el activo en maestro).
                  </p>
                ) : null}
                {ordenSinActivoEnMaestros && workOrder.ubicacion_tecnica?.trim() ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    El alcance se identifica por la ubicación técnica de abajo (no hay enlace a Activos).
                  </p>
                ) : null}
              </>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">Ubicación técnica</p>
            <p className="text-foreground">
              {workOrder.denom_ubic_tecnica?.trim() || workOrder.ubicacion_tecnica || "—"}
            </p>
            {workOrder.denom_ubic_tecnica?.trim() ? (
              <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {workOrder.ubicacion_tecnica}
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500">Técnico asignado</p>
            {puede("ot:cancelar_reasignar") &&
            (workOrder.estado === "ABIERTA" || workOrder.estado === "EN_EJECUCION") ? (
              <TecnicoSelectParaOt
                centro={workOrder.centro}
                valueUid={workOrder.tecnico_asignado_uid ?? ""}
                disabled={asignBusy}
                onValueChange={async (uid, nombre) => {
                  setMsg(null);
                  setAsignBusy(true);
                  try {
                    const t = await getClientIdToken();
                    if (!t) {
                      setMsg("Sin sesión");
                      return;
                    }
                    const res = await actionAssignTechnician(t, {
                      workOrderId,
                      tecnicoUid: uid,
                      tecnicoNombre: nombre,
                    });
                    if (!res.ok) {
                      setMsg(res.error.message);
                      return;
                    }
                    setMsg(
                      uid
                        ? "Técnico asignado"
                        : "Sin técnico asignado — disponible para el equipo de esta planta",
                    );
                  } finally {
                    setAsignBusy(false);
                  }
                }}
              />
            ) : (
              <p className="text-foreground">
                {workOrder.tecnico_asignado_nombre?.trim() || "Sin asignar"}
              </p>
            )}
          </div>

          <div className="space-y-2 pt-2">
            {vista === "PENDIENTE" && !esCliente ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Para <strong className="font-medium text-foreground">iniciar la ejecución</strong>, usá{" "}
                <strong className="font-medium text-foreground">Iniciar planilla</strong> en la sección siguiente (se
                abre el formulario y la orden pasa a en curso).
              </p>
            ) : null}
            {puedeCompletar && !planillaLoading && !planillaResp ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Para cerrar la orden: <strong className="font-medium text-foreground">iniciá la planilla</strong> abajo y
                firmala (Arauco + técnico SEAM). Ese paso único cierra la orden; no hay que firmar dos veces.
              </p>
            ) : null}
            {puedeCompletar && planillaResp && !planillaFirmada ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                La planilla se puede ir completando en varias veces: el avance queda guardado y podés usar{" "}
                <strong className="font-medium text-foreground">Continuar planilla</strong> cuando quieras. Al{" "}
                <strong className="font-medium text-foreground">completar y firmar</strong> la planilla la orden queda
                cerrada; no uses otro botón de cierre después.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {showChecklist ? (
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
            <CardDescription>
              {clLoading ? "Cargando…" : `${checklistDone} / ${checklistItems.length} ítems`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!checklistItems.length ? (
              <p className="text-sm text-zinc-500">Sin ítems de checklist.</p>
            ) : (
              checklistItems.map((it) => {
                if (it.tipo !== "BOOLEANO") {
                  return (
                    <div key={it.id} className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
                      <p className="font-medium">{it.descripcion}</p>
                      <p className="text-xs text-zinc-500">Tipo {it.tipo} (no editable aquí)</p>
                    </div>
                  );
                }
                const serverVal = it.respuesta_boolean === true;
                const checked = localCheck[it.id] ?? serverVal;
                return (
                  <label
                    key={it.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={checked}
                      disabled={esCliente || cerrada || vista === "CANCELADA"}
                      onChange={(e) => void toggleCheck(it.id, e.target.checked, serverVal)}
                    />
                    <span className="text-sm leading-snug">{it.descripcion}</span>
                  </label>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Planilla</CardTitle>
          <CardDescription>
            {planillaLoading
              ? "Cargando…"
              : planillaResp
                ? null
                : `Plantilla sugerida: ${etiquetaPlanillaTemplateCorta(planillaTemplateIdEsperado)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {planillaResp && !planillaLoading ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                Planilla {etiquetaPlanillaTemplateCorta(planillaResp.templateId)}
              </p>
              {planillaResp.status !== "firmada" ? (
                <span className="text-xs capitalize text-zinc-500">
                  Estado: {planillaResp.status.replaceAll("_", " ")}
                </span>
              ) : (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Firmada</span>
              )}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {!esCliente && !planillaResp && !cerrada && vista !== "CANCELADA" ? (
              <Button type="button" className="min-h-11" onClick={() => void onIniciarPlanilla()}>
                Iniciar planilla {etiquetaPlanillaTemplateCorta(planillaTemplateIdEsperado)}
              </Button>
            ) : null}
            {!esCliente && planillaResp && planillaResp.status !== "firmada" && !cerrada && vista !== "CANCELADA" ? (
              <Button
                type="button"
                size="lg"
                className="min-h-12 w-full font-semibold shadow-sm sm:w-auto"
                onClick={() => setPlanillaOpen(true)}
              >
                Continuar planilla
              </Button>
            ) : null}
            {esCliente && planillaResp ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPlanillaOpen(true)}>
                Ver planilla
              </Button>
            ) : null}
            {planillaResp?.status === "firmada" ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPlanillaOpen(true)}>
                Ver planilla completa
              </Button>
            ) : null}
            {cerrada || vista === "CANCELADA" ? (
              <p className="text-sm text-zinc-500">
                {planillaResp ? "Usá “Ver planilla completa” para consultar." : "No hay planilla registrada."}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {planillaOpen && workOrder ? (
        planillaTemplate && planillaResp ? (
          <PlanillaForm
            template={planillaTemplate}
            ot={workOrder}
            equipo={equipoCatalogo}
            respuestaInicial={planillaResp}
            readOnly={
              esCliente || planillaResp.status === "firmada" || cerrada || vista === "CANCELADA"
            }
            iaEnabled={centroCfg.modulos.ia}
            onCerrar={() => setPlanillaOpen(false)}
          />
        ) : (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/40 px-4 text-center text-white">
            <p className="text-sm font-medium">Preparando planilla…</p>
            <Button type="button" variant="secondary" onClick={() => setPlanillaOpen(false)}>
              Cancelar
            </Button>
          </div>
        )
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Materiales</CardTitle>
          <CardDescription>{matLoading ? "Cargando…" : `${materials.length} registros`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2 text-sm">
            {materials.map((m) => (
              <li key={m.id} className="rounded-md border border-zinc-100 px-2 py-1 dark:border-zinc-800">
                {materialLabel(m, esCliente)}
              </li>
            ))}
          </ul>
          {!esCliente && !cerrada && vista !== "CANCELADA" ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setMatOpen((o) => !o)}>
                + Agregar material
              </Button>
              {matOpen ? (
                <form onSubmit={(e) => void submitMaterial(e)} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="relative space-y-1">
                    <Input
                      value={matDesc}
                      onChange={(e) => {
                        setMatDesc(e.target.value);
                        setMatCatalogPick(null);
                      }}
                      placeholder={
                        MATERIALES_UI_SOLO_TEXTO_LIBRE
                          ? "Descripción del material (texto libre)"
                          : "Descripción (o elegí del catálogo)"
                      }
                      autoComplete="off"
                    />
                    {!MATERIALES_UI_SOLO_TEXTO_LIBRE && materialSuggestions.length ? (
                      <ul className="absolute z-20 mt-0.5 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-md dark:border-zinc-700 dark:bg-zinc-950">
                        {materialSuggestions.map((it) => (
                          <li key={it.id}>
                            <button
                              type="button"
                              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
                              onClick={() => {
                                setMatCatalogPick(it);
                                setMatDesc(it.descripcion);
                                setMatUd(it.unidad_medida || "u");
                              }}
                            >
                              <span className="font-medium text-foreground">{it.descripcion}</span>
                              <span className="text-xs text-zinc-500">
                                {it.codigo_material}
                                {esCliente ? null : (
                                  <>
                                    {" "}
                                    · Stock: {it.stock_disponible ?? "—"} {it.unidad_medida}
                                  </>
                                )}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {!MATERIALES_UI_SOLO_TEXTO_LIBRE && matCatalogPick && !esCliente ? (
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Del catálogo — el stock se actualizará al guardar
                    </p>
                  ) : !MATERIALES_UI_SOLO_TEXTO_LIBRE && !esCliente && centroCfg.modulos.ia && matDesc.trim().length >= 2 ? (
                    <p className="text-xs text-zinc-500">La IA intentará mapear el texto al catálogo en segundo plano</p>
                  ) : MATERIALES_UI_SOLO_TEXTO_LIBRE ? (
                    <p className="text-xs text-zinc-500">Registro libre; sin vinculación a catálogo en pantalla.</p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={matCant} onChange={(e) => setMatCant(e.target.value)} placeholder="Cantidad" />
                    <Input value={matUd} onChange={(e) => setMatUd(e.target.value)} placeholder="Unidad" />
                  </div>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={matOrigen}
                    onChange={(e) => setMatOrigen(e.target.value as "ARAUCO" | "EXTERNO")}
                  >
                    <option value="ARAUCO">ARAUCO</option>
                    <option value="EXTERNO">EXTERNO</option>
                  </select>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Guardar
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMatOpen(false)}>
                      Cerrar
                    </Button>
                  </div>
                </form>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
          <CardDescription>
            {histLoading ? "Cargando…" : `${historialVisible.length} eventos · sincronizado en vivo`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!historialVisible.length && !histLoading ? (
            <p className="text-sm text-zinc-500">Sin eventos aún.</p>
          ) : (
            <ul className="relative space-y-0 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
              {historialVisible.map((ev) => (
                <li key={ev.id} className="relative pb-6 last:pb-0">
                  <span className="absolute -left-[9px] top-1.5 h-3 w-3 rounded-full bg-zinc-400 ring-4 ring-white dark:bg-zinc-500 dark:ring-zinc-950" />
                  <p className="text-xs text-zinc-500">{formatFirestoreDate(ev.created_at)}</p>
                  <p className="mt-1 text-sm leading-snug text-foreground">
                    {historialEventoTextoUsuario(ev, historialActorNames[ev.actor_uid] ?? null)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {!esCliente ? (
            <div className="mt-4 flex border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <Button type="button" variant="outline" size="sm" onClick={() => downloadHistorialCsv()}>
                <Download className="mr-2 h-4 w-4" />
                Descargar CSV del historial
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <WorkOrderComentariosSection
        otId={workOrderId}
        viewerUid={user?.uid}
        puedeComentar={puede("comentarios:crear")}
        esCliente={esCliente}
      />

      <Button variant="outline" asChild>
        <Link href="/tareas">Volver a OTs</Link>
      </Button>

      {empOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="empalme-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !empBusy) setEmpOpen(false);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="empalme-dialog-title" className="text-lg font-semibold text-foreground">
              Registrar empalme documentado
            </h2>
            <div
              className="mt-3 rounded-lg border border-amber-400/70 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-600/45 dark:bg-amber-500/15 dark:text-amber-50"
              role="alert"
            >
              Esta acción registra trabajo ya realizado fuera del sistema. Quedará trazado quién y cuándo lo cargó, con
              la fecha real declarada.
            </div>
            <form className="mt-4 space-y-4" onSubmit={(e) => void submitEmpalme(e)}>
              <div className="space-y-1.5">
                <label htmlFor="emp-fecha" className="text-sm font-medium text-foreground">
                  Fecha de ejecución real
                </label>
                <Input
                  id="emp-fecha"
                  type="date"
                  required
                  max={isoDateLocal(new Date())}
                  value={empFecha}
                  onChange={(e) => setEmpFecha(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="emp-motivo" className="text-sm font-medium text-foreground">
                  Motivo / referencia documental (mín. 10 caracteres)
                </label>
                <Textarea
                  id="emp-motivo"
                  required
                  minLength={10}
                  value={empMotivo}
                  onChange={(e) => setEmpMotivo(e.target.value)}
                  placeholder="Ej.: Empalme planillas papel 01–03/05, carpeta mantenimiento n.º …"
                  rows={4}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="emp-tecnico" className="text-sm font-medium text-foreground">
                  Técnico responsable (opcional)
                </label>
                <Input
                  id="emp-tecnico"
                  value={empTecnico}
                  onChange={(e) => setEmpTecnico(e.target.value)}
                  placeholder="Nombre en planilla / quién ejecutó en planta"
                  maxLength={300}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="emp-evidencia" className="text-sm font-medium text-foreground">
                  URL de evidencia (opcional)
                </label>
                <Input
                  id="emp-evidencia"
                  type="url"
                  inputMode="url"
                  value={empEvidencia}
                  onChange={(e) => setEmpEvidencia(e.target.value)}
                  placeholder="https://… (archivo ya subido a almacenamiento)"
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" disabled={empBusy}>
                  {empBusy ? "Guardando…" : "Registrar empalme"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={empBusy}
                  onClick={() => setEmpOpen(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
