import { addWeeks, endOfISOWeek, setISOWeek, startOfISOWeek } from "date-fns";

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
