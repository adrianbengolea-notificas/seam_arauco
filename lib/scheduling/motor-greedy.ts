import type {
  OtPropuestaFirestore,
  PlanMantenimientoFirestore,
  PropuestaSemanaFirestore,
} from "@/lib/firestore/plan-mantenimiento-types";
import type { ConfigMotorFirestore } from "@/modules/centros/types";
import type { Especialidad } from "@/modules/notices/types";
import type { WorkOrder } from "@/modules/work-orders/types";
import { Timestamp } from "firebase-admin/firestore";
import { addDays } from "date-fns";
import { randomUUID } from "node:crypto";

const DIA_TO_OFFSET: Record<string, number> = {
  lunes: 0,
  martes: 1,
  miercoles: 2,
  jueves: 3,
  viernes: 4,
  sabado: 5,
  domingo: 6,
};

function capPorEspecialidad(cfg: ConfigMotorFirestore, esp: Especialidad): number {
  if (esp === "AA") return Math.max(1, cfg.max_ots_por_dia_aire);
  if (esp === "ELECTRICO" || esp === "HG") return Math.max(1, cfg.max_ots_por_dia_electrico);
  return Math.max(1, cfg.max_ots_por_dia_gg);
}

const ISO_SEMANA_ID = /^\d{4}-W\d{2}$/;

/** Solo si `YYYY-Www` coincide con la semana en la que corre el motor. */
function coincideSemanaAsignadaConMotor(p: PlanMantenimientoFirestore, motorSemana: string): boolean {
  const s = typeof p.semana_asignada === "string" ? p.semana_asignada.trim() : "";
  return ISO_SEMANA_ID.test(s) && s === motorSemana;
}

/** Semana ISO `YYYY-Www` presente (asignación explícita en calendario anual). */
function tieneSemanaIsoAsignada(p: PlanMantenimientoFirestore): boolean {
  const s = typeof p.semana_asignada === "string" ? p.semana_asignada.trim() : "";
  return ISO_SEMANA_ID.test(s);
}

/**
 * Tiene una semana ISO asignada distinta del motor → se excluye del pool si no está vencido.
 */
function semanaPlaneadaDistintaAlMotor(p: PlanMantenimientoFirestore, motorSemana: string): boolean {
  const s = typeof p.semana_asignada === "string" ? p.semana_asignada.trim() : "";
  return ISO_SEMANA_ID.test(s) && s !== motorSemana;
}

function clasePrioridad(p: PlanMantenimientoFirestore): 1 | 2 | 3 | 4 {
  if (p.estado_vencimiento === "vencido" || p.nivel_riesgo_equipo === "critico") return 1;
  if (p.estado_vencimiento === "nunca_ejecutado") return 2;
  const d = p.dias_para_vencer;
  if (d != null && d <= 7) return 2;
  if (d != null && d <= 30) return 3;
  return 4;
}

/** Orden de urgencias B → C → D (menor = antes en el greedy). */
function subtierUrgencia(p: PlanMantenimientoFirestore): number {
  if (p.estado_vencimiento === "vencido") return 0;
  const sinSem = !tieneSemanaIsoAsignada(p);
  if (p.nivel_riesgo_equipo === "critico" && sinSem) return 1;
  const d = p.dias_para_vencer;
  if (d != null && d <= 7 && sinSem) return 2;
  return 9;
}

function origenPreventivo(
  p: PlanMantenimientoFirestore,
  motorSemana: string,
): NonNullable<OtPropuestaFirestore["origen"]> {
  if (coincideSemanaAsignadaConMotor(p, motorSemana)) return "planificado";
  return "urgencia";
}

/** Prioridad 1–3 que se persiste en el ítem preventivo. */
function prioridadItemPreventivo(p: PlanMantenimientoFirestore, motorSemana: string): 1 | 2 | 3 {
  if (coincideSemanaAsignadaConMotor(p, motorSemana)) {
    const pm = p.prioridad_motor;
    if (pm === 1 || pm === 2 || pm === 3) return pm;
    return 2;
  }
  return prioridadItem(clasePrioridad(p));
}

/** Clase para elegir día (lun/mar primero si urgencia máxima). */
function claseParaDias(p: PlanMantenimientoFirestore, motorSemana: string): 1 | 2 | 3 | 4 {
  if (coincideSemanaAsignadaConMotor(p, motorSemana)) {
    const pm = p.prioridad_motor ?? 2;
    return pm <= 1 ? 1 : 2;
  }
  return clasePrioridad(p);
}

function razonIncluida(p: PlanMantenimientoFirestore, motorSemana: string): string {
  if (coincideSemanaAsignadaConMotor(p, motorSemana)) return "Planificado por supervisor para esta semana";
  if (p.estado_vencimiento === "vencido") return "Aviso vencido — atención inmediata";
  const sinSem = !tieneSemanaIsoAsignada(p);
  if (p.nivel_riesgo_equipo === "critico" && sinSem) return "Equipo crítico sin semana asignada";
  const d = p.dias_para_vencer;
  if (d != null && d <= 7 && sinSem) return `Vence en ${d} días — sin semana asignada`;
  return "Incluido por motor";
}

function prioridadItem(pr: 1 | 2 | 3 | 4): 1 | 2 | 3 {
  if (pr === 1) return 1;
  if (pr === 2) return 2;
  return 3;
}

function diasOrdenados(
  pr: 1 | 2 | 3 | 4,
  diasHabiles: string[],
  preferenciaLocalidad: string | undefined,
  cargaPorDiaLoc: Map<string, Map<string, number>>,
  keyEsp: string,
): string[] {
  const base = diasHabiles.filter((d) => DIA_TO_OFFSET[d] !== undefined);
  const lunMarPrimero =
    pr === 1 ? [...base.filter((d) => d === "lunes" || d === "martes"), ...base.filter((d) => d !== "lunes" && d !== "martes")] : [...base];

  if (!preferenciaLocalidad) return lunMarPrimero;

  return [...lunMarPrimero].sort((a, b) => {
    const ca = cargaPorDiaLoc.get(a)?.get(keyEsp) ?? 0;
    const cb = cargaPorDiaLoc.get(b)?.get(keyEsp) ?? 0;
    if (ca !== cb) return cb - ca;
    return 0;
  });
}

function fechaDiaSemana(weekStart: Date, dia: string): Date {
  const off = DIA_TO_OFFSET[dia] ?? 0;
  const d = addDays(weekStart, off);
  d.setHours(8, 0, 0, 0);
  return d;
}

function tecnicoSugerido(
  esp: Especialidad,
  tecnicos: Array<{ uid: string; display_name: string; especialidades?: Especialidad[] }>,
): { id?: string; nombre?: string } {
  const match = tecnicos.find((t) => (t.especialidades ?? []).includes(esp));
  if (!match) return {};
  return { id: match.uid, nombre: match.display_name };
}

/** Firestore rechaza `undefined`; omitir campos opcionales si no hay técnico sugerido. */
function camposTecnicoSugerido(suger: { id?: string; nombre?: string }): {
  tecnico_sugerido_id?: string;
  tecnico_sugerido_nombre?: string;
} {
  const id = suger.id?.trim();
  if (!id) return {};
  return { tecnico_sugerido_id: id, tecnico_sugerido_nombre: suger.nombre?.trim() ?? "" };
}

export type MotorGreedyInput = {
  centro: string;
  semanaId: string;
  weekStart: Date;
  config: ConfigMotorFirestore;
  planes: PlanMantenimientoFirestore[];
  correctivos: WorkOrder[];
  tecnicos: Array<{ uid: string; display_name: string; especialidades?: Especialidad[] }>;
};

export type MotorGreedyOutput = Pick<PropuestaSemanaFirestore, "items" | "advertencias" | "metricas">;

export function buildPropuestaGreedyMotor(input: MotorGreedyInput): MotorGreedyOutput {
  const { config } = input;
  const diasHabiles = config.dias_habiles.length ? config.dias_habiles : Object.keys(DIA_TO_OFFSET);

  const motorSemana = input.semanaId.trim();

  const advertencias: string[] = [];

  for (const p of input.planes) {
    if (!coincideSemanaAsignadaConMotor(p, motorSemana)) continue;
    const pend = p.incluido_en_ot_pendiente;
    if (pend != null && String(pend).trim() !== "") {
      advertencias.push(`Plan #${p.numero} asignado a esta semana ya tiene OT pendiente — revisar.`);
    }
  }

  const pool = input.planes.filter((p) => {
    if (p.activo === false) return false;
    const pend = p.incluido_en_ot_pendiente;
    if (pend != null && String(pend).trim() !== "") return false;
    if (!p.asset_id?.trim()) return false;
    if (semanaPlaneadaDistintaAlMotor(p, motorSemana) && p.estado_vencimiento !== "vencido") {
      return false;
    }
    const sinSemIso = !tieneSemanaIsoAsignada(p);
    const condA = coincideSemanaAsignadaConMotor(p, motorSemana);
    const condB = p.estado_vencimiento === "vencido";
    const condC = p.nivel_riesgo_equipo === "critico" && sinSemIso;
    const d = p.dias_para_vencer;
    const condD = d != null && d <= 7 && sinSemIso;
    return condA || condB || condC || condD;
  });

  if (pool.length === 0) {
    advertencias.push(
      "No hay urgencias ni planes asignados a esta semana. Si esperabas ver tareas, asignalas desde el calendario anual en /programa/preventivos.",
    );
  }

  const sorted = [...pool].sort((a, b) => {
    const oa = origenPreventivo(a, motorSemana);
    const ob = origenPreventivo(b, motorSemana);
    const rank = (o: typeof oa) => (o === "urgencia" ? 0 : 1);
    const r = rank(oa) - rank(ob);
    if (r !== 0) return r;
    if (oa === "urgencia") {
      const sa = subtierUrgencia(a);
      const sb = subtierUrgencia(b);
      if (sa !== sb) return sa - sb;
      const pa = clasePrioridad(a);
      const pb = clasePrioridad(b);
      if (pa !== pb) return pa - pb;
      const da = a.dias_para_vencer ?? 9999;
      const db = b.dias_para_vencer ?? 9999;
      return da - db;
    }
    const pma = a.prioridad_motor ?? 2;
    const pmb = b.prioridad_motor ?? 2;
    if (pma !== pmb) return pma - pmb;
    const da = a.dias_para_vencer ?? 9999;
    const db = b.dias_para_vencer ?? 9999;
    return da - db;
  });

  const carga: Map<string, number> = new Map();
  const cargaLoc: Map<string, Map<string, number>> = new Map();
  const key = (dia: string, esp: Especialidad) => `${dia}|${esp}`;

  const capacity = (dia: string, esp: Especialidad) => {
    const k = key(dia, esp);
    const cur = carga.get(k) ?? 0;
    return Math.max(0, capPorEspecialidad(config, esp) - cur);
  };

  const items: OtPropuestaFirestore[] = [];
  let vencidosIncluidos = 0;
  let vencidosPostergados = 0;
  let planificadosIncluidos = 0;
  let urgenciasIncluidas = 0;
  const cargaEsp: Record<string, number> = { AA: 0, ELECTRICO: 0, GG: 0, HG: 0 };

  for (const p of sorted) {
    const prDia = claseParaDias(p, motorSemana);
    const espKey = `${p.localidad}|${p.especialidad}`;
    const diasTry = diasOrdenados(prDia, diasHabiles, config.agrupar_por_localidad ? p.localidad : undefined, cargaLoc, espKey);

    let placed = false;
    for (const dia of diasTry) {
      if (capacity(dia, p.especialidad) <= 0) continue;
      const suger = tecnicoSugerido(p.especialidad, input.tecnicos);
      const prioridadNum = prioridadItemPreventivo(p, motorSemana);
      const origen = origenPreventivo(p, motorSemana);
      const item: OtPropuestaFirestore = {
        id: randomUUID(),
        kind: "preventivo_plan",
        plan_id: p.id,
        numero: p.numero,
        descripcion: p.descripcion,
        especialidad: p.especialidad,
        localidad: p.localidad,
        duracion_estimada_min: p.duracion_estimada_min ?? 60,
        prioridad: prioridadNum,
        origen,
        razon_incluida: razonIncluida(p, motorSemana),
        ...camposTecnicoSugerido(suger),
        status: "propuesta",
        dia_semana: dia,
        fecha: Timestamp.fromDate(fechaDiaSemana(input.weekStart, dia)) as unknown as OtPropuestaFirestore["fecha"],
      };
      items.push(item);

      const k = key(dia, p.especialidad);
      carga.set(k, (carga.get(k) ?? 0) + 1);
      const byDia = cargaLoc.get(dia) ?? new Map<string, number>();
      byDia.set(espKey, (byDia.get(espKey) ?? 0) + 1);
      cargaLoc.set(dia, byDia);
      cargaEsp[p.especialidad] = (cargaEsp[p.especialidad] ?? 0) + 1;
      if (p.estado_vencimiento === "vencido") vencidosIncluidos++;
      if (origen === "planificado") planificadosIncluidos++;
      else urgenciasIncluidas++;
      placed = true;
      break;
    }
    if (!placed) {
      if (p.estado_vencimiento === "vencido") {
        vencidosPostergados++;
        advertencias.push(`Vencido #${p.numero} no entró por cupo diario (${p.especialidad}).`);
      }
    }
  }

  if (config.incluir_correctivos_en_propuesta && input.correctivos.length) {
    const diasUrg = diasHabiles.filter((d) => d === "lunes" || d === "martes");
    let i = 0;
    for (const wo of input.correctivos) {
      const dia = diasUrg[i % diasUrg.length]!;
      i++;
      const suger = tecnicoSugerido(wo.especialidad, input.tecnicos);
      const tecUid = wo.tecnico_asignado_uid?.trim() || suger.id?.trim();
      const tecNom = wo.tecnico_asignado_nombre?.trim() || suger.nombre?.trim() || "";
      items.push({
        id: randomUUID(),
        kind: "correctivo_existente",
        work_order_id: wo.id,
        numero: wo.aviso_numero ?? wo.n_ot,
        descripcion: wo.texto_trabajo.slice(0, 500),
        especialidad: wo.especialidad,
        localidad: wo.ubicacion_tecnica?.slice(0, 48) ?? "—",
        duracion_estimada_min: 60,
        prioridad: 1,
        razon_incluida: "Correctivo abierto — ubicar al inicio de semana",
        ...(tecUid ? { tecnico_sugerido_id: tecUid, tecnico_sugerido_nombre: tecNom } : {}),
        status: "propuesta",
        dia_semana: dia,
        fecha: Timestamp.fromDate(fechaDiaSemana(input.weekStart, dia)) as unknown as OtPropuestaFirestore["fecha"],
      });
    }
    if (input.correctivos.length) {
      advertencias.push(`${input.correctivos.length} correctivos incluidos en lunes/martes (revisar cupo real).`);
    }
  }

  return {
    items: items.sort((a, b) => a.prioridad - b.prioridad),
    advertencias,
    metricas: {
      total_ots_propuestas: items.length,
      vencidos_incluidos: vencidosIncluidos,
      vencidos_postergados: vencidosPostergados,
      planificados_incluidos: planificadosIncluidos,
      urgencias_incluidas: urgenciasIncluidas,
      carga_por_especialidad: cargaEsp,
    },
  };
}
