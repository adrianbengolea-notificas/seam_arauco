import { addWeeks, endOfISOWeek, setISOWeek, startOfISOWeek } from "date-fns";
import type { DiaSemanaPrograma } from "@/modules/scheduling/types";

/**
 * Lista ordenada de ids ISO `YYYY-Www` para todos los días calendario de ese año (`year` jan 1 … dec 31).
 * Útil para selectores de semana dentro de un año visual.
 */
export function listaSemanasIsoEnAnoCalendario(year: number): string[] {
  const isoSet = new Set<string>();
  const end = new Date(year, 11, 31);
  for (let d = new Date(year, 0, 1); d <= end; d.setDate(d.getDate() + 1)) {
    isoSet.add(getIsoWeekId(d));
  }
  return [...isoSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Día ISO para `WeeklyScheduleSlot.dia_semana`: 1 = lunes … 7 = domingo (calendario local). */
export function isoDiaSemanaDesdeDateLocal(d: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const js = d.getDay();
  const n = js === 0 ? 7 : js;
  return n as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** `dia_semana` de agenda ISO 1 = lunes … 7 = domingo → celda de la grilla publicada. */
export function diaIsoSemanaADiaPrograma(diaSemana: number): DiaSemanaPrograma {
  const orden: DiaSemanaPrograma[] = [
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
    "domingo",
  ];
  const i = Math.floor(diaSemana) - 1;
  if (i < 0 || i >= orden.length) return "lunes";
  return orden[i]!;
}

/**
 * Acepta el id ISO (`2026-W19`) o el id de documento `programa_semanal` con prefijo de centro (`PC01_2026-W19`).
 * Devuelve siempre `YYYY-Www` para `weekly_schedule`, `parseIsoWeekToBounds` y acciones.
 */
export function parseIsoWeekIdFromSemanaParam(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{4}-W\d{2}$/.test(t)) return t;
  const m = /(\d{4}-W\d{2})$/.exec(t);
  return m?.[1] ?? null;
}

/** Semana ISO `YYYY-Www` a partir de una fecha (UTC, coherente con buckets por semana). */
export function getIsoWeekId(d: Date): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const w = weekNo.toString().padStart(2, "0");
  return `${target.getUTCFullYear()}-W${w}`;
}

/** Navegar semanas respecto a un id `YYYY-Www`. */
export function shiftIsoWeekId(weekId: string, deltaWeeks: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId.trim());
  if (!m) return getIsoWeekId(new Date());
  const year = Number(m[1]);
  const week = Number(m[2]);
  const inWeek = startOfISOWeek(setISOWeek(new Date(year, 0, 4), week));
  return getIsoWeekId(addWeeks(inWeek, deltaWeeks));
}

/** Inicio (lunes) y fin (domingo) de la semana ISO, en tiempo local (coherente con `shiftIsoWeekId`). */
export function parseIsoWeekToBounds(weekId: string): { start: Date; end: Date } {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId.trim());
  if (!m) {
    const n = new Date();
    const s = startOfISOWeek(n);
    return { start: s, end: endOfISOWeek(s) };
  }
  const year = Number(m[1]);
  const week = Number(m[2]);
  const start = startOfISOWeek(setISOWeek(new Date(year, 0, 4), week));
  return { start, end: endOfISOWeek(start) };
}

/** Rótulo `Semana N — dd/MM al dd/MM` alineado con `appendAvisoToProgramaSemanaAdmin` / selectores en UI. */
export function semanaLabelDesdeIso(weekId: string): string {
  const { start, end } = parseIsoWeekToBounds(weekId.trim());
  const weekPart = weekId.trim().split("-W")[1] ?? "";
  return `Semana ${parseInt(weekPart, 10) || weekPart} — ${start.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  })} al ${end.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;
}
