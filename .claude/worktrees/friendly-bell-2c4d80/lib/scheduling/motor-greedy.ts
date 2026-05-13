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

function clasePrioridad(p: PlanMantenimientoFirestore): 1 | 2 | 3 | 4 {
  if (p.estado_vencimiento === "vencido" || p.nivel_riesgo_equipo === "critico") return 1;
  if (p.estado_vencimiento === "nunca_ejecutado") return 2;
  const d = p.dias_para_vencer;
  if (d != null && d <= 7) return 2;
  if (d != null && d <= 30) return 3;
  return 4;
}

function razonIncluido(p: PlanMantenimientoFirestore, pr: 1 | 2 | 3 | 4): string {
  if (p.estado_vencimiento === "vencido") return "Aviso vencido — prioridad máxima";
  if (p.nivel_riesgo_equipo === "critico") return "Equipo con riesgo crítico";
  if (p.estado_vencimiento === "nunca_ejecutado") return "Sin historial de ejecución en sistema";
  if (pr <= 2 && p.dias_para_vencer != null && p.dias_para_vencer <= 7)
    return `Vence en ${p.dias_para_vencer} días`;
  if (p.dias_para_vencer != null && p.dias_para_vencer <= 30) return `Vence en ${p.dias_para_vencer} días`;
  return "Preventivo planificado en ciclo";
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

  const pool = input.planes.filter((p) => {
    if (p.activo === false) return false;
    const pend = p.incluido_en_ot_pendiente;
    if (pend != null && String(pend).trim() !== "") return false;
    return p.asset_id?.trim() !== "";
  });

  const sorted = [...pool].sort((a, b) => {
    const pa = clasePrioridad(a);
    const pb = clasePrioridad(b);
    if (pa !== pb) return pa - pb;
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
  const advertencias: string[] = [];
  let vencidosIncluidos = 0;
  let vencidosPostergados = 0;
  const cargaEsp: Record<string, number> = { AA: 0, ELECTRICO: 0, GG: 0, HG: 0 };

  for (const p of sorted) {
    const pr = clasePrioridad(p);
    const espKey = `${p.localidad}|${p.especialidad}`;
    const diasTry = diasOrdenados(pr, diasHabiles, config.agrupar_por_localidad ? p.localidad : undefined, cargaLoc, espKey);

    let placed = false;
    for (const dia of diasTry) {
      if (capacity(dia, p.especialidad) <= 0) continue;
      const suger = tecnicoSugerido(p.especialidad, input.tecnicos);
      const item: OtPropuestaFirestore = {
        id: randomUUID(),
        kind: "preventivo_plan",
        plan_id: p.id,
        numero: p.numero,
        descripcion: p.descripcion,
        especialidad: p.especialidad,
        localidad: p.localidad,
        duracion_estimada_min: p.duracion_estimada_min ?? 60,
        prioridad: prioridadItem(pr),
        razon_incluida: razonIncluido(p, pr),
        tecnico_sugerido_id: suger.id,
        tecnico_sugerido_nombre: suger.nombre,
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
        tecnico_sugerido_id: wo.tecnico_asignado_uid ?? suger.id,
        tecnico_sugerido_nombre: wo.tecnico_asignado_nombre ?? suger.nombre,
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
      carga_por_especialidad: cargaEsp,
    },
  };
}
