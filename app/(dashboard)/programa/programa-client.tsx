"use client";

import {
  actionMoveAvisoEnProgramaPublicado,
  actionRemoveAvisoFromProgramaPublicado,
  actionSearchAvisoEnProgramaSemanal,
} from "@/app/actions/schedule";
import {
  actionArchiveWorkOrder,
  actionCorrectWorkOrderFechaRealizacion,
} from "@/app/actions/work-orders";
import { ProgramaSeccionNav } from "@/app/(dashboard)/programa/programa-seccion-nav";
import { ProgramaSemanalClient } from "@/app/programa-semanal/programa-semanal-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HelpIconTooltip } from "@/components/ui/help-icon-tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CENTRO_SELECTOR_TODAS_PLANTAS,
  DEFAULT_CENTRO,
  isCentroInKnownList,
  KNOWN_CENTROS,
  nombreCentro,
  PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA,
} from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";
import { HORAS_ALERTA_PROPUESTA_SIN_VISTA } from "@/lib/config/limits";
import { isSuperAdminRole } from "@/modules/users/roles";
import { usuarioTieneCentro, centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import { etiquetaLocalidadSlot } from "@/lib/format/localidad-programa";
import { cn } from "@/lib/utils";
import { useAvisoLive } from "@/modules/notices/hooks";
import { useAvisosWorkOrderIdsByDocIds } from "@/modules/notices/use-avisos-work-order-ids";
import {
  avisoPasaBusqueda,
  busquedaProgramaListaParaCrossWeek,
  type ContextoBusquedaAvisoPrograma,
} from "@/modules/scheduling/busqueda-programa-aviso";
import {
  useProgramaSemana,
  useProgramaSemanaFusion,
  usePropuestaMotorSemana,
  useSemanasDisponibles,
  useSemanasDisponiblesTodas,
  type MergedSemanaOpcion,
  type SemanaOpcion,
} from "@/modules/scheduling/hooks";
import { useWorkOrderLive } from "@/modules/work-orders/hooks";
import { useWorkOrderEstadosForIds } from "@/modules/work-orders/use-work-order-estados-for-ids";
import { useWorkOrderIdPorAvisoBusqueda } from "@/modules/work-orders/use-work-order-id-por-aviso-busqueda";
import type { WorkOrderEstado } from "@/modules/work-orders/types";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import {
  getIsoWeekId,
  parseIsoWeekIdFromSemanaParam,
  semanaLabelDesdeIso,
  shiftIsoWeekId,
} from "@/modules/scheduling/iso-week";
import {
  ESPECIALIDADES_PROGRAMA_FILTRO,
  especialidadesOtSemanasTecnico,
  especialidadesProgramaVisiblesTecnico,
  etiquetaEspecialidadPrograma,
} from "@/modules/scheduling/especialidad-programa";
import type {
  AvisoSlot,
  DiaSemanaPrograma,
  EspecialidadPrograma,
  ProgramaSemana,
  SlotSemanal,
} from "@/modules/scheduling/types";
import { tienePermiso, type Rol } from "@/lib/permisos";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { getClientIdToken, useAuth } from "@/modules/users/hooks";
import { exportarProgramaSemanalExcel } from "@/lib/export/programa-semanal-excel";
import { Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";

const MIME_PROGRAMA_AVISO_DRAG = "text/plain";

type ProgramaAvisoDragPayload = {
  v: 1;
  programaDocId: string;
  avisoNumero: string;
  avisoFirestoreId?: string;
  /** Clave igual que la fila (localidad) */
  localidad: string;
  fromDia: DiaSemanaPrograma;
  especialidad: EspecialidadPrograma;
};

function normLocalidadGrid(loc: string | undefined): string {
  return (loc?.trim() || "").trim() || "—";
}

/** `localidad` tal como está en Firestore para mutar la celda (fusión multi-planta usa prefijo "PC01 · " solo en UI). */
function localidadCeldaFirestoreParaServidor(slot: SlotSemanal): string {
  const docLoc = slot.localidadDocPrograma?.trim();
  if (docLoc) return docLoc;
  return slot.localidad?.trim() || "—";
}

const DIAS_ORDEN: DiaSemanaPrograma[] = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
];

const DIA_LABEL: Record<DiaSemanaPrograma, string> = {
  lunes: "Lun",
  martes: "Mar",
  miercoles: "Mié",
  jueves: "Jue",
  viernes: "Vie",
  sabado: "Sáb",
  domingo: "Dom",
};

const DIA_LABEL_LARGO: Record<DiaSemanaPrograma, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};

const SUFIJO_ISO_EN_ID_SEMANA = /(\d{4}-W\d{2})$/;

/** Alinea `?semana=2026-W19` o `?semana=PC01_2026-W19` con un `s.id` del listado. */
function idDocumentoDesdeParamSemana(semanas: SemanaOpcion[], param: string | null | undefined): string | null {
  if (!param?.trim() || !semanas.length) return null;
  const p = param.trim();
  if (semanas.some((s) => s.id === p)) return p;
  const iso = parseIsoWeekIdFromSemanaParam(p);
  if (!iso) return null;
  return semanas.find((s) => SUFIJO_ISO_EN_ID_SEMANA.exec(s.id)?.[1] === iso)?.id ?? null;
}

/** Semana ISO del día de hoy según el calendario (no la más reciente en Firestore). */
function semanaIsoHoy(): string {
  return getIsoWeekId(new Date());
}

function semanaDocIdEnLista(semanas: SemanaOpcion[], iso: string): string | null {
  const match = semanas.find((s) => s.id === iso || SUFIJO_ISO_EN_ID_SEMANA.exec(s.id)?.[1] === iso);
  return match?.id ?? null;
}

/** Inserta la semana ISO de hoy si falta, manteniendo orden descendente (más reciente primero). */
function semanasSelectorConHoyOrdenadas<T>(
  lista: T[],
  hoyIso: string,
  hoyItem: T,
  isoDe: (item: T) => string,
): T[] {
  if (lista.some((s) => isoDe(s) === hoyIso)) return lista;
  return [...lista, hoyItem].sort((a, b) => isoDe(b).localeCompare(isoDe(a)));
}

/**
 * Id de documento `programa_semanal` a mostrar por defecto o desde `?semana=`.
 * Por defecto: semana ISO actual del calendario, aunque aún no esté publicada.
 */
function resolverSemanaDocIdPlanta(
  centro: string,
  semanas: SemanaOpcion[],
  param: string | null | undefined,
): string {
  const c = centro.trim();
  const hoyIso = semanaIsoHoy();
  if (param?.trim()) {
    const fromList = idDocumentoDesdeParamSemana(semanas, param);
    if (fromList) return fromList;
    const iso = parseIsoWeekIdFromSemanaParam(param);
    if (iso && c && isCentroInKnownList(c)) return propuestaSemanaDocId(c, iso);
    if (iso) return iso;
  }
  const enLista = semanaDocIdEnLista(semanas, hoyIso);
  if (enLista) return enLista;
  if (c && isCentroInKnownList(c)) return propuestaSemanaDocId(c, hoyIso);
  return hoyIso;
}

/** Semana ISO por defecto en vista «todas las plantas» (calendario actual si no hay `?semana=`). */
function resolverSemanaIsoTodasPlantas(
  merged: MergedSemanaOpcion[],
  param: string | null | undefined,
): string {
  const hoyIso = semanaIsoHoy();
  if (param?.trim()) {
    const desdeUrl = idIsoDesdeParamSemanaTodas(merged, param);
    if (desdeUrl) return desdeUrl;
    const iso = parseIsoWeekIdFromSemanaParam(param);
    if (iso) return iso;
  }
  return hoyIso;
}

/** Alineado con la ventana hacia adelante de órdenes programadas en `useSemanasDisponibles`. */
const SEMANAS_REPROGRAMAR_HORIZONTE_ADELANTE = 52;

/**
 * Semanas ya cargadas (publicadas / OT / propuestas) más cada ISO hasta N semanas desde hoy.
 * Permite mover un aviso a una semana futura aunque el plan aún no esté publicado (`programa_semanal` se crea al guardar).
 */
function semanasOpcionesReprogramarAviso(centro: string, existentes: SemanaOpcion[], semanasAdelante: number): SemanaOpcion[] {
  const c = centro.trim();
  if (!c) return existentes;
  const byIso = new Map<string, SemanaOpcion>();
  for (const s of existentes) {
    const iso = parseIsoWeekIdFromSemanaParam(s.id);
    if (!iso || !/^\d{4}-W\d{2}$/.test(iso)) continue;
    byIso.set(iso, s);
  }
  const desde = getIsoWeekId(new Date());
  for (let i = 0; i <= semanasAdelante; i++) {
    const iso = shiftIsoWeekId(desde, i);
    if (!byIso.has(iso)) {
      byIso.set(iso, { id: propuestaSemanaDocId(c, iso), label: semanaLabelDesdeIso(iso) });
    }
  }
  return [...byIso.values()].sort((a, b) => {
    const ka = SUFIJO_ISO_EN_ID_SEMANA.exec(a.id)?.[1];
    const kb = SUFIJO_ISO_EN_ID_SEMANA.exec(b.id)?.[1];
    if (ka && kb) return kb.localeCompare(ka);
    if (ka && !kb) return -1;
    if (!ka && kb) return 1;
    return b.id.localeCompare(a.id);
  });
}

/** Prefijo `centro_` de un id `programa_semanal` / propuesta (`PC01_2026-W18`). */
function centroDesdeProgramaDocId(programaDocId: string): string | null {
  const id = programaDocId.trim();
  if (!id) return null;
  const sorted = [...KNOWN_CENTROS].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (id.startsWith(`${c}_`)) return c;
  }
  return null;
}

/** Resuelve `YYYY-Www` para el modo «todas las plantas» (acepta id doc o ISO en la URL). */
function idIsoDesdeParamSemanaTodas(merged: MergedSemanaOpcion[], param: string | null | undefined): string | null {
  if (!param?.trim() || !merged.length) return null;
  const p = param.trim();
  if (merged.some((s) => s.iso === p)) return p;
  const iso = parseIsoWeekIdFromSemanaParam(p);
  if (iso && merged.some((s) => s.iso === iso)) return iso;
  for (const s of merged) {
    if (Object.values(s.programaDocIdPorCentro).includes(p)) return s.iso;
  }
  return null;
}

/** Al cambiar planta, adapta `?semana=` (ISO en «todas», `{centro}_{ISO}` en planta única). */
function normalizarSemanaParamAlCambiarCentro(
  semanaActual: string | null | undefined,
  nextCentro: string,
): string | null {
  if (!semanaActual?.trim()) return null;
  const iso = parseIsoWeekIdFromSemanaParam(semanaActual);
  if (!iso) return semanaActual.trim();
  if (nextCentro === CENTRO_SELECTOR_TODAS_PLANTAS) return iso;
  if (isCentroInKnownList(nextCentro)) return propuestaSemanaDocId(nextCentro, iso);
  return iso;
}

type FiltroEspecialidad = EspecialidadPrograma | "todos";
type FiltroDia = DiaSemanaPrograma | "todos";
type FiltroTipo = "todos" | "correctivo" | "urgente";

/**
 * Filtro de la grilla: etapas del chip (leyenda) u orden previa SAP (aro rojo), sin mezclar con «Todos» a la vez.
 */
type FiltroEstadoOperativo =
  | "todos"
  | "orden_previa_pendiente"
  | "sin_orden"
  | "abierta_borrador"
  | "en_ejecucion"
  | "pendiente_firma"
  | "listo_cierre"
  | "cerrada"
  | "anulada";

type CategoriaEstadoOperativoChip = Exclude<FiltroEstadoOperativo, "todos" | "orden_previa_pendiente">;

function avisoVariant(a: AvisoSlot): "urgente" | "correctivo" | "preventivo" {
  if (a.urgente) return "urgente";
  if (a.tipo === "correctivo") return "correctivo";
  return "preventivo";
}

function avisoPasaTipo(a: AvisoSlot, filtro: FiltroTipo): boolean {
  if (filtro === "todos") return true;
  if (filtro === "correctivo") return a.tipo === "correctivo";
  return a.urgente === true;
}

function avisoPasaFiltros(a: AvisoSlot, tipo: FiltroTipo): boolean {
  return avisoPasaTipo(a, tipo);
}

function semanaActualTieneCoincidenciaBusqueda(
  programa: ProgramaSemana | null | undefined,
  busqueda: string,
): boolean {
  const q = busqueda.trim();
  if (!q || !programa?.slots?.length) return false;
  for (const slot of programa.slots) {
    const ctx: ContextoBusquedaAvisoPrograma = {
      localidad: slot.localidad,
      denomUbicTecnica: slot.denomUbicTecnica,
      especialidad: slot.especialidad,
    };
    for (const aviso of slot.avisos ?? []) {
      if (avisoPasaBusqueda(aviso, q, ctx)) return true;
    }
  }
  return false;
}

type CeldaAvisoPrograma = { aviso: AvisoSlot; especialidad: EspecialidadPrograma; programaDocId?: string };

function etiquetaLocalidadEnPrograma(localidadClave: string, todosSlots: SlotSemanal[] | undefined): string {
  const row = (todosSlots ?? []).find((s) => (s.localidad?.trim() || "—") === localidadClave);
  return etiquetaLocalidadSlot(localidadClave, row?.denomUbicTecnica);
}

function etiquetaEspecialidadEnChip(esp: EspecialidadPrograma): string {
  return etiquetaEspecialidadPrograma(esp);
}

/** Progresión de intensidad: cuanto más avanzada la orden, más saturado el chip (excepto anulada = rojo). */

/** 1 — Aviso en plan sin orden vinculada (mínima intensidad). */
const CLASES_CHIP_PLAN_SIN_ORDEN =
  "border-zinc-200/90 bg-zinc-50/95 text-foreground shadow-sm dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100";

/** 2 — Orden creada, aún sin «en curso». */
const CLASES_CHIP_ORDEN_ABIERTA =
  "border-slate-400 bg-slate-200 text-slate-950 shadow-sm dark:border-slate-500 dark:bg-slate-700 dark:text-slate-50";

/** 3 — En ejecución (primer pico de color «cálido»). */
const CLASES_OS_EN_EJECUCION =
  "border-orange-500 bg-orange-200 text-orange-950 shadow-sm dark:border-orange-500 dark:bg-orange-900/85 dark:text-orange-50";

/** 4 — Realizado: pendiente firma (más intenso que ejecución en frío). */
const CLASES_OS_REALIZADO_PENDIENTE_FIRMA =
  "border-sky-600 bg-sky-300 text-sky-950 shadow-sm dark:border-sky-500 dark:bg-sky-800 dark:text-sky-50";

/** 5 — Listo para cierre formal (casi al verde final). */
const CLASES_OS_LISTO_CIERRE =
  "border-teal-700 bg-teal-400 text-teal-950 shadow-sm dark:border-teal-400 dark:bg-teal-700 dark:text-teal-50";

/** 6 — Terminado: máxima intensidad «éxito». */
const CLASES_OS_CERRADA =
  "border-emerald-800 bg-emerald-600 text-white shadow-sm dark:border-emerald-500 dark:bg-emerald-600 dark:text-white";

const CLASES_OS_ANULADA =
  "border-red-500 bg-red-100 text-red-950 line-through decoration-red-600 dark:border-red-500 dark:bg-red-950/95 dark:text-red-100";

function clasesProgramaChip(
  aviso: AvisoSlot,
  ctx: {
    /** Programa publicado puede ir atrasado: misma fusión que el panel («Abrir orden»). */
    ordenServicioIdEfectiva: string | undefined;
    estado: WorkOrderEstado | undefined;
    cargando: boolean;
    ordenPreviaPendienteEfectiva?: boolean;
  },
): string {
  const woId = ctx.ordenServicioIdEfectiva?.trim();

  let inner: string;
  if (!woId) {
    inner = CLASES_CHIP_PLAN_SIN_ORDEN;
  } else if (ctx.cargando) {
    inner = cn(CLASES_CHIP_ORDEN_ABIERTA, "opacity-75");
  } else {
    const e = ctx.estado;
    if (!e) {
      inner = CLASES_CHIP_ORDEN_ABIERTA;
    } else if (e === "CERRADA") {
      inner = CLASES_OS_CERRADA;
    } else if (e === "ANULADA") {
      inner = CLASES_OS_ANULADA;
    } else if (e === "PENDIENTE_FIRMA_SOLICITANTE") {
      inner = CLASES_OS_REALIZADO_PENDIENTE_FIRMA;
    } else if (e === "LISTA_PARA_CIERRE") {
      inner = CLASES_OS_LISTO_CIERRE;
    } else if (e === "EN_EJECUCION") {
      inner = CLASES_OS_EN_EJECUCION;
    } else {
      inner = CLASES_CHIP_ORDEN_ABIERTA;
    }
  }

  if (ctx.ordenPreviaPendienteEfectiva ?? aviso.ordenPreviaPendiente) {
    return cn(inner, "ring-2 ring-red-500/65 ring-offset-1 dark:ring-offset-zinc-950");
  }
  return inner;
}

function ordenPreviaPendienteEfectivaEnChip(
  aviso: AvisoSlot,
  antecesorWorkOrderIdPorAvisoDocId: Map<string, string>,
  estadosPorId: Map<string, WorkOrderEstado>,
  archivadaPorId: Map<string, boolean>,
  loadingEstados: boolean,
): boolean {
  const docId = aviso.avisoFirestoreId?.trim();
  const antWo = docId ? antecesorWorkOrderIdPorAvisoDocId.get(docId)?.trim() : undefined;
  if (docId && antWo) {
    if (loadingEstados) return Boolean(aviso.ordenPreviaPendiente);
    if (archivadaPorId.get(antWo) === true) return false;
    const st = estadosPorId.get(antWo);
    if (!st) return false;
    return st !== "CERRADA" && st !== "ANULADA";
  }
  return Boolean(aviso.ordenPreviaPendiente);
}

function LeyendaColoresProgramaSemanal() {
  return (
    <div
      className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs leading-snug text-muted-foreground"
      role="region"
      aria-label="Leyenda de colores y señales de la grilla (estado operativo y orden previa)"
    >
      <p className="mb-2 font-semibold text-foreground">Leyenda: estado operativo</p>
      <p className="mb-2 text-muted-foreground">
        Los colores del chip indican <strong className="text-foreground">en qué etapa está la orden</strong>. La{" "}
        <strong className="text-foreground">especialidad</strong> (Aire, Eléctrico, GG, Hidrogrúa) se lee en la{" "}
        <strong className="text-foreground">primera línea</strong> de cada chip.{" "}
        <strong className="text-foreground">A mayor avance hacia el cierre</strong>, el tono se vuelve más intenso.
      </p>
      <ul className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-1.5">
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-zinc-200/90 bg-zinc-50/95 dark:border-zinc-700 dark:bg-zinc-900/45"
            aria-hidden
          />
          <span>Solo aviso en el plan · sin orden vinculada acá</span>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-slate-400 bg-slate-200 dark:border-slate-500 dark:bg-slate-700"
            aria-hidden
          />
          <span>
            Orden abierta o borrador: la orden ya está creada pero{" "}
            <strong className="text-foreground">aún no se marcó «en curso»</strong> (no empezó el trámite de cierre).
          </span>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-orange-500 bg-orange-200 dark:border-orange-500 dark:bg-orange-900/85"
            aria-hidden
          />
          <span>
            En ejecución: ya está <strong className="text-foreground">en curso</strong>. En la práctica suele
            empezar al pulsar <strong className="text-foreground">Iniciar planilla</strong> en el detalle de la orden:{" "}
            primero el sistema registra el inicio de ejecución y después abre el formulario.
          </span>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-sky-600 bg-sky-300 dark:border-sky-500 dark:bg-sky-800"
            aria-hidden
          />
          <span>
            Realizado · pendiente firma del solicitante (trabajo hecho, trámite de firma)
          </span>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-teal-700 bg-teal-400 dark:border-teal-400 dark:bg-teal-700"
            aria-hidden
          />
          <span>Listo para cierre formal (último paso antes de cerrada)</span>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-emerald-800 bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-600"
            aria-hidden
          />
          <span>Terminado · cerrada en sistema (firmas completas)</span>
        </li>
        <li className="flex min-w-0 basis-full items-start gap-2 sm:basis-full">
          <span
            className="relative mt-0.5 box-border h-6 w-9 shrink-0 rounded-md border border-slate-400 bg-slate-200 ring-2 ring-red-500/65 ring-offset-1 dark:border-slate-500 dark:bg-slate-700 dark:ring-offset-zinc-950"
            aria-hidden
          />
          <span>
            <strong className="text-foreground">Aro / recuadro rojo alrededor del chip</strong> (el fondo sigue siendo el
            color de estado de arriba): <strong className="text-foreground">orden previa</strong> — SAP emitió un aviso
            nuevo y todavía hay una <strong className="text-foreground">orden del mismo mantenimiento sin cerrar</strong>.
            Es una alerta; <strong className="text-foreground">no es lo mismo que anulada</strong> (anulada = ítem de
            abajo: fondo rojo y texto tachado).
          </span>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span
            className="h-5 w-8 shrink-0 rounded border border-red-500 bg-red-100 line-through dark:border-red-500 dark:bg-red-950/95"
            aria-hidden
          />
          <span>Anulada (fondo rojo y texto tachado; sin confundir con el aro de orden previa)</span>
        </li>
      </ul>
      <p className="mt-2 text-muted-foreground">
        Si en el programa aún no figura el id de orden pero el aviso en sistema sí, el color se alinea con el aviso (lo
        mismo que al abrir <strong className="text-foreground">Abrir OT</strong>).
      </p>
    </div>
  );
}

/**
 * Misma prioridad que el drawer («Abrir orden»): vínculo vivo en `avisos.work_order_id`, y si aún no hay,
 * el id embebido en el programa publicado.
 */
function ordenServicioIdEfectivaEnPrograma(aviso: AvisoSlot, workOrderIdDesdeFirestoreAviso: Map<string, string>): string | undefined {
  const aid = aviso.avisoFirestoreId?.trim();
  const desdeFirestore = aid ? workOrderIdDesdeFirestoreAviso.get(aid)?.trim() : undefined;
  if (desdeFirestore) return desdeFirestore;
  return aviso.workOrderId?.trim() || undefined;
}

function chipEstadoServicioProps(
  ordenServicioIdEfectiva: string | undefined,
  mapaEstados: Map<string, WorkOrderEstado>,
  cargandoMapaEstados: boolean,
): { estadoServicio: WorkOrderEstado | undefined; cargandoEstadoServicio: boolean } {
  const woId = ordenServicioIdEfectiva?.trim();
  return {
    estadoServicio: woId ? mapaEstados.get(woId) : undefined,
    cargandoEstadoServicio: Boolean(woId && cargandoMapaEstados && !mapaEstados.has(woId)),
  };
}

function categoriaEstadoOperativoChip(
  ordenServicioIdEfectiva: string | undefined,
  estado: WorkOrderEstado | undefined,
  cargando: boolean,
): CategoriaEstadoOperativoChip {
  const woId = ordenServicioIdEfectiva?.trim();
  if (!woId) return "sin_orden";
  if (cargando) return "abierta_borrador";
  if (!estado) return "abierta_borrador";
  if (estado === "CERRADA") return "cerrada";
  if (estado === "ANULADA") return "anulada";
  if (estado === "PENDIENTE_FIRMA_SOLICITANTE") return "pendiente_firma";
  if (estado === "LISTA_PARA_CIERRE") return "listo_cierre";
  if (estado === "EN_EJECUCION") return "en_ejecucion";
  return "abierta_borrador";
}

type FiltroVistaTecnico = {
  especialidadesPrograma: EspecialidadPrograma[];
};

/** Técnico: chips con OT legible (propias o pool sin asignar); oculta solo anuladas. */
function avisoVisibleProgramaTecnico(
  a: AvisoSlot,
  workOrderIdPorAvisoDocId: Map<string, string>,
  estadosPorId: Map<string, WorkOrderEstado>,
  loadingEstados: boolean,
): boolean {
  const ordenId = ordenServicioIdEfectivaEnPrograma(a, workOrderIdPorAvisoDocId)?.trim();
  if (!ordenId) return false;
  if (loadingEstados) return true;
  const estado = estadosPorId.get(ordenId);
  if (!estado) return false;
  return estado !== "ANULADA";
}

function avisoVisibleEnGrilla(
  a: AvisoSlot,
  tipo: FiltroTipo,
  filtroEstado: FiltroEstadoOperativo,
  workOrderIdPorAvisoDocId: Map<string, string>,
  estadosPorId: Map<string, WorkOrderEstado>,
  loadingEstados: boolean,
  filtroVistaTecnico?: FiltroVistaTecnico,
  busqueda?: string,
  ctxBusqueda?: ContextoBusquedaAvisoPrograma,
): boolean {
  if (filtroVistaTecnico && !avisoVisibleProgramaTecnico(a, workOrderIdPorAvisoDocId, estadosPorId, loadingEstados)) {
    return false;
  }
  if (!avisoPasaBusqueda(a, busqueda ?? "", ctxBusqueda)) return false;
  if (!avisoPasaFiltros(a, tipo)) return false;
  if (filtroEstado === "orden_previa_pendiente") return Boolean(a.ordenPreviaPendiente);
  if (filtroEstado === "todos") return true;
  const ordenId = ordenServicioIdEfectivaEnPrograma(a, workOrderIdPorAvisoDocId);
  const { estadoServicio, cargandoEstadoServicio } = chipEstadoServicioProps(
    ordenId,
    estadosPorId,
    loadingEstados,
  );
  return categoriaEstadoOperativoChip(ordenId, estadoServicio, cargandoEstadoServicio) === filtroEstado;
}

function slotsFiltrados(
  programa: ProgramaSemana | null,
  esp: FiltroEspecialidad,
  dia: FiltroDia,
  tipo: FiltroTipo,
  filtroEstado: FiltroEstadoOperativo,
  workOrderIdPorAvisoDocId: Map<string, string>,
  estadosPorId: Map<string, WorkOrderEstado>,
  loadingEstados: boolean,
  filtroVistaTecnico?: FiltroVistaTecnico,
  busqueda?: string,
): SlotSemanal[] {
  if (!programa?.slots?.length) return [];
  return programa.slots.filter((s) => {
    if (filtroVistaTecnico && !filtroVistaTecnico.especialidadesPrograma.includes(s.especialidad)) {
      return false;
    }
    if (esp !== "todos" && s.especialidad !== esp) return false;
    if (dia !== "todos" && s.dia !== dia) return false;
    const ctxBusqueda: ContextoBusquedaAvisoPrograma = {
      localidad: s.localidad,
      denomUbicTecnica: s.denomUbicTecnica,
      especialidad: s.especialidad,
    };
    const avisosOk = (s.avisos ?? []).filter((a) =>
      avisoVisibleEnGrilla(
        a,
        tipo,
        filtroEstado,
        workOrderIdPorAvisoDocId,
        estadosPorId,
        loadingEstados,
        filtroVistaTecnico,
        busqueda,
        ctxBusqueda,
      ),
    );
    return avisosOk.length > 0;
  });
}

function celdasPorLocalidad(
  slots: SlotSemanal[],
  tipo: FiltroTipo,
  filtroEstado: FiltroEstadoOperativo,
  workOrderIdPorAvisoDocId: Map<string, string>,
  estadosPorId: Map<string, WorkOrderEstado>,
  loadingEstados: boolean,
  filtroVistaTecnico?: FiltroVistaTecnico,
  busqueda?: string,
): Map<string, Map<DiaSemanaPrograma, CeldaAvisoPrograma[]>> {
  const out = new Map<string, Map<DiaSemanaPrograma, CeldaAvisoPrograma[]>>();

  for (const slot of slots) {
    const loc = slot.localidad?.trim() || "—";
    const ctxBusqueda: ContextoBusquedaAvisoPrograma = {
      localidad: slot.localidad,
      denomUbicTecnica: slot.denomUbicTecnica,
      especialidad: slot.especialidad,
    };
    const avisos = (slot.avisos ?? []).filter((a) =>
      avisoVisibleEnGrilla(
        a,
        tipo,
        filtroEstado,
        workOrderIdPorAvisoDocId,
        estadosPorId,
        loadingEstados,
        filtroVistaTecnico,
        busqueda,
        ctxBusqueda,
      ),
    );
    if (!avisos.length) continue;

    let byDay = out.get(loc);
    if (!byDay) {
      byDay = new Map();
      out.set(loc, byDay);
    }
    const wrapped = avisos.map((aviso) => ({
      aviso,
      especialidad: slot.especialidad,
      programaDocId: slot.programaOrigenDocId,
    }));
    const cur = byDay.get(slot.dia) ?? [];
    byDay.set(slot.dia, [...cur, ...wrapped]);
  }

  return out;
}

function encuentraSlotParaChip(
  programa: ProgramaSemana | null | undefined,
  loc: string,
  dia: DiaSemanaPrograma,
  especialidad: EspecialidadPrograma,
  numeroAviso: string,
): SlotSemanal | undefined {
  return programa?.slots?.find(
    (s) =>
      s.especialidad === especialidad &&
      normLocalidadGrid(s.localidad) === normLocalidadGrid(loc) &&
      s.dia === dia &&
      (s.avisos ?? []).some((a) => a.numero === numeroAviso),
  );
}

/** Chip del aviso; si `puedeArrastrar`, se arrastra entero a otro día (misma fila / misma semana). */
function ProgramaChipAvisoConArrastre({
  programaDocId,
  loc,
  diaCol,
  c,
  puedeArrastrar,
  onAbrirDrawer,
  chipClassNameBoton,
  estadoServicio,
  cargandoEstadoServicio,
  ordenServicioIdEfectiva,
  onDragPayloadStart,
  onDragPayloadEnd,
  ordenPreviaPendienteEfectiva,
}: {
  programaDocId: string;
  loc: string;
  diaCol: DiaSemanaPrograma;
  c: CeldaAvisoPrograma;
  puedeArrastrar: boolean;
  onAbrirDrawer: () => void;
  chipClassNameBoton: string;
  estadoServicio: WorkOrderEstado | undefined;
  cargandoEstadoServicio: boolean;
  ordenServicioIdEfectiva: string | undefined;
  onDragPayloadStart?: (payload: ProgramaAvisoDragPayload) => void;
  onDragPayloadEnd?: () => void;
  ordenPreviaPendienteEfectiva: boolean;
}) {
  const omitirClickTrasArrastre = useRef(false);

  const dragPayload = puedeArrastrar
    ? ({
        v: 1 as const,
        programaDocId,
        avisoNumero: c.aviso.numero,
        ...(c.aviso.avisoFirestoreId?.trim() ? { avisoFirestoreId: c.aviso.avisoFirestoreId.trim() } : {}),
        localidad: normLocalidadGrid(loc),
        fromDia: diaCol,
        especialidad: c.especialidad,
      } satisfies ProgramaAvisoDragPayload)
    : null;

  const tituloChip = ordenPreviaPendienteEfectiva
    ? `Aviso ${c.aviso.numero} — orden previa pendiente de cierre`
    : `Aviso ${c.aviso.numero}`;

  return (
    <button
      type="button"
      draggable={Boolean(dragPayload)}
      title={dragPayload ? `${tituloChip} — mantené apretado y soltá en otro día (misma fila)` : tituloChip}
      onDragStart={
        dragPayload
          ? (e) => {
              omitirClickTrasArrastre.current = false;
              e.dataTransfer.setData(MIME_PROGRAMA_AVISO_DRAG, JSON.stringify(dragPayload));
              e.dataTransfer.effectAllowed = "move";
              onDragPayloadStart?.(dragPayload);
            }
          : undefined
      }
      onDragEnd={
        dragPayload
          ? () => {
              omitirClickTrasArrastre.current = true;
              window.setTimeout(() => {
                omitirClickTrasArrastre.current = false;
              }, 0);
              onDragPayloadEnd?.();
            }
          : undefined
      }
      onClick={() => {
        if (omitirClickTrasArrastre.current) return;
        onAbrirDrawer();
      }}
      className={cn(
        chipClassNameBoton,
        dragPayload && "cursor-grab touch-none active:cursor-grabbing",
        clasesProgramaChip(c.aviso, {
          ordenServicioIdEfectiva,
          estado: estadoServicio,
          cargando: cargandoEstadoServicio,
          ordenPreviaPendienteEfectiva,
        }),
      )}
    >
      <span className="flex w-full flex-col items-stretch gap-0.5 text-left">
        <span className="text-[10px] font-semibold leading-none sm:text-[11px]">
          {etiquetaEspecialidadEnChip(c.especialidad)}
        </span>
        <span className="line-clamp-2 [overflow-wrap:anywhere] opacity-95">
          {c.aviso.descripcion?.trim() || "—"}
        </span>
      </span>
    </button>
  );
}

type DrawerState = { aviso: AvisoSlot; slot: SlotSemanal; programaDocId: string } | null;
/** Cuando hay panel abierto, `estado` no es null. */
type DrawerAbierto = NonNullable<DrawerState>;

function SelectorVistaPrograma({
  vistaOperativa,
  onElegirPublicada,
  onElegirOperativa,
  superadmin,
  mostrarPestañaOperativa = true,
}: {
  vistaOperativa: boolean;
  onElegirPublicada: () => void;
  onElegirOperativa: () => void;
  /** Nota corta en la ayuda: consulta multi-planta vs edición por centro. */
  superadmin?: boolean;
  /** Si es `false`, solo se muestra la tarjeta «Programa publicado». */
  mostrarPestañaOperativa?: boolean;
}) {
  const publicadaSeleccionada = !vistaOperativa || !mostrarPestañaOperativa;
  return (
    <div className="relative z-20 flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row">
        <button
          type="button"
          aria-pressed={publicadaSeleccionada}
          onClick={onElegirPublicada}
          className={cn(
            "flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition-all duration-150",
            publicadaSeleccionada
              ? "border-brand bg-brand/5 shadow-sm ring-1 ring-brand/25"
              : "border-border bg-background hover:border-brand/40 hover:bg-muted/40",
          )}
        >
          <span className={cn("text-sm font-semibold", publicadaSeleccionada ? "text-brand" : "text-foreground")}>
            📋 Programa publicado
          </span>
          <span className="text-xs leading-snug text-muted-foreground">
            Consulta · grilla semanal (por día)
          </span>
        </button>
        {mostrarPestañaOperativa ? (
          <button
            type="button"
            aria-pressed={vistaOperativa}
            onClick={onElegirOperativa}
            className={cn(
              "flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition-all duration-150",
              vistaOperativa
                ? "border-brand bg-brand/5 shadow-sm ring-1 ring-brand/25"
                : "border-border bg-background hover:border-brand/40 hover:bg-muted/40",
            )}
          >
            <span className={cn("text-sm font-semibold", vistaOperativa ? "text-brand" : "text-foreground")}>
              ✏️ Editar esta semana
            </span>
            <span className="text-xs leading-snug text-muted-foreground">
              Calendario semanal: agendar órdenes por día — no es el maestro de avisos (Administración, importación)
            </span>
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-center self-center sm:items-start sm:pt-1">
        <HelpIconTooltip
          variant="info"
          ariaLabel="Diferencia entre consulta y edición del programa"
          panelClassName="right-0 left-auto w-[min(28rem,calc(100vw-2.5rem))] sm:left-auto sm:right-0"
        >
          <div className="block space-y-2 text-left">
            <span className="font-semibold text-foreground">Programa publicado</span>
            <p>
              Lo que la cuadrilla usa para ver la semana: avisos en columnas por <strong>día</strong> de la semana, con
              los filtros de abajo. En el celular podés cambiar de <strong>fila</strong> (localidad) con los botones de
              arriba. Es <strong>solo lectura</strong> salvo que tengas permiso para mover avisos: con{" "}
              <strong>una planta</strong> en el filtro podés arrastrar o usar el panel; con{" "}
              <strong>Todas las plantas</strong> el arrastre sigue desactivado, pero el panel del aviso permite
              reprogramar en la planta de ese aviso si tenés permiso sobre ese centro.
            </p>
            {mostrarPestañaOperativa ? (
              <>
                <span className="font-semibold text-foreground">Editar esta semana</span>
                <p>
                  <strong>Calendario semanal:</strong> asigná <strong>OTs que ya existen</strong> a cada
                  día de la semana ISO. La grilla con textos de aviso está en la otra pestaña. El{" "}
                  <strong>maestro de preventivos</strong> (Excel tipo AVISOS_PREVENTIVOS) se carga en{" "}
                  <strong>Administración → Configuración e importación</strong>; no reemplaza publicar el programa acá.
                </p>
                <p className="text-muted-foreground">
                  Si el motor dejó propuestas sin tratar, <strong>Revisar y aprobar</strong> es el paso que vuelca ítems
                  en avisos de esta grilla.
                </p>
                {superadmin ? (
                  <p className="text-muted-foreground">
                    Como <strong>superadmin</strong>, en consulta podés usar <strong>Todas las plantas</strong> y ver
                    varios centros juntos. En <strong>Editar esta semana</strong> el calendario es siempre de{" "}
                    <strong>un</strong> centro: el de tu perfil hasta que elijas otra planta en el selector.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Con los permisos adecuados, <strong>mové o reprogramá avisos</strong> desde esta misma grilla
                  (arrastrar entre días o panel del aviso). El maestro Excel de preventivos se carga en{" "}
                  <strong>Administración → Configuración e importación</strong>.
                </p>
                <p className="text-muted-foreground">
                  Si el motor dejó propuestas sin tratar, <strong>Revisar y aprobar</strong> es el paso que vuelca ítems
                  en avisos de esta grilla.
                </p>
                {superadmin ? (
                  <p className="text-muted-foreground">
                    Como <strong>superadmin</strong>, en consulta podés usar <strong>Todas las plantas</strong> y ver
                    varios centros juntos. Para arrastrar o usar <strong>Reprogramar</strong> en el panel, elegí{" "}
                    <strong>una planta</strong> en el selector.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </HelpIconTooltip>
      </div>
    </div>
  );
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fechaFinEjecucionIsoDesdeWo(wo: { fecha_fin_ejecucion?: { toDate?: () => Date } | null }): string {
  const fp = wo.fecha_fin_ejecucion;
  if (fp != null && typeof fp.toDate === "function") {
    const d = fp.toDate();
    if (!Number.isNaN(d.getTime())) return isoDateLocal(d);
  }
  return isoDateLocal(new Date());
}

function SelectorPlantaSuperadmin({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (centro: string) => void;
  disabled?: boolean;
}) {
  const selectValue =
    value === CENTRO_SELECTOR_TODAS_PLANTAS
      ? CENTRO_SELECTOR_TODAS_PLANTAS
      : isCentroInKnownList(value)
        ? value
        : CENTRO_SELECTOR_TODAS_PLANTAS;

  return (
    <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Planta
      <select
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={CENTRO_SELECTOR_TODAS_PLANTAS}>Todas las plantas</option>
        {KNOWN_CENTROS.map((c) => (
          <option key={c} value={c}>
            {nombreCentro(c)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectorPlantaTecnico({
  value,
  centros,
  onChange,
  disabled,
}: {
  value: string;
  centros: string[];
  onChange: (centro: string) => void;
  disabled?: boolean;
}) {
  const opciones = centros.length ? centros : [value].filter(Boolean);
  const selectValue = opciones.includes(value) ? value : (opciones[0] ?? value);

  return (
    <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Planta
      <select
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {opciones.map((c) => (
          <option key={c} value={c}>
            {nombreCentro(c)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AvisoDrawer({
  onClose,
  estado,
  puedeCrearOt,
  puedeReprogramar,
  semanasOpciones,
  programaDocSeleccionActual,
  viewerUid,
  esSuperadmin,
}: {
  onClose: () => void;
  estado: DrawerAbierto;
  puedeCrearOt: boolean;
  puedeReprogramar: boolean;
  semanasOpciones: SemanaOpcion[];
  programaDocSeleccionActual: string;
  viewerUid: string | undefined;
  esSuperadmin: boolean;
}) {
  const [destProgramaDocId, setDestProgramaDocId] = useState(programaDocSeleccionActual);
  const [destDiaSeleccionado, setDestDiaSeleccionado] = useState<DiaSemanaPrograma>("lunes");
  const [moverBusy, setMoverBusy] = useState(false);
  const [moverMsg, setMoverMsg] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [quitarBusy, setQuitarBusy] = useState(false);
  const [quitarMsg, setQuitarMsg] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [corrFecha, setCorrFecha] = useState(() => isoDateLocal(new Date()));
  const [corrMotivo, setCorrMotivo] = useState("");
  const [corrBusy, setCorrBusy] = useState(false);
  const [corrMsg, setCorrMsg] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setDestProgramaDocId(programaDocSeleccionActual);
    setDestDiaSeleccionado(estado.slot.dia);
    setMoverMsg(null);
    setMoverBusy(false);
    setQuitarMsg(null);
    setQuitarBusy(false);
    setCorrMsg(null);
    setCorrMotivo("");
    setCorrBusy(false);
  }, [estado, programaDocSeleccionActual]);

  const avisoDocId = estado.aviso.avisoFirestoreId?.trim() || undefined;
  const { aviso: avisoFb, loading: avisoFbLoading } = useAvisoLive(avisoDocId, viewerUid);

  const { aviso, slot } = estado;
  /** Misma entidad que la OT del CTA: si ya existe, no ofrecer alta duplicada. */
  const ordenServicioExistenteId =
    avisoFb?.work_order_id?.trim() ||
    aviso.workOrderId?.trim() ||
    avisoFb?.ultima_ejecucion_ot_id?.trim() ||
    undefined;
  const buscarOtPorAvisoCerrado =
    avisoFb?.estado === "CERRADO" && !ordenServicioExistenteId && !avisoFbLoading;
  const centrosBusquedaOt = useMemo(() => {
    const c = avisoFb?.centro?.trim();
    return c ? [c] : [];
  }, [avisoFb?.centro]);
  const { workOrderId: otIdPorBusqueda, loading: otBusquedaLoading } = useWorkOrderIdPorAvisoBusqueda({
    avisoDocId,
    avisoNumero: aviso.numero,
    centros: centrosBusquedaOt,
    buscarEnTodasLasPlantas: centrosBusquedaOt.length === 0,
    enabled: buscarOtPorAvisoCerrado,
  });
  const ordenServicioIdEfectiva = ordenServicioExistenteId || otIdPorBusqueda;
  const avisoCerradoImportacionSinOt =
    avisoFb?.estado === "CERRADO" &&
    !avisoFb?.ultima_ejecucion_ot_id?.trim() &&
    !ordenServicioIdEfectiva &&
    !avisoFbLoading &&
    !otBusquedaLoading;
  const { workOrder: woVinculada, loading: woVinculadaLoading } = useWorkOrderLive(ordenServicioIdEfectiva);
  const puedeCorregirFechaRealizacion =
    esSuperadmin && woVinculada?.estado === "CERRADA" && Boolean(ordenServicioIdEfectiva?.trim());

  useEffect(() => {
    if (woVinculada) setCorrFecha(fechaFinEjecucionIsoDesdeWo(woVinculada));
  }, [woVinculada?.id, woVinculada?.fecha_fin_ejecucion]);

  const antecesor = avisoFb?.antecesor_orden_abierta;
  const antecesorWoId = antecesor?.work_order_id?.trim() || undefined;
  const { workOrder: woAntecesor, loading: woAntecesorLoading } = useWorkOrderLive(antecesorWoId);
  const antecesorSigueBloqueando =
    Boolean(antecesorWoId) &&
    !woAntecesorLoading &&
    woAntecesor != null &&
    woAntecesor.archivada !== true &&
    woAntecesor.estado !== "CERRADA" &&
    woAntecesor.estado !== "ANULADA";
  /** El slot publicado puede quedar desactualizado; si tenemos el aviso en vivo, confiamos en Firestore. */
  const ordenPreviaPendienteEfectiva =
    avisoDocId && !avisoFbLoading && (!antecesorWoId || !woAntecesorLoading)
      ? antecesorSigueBloqueando
      : Boolean(aviso.ordenPreviaPendiente);

  const equipoDisplay =
    aviso.equipoCodigo?.trim() || avisoFb?.asset_id?.trim() || "—";
  const ubicacionDisplay =
    aviso.ubicacion?.trim() || avisoFb?.ubicacion_tecnica?.trim() || "—";

  const etiquetaAbrirOtVinculada = (() => {
    if (woVinculadaLoading) return "Comprobando orden…";
    const st = woVinculada?.estado;
    if (st === "CERRADA" || st === "ANULADA") return "Ver orden";
    if (st === "EN_EJECUCION" || st === "PENDIENTE_FIRMA_SOLICITANTE" || st === "LISTA_PARA_CIERRE") {
      return "Continuar trabajo";
    }
    return "Abrir orden de trabajo";
  })();

  async function onSubmitReprogramar(e: FormEvent) {
    e.preventDefault();
    setMoverMsg(null);
    setMoverBusy(true);
    try {
      const tok = await getClientIdToken();
      if (!tok) {
        setMoverMsg({ tipo: "err", texto: "No hay sesión. Volvé a iniciar sesión." });
        setMoverBusy(false);
        return;
      }
      const res = await actionMoveAvisoEnProgramaPublicado(tok, {
        sourceProgramaDocId: estado.programaDocId.trim(),
        destProgramaDocId: destProgramaDocId.trim(),
        avisoNumero: estado.aviso.numero.trim(),
        avisoFirestoreId: estado.aviso.avisoFirestoreId?.trim() || undefined,
        destDia: destDiaSeleccionado,
        from: {
          localidad: localidadCeldaFirestoreParaServidor(estado.slot),
          dia: estado.slot.dia,
          especialidad: estado.slot.especialidad,
        },
      });
      if (!res.ok) {
        setMoverMsg({ tipo: "err", texto: res.error.message });
      } else {
        setMoverMsg({ tipo: "ok", texto: "Ubicación en el programa actualizada." });
        onClose();
      }
    } catch (err) {
      setMoverMsg({
        tipo: "err",
        texto: err instanceof Error ? err.message : "No se pudo reprogramar",
      });
    } finally {
      setMoverBusy(false);
    }
  }

  async function onQuitarDelProgramaSemanal() {
    if (
      !window.confirm(
        "¿Quitar esta tarea del programa semanal? El aviso de mantenimiento no se borra; solo deja de figurar en la grilla.",
      )
    ) {
      return;
    }
    setQuitarMsg(null);
    setQuitarBusy(true);
    try {
      const tok = await getClientIdToken();
      if (!tok) {
        setQuitarMsg({ tipo: "err", texto: "No hay sesión. Volvé a iniciar sesión." });
        return;
      }
      const res = await actionRemoveAvisoFromProgramaPublicado(tok, {
        programaDocId: estado.programaDocId.trim(),
        avisoNumero: estado.aviso.numero.trim(),
        avisoFirestoreId: estado.aviso.avisoFirestoreId?.trim() || undefined,
        workOrderId:
          ordenServicioIdEfectiva?.trim() ||
          estado.aviso.workOrderId?.trim() ||
          undefined,
        from: {
          localidad: localidadCeldaFirestoreParaServidor(estado.slot),
          dia: estado.slot.dia,
          especialidad: estado.slot.especialidad,
        },
      });
      if (!res.ok) {
        setQuitarMsg({ tipo: "err", texto: res.error.message });
        return;
      }
      setQuitarMsg({ tipo: "ok", texto: "Tarea quitada del programa semanal." });
      onClose();
    } catch (err) {
      setQuitarMsg({
        tipo: "err",
        texto: err instanceof Error ? err.message : "No se pudo quitar del programa",
      });
    } finally {
      setQuitarBusy(false);
    }
  }

  async function onSubmitCorregirFechaRealizacion(e: FormEvent) {
    e.preventDefault();
    if (!ordenServicioIdEfectiva?.trim()) return;
    setCorrMsg(null);
    setCorrBusy(true);
    try {
      const tok = await getClientIdToken();
      if (!tok) {
        setCorrMsg({ tipo: "err", texto: "No hay sesión. Volvé a iniciar sesión." });
        return;
      }
      const res = await actionCorrectWorkOrderFechaRealizacion(tok, {
        workOrderId: ordenServicioIdEfectiva.trim(),
        fechaEjecucion: corrFecha,
        motivo: corrMotivo,
      });
      if (!res.ok) {
        setCorrMsg({ tipo: "err", texto: res.error.message });
        return;
      }
      setCorrMsg({
        tipo: "ok",
        texto: "Fecha de realización actualizada. El cambio quedó en el historial de la OT.",
      });
      setCorrMotivo("");
    } catch (err) {
      setCorrMsg({
        tipo: "err",
        texto: err instanceof Error ? err.message : "No se pudo corregir la fecha",
      });
    } finally {
      setCorrBusy(false);
    }
  }

  async function onArchivarOrdenExistente() {
    if (!ordenServicioIdEfectiva) return;
    if (
      !window.confirm(
        "¿Archivar esta orden de trabajo? Dejará de mostrarse en listados y se desvincula del aviso en el programa.",
      )
    ) {
      return;
    }
    setArchiveMsg(null);
    setArchiveBusy(true);
    try {
      const tok = await getClientIdToken();
      if (!tok) {
        setArchiveMsg({ tipo: "err", texto: "No hay sesión. Volvé a iniciar sesión." });
        return;
      }
      const res = await actionArchiveWorkOrder(tok, {
        workOrderId: ordenServicioIdEfectiva.trim(),
        programa: {
          programaDocId: estado.programaDocId.trim(),
          localidad: localidadCeldaFirestoreParaServidor(estado.slot),
          dia: estado.slot.dia,
          especialidad: estado.slot.especialidad,
          avisoNumero: estado.aviso.numero.trim(),
          avisoFirestoreId: estado.aviso.avisoFirestoreId?.trim() || undefined,
        },
      });
      if (!res.ok) {
        setArchiveMsg({ tipo: "err", texto: res.error.message });
        return;
      }
      setArchiveMsg({ tipo: "ok", texto: "Orden archivada." });
      onClose();
    } catch (err) {
      setArchiveMsg({
        tipo: "err",
        texto: err instanceof Error ? err.message : "No se pudo archivar",
      });
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
        aria-label="Cerrar panel"
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md min-h-0 flex-col border-l border-border bg-background shadow-2xl",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aviso-drawer-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aviso</p>
            <h2 id="aviso-drawer-title" className="text-lg font-semibold leading-snug text-foreground">
              {aviso.descripcion?.trim() || "Sin descripción"}
            </h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">N.º {aviso.numero}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {etiquetaLocalidadSlot(slot.localidad, slot.denomUbicTecnica)} ·{" "}
              {etiquetaEspecialidadPrograma(slot.especialidad)} · {DIA_LABEL_LARGO[slot.dia]}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-4 px-4 py-4 text-sm">
          {!puedeCrearOt && ordenServicioIdEfectiva ? (
            <div className="space-y-2">
              <Button className="w-full min-h-11 font-semibold" asChild disabled={woVinculadaLoading}>
                <Link href={`/tareas/${encodeURIComponent(ordenServicioIdEfectiva)}`}>
                  {etiquetaAbrirOtVinculada}
                </Link>
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {woVinculada?.estado === "CERRADA" || woVinculada?.estado === "ANULADA"
                  ? "Esta orden ya está cerrada en el sistema."
                  : "Desde acá iniciás o continuás la planilla de la orden vinculada a este aviso."}
              </p>
            </div>
          ) : null}
          {ordenPreviaPendienteEfectiva ? (
            <div
              className="rounded-lg border border-amber-400/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
              role="alert"
            >
              <p className="font-semibold">Otra orden del mismo mantenimiento está en curso</p>
              <p className="mt-1 leading-relaxed">
                Este aviso es el número nuevo, pero el trabajo pendiente sigue en la orden anterior. Recomendamos
                terminarla antes de abrir o programar otra; el sistema las mantiene vinculadas.
              </p>
              {antecesorSigueBloqueando && antecesorWoId ? (
                <p className="mt-2">
                  <Link
                    href={`/tareas/${antecesorWoId}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    Ir a orden n.º {antecesor?.n_aviso || antecesor?.n_ot}
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Descripción</p>
            <p className="mt-1 leading-relaxed text-foreground">{aviso.descripcion}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Equipo</p>
              <p className="mt-1 font-mono text-foreground">{equipoDisplay}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ubicación</p>
              <p className="mt-1 text-foreground">{ubicacionDisplay}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={avisoVariant(aviso)}>
              {aviso.urgente ? "Urgente" : aviso.tipo === "correctivo" ? "Correctivo" : "Preventivo"}
            </Badge>
            {avisoFb?.estado === "CERRADO" && avisoFb?.ultima_ejecucion_ot_id?.trim() ? (
              <Badge
                variant="default"
                className="border border-emerald-600/40 bg-emerald-600/10 text-emerald-950 dark:text-emerald-100"
              >
                Aviso cerrado
              </Badge>
            ) : null}
          </div>
          {avisoCerradoImportacionSinOt ? (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-3 dark:border-amber-500/35 dark:bg-amber-500/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">
                Pendiente de planilla en Seam
              </p>
              <p className="mt-2 text-sm text-amber-950 dark:text-amber-50">
                Este correctivo tiene fecha en el maestro
                {avisoFb?.fecha_programada
                  ? ` (${formatFirestoreDate(avisoFb.fecha_programada, "dd/MM/yyyy")})`
                  : ""}
                , pero aún no tiene orden cerrada con firma en el sistema.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                Creá la OT, completá la planilla y cerrá con firma. Recién ahí figurará como finalizado en el
                programa.
              </p>
            </div>
          ) : null}
          </div>
        {puedeReprogramar && semanasOpciones.length > 0 ? (
          <form
            className="space-y-3 border-t border-border px-4 py-4"
            onSubmit={onSubmitReprogramar}
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cambiar día o semana en el programa
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                El aviso pasa a otra celda del programa. Podés elegir semanas futuras aunque el plan aún no esté
                publicado: al guardar se crea la semana destino si hacía falta.
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Semana destino
              <select
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal shadow-sm"
                value={destProgramaDocId}
                onChange={(e) => setDestProgramaDocId(e.target.value)}
                disabled={moverBusy}
              >
                {semanasOpciones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Día
              <select
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal shadow-sm"
                value={destDiaSeleccionado}
                onChange={(e) => setDestDiaSeleccionado(e.target.value as DiaSemanaPrograma)}
                disabled={moverBusy}
              >
                {DIAS_ORDEN.map((d) => (
                  <option key={d} value={d}>
                    {DIA_LABEL_LARGO[d]}
                  </option>
                ))}
              </select>
            </label>
            {moverMsg?.tipo === "err" ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {moverMsg.texto}
              </p>
            ) : null}
            <Button type="submit" variant="outline" className="w-full" disabled={moverBusy}>
              {moverBusy ? "Guardando…" : "Guardar nueva fecha en el programa"}
            </Button>
          </form>
        ) : null}
        {esSuperadmin ? (
          <div className="space-y-2 border-t border-border px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Quitar del programa
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Solo súper administrador. La tarea desaparece de la grilla semanal; el aviso en mantenimiento sigue
              existiendo y podés volver a programarlo más adelante.
            </p>
            {quitarMsg?.tipo === "err" ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {quitarMsg.texto}
              </p>
            ) : null}
            {quitarMsg?.tipo === "ok" ? (
              <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-900 dark:text-emerald-100">
                {quitarMsg.texto}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={quitarBusy || moverBusy || archiveBusy}
              onClick={() => void onQuitarDelProgramaSemanal()}
            >
              <Trash2 className="mr-2 h-4 w-4 shrink-0" aria-hidden />
              {quitarBusy ? "Quitando…" : "Quitar del programa semanal"}
            </Button>
          </div>
        ) : null}
        {puedeCorregirFechaRealizacion ? (
          <form
            className="space-y-3 border-t border-border px-4 py-4"
            onSubmit={onSubmitCorregirFechaRealizacion}
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Corregir fecha de realización
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Solo súper administrador. La OT está <strong className="text-foreground">cerrada</strong>: podés
                ajustar la fecha con la que figura en certificación y reportes (p. ej. abril en lugar de mayo). Queda
                registrado en el historial de movimientos de la OT.
              </p>
              {woVinculada?.fecha_fin_ejecucion ? (
                <p className="mt-2 text-sm text-foreground">
                  Fecha actual en sistema:{" "}
                  <span className="font-semibold">
                    {formatFirestoreDate(woVinculada.fecha_fin_ejecucion, "dd/MM/yyyy")}
                  </span>
                </p>
              ) : null}
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Nueva fecha de realización
              <Input
                type="date"
                required
                max={isoDateLocal(new Date())}
                value={corrFecha}
                onChange={(e) => setCorrFecha(e.target.value)}
                disabled={corrBusy}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Motivo del cambio (mín. 10 caracteres)
              <Textarea
                required
                minLength={10}
                rows={3}
                value={corrMotivo}
                onChange={(e) => setCorrMotivo(e.target.value)}
                disabled={corrBusy}
                placeholder="Ej.: Trabajo hecho en abril; se cargó en mayo para certificación."
              />
            </label>
            {corrMsg?.tipo === "err" ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {corrMsg.texto}
              </p>
            ) : null}
            {corrMsg?.tipo === "ok" ? (
              <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-900 dark:text-emerald-100">
                {corrMsg.texto}
              </p>
            ) : null}
            <Button type="submit" variant="outline" className="w-full" disabled={corrBusy}>
              {corrBusy ? "Guardando…" : "Guardar fecha de realización"}
            </Button>
          </form>
        ) : esSuperadmin && ordenServicioIdEfectiva && woVinculadaLoading ? (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Comprobando estado de la orden…
          </p>
        ) : null}
        {puedeCrearOt && esSuperadmin && ordenServicioIdEfectiva ? (
          <div className="space-y-2 border-t border-border px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Archivo</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Solo súper administrador. La OT deja de verse en el sistema operativo diario.
            </p>
            {archiveMsg?.tipo === "err" ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {archiveMsg.texto}
              </p>
            ) : null}
            {archiveMsg?.tipo === "ok" ? (
              <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-900 dark:text-emerald-100">
                {archiveMsg.texto}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={archiveBusy}
              onClick={() => void onArchivarOrdenExistente()}
            >
              {archiveBusy ? "Archivando…" : "Archivar OT"}
            </Button>
          </div>
        ) : null}
        {puedeCrearOt ? (
          <div className="space-y-2 border-t border-border p-4">
            {ordenServicioIdEfectiva ? (
              <>
                <Button className="w-full" asChild>
                  <Link href={`/tareas/${encodeURIComponent(ordenServicioIdEfectiva)}`}>
                    Abrir OT
                  </Link>
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Este aviso ya tiene una OT en el sistema.
                  {puedeCorregirFechaRealizacion
                    ? " Para corregir la fecha de realización, usá el formulario de arriba en este panel."
                    : woVinculada?.estado === "CERRADA" && !esSuperadmin
                      ? ""
                      : esSuperadmin && woVinculada?.estado !== "CERRADA" && woVinculada
                        ? " La corrección de fecha de realización solo aplica cuando la OT está cerrada."
                        : ""}
                </p>
              </>
            ) : avisoDocId && (avisoFbLoading || otBusquedaLoading) ? (
              <Button className="w-full" type="button" disabled>
                Comprobando si ya hay orden…
              </Button>
            ) : (
              <>
                {avisoCerradoImportacionSinOt ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Importación anterior lo marcó cerrado sin OT. Usá el botón de abajo para iniciar el circuito
                    completo (planilla + firma).
                  </p>
                ) : null}
                <Button className="w-full" asChild>
                  <Link href={`/tareas/nueva?avisoId=${encodeURIComponent(aviso.numero)}`}>
                    + Crear OT
                  </Link>
                </Button>
              </>
            )}
          </div>
        ) : null}
        </div>
      </aside>
    </>
  );
}

export function ProgramaClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const vistaOperativo = searchParams.get("vista") === "operativo";
  const vistaOperativaActiva = vistaOperativo && PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA;

  const { user, profile, loading: authLoading } = useAuth();
  const { puede, rol } = usePermisos();
  const esCliente = rol === "cliente_arauco";
  const esRolTecnico = rol === "tecnico";
  const centrosPerfil = useMemo(() => centrosEfectivosDelUsuario(profile), [profile]);
  const esTecnicoMultiCentro = esRolTecnico && centrosPerfil.length > 1;
  const especialidadesProgramaTecnico = useMemo((): EspecialidadPrograma[] => {
    if (!esRolTecnico) return [];
    return especialidadesProgramaVisiblesTecnico(profile?.especialidades);
  }, [esRolTecnico, profile?.especialidades]);
  const filtroVistaTecnico = useMemo(
    () =>
      esRolTecnico && especialidadesProgramaTecnico.length
        ? { especialidadesPrograma: especialidadesProgramaTecnico }
        : undefined,
    [esRolTecnico, especialidadesProgramaTecnico],
  );
  const perfilCentro = (profile?.centro?.trim() || DEFAULT_CENTRO).trim();
  const viewerSuperadmin = isSuperAdminRole(profile?.rol);
  /** Selector «Planta / Todas las plantas» en programa publicado (lectura multi-planta). */
  const viewerEligeAlcanceMultiPlanta =
    viewerSuperadmin || esCliente || rol === "admin" || rol === "supervisor";
  const centroParam = searchParams.get("centro")?.trim() ?? "";

  const centroDesdeUrl = useMemo(() => {
    if (esTecnicoMultiCentro) {
      if (centroParam && centrosPerfil.includes(centroParam)) return centroParam;
      if (centrosPerfil.includes(perfilCentro)) return perfilCentro;
      return centrosPerfil[0] ?? perfilCentro;
    }
    if (!viewerEligeAlcanceMultiPlanta) return perfilCentro;
    if (centroParam === CENTRO_SELECTOR_TODAS_PLANTAS) return CENTRO_SELECTOR_TODAS_PLANTAS;
    if (centroParam && isCentroInKnownList(centroParam)) return centroParam;
    return CENTRO_SELECTOR_TODAS_PLANTAS;
  }, [esTecnicoMultiCentro, centrosPerfil, perfilCentro, centroParam, viewerEligeAlcanceMultiPlanta]);

  const [centroSelectorOptimista, setCentroSelectorOptimista] = useState<string | null>(null);

  const centroEfectivo = useMemo(
    () => centroSelectorOptimista ?? centroDesdeUrl,
    [centroSelectorOptimista, centroDesdeUrl],
  );

  const vistaTodasPlantas = centroEfectivo === CENTRO_SELECTOR_TODAS_PLANTAS;

  useEffect(() => {
    if (centroSelectorOptimista !== null && centroDesdeUrl === centroSelectorOptimista) {
      setCentroSelectorOptimista(null);
    }
  }, [centroSelectorOptimista, centroDesdeUrl]);

  /** Default explícito en URL para roles multi-planta (evita heredar `?centro=PC01` implícito). */
  useEffect(() => {
    if (authLoading) return;
    if (esTecnicoMultiCentro) {
      if (centroParam && centrosPerfil.includes(centroParam)) return;
      const p = new URLSearchParams(searchParams.toString());
      const def = centrosPerfil.includes(perfilCentro) ? perfilCentro : (centrosPerfil[0] ?? perfilCentro);
      p.set("centro", def);
      const q = p.toString();
      void router.replace(q ? `/programa?${q}` : "/programa", { scroll: false });
      return;
    }
    if (!viewerEligeAlcanceMultiPlanta) return;
    if (centroParam) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set("centro", CENTRO_SELECTOR_TODAS_PLANTAS);
    const q = p.toString();
    void router.replace(q ? `/programa?${q}` : "/programa", { scroll: false });
  }, [authLoading, esTecnicoMultiCentro, centrosPerfil, perfilCentro, centroParam, viewerEligeAlcanceMultiPlanta, router, searchParams]);

  const onCentroProgramaChange = useCallback(
    (nextCentro: string) => {
      const centroValido = esTecnicoMultiCentro
        ? centrosPerfil.includes(nextCentro)
          ? nextCentro
          : (centrosPerfil.includes(perfilCentro) ? perfilCentro : (centrosPerfil[0] ?? perfilCentro))
        : nextCentro === CENTRO_SELECTOR_TODAS_PLANTAS
          ? CENTRO_SELECTOR_TODAS_PLANTAS
          : isCentroInKnownList(nextCentro)
            ? nextCentro
            : CENTRO_SELECTOR_TODAS_PLANTAS;

      setCentroSelectorOptimista(centroValido);
      setSemanaIdElegida(null);

      const p = new URLSearchParams(searchParams.toString());
      p.set("centro", centroValido);

      const semNorm = normalizarSemanaParamAlCambiarCentro(p.get("semana"), centroValido);
      if (semNorm) p.set("semana", semNorm);

      p.delete("vista");
      const q = p.toString();
      void router.replace(q ? `/programa?${q}` : "/programa", { scroll: false });
    },
    [esTecnicoMultiCentro, centrosPerfil, perfilCentro, router, searchParams],
  );

  const puedeLeerMotorPropuestasEnSemanas = tienePermiso(
    (profile?.rol as Rol) ?? "tecnico",
    "ot:ver_todas",
  );

  const opcionesSemanasDisponibles = useMemo(
    () => ({
      incluirOtProgramadasSemana: true as const,
      incluirPropuestasMotorSemana: puedeLeerMotorPropuestasEnSemanas,
      ...(esRolTecnico && profile?.especialidades?.length
        ? { otSemanasSoloEspecialidades: especialidadesOtSemanasTecnico(profile.especialidades) }
        : {}),
    }),
    [esRolTecnico, profile?.especialidades, puedeLeerMotorPropuestasEnSemanas],
  );

  const [drawer, setDrawer] = useState<DrawerState>(null);
  const drawerCentroParaSemanas = useMemo(() => {
    if (!vistaTodasPlantas) return undefined;
    const pid = drawer?.programaDocId?.trim();
    if (!pid) return undefined;
    const c = centroDesdeProgramaDocId(pid);
    return c && isCentroInKnownList(c) ? c : undefined;
  }, [vistaTodasPlantas, drawer]);

  const { semanas: semanasSingle, loading: semanasLoadingSingle, error: semanasErrorSingle } = useSemanasDisponibles(
    vistaTodasPlantas ? undefined : centroEfectivo,
    user?.uid,
    opcionesSemanasDisponibles,
  );

  const { semanas: semanasTodas, loading: semanasLoadingTodas, error: semanasErrorTodas } = useSemanasDisponiblesTodas(
    vistaTodasPlantas ? user?.uid : undefined,
    opcionesSemanasDisponibles,
  );

  const { semanas: semanasDrawerAlcance } = useSemanasDisponibles(
    drawerCentroParaSemanas,
    user?.uid,
    opcionesSemanasDisponibles,
  );

  const semanasLoading = vistaTodasPlantas ? semanasLoadingTodas : semanasLoadingSingle;
  const semanasError = vistaTodasPlantas ? semanasErrorTodas : semanasErrorSingle;
  const semanasActivas = vistaTodasPlantas ? semanasTodas : semanasSingle;

  /** Selector: siempre incluye la semana ISO del calendario (hoy), aunque no haya plan publicado aún. */
  const semanasParaSelectorMerged = useMemo((): MergedSemanaOpcion[] => {
    const hoyIso = semanaIsoHoy();
    return semanasSelectorConHoyOrdenadas(
      semanasTodas,
      hoyIso,
      { iso: hoyIso, label: semanaLabelDesdeIso(hoyIso), programaDocIdPorCentro: {} },
      (s) => s.iso,
    );
  }, [semanasTodas]);

  const semanasParaSelectorSingle = useMemo((): SemanaOpcion[] => {
    const hoyIso = semanaIsoHoy();
    const c = centroEfectivo.trim();
    if (!c || c === CENTRO_SELECTOR_TODAS_PLANTAS || !isCentroInKnownList(c)) return semanasSingle;
    return semanasSelectorConHoyOrdenadas(
      semanasSingle,
      hoyIso,
      { id: propuestaSemanaDocId(c, hoyIso), label: semanaLabelDesdeIso(hoyIso) },
      (s) => parseIsoWeekIdFromSemanaParam(s.id) ?? s.id,
    );
  }, [semanasSingle, centroEfectivo]);

  const semanasParaReprogramarDrawer = useMemo(() => {
    if (vistaTodasPlantas) {
      const c = drawerCentroParaSemanas;
      if (!c) return [];
      return semanasOpcionesReprogramarAviso(c, semanasDrawerAlcance, SEMANAS_REPROGRAMAR_HORIZONTE_ADELANTE);
    }
    const c = centroEfectivo.trim();
    if (!c || c === CENTRO_SELECTOR_TODAS_PLANTAS) return semanasSingle;
    return semanasOpcionesReprogramarAviso(c, semanasSingle, SEMANAS_REPROGRAMAR_HORIZONTE_ADELANTE);
  }, [vistaTodasPlantas, drawerCentroParaSemanas, semanasDrawerAlcance, centroEfectivo, semanasSingle]);

  const [semanaIdElegida, setSemanaIdElegida] = useState<string | null>(null);
  const urlSemana = searchParams.get("semana")?.trim() ?? null;
  const [filtroEsp, setFiltroEsp] = useState<FiltroEspecialidad>("todos");
  const [filtroDia, setFiltroDia] = useState<FiltroDia>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [filtroEstadoOperativo, setFiltroEstadoOperativo] = useState<FiltroEstadoOperativo>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [localidadTab, setLocalidadTab] = useState<string | null>(null);

  const semanaId = useMemo(() => {
    if (vistaTodasPlantas) {
      if (semanaIdElegida && semanasTodas.some((s) => s.iso === semanaIdElegida)) return semanaIdElegida;
      return resolverSemanaIsoTodasPlantas(semanasTodas, urlSemana);
    }
    const c = centroEfectivo.trim();
    if (!c || c === CENTRO_SELECTOR_TODAS_PLANTAS) return "";
    if (semanaIdElegida && semanasSingle.some((s) => s.id === semanaIdElegida)) return semanaIdElegida;
    return resolverSemanaDocIdPlanta(c, semanasSingle, urlSemana);
  }, [vistaTodasPlantas, semanasTodas, semanasSingle, semanaIdElegida, urlSemana, centroEfectivo]);

  const semanaIso = useMemo(
    () => (semanaId ? parseIsoWeekIdFromSemanaParam(semanaId) : null),
    [semanaId],
  );

  useEffect(() => {
    if (!semanasActivas.length || !urlSemana) return;
    if (vistaTodasPlantas) {
      const id = idIsoDesdeParamSemanaTodas(semanasTodas, urlSemana);
      if (id) setSemanaIdElegida(id);
      return;
    }
    const id = idDocumentoDesdeParamSemana(semanasSingle, urlSemana);
    if (id) setSemanaIdElegida(id);
  }, [semanasActivas.length, urlSemana, vistaTodasPlantas, semanasTodas, semanasSingle]);

  /** Cambiar planta (URL o selector) invalida semana elegida en memoria. */
  useEffect(() => {
    setSemanaIdElegida(null);
  }, [centroDesdeUrl]);

  const onCentroSuperadminChange = useCallback(
    (nextCentro: string) => {
      onCentroProgramaChange(nextCentro);
    },
    [onCentroProgramaChange],
  );

  /**
   * Si la URL trae ?semana= incompatible con la planta (p. ej. PC01_* con PF01), calcula el reemplazo una sola vez.
   */
  const semanaUrlReemplazo = useMemo(() => {
    if (!semanasActivas.length || !urlSemana) return null;
    if (vistaTodasPlantas) {
      const ok =
        semanasTodas.some((s) => s.iso === urlSemana) ||
        semanasTodas.some((s) => Object.values(s.programaDocIdPorCentro).includes(urlSemana));
      if (ok) return null;
      const resolved = idIsoDesdeParamSemanaTodas(semanasTodas, urlSemana);
      if (!resolved || resolved === urlSemana) return null;
      return resolved;
    }
    if (semanasSingle.some((s) => s.id === urlSemana)) return null;
    const resolved = resolverSemanaDocIdPlanta(centroEfectivo, semanasSingle, urlSemana);
    if (!resolved || resolved === urlSemana) return null;
    return resolved;
  }, [semanasActivas.length, urlSemana, vistaTodasPlantas, centroEfectivo, semanasTodas, semanasSingle]);

  useEffect(() => {
    if (!semanaUrlReemplazo) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set("semana", semanaUrlReemplazo);
    const q = p.toString();
    void router.replace(q ? `/programa?${q}` : "/programa", { scroll: false });
  }, [semanaUrlReemplazo, router, searchParams]);

  const hrefProgramaPublicada = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("vista");
    if (semanaId) p.set("semana", semanaId);
    const q = p.toString();
    return q ? `/programa?${q}` : "/programa";
  }, [searchParams, semanaId]);

  const hrefProgramaOperativa = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("vista", "operativo");
    if (semanaId) p.set("semana", semanaId);
    return `/programa?${p.toString()}`;
  }, [searchParams, semanaId]);

  const setVistaPublicada = useCallback(() => {
    router.replace(hrefProgramaPublicada);
  }, [router, hrefProgramaPublicada]);

  const setVistaOperativa = useCallback(() => {
    router.replace(hrefProgramaOperativa);
  }, [router, hrefProgramaOperativa]);

  const irProgramaPublicada = useCallback(() => {
    void router.push(hrefProgramaPublicada, { scroll: false });
  }, [router, hrefProgramaPublicada]);

  const irProgramaOperativa = useCallback(() => {
    void router.push(hrefProgramaOperativa, { scroll: false });
  }, [router, hrefProgramaOperativa]);

  useEffect(() => {
    if (PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA) return;
    if (searchParams.get("vista") !== "operativo") return;
    void router.replace(hrefProgramaPublicada);
  }, [searchParams, router, hrefProgramaPublicada]);

  const onSemanaPublicaChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      setSemanaIdElegida(v);
      const p = new URLSearchParams(searchParams.toString());
      p.set("semana", v);
      p.delete("vista");
      const q = p.toString();
      void router.replace(q ? `/programa?${q}` : "/programa", { scroll: false });
    },
    [router, searchParams],
  );

  const docIdsFusion = useMemo(() => {
    if (!vistaTodasPlantas || !semanaId) return undefined;
    const row = semanasTodas.find((s) => s.iso === semanaId);
    if (!row) return undefined;
    return KNOWN_CENTROS.map((c) => row.programaDocIdPorCentro[c]).filter((id): id is string => Boolean(id?.trim()));
  }, [vistaTodasPlantas, semanaId, semanasTodas]);

  const { programa: programaFusion, loading: programaLoadingFusion, error: programaErrorFusion } =
    useProgramaSemanaFusion(docIdsFusion, semanaId || undefined, vistaTodasPlantas ? user?.uid : undefined);

  const { programa: programaSingle, loading: programaLoadingSingle, error: programaErrorSingle } = useProgramaSemana(
    !vistaTodasPlantas ? semanaId || undefined : undefined,
    user?.uid,
  );

  const programa = vistaTodasPlantas ? programaFusion : programaSingle;
  const programaLoading = vistaTodasPlantas ? programaLoadingFusion : programaLoadingSingle;
  const programaError = vistaTodasPlantas ? programaErrorFusion : programaErrorSingle;

  /** Grilla sólo si el doc publicado coincide con la planta elegida (evita datos cruzados por id heredado de otra lista). */
  const programaParaGrilla = useMemo(() => {
    if (!programa) return null;
    if (vistaTodasPlantas) return programa;
    const dc = programa.centro?.trim();
    if (dc && dc !== centroEfectivo) return null;
    return programa;
  }, [programa, centroEfectivo, vistaTodasPlantas]);

  const crossWeekBusquedaSeqRef = useRef(0);

  /** Si el aviso no está en la semana visible, busca en todas las publicadas y salta a la semana correcta. */
  useEffect(() => {
    const q = busqueda.trim();
    if (!busquedaProgramaListaParaCrossWeek(q)) return;
    if (!user?.uid) return;
    if (programaLoading) return;

    const centroBusqueda =
      !vistaTodasPlantas &&
      centroEfectivo.trim() &&
      centroEfectivo !== CENTRO_SELECTOR_TODAS_PLANTAS &&
      isCentroInKnownList(centroEfectivo)
        ? centroEfectivo.trim()
        : undefined;

    if (!vistaTodasPlantas && !centroBusqueda) return;
    if (semanaActualTieneCoincidenciaBusqueda(programaParaGrilla, q)) return;

    const seq = ++crossWeekBusquedaSeqRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const tok = await getClientIdToken();
          if (!tok || seq !== crossWeekBusquedaSeqRef.current) return;
          const res = await actionSearchAvisoEnProgramaSemanal(tok, {
            query: q,
            ...(centroBusqueda ? { centro: centroBusqueda } : {}),
          });
          if (seq !== crossWeekBusquedaSeqRef.current) return;
          if (!res.ok || !res.data.length) return;

          const hit = res.data[0]!;
          if (semanaIso && hit.isoSemana === semanaIso) return;

          if (vistaTodasPlantas) {
            if (semanaId === hit.isoSemana) return;
            setSemanaIdElegida(hit.isoSemana);
            const p = new URLSearchParams(searchParams.toString());
            p.set("semana", hit.isoSemana);
            p.delete("vista");
            const qs = p.toString();
            void router.replace(qs ? `/programa?${qs}` : "/programa", { scroll: false });
            return;
          }

          const docDestino =
            (hit.programaDocId && semanasSingle.some((s) => s.id === hit.programaDocId)
              ? hit.programaDocId
              : null) ??
            idDocumentoDesdeParamSemana(semanasSingle, hit.isoSemana) ??
            (centroBusqueda ? propuestaSemanaDocId(centroBusqueda, hit.isoSemana) : hit.isoSemana);

          if (semanaId === docDestino) return;
          setSemanaIdElegida(docDestino);
          const p = new URLSearchParams(searchParams.toString());
          p.set("semana", docDestino);
          p.delete("vista");
          const qs = p.toString();
          void router.replace(qs ? `/programa?${qs}` : "/programa", { scroll: false });
        } catch {
          /* búsqueda auxiliar: fallo silencioso */
        }
      })();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    busqueda,
    user?.uid,
    programaLoading,
    programaParaGrilla,
    vistaTodasPlantas,
    centroEfectivo,
    semanaIso,
    semanaId,
    semanasSingle,
    searchParams,
    router,
  ]);

  const avisoFirestoreIdsParaSyncWo = useMemo(() => {
    if (!programaParaGrilla?.slots?.length) return [];
    const s = new Set<string>();
    for (const slot of programaParaGrilla.slots) {
      for (const a of slot.avisos ?? []) {
        const id = a.avisoFirestoreId?.trim();
        if (id) s.add(id);
      }
    }
    return [...s];
  }, [programaParaGrilla]);

  const { workOrderIdPorAvisoDocId, antecesorWorkOrderIdPorAvisoDocId } =
    useAvisosWorkOrderIdsByDocIds(avisoFirestoreIdsParaSyncWo);

  const idsOrdenServicioParaEstados = useMemo(() => {
    const s = new Set<string>();
    for (const w of workOrderIdPorAvisoDocId.values()) {
      const t = w?.trim();
      if (t) s.add(t);
    }
    for (const w of antecesorWorkOrderIdPorAvisoDocId.values()) {
      const t = w?.trim();
      if (t) s.add(t);
    }
    if (programaParaGrilla?.slots) {
      for (const slot of programaParaGrilla.slots) {
        for (const a of slot.avisos ?? []) {
          const w = a.workOrderId?.trim();
          if (w) s.add(w);
        }
      }
    }
    return [...s];
  }, [programaParaGrilla, workOrderIdPorAvisoDocId, antecesorWorkOrderIdPorAvisoDocId]);

  const { estados: estadosServicioPorId, archivadaPorId, loading: loadingEstadosServicio } =
    useWorkOrderEstadosForIds(idsOrdenServicioParaEstados);

  const docCentroDesalineado = Boolean(
    !vistaTodasPlantas &&
      programa?.centro?.trim() &&
      programa.centro.trim() !== centroEfectivo,
  );

  // Propuesta: solo usada para saber si hay ítems pendientes de aprobación
  const propuestaIdBanner =
    !vistaTodasPlantas && semanaIso && isCentroInKnownList(centroEfectivo)
      ? propuestaSemanaDocId(centroEfectivo, semanaIso)
      : undefined;
  const { propuesta: propuestaBanner } = usePropuestaMotorSemana(propuestaIdBanner, user?.uid);
  const tienePendientesPropuesta = (propuestaBanner?.items ?? []).some((i) => i.status === "propuesta");
  const horasPropuestaSinVista = useMemo(() => {
    const gen = propuestaBanner?.generada_en as { toMillis?: () => number } | undefined;
    const ms = gen && typeof gen.toMillis === "function" ? gen.toMillis() : 0;
    if (!ms) return 0;
    return (Date.now() - ms) / 3_600_000;
  }, [propuestaBanner?.generada_en]);
  const alertaPropuestaSinRevision =
    Boolean(propuestaBanner?.status === "pendiente_aprobacion") &&
    !propuestaBanner?.propuesta_vista_supervisor_at &&
    horasPropuestaSinVista >= HORAS_ALERTA_PROPUESTA_SIN_VISTA &&
    tienePendientesPropuesta;

  const slotsVisibles = useMemo(
    () =>
      slotsFiltrados(
        programaParaGrilla,
        filtroEsp,
        filtroDia,
        filtroTipo,
        filtroEstadoOperativo,
        workOrderIdPorAvisoDocId,
        estadosServicioPorId,
        loadingEstadosServicio,
        filtroVistaTecnico,
        busqueda,
      ),
    [
      programaParaGrilla,
      filtroEsp,
      filtroDia,
      filtroTipo,
      filtroEstadoOperativo,
      workOrderIdPorAvisoDocId,
      estadosServicioPorId,
      loadingEstadosServicio,
      filtroVistaTecnico,
      busqueda,
    ],
  );

  const grid = useMemo(
    () =>
      celdasPorLocalidad(
        slotsVisibles,
        filtroTipo,
        filtroEstadoOperativo,
        workOrderIdPorAvisoDocId,
        estadosServicioPorId,
        loadingEstadosServicio,
        filtroVistaTecnico,
        busqueda,
      ),
    [
      slotsVisibles,
      filtroTipo,
      filtroEstadoOperativo,
      workOrderIdPorAvisoDocId,
      estadosServicioPorId,
      loadingEstadosServicio,
      filtroVistaTecnico,
      busqueda,
    ],
  );

  const localidades = useMemo(() => Array.from(grid.keys()).sort((a, b) => a.localeCompare(b, "es")), [grid]);

  const localidadMobile = useMemo(() => {
    if (!localidades.length) return "";
    if (localidadTab && localidades.includes(localidadTab)) return localidadTab;
    return localidades[0]!;
  }, [localidades, localidadTab]);

  const diasColumnas = useMemo(
    () => (filtroDia === "todos" ? DIAS_ORDEN : [filtroDia]),
    [filtroDia],
  );

  const puedeCrearOt = puede("programa:crear_ot");
  const puedePlanOperativo = puede("programa:crear_ot") || puede("programa:editar");
  const puedeMoverEnProgramaPublicado =
    !esCliente &&
    !vistaTodasPlantas &&
    (puede("programa:crear_ot") || puede("programa:editar"));
  const puedeReprogramarAvisoEnDrawer = useMemo(() => {
    if (esCliente) return false;
    if (!puede("programa:crear_ot") && !puede("programa:editar")) return false;
    if (!vistaTodasPlantas) return puedeMoverEnProgramaPublicado;
    const pid = drawer?.programaDocId?.trim();
    if (!pid) return false;
    const c = centroDesdeProgramaDocId(pid);
    if (!c || !isCentroInKnownList(c)) return false;
    if (viewerSuperadmin) return true;
    return usuarioTieneCentro(profile, c);
  }, [
    esCliente,
    puede,
    vistaTodasPlantas,
    puedeMoverEnProgramaPublicado,
    drawer,
    viewerSuperadmin,
    profile,
  ]);
  const puedeImportarMaestroAvisos = puede("admin:cargar_programa") || puede("admin:gestionar_usuarios");

  useEffect(() => {
    if (vistaOperativo && (esCliente || !puedePlanOperativo)) setVistaPublicada();
  }, [esCliente, vistaOperativo, puedePlanOperativo, setVistaPublicada]);

  const cerrarDrawer = useCallback(() => setDrawer(null), []);

  const [exportandoExcel, setExportandoExcel] = useState(false);
  const onExportarExcel = useCallback(async () => {
    if (!programaParaGrilla || exportandoExcel) return;
    setExportandoExcel(true);
    try {
      await exportarProgramaSemanalExcel(programaParaGrilla);
    } finally {
      setExportandoExcel(false);
    }
  }, [programaParaGrilla, exportandoExcel]);

  const [dndBusy, setDndBusy] = useState(false);
  const [dndFlashMsg, setDndFlashMsg] = useState<string | null>(null);
  const [payloadArrastrePrograma, setPayloadArrastrePrograma] = useState<ProgramaAvisoDragPayload | null>(null);

  useEffect(() => {
    setPayloadArrastrePrograma(null);
  }, [programaParaGrilla?.id]);

  const ejecutarDropAvisoEnCelda = useCallback(
    async (
      e: DragEvent<HTMLElement>,
      celdaLoc: string,
      celdaDia: DiaSemanaPrograma,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      if (!puedeMoverEnProgramaPublicado || !programaParaGrilla?.id) return;

      const raw = e.dataTransfer?.getData(MIME_PROGRAMA_AVISO_DRAG);
      if (!raw) return;

      let parsed: ProgramaAvisoDragPayload;
      try {
        parsed = JSON.parse(raw) as ProgramaAvisoDragPayload;
      } catch {
        return;
      }
      if (parsed.v !== 1 || parsed.programaDocId !== programaParaGrilla.id) return;

      if (normLocalidadGrid(celdaLoc) !== normLocalidadGrid(parsed.localidad)) {
        setDndFlashMsg(
          "Este aviso solo se puede mover a otro día en la misma fila de localidad. Soltalo en esa fila.",
        );
        window.setTimeout(() => setDndFlashMsg(null), 5000);
        return;
      }
      if (parsed.fromDia === celdaDia) return;

      setDndBusy(true);
      setDndFlashMsg(null);
      try {
        const tok = await getClientIdToken();
        if (!tok) {
          setDndFlashMsg("Sesión caducada. Volvé a iniciar sesión.");
          window.setTimeout(() => setDndFlashMsg(null), 4500);
          return;
        }
        const res = await actionMoveAvisoEnProgramaPublicado(tok, {
          sourceProgramaDocId: programaParaGrilla.id,
          destProgramaDocId: programaParaGrilla.id,
          avisoNumero: parsed.avisoNumero.trim(),
          avisoFirestoreId: parsed.avisoFirestoreId?.trim(),
          destDia: celdaDia,
          from: {
            localidad: parsed.localidad,
            dia: parsed.fromDia,
            especialidad: parsed.especialidad,
          },
        });
        if (!res.ok) {
          setDndFlashMsg(res.error.message);
          window.setTimeout(() => setDndFlashMsg(null), 6000);
        }
      } catch (err) {
        setDndFlashMsg(err instanceof Error ? err.message : "No se pudo mover el aviso");
        window.setTimeout(() => setDndFlashMsg(null), 6000);
      } finally {
        setDndBusy(false);
        setPayloadArrastrePrograma(null);
      }
    },
    [programaParaGrilla, puedeMoverEnProgramaPublicado],
  );

  const tablaLoading = authLoading || semanasLoading || (Boolean(semanaId) && programaLoading);

  if (authLoading) {
    return <p className="text-sm text-muted-foreground">Cargando sesión…</p>;
  }

  if (vistaOperativaActiva && !esCliente && puedePlanOperativo) {
    return (
      <div className="space-y-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">Programa semanal — edición</h1>
                <HelpIconTooltip
                  variant="info"
                  className="mt-1.5"
                  ariaLabel="Qué hace la vista de edición del programa"
                  panelClassName="right-0 left-auto w-[min(28rem,calc(100vw-2.5rem))]"
                >
                  <div className="block space-y-2 text-left">
                    <p>
                      Acá <strong>armás</strong> la semana ISO: asignás a cada día <strong>OTs que ya
                      existen</strong> en el sistema. No es el Excel de preventivos: ese maestro va a{" "}
                      <strong>Administración → Configuración e importación</strong>.
                    </p>
                    <p>
                      <strong>Programa publicado</strong> (la otra pestaña) es la tabla que ve la cuadrilla: avisos por
                      día, con filtros.
                    </p>
                  </div>
                </HelpIconTooltip>
              </div>
              {viewerSuperadmin ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {vistaTodasPlantas
                    ? "Con Todas las plantas, el calendario de abajo sigue siendo del centro de tu perfil. Para editar u publicar en otro sitio, elegí una planta en el selector."
                    : "Usá Planta para armar la semana en el centro que corresponda (no tiene que ser solo el de tu perfil)."}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Esta vista usa el centro de tu perfil.
                  {esRolTecnico
                    ? esTecnicoMultiCentro
                      ? " Elegí la planta arriba; ves el programa de tu especialidad (asignadas a vos o sin asignar), incluidas las completadas."
                      : " Ves el programa de tu especialidad (asignadas a vos o sin asignar), incluidas las completadas, en cualquier semana del selector."
                    : null}
                </p>
              )}
            </div>
            {viewerEligeAlcanceMultiPlanta ? (
              <SelectorPlantaSuperadmin value={centroEfectivo} onChange={onCentroSuperadminChange} />
            ) : esTecnicoMultiCentro ? (
              <SelectorPlantaTecnico
                value={centroEfectivo}
                centros={centrosPerfil}
                onChange={onCentroProgramaChange}
              />
            ) : null}
          </div>
          <SelectorVistaPrograma
            vistaOperativa={vistaOperativo}
            onElegirPublicada={irProgramaPublicada}
            onElegirOperativa={irProgramaOperativa}
            superadmin={viewerSuperadmin}
            mostrarPestañaOperativa={PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA}
          />
          <div
            className="rounded-lg border border-border bg-muted/35 px-4 py-3 text-sm leading-relaxed"
            role="note"
          >
            <p className="font-medium text-foreground">
              Acá agendás OTs que ya existen — no se generan desde un Excel
            </p>
            <p className="mt-1.5 text-muted-foreground">
              El <strong className="text-foreground">motor diario</strong> propone automáticamente las tareas{" "}
              <strong className="text-foreground">vencidas, críticas o próximas a vencer</strong>. Un supervisor las aprueba
              en <strong className="text-foreground">Aprobación del motor</strong> y recién ahí se crean las órdenes de
              servicio. El resto
              del calendario lo armás vos manualmente abajo. La tabla que ve la planta está en{" "}
              <strong className="text-foreground">Programa publicado</strong>. El{" "}
              <strong className="text-foreground">maestro de preventivos</strong> (Excel tipo AVISOS_PREVENTIVOS) va en{" "}
              {puedeImportarMaestroAvisos ? (
                <Link
                  href="/superadmin/configuracion"
                  className="font-semibold text-primary underline underline-offset-2"
                >
                  Administración → Configuración e importación
                </Link>
              ) : (
                <span className="font-medium text-foreground">Administración → Configuración e importación</span>
              )}
              .
            </p>
            <details className="mt-3 rounded-md border border-border/80 bg-background/60 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-foreground">
                Cómo funciona el flujo completo (planificadores)
              </summary>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Maestro preventivos:</strong> importar el Excel en{" "}
                  {puedeImportarMaestroAvisos ? (
                    <Link href="/superadmin/configuracion" className="font-medium text-primary underline underline-offset-2">
                      Administración → Configuración e importación
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">Administración → Configuración e importación</span>
                  )}
                  .
                </li>
                <li>
                  <strong className="text-foreground">Motor diario:</strong> cada noche propone las tareas vencidas,
                  críticas o próximas a vencer. El supervisor las aprueba en{" "}
                  <strong className="text-foreground">Aprobación del motor</strong> y se crean las OTs
                  automáticamente.
                </li>
                <li>
                  <strong className="text-foreground">Órdenes manuales:</strong> para tareas fuera del ciclo del motor,
                  creá la OT desde{" "}
                  <Link href="/tareas" className="font-medium text-primary underline underline-offset-2">
                    Tareas
                  </Link>
                  {" "}y luego la agendás abajo.
                </li>
                <li>
                  <strong className="text-foreground">Calendario semanal:</strong> asigná cada OT a un día
                  (y turno si aplica) y guardá en la semana ISO.
                </li>
                <li>
                  <strong className="text-foreground">Consulta en planta:</strong> la grilla pública es la pestaña{" "}
                  <strong className="text-foreground">Programa publicado</strong>.
                </li>
              </ol>
            </details>
          </div>
        </header>
        <ProgramaSemanalClient
          key={semanaIso ? `ed-${semanaIso}` : "ed-cargando"}
          embedded
          centroTrabajo={vistaTodasPlantas ? perfilCentro : centroEfectivo}
          initialWeekId={semanaIso ?? undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex flex-1 items-start gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight">Programa de la semana</h1>
              {viewerEligeAlcanceMultiPlanta ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {vistaTodasPlantas
                    ? "Varias plantas en una sola tabla: cada fila empieza con el código de planta. Para arrastrar entre días, elegí una planta sola; desde el panel del aviso podés cambiar semana o día para la planta de ese aviso si tenés permiso."
                    : "Planta, semana y filtros de la grilla están en la barra de abajo."}
                </p>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">
                  Esta vista muestra el programa del centro de tu perfil. Semana y filtros de la grilla están en la barra
                  de abajo.
                  {esRolTecnico ? (
                    <>
                      {" "}
                      Ves órdenes de tu especialidad (asignadas a vos o sin asignar), incluidas las completadas. Cambiá la semana arriba
                      para organizarte en el tiempo.
                      <HelpIconTooltip
                        variant="info"
                        className="ml-0.5 align-text-bottom"
                        ariaLabel="Qué tareas veo en el programa como técnico"
                        panelClassName="right-0 left-auto w-[min(24rem,calc(100vw-2.5rem))]"
                      >
                        <div className="block space-y-2 text-left">
                          <p>
                            La grilla muestra el <strong>programa publicado</strong> filtrado por la{" "}
                            <strong>especialidad de tu perfil</strong> y chips con una{" "}
                            <strong>orden de trabajo</strong> que podés leer (la tuya o del pool sin asignar),{" "}
                            <strong>incluidas las cerradas</strong>.
                          </p>
                          <p className="text-muted-foreground">
                            Usá el selector de <strong>semana</strong> para ver otras semanas. Las anuladas o asignadas a
                            otro operario no aparecen acá; el detalle completo está en <strong>Tareas</strong>.
                          </p>
                        </div>
                      </HelpIconTooltip>
                    </>
                  ) : null}
                </div>
              )}
            </div>
            <HelpIconTooltip
              variant="info"
              ariaLabel="Información: qué es el programa de la semana y cómo se actualiza"
              panelClassName="right-0 left-auto w-[min(28rem,calc(100vw-2.5rem))]"
            >
              <div className="block space-y-2 text-left">
                <p>
                  {vistaTodasPlantas && viewerEligeAlcanceMultiPlanta ? (
                    <>
                      <strong>Programa de la semana</strong> en modo <strong>Todas las plantas</strong> junta en una
                      tabla los planes <strong>ya publicados</strong> de cada centro que tenga datos para la semana ISO
                      elegida. Sirve para comparar cargas entre sitios. El <strong>maestro</strong> de avisos (Excel en
                      Configuración e importación) es independiente de esta vista.
                    </>
                  ) : viewerEligeAlcanceMultiPlanta ? (
                    <>
                      <strong>Programa de la semana</strong> es el <strong>plan ya publicado</strong> del centro que
                      elegís en <strong>Planta</strong>: avisos por día en la grilla. Es la referencia de campo; el{" "}
                      <strong>maestro</strong> se importa aparte en Configuración e importación.
                    </>
                  ) : (
                    <>
                      <strong>Programa de la semana</strong> es el <strong>plan ya publicado</strong> de tu planta:
                      avisos por día en la grilla. Es la referencia de campo; el <strong>maestro</strong> de avisos se
                      importa en Configuración e importación y no reemplaza publicar el programa acá.
                    </>
                  )}
                </p>
                <p className="text-muted-foreground">
                  {vistaTodasPlantas && viewerEligeAlcanceMultiPlanta ? (
                    <>
                      En modo <strong>Todas las plantas</strong>, cada fila de la grilla corresponde a una localidad
                      (el dato lleva el <strong>código de planta</strong> para no mezclar sitios). En esta vista no podés{" "}
                      <strong>arrastrar</strong> ni usar <strong>Reprogramar</strong> en el panel: para eso elegí{" "}
                      <strong>una planta</strong> en el selector.
                    </>
                  ) : viewerEligeAlcanceMultiPlanta ? (
                    <>
                      El texto del aviso puede incluir otros códigos (equipo, ubicación…); la tabla sigue siendo solo del
                      centro que elegís en <strong>Planta</strong>.
                    </>
                  ) : (
                    <>
                      El texto del aviso puede incluir otros códigos (equipo, ubicación…); la tabla es siempre del centro
                      de tu perfil.
                    </>
                  )}
                </p>
                <p>
                  Los <strong>filtros</strong> incluyen <strong>planta</strong> (cuando corresponda al rol),{" "}
                  <strong>semana</strong> y las opciones que acotan la tabla: especialidad, día, tipo y{" "}
                  <strong>estado operativo</strong> (etapas del chip y la opción <strong>orden previa SAP</strong>, mismo
                  criterio que el aro rojo en la leyenda de abajo).
                </p>
                <p className="text-muted-foreground">
                  Si no hay semanas en el listado, aún no hubo <strong>publicación</strong> del plan ni{" "}
                  <strong>aprobación</strong> de propuesta con grilla. Quien planifique usa{" "}
                  {PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? (
                    <>
                      <strong>Editar esta semana</strong> o{" "}
                    </>
                  ) : null}
                  <strong>Revisar y aprobar</strong> cuando el motor deje propuestas.
                </p>
              </div>
            </HelpIconTooltip>
          </div>
        </div>
        {!esCliente && puedePlanOperativo ? (
          <>
            <SelectorVistaPrograma
              vistaOperativa={false}
              onElegirPublicada={irProgramaPublicada}
              onElegirOperativa={irProgramaOperativa}
              superadmin={viewerSuperadmin}
              mostrarPestañaOperativa={PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA}
            />
          </>
        ) : null}
      </header>

      {!esCliente ? <ProgramaSeccionNav vistaActual="grilla" /> : null}

      {puedeCrearOt && !esCliente && tienePendientesPropuesta ? (
        <div
          className={
            alertaPropuestaSinRevision
              ? "rounded-xl border border-red-400/70 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-950 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-100"
              : "rounded-xl border border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          }
          role="status"
        >
          {alertaPropuestaSinRevision ? (
            <>
              <span className="font-semibold">Atención:</span> la propuesta del motor lleva más de{" "}
              {HORAS_ALERTA_PROPUESTA_SIN_VISTA} h sin que un supervisor abra la pantalla de aprobación. Revisala cuanto
              antes —{" "}
            </>
          ) : (
            <>Hay ítems pendientes de aprobación para esta semana — </>
          )}
          <Link
            href={
              semanaIso
                ? `/programa/aprobacion?semana=${encodeURIComponent(semanaIso)}&centro=${encodeURIComponent(centroEfectivo)}`
                : `/programa/aprobacion?centro=${encodeURIComponent(centroEfectivo)}`
            }
            className="font-semibold underline underline-offset-2"
          >
            Revisar y aprobar →
          </Link>
        </div>
      ) : null}

      {semanasError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          <p className="font-medium">No se pudieron cargar las semanas publicadas</p>
          <p className="mt-1">{mensajeErrorFirebaseParaUsuario(semanasError)}</p>
          {(semanasError as { code?: string }).code === "permission-denied" ? (
            <p className="mt-2 text-foreground">
              Suele faltar permiso de lectura o un perfil incompleto en el proyecto. Si tenés acceso de administración,
              comprobá reglas de Firestore y el documento de usuario. Detalle técnico: colección{" "}
              <span className="font-mono">programa_semanal</span> y perfil en{" "}
              <span className="font-mono">users</span>.
              {!esCliente && puedePlanOperativo ? (
                PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? (
                  <>
                    {" "}
                    Igual podés entrar a{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline underline-offset-2"
                      onClick={irProgramaOperativa}
                    >
                      Editar esta semana
                    </button>{" "}
                    para trabajar con el calendario operativo.
                  </>
                ) : (
                  <>
                    {" "}
                    Si tenés permisos de supervisión, revisá el flujo de <strong>Revisar y aprobar</strong> o la
                    publicación del plan en <span className="font-mono">programa_semanal</span>.
                  </>
                )
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
      {programaError ? (
        <p className="text-sm text-destructive" role="alert">
          No se pudo cargar el programa: {programaError.message}
        </p>
      ) : null}

      {docCentroDesalineado ? (
        <div
          className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">Plan de otra planta</p>
          <p className="mt-1 leading-relaxed">
            El programa cargado está asociado a{" "}
            <strong className="text-foreground">{nombreCentro(programa!.centro)}</strong> y no coincide con la planta
            seleccionada (
            <strong className="text-foreground">
              {centroEfectivo === CENTRO_SELECTOR_TODAS_PLANTAS
                ? "Todas las plantas"
                : nombreCentro(centroEfectivo)}
            </strong>
            ). La URL puede haber guardado una semana de otra planta: elegí una semana de nuevo o tocá otro día en
            «Semana». Si sigue igual, revisá en Firestore el campo <span className="font-mono">centro</span> del
            documento.
          </p>
        </div>
      ) : null}

      <section className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[7rem] items-center gap-1.5 self-end pb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Filtros</span>
          <HelpIconTooltip
            variant="info"
            ariaLabel="Cómo funcionan los filtros de la grilla"
            panelClassName="right-0 left-auto w-[min(26rem,calc(100vw-2.5rem))] sm:left-0 sm:right-auto"
          >
            <div className="block space-y-2 text-left normal-case">
              <p>
                <strong>Planta</strong> y <strong>Semana</strong> eligen qué programa cargar; el resto acota qué filas y
                chips ves en la tabla. La <strong>búsqueda</strong> filtra por número de aviso o texto libre y, si no
                está en la semana visible, busca en <strong>todas las semanas publicadas</strong> y salta a la que
                corresponda (descripción, equipo, ubicación, fila de localidad). <strong>Especialidad</strong>,{" "}
                <strong>día</strong> y <strong>tipo</strong> filtran la grilla; <strong>estado operativo</strong> incluye
                las etapas de la leyenda
                (colores del chip) y la
                opción <strong>orden previa (SAP)</strong>: solo avisos con el aro rojo (nuevo aviso mientras sigue{" "}
                <strong>abierta</strong> una orden del mismo mantenimiento). Para{" "}
                <strong>arrastrar una tarea a otro día</strong> (mantené apretada la tarjeta y soltala en la columna del
                día), necesitás ver todos los días: dejá <strong>Día</strong> en «Todos».
              </p>
              {vistaTodasPlantas ? (
                <p className="text-muted-foreground">
                  Con <strong>Todas las plantas</strong>, los filtros aplican a la tabla completa (todos los centros
                  mostrados).
                </p>
              ) : null}
            </div>
          </HelpIconTooltip>
        </div>
        {viewerEligeAlcanceMultiPlanta ? (
          <SelectorPlantaSuperadmin value={centroEfectivo} onChange={onCentroSuperadminChange} />
        ) : esTecnicoMultiCentro ? (
          <SelectorPlantaTecnico
            value={centroEfectivo}
            centros={centrosPerfil}
            onChange={onCentroProgramaChange}
          />
        ) : null}
        <label className="flex min-w-[12rem] max-w-md flex-[1.5] flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Búsqueda
          <span className="relative block">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-9 pl-7 text-sm font-normal normal-case"
              placeholder="N.º de aviso o palabras — busca en todas las semanas…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Buscar avisos en el programa por número o texto en cualquier semana publicada"
            />
          </span>
        </label>
        <label className="flex min-w-[min(100%,14rem)] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            Semana
            <HelpIconTooltip
              variant="info"
              ariaLabel="Qué semanas aparecen en el listado"
              panelClassName="right-0 left-auto w-[min(24rem,calc(100vw-2.5rem))]"
            >
              <div className="block space-y-2 text-left">
                <p>
                  {vistaTodasPlantas ? (
                    <>
                      Aparece cada <strong>semana ISO</strong> en la que <strong>al menos una</strong> planta de la lista
                      ya tiene <strong>programa publicado</strong>. Al elegirla, la grilla suma los avisos de todas las
                      que tengan documento para esa semana (las que no publicaron aún no aportan filas).
                    </>
                  ) : (
                    <>
                      Solo listamos <strong>semanas ISO</strong> (p. ej. 2026-W17) que ya tienen{" "}
                      <strong>programa publicado</strong> para el centro del selector <strong>Planta</strong> (o el centro
                      de tu perfil si no ves ese selector).
                    </>
                  )}
                </p>
                <p className="text-muted-foreground">
                  Importar el maestro en Excel <strong>no</strong> crea solo la semana acá: hace falta{" "}
                  <strong>publicar</strong> el calendario o <strong>aprobar</strong> la propuesta del motor. Si falta una
                  semana, corresponde a quien planifique completar ese flujo.
                </p>
              </div>
            </HelpIconTooltip>
          </span>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
            value={semanaId}
            onChange={onSemanaPublicaChange}
            disabled={semanasLoading}
          >
            {!(vistaTodasPlantas ? semanasParaSelectorMerged : semanasParaSelectorSingle).length ? (
              <option value="">— Sin semanas —</option>
            ) : null}
            {vistaTodasPlantas
              ? semanasParaSelectorMerged.map((s) => (
                  <option key={s.iso} value={s.iso}>
                    {s.label}
                  </option>
                ))
              : semanasParaSelectorSingle.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Especialidad
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal capitalize text-foreground shadow-sm"
            value={filtroEsp}
            onChange={(e) => setFiltroEsp(e.target.value as FiltroEspecialidad)}
          >
            {esRolTecnico ? (
              <>
                <option value="todos">Todas (mi perfil)</option>
                {ESPECIALIDADES_PROGRAMA_FILTRO.filter((e) => especialidadesProgramaTecnico.includes(e)).map((e) => (
                  <option key={e} value={e}>
                    {etiquetaEspecialidadPrograma(e)}
                  </option>
                ))}
              </>
            ) : (
              <>
                <option value="todos">Todos</option>
                {ESPECIALIDADES_PROGRAMA_FILTRO.map((e) => (
                  <option key={e} value={e}>
                    {etiquetaEspecialidadPrograma(e)}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Día
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
            value={filtroDia}
            onChange={(e) => setFiltroDia(e.target.value as FiltroDia)}
          >
            <option value="todos">Todos</option>
            {DIAS_ORDEN.map((d) => (
              <option key={d} value={d}>
                {DIA_LABEL_LARGO[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tipo
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)}
          >
            <option value="todos">Todos</option>
            <option value="correctivo">Correctivo</option>
            <option value="urgente">Urgente</option>
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-[1.25] flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Estado operativo
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground shadow-sm"
            value={filtroEstadoOperativo}
            onChange={(e) => setFiltroEstadoOperativo(e.target.value as FiltroEstadoOperativo)}
          >
            <option value="todos">Todos</option>
            <option value="orden_previa_pendiente">Solo avisos con orden previa por cerrar (SAP nuevo)</option>
            <option value="sin_orden">Solo aviso en plan · sin orden vinculada</option>
            <option value="abierta_borrador">Orden abierta o borrador</option>
            <option value="en_ejecucion">En ejecución</option>
            <option value="pendiente_firma">Realizado · pendiente firma del solicitante</option>
            <option value="listo_cierre">Listo para cierre formal</option>
            <option value="cerrada">Terminado · cerrada en sistema</option>
            <option value="anulada">Anulada</option>
          </select>
        </label>
      </section>

      {programaParaGrilla ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exportandoExcel}
            onClick={onExportarExcel}
            className="gap-2 text-xs"
          >
            {exportandoExcel ? "Generando…" : "Exportar Excel"}
          </Button>
        </div>
      ) : null}

      {puedeMoverEnProgramaPublicado && filtroDia !== "todos" ? (
        <p className="rounded-lg border border-amber-200/60 bg-amber-50/50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
          Para <strong>mover tareas entre días</strong>, dejá el filtro <strong>Día</strong> en «Todos» (columnas Lun–Dom),
          mantené apretada una tarjeta y soltala en la columna del día destino (misma fila de localidad).
        </p>
      ) : null}
      {dndFlashMsg ? (
        <p
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="status"
        >
          {dndFlashMsg}
        </p>
      ) : null}

      {!semanasActivas.length && !semanasLoading ? (
        <Card>
          <CardContent className="space-y-4 pt-6 text-sm">
            <div>
              <p className="font-medium text-foreground">No hay semanas para mostrar acá todavía</p>
              <p className="mt-1.5 leading-relaxed text-muted-foreground">
                El selector muestra cualquier semana ISO donde haya al menos uno de estos datos para tu centro:{" "}
                <strong className="text-foreground">plan publicado</strong> (<span className="font-mono text-xs">programa_semanal</span>
                ), <strong className="text-foreground">OT con fecha programada</strong> dentro de una
                ventana de ~dos años atrás / un año adelante, o (solo roles con acceso de supervisión al motor){" "}
                <strong className="text-foreground">propuesta semanal generada por el motor</strong>. Solo el maestro
                importado en Administración <strong>no</strong> aparece hasta que exista trabajo en ese calendario.
              </p>
            </div>
            {!esCliente && puedePlanOperativo ? (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-3 text-muted-foreground">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground">Próximo paso</p>
                <p className="mt-2 leading-relaxed">
                  {PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? (
                    <>
                      Entrá a{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-2"
                        onClick={irProgramaOperativa}
                      >
                        Editar esta semana
                      </button>{" "}
                      y asigná <span className="font-medium text-foreground">OTs</span> a cada día; cuando se
                      publique el plan, la semana va a figurar en el selector de esta pantalla.
                    </>
                  ) : (
                    <>
                      Publicá el plan o aprobá la propuesta del motor en{" "}
                      <Link
                        href={
                          semanaIso
                            ? `/programa/aprobacion?semana=${encodeURIComponent(semanaIso)}&centro=${encodeURIComponent(centroEfectivo)}`
                            : `/programa/aprobacion?centro=${encodeURIComponent(centroEfectivo)}`
                        }
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Revisar y aprobar
                      </Link>
                      ; cuando exista <span className="font-mono">programa_semanal</span>, la semana va a figurar acá.
                    </>
                  )}
                </p>
              </div>
            ) : !esCliente ? (
              <p className="rounded-lg border border-border bg-muted/15 px-3 py-3 text-sm leading-relaxed text-muted-foreground">
                Cuando haya un plan publicado para tu centro, las semanas van a aparecer en el selector. Si falta, pedí a
                supervisión o administración que publiquen el calendario o revisen el flujo de aprobación.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {semanaId && !programaLoading && !programa ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {puedePlanOperativo
                ? PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA
                  ? "La semana figura en el selector, pero la grilla de consulta está vacía. Podés completarla desde Editar esta semana o el flujo de publicación."
                  : "La semana figura en el selector, pero la grilla de consulta está vacía. Completá el plan con el flujo de publicación o Revisar y aprobar."
                : "La semana figura en el selector, pero no hay datos publicados en la grilla. Si corresponde, pedí a supervisión o administración que publiquen el plan."}
            </p>
            {puedePlanOperativo && PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? (
              <Button variant="outline" type="button" onClick={irProgramaOperativa}>
                Ir al editor del plan
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tablaLoading ? (
        <p className="text-sm text-muted-foreground">Cargando grilla…</p>
      ) : programaParaGrilla && localidades.length ? (
        <>
          {/* Móvil: una localidad + días en columnas */}
          <div className="md:hidden space-y-3">
            <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
              {localidades.map((loc) => (
                <Button
                  key={loc}
                  type="button"
                  size="sm"
                  variant={localidadMobile === loc ? "default" : "secondary"}
                  className="max-w-[min(100%,14rem)] shrink-0 truncate rounded-full"
                  title={
                    loc !== etiquetaLocalidadEnPrograma(loc, programaParaGrilla?.slots) ? loc : undefined
                  }
                  onClick={() => setLocalidadTab(loc)}
                >
                  {etiquetaLocalidadEnPrograma(loc, programaParaGrilla?.slots)}
                </Button>
              ))}
            </div>
            {localidadMobile ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table
                  className="w-full min-w-[20rem] border-collapse text-sm"
                  aria-label="Programa semanal: avisos por día (vista móvil)"
                >
                  <thead>
                    <tr className="border-b border-border bg-foreground/[0.03]">
                      <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Día</th>
                      <th className="px-2 py-2 text-left font-semibold text-foreground">Avisos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diasColumnas.map((d) => {
                      const celdas = grid.get(localidadMobile)?.get(d) ?? [];
                      return (
                        <tr key={d} className="border-b border-border last:border-0">
                          <td className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">
                            {DIA_LABEL_LARGO[d]}
                          </td>
                          <td
                            className={cn("px-2 py-2 align-top", dndBusy && "pointer-events-none opacity-70")}
                            onDragOver={
                              puedeMoverEnProgramaPublicado
                                ? (ev) => {
                                    ev.preventDefault();
                                    ev.dataTransfer.dropEffect = "move";
                                  }
                                : undefined
                            }
                            onDrop={
                              puedeMoverEnProgramaPublicado
                                ? (ev) => void ejecutarDropAvisoEnCelda(ev, localidadMobile, d)
                                : undefined
                            }
                          >
                            <div className="flex flex-wrap gap-1">
                              {celdas.map((c, i) => {
                                const docIdChip = c.programaDocId ?? programaParaGrilla.id;
                                const ordenIdEfectiva = ordenServicioIdEfectivaEnPrograma(
                                  c.aviso,
                                  workOrderIdPorAvisoDocId,
                                );
                                const ordenPreviaChip = ordenPreviaPendienteEfectivaEnChip(
                                  c.aviso,
                                  antecesorWorkOrderIdPorAvisoDocId,
                                  estadosServicioPorId,
                                  archivadaPorId,
                                  loadingEstadosServicio,
                                );
                                return (
                                  <ProgramaChipAvisoConArrastre
                                    key={`${c.aviso.numero}-${i}`}
                                    programaDocId={docIdChip}
                                    loc={localidadMobile}
                                    diaCol={d}
                                    c={c}
                                    ordenServicioIdEfectiva={ordenIdEfectiva}
                                    ordenPreviaPendienteEfectiva={ordenPreviaChip}
                                    {...chipEstadoServicioProps(
                                      ordenIdEfectiva,
                                      estadosServicioPorId,
                                      loadingEstadosServicio,
                                    )}
                                    puedeArrastrar={Boolean(puedeMoverEnProgramaPublicado && docIdChip)}
                                    onDragPayloadStart={
                                      puedeMoverEnProgramaPublicado ? setPayloadArrastrePrograma : undefined
                                    }
                                    onDragPayloadEnd={
                                      puedeMoverEnProgramaPublicado ? () => setPayloadArrastrePrograma(null) : undefined
                                    }
                                    onAbrirDrawer={() => {
                                      const slot = encuentraSlotParaChip(
                                        programaParaGrilla,
                                        localidadMobile,
                                        d,
                                        c.especialidad,
                                        c.aviso.numero,
                                      );
                                      if (slot && docIdChip) {
                                        setDrawer({
                                          aviso: c.aviso,
                                          slot,
                                          programaDocId: docIdChip,
                                        });
                                      }
                                    }}
                                    chipClassNameBoton="inline-block max-w-full cursor-pointer rounded-md border px-2 py-1 text-left text-xs font-medium leading-snug transition-opacity hover:opacity-90"
                                  />
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* Desktop: una columna por día; cada columna apila solo las localidades con avisos (sin huecos por otras filas). */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
            <div
              className="min-w-[32rem] text-sm"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${diasColumnas.length}, minmax(0, 1fr))`,
              }}
              aria-label="Programa semanal: días de la semana por fila de planificación"
            >
              {diasColumnas.map((d) => (
                <div
                  key={`head-${d}`}
                  className="border-b border-border bg-foreground/[0.03] px-2 py-2 text-center text-xs font-semibold text-muted-foreground sm:text-sm"
                >
                  {DIA_LABEL[d]}
                </div>
              ))}
              {diasColumnas.map((d, idx) => (
                <div
                  key={`col-${d}`}
                  className={cn(
                    "flex min-h-[2rem] min-w-0 flex-col gap-2 px-2 py-2",
                    idx < diasColumnas.length - 1 && "border-r border-border",
                    dndBusy && "pointer-events-none opacity-70",
                  )}
                >
                  {localidades.map((loc) => {
                    const celdas = grid.get(loc)?.get(d) ?? [];
                    const mostrarZonaVacia =
                      puedeMoverEnProgramaPublicado &&
                      Boolean(programaParaGrilla?.id) &&
                      payloadArrastrePrograma?.programaDocId === programaParaGrilla.id &&
                      normLocalidadGrid(payloadArrastrePrograma.localidad) === normLocalidadGrid(loc) &&
                      payloadArrastrePrograma.fromDia !== d &&
                      celdas.length === 0;
                    if (!celdas.length && !mostrarZonaVacia) return null;
                    return (
                      <div
                        key={`${loc}-${d}`}
                        className="flex flex-col gap-1"
                        onDragOver={
                          puedeMoverEnProgramaPublicado
                            ? (ev) => {
                                ev.preventDefault();
                                ev.dataTransfer.dropEffect = "move";
                              }
                            : undefined
                        }
                        onDrop={
                          puedeMoverEnProgramaPublicado
                            ? (ev) => void ejecutarDropAvisoEnCelda(ev, loc, d)
                            : undefined
                        }
                      >
                        {localidades.length > 1 && celdas.length > 0 ? (
                          <span
                            className="truncate text-[10px] font-medium leading-none text-muted-foreground"
                            title={loc !== etiquetaLocalidadEnPrograma(loc, programaParaGrilla?.slots) ? loc : undefined}
                          >
                            {etiquetaLocalidadEnPrograma(loc, programaParaGrilla?.slots)}
                          </span>
                        ) : null}
                        {mostrarZonaVacia ? (
                          <div className="flex min-h-9 items-center justify-center rounded-md border border-dashed border-border/90 bg-muted/25 px-1 text-center text-[10px] text-muted-foreground">
                            Soltá para mover acá
                          </div>
                        ) : null}
                        <div className="flex flex-col items-stretch gap-1">
                          {celdas.map((c, i) => {
                            const docIdChip = c.programaDocId ?? programaParaGrilla.id;
                            const ordenIdEfectiva = ordenServicioIdEfectivaEnPrograma(
                              c.aviso,
                              workOrderIdPorAvisoDocId,
                            );
                            const ordenPreviaChip = ordenPreviaPendienteEfectivaEnChip(
                              c.aviso,
                              antecesorWorkOrderIdPorAvisoDocId,
                              estadosServicioPorId,
                              archivadaPorId,
                              loadingEstadosServicio,
                            );
                            return (
                              <ProgramaChipAvisoConArrastre
                                key={`${c.aviso.numero}-${i}`}
                                programaDocId={docIdChip}
                                loc={loc}
                                diaCol={d}
                                c={c}
                                ordenServicioIdEfectiva={ordenIdEfectiva}
                                ordenPreviaPendienteEfectiva={ordenPreviaChip}
                                {...chipEstadoServicioProps(
                                  ordenIdEfectiva,
                                  estadosServicioPorId,
                                  loadingEstadosServicio,
                                )}
                                puedeArrastrar={Boolean(puedeMoverEnProgramaPublicado && docIdChip)}
                                onDragPayloadStart={
                                  puedeMoverEnProgramaPublicado ? setPayloadArrastrePrograma : undefined
                                }
                                onDragPayloadEnd={
                                  puedeMoverEnProgramaPublicado ? () => setPayloadArrastrePrograma(null) : undefined
                                }
                                onAbrirDrawer={() => {
                                  const slot = encuentraSlotParaChip(
                                    programaParaGrilla,
                                    loc,
                                    d,
                                    c.especialidad,
                                    c.aviso.numero,
                                  );
                                  if (slot && docIdChip) {
                                    setDrawer({
                                      aviso: c.aviso,
                                      slot,
                                      programaDocId: docIdChip,
                                    });
                                  }
                                }}
                                chipClassNameBoton="inline-block w-full max-w-none cursor-pointer rounded-md border px-1.5 py-1 text-left text-[11px] font-medium leading-snug sm:text-xs"
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : programaParaGrilla && !localidades.length ? (
        <p className="text-sm text-muted-foreground">
          {esRolTecnico
            ? busqueda.trim()
              ? "No hay órdenes de tu especialidad que coincidan con la búsqueda o los filtros. Probá otro término; la búsqueda revisa todas las semanas publicadas."
              : "No hay órdenes de tu especialidad en esta semana con los filtros seleccionados. Probá otra semana en el selector."
            : busqueda.trim()
              ? "No hay avisos que coincidan con la búsqueda o los filtros seleccionados (se buscó en todas las semanas publicadas)."
              : "No hay avisos con los filtros seleccionados."}
        </p>
      ) : null}

      {programaParaGrilla ? <LeyendaColoresProgramaSemanal /> : null}

      {drawer ? (
        <AvisoDrawer
          onClose={cerrarDrawer}
          estado={drawer}
          puedeCrearOt={puedeCrearOt}
          puedeReprogramar={puedeReprogramarAvisoEnDrawer}
          semanasOpciones={semanasParaReprogramarDrawer}
          programaDocSeleccionActual={drawer?.programaDocId ?? semanaId}
          viewerUid={user?.uid}
          esSuperadmin={viewerSuperadmin}
        />
      ) : null}
    </div>
  );
}
