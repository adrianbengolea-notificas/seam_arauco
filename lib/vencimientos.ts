import { addDays } from "date-fns";
import type { Timestamp } from "firebase/firestore";
import type { Aviso, FrecuenciaMantenimiento } from "@/modules/notices/types";

/** Normaliza número de aviso → id de documento `avisos/{id}` (igual que seed). */
export function avisoFirestoreDocId(numeroRaw: string): string {
  return String(numeroRaw ?? "")
    .replace(/\//g, "-")
    .replace(/\s+/g, "")
    .trim();
}

export type MtsaBadge = "M" | "T" | "S" | "A";

export function diasPorMtsa(m: MtsaBadge): number {
  switch (m) {
    case "M":
      return 30;
    case "T":
      return 90;
    case "S":
      return 180;
    case "A":
      return 365;
    default:
      return 30;
  }
}

export function inferMtsaDesdeAviso(aviso: Pick<Aviso, "frecuencia_plan_mtsa" | "frecuencia">): MtsaBadge {
  if (aviso.frecuencia_plan_mtsa) return aviso.frecuencia_plan_mtsa;
  const f = aviso.frecuencia;
  const map: Partial<Record<FrecuenciaMantenimiento, MtsaBadge>> = {
    MENSUAL: "M",
    TRIMESTRAL: "T",
    SEMESTRAL: "S",
    ANUAL: "A",
  };
  return map[f] ?? "M";
}

export function proximoVencimientoDesdeFecha(fechaCierre: Date, mtsa: MtsaBadge): Date {
  return addDays(fechaCierre, diasPorMtsa(mtsa));
}

export function diasParaVencimientoDesdeProximo(
  proximo: Date,
  hoyUtc: Date = new Date(),
): number {
  const a = Date.UTC(hoyUtc.getFullYear(), hoyUtc.getMonth(), hoyUtc.getDate());
  const b = Date.UTC(proximo.getFullYear(), proximo.getMonth(), proximo.getDate());
  return Math.round((b - a) / 86_400_000);
}

export function estadoVencimientoDesdeDias(dias: number): "ok" | "proximo" | "vencido" {
  if (dias < 0) return "vencido";
  if (dias <= 30) return "proximo";
  return "ok";
}

/** Cliente Firestore: lee `proximo_vencimiento` como Timestamp. */
export function diasParaVencimientoDesdeTimestamp(
  proximo: Timestamp | undefined,
  hoy: Date = new Date(),
): number | undefined {
  if (!proximo) return undefined;
  const d = proximo.toDate();
  return diasParaVencimientoDesdeProximo(d, hoy);
}
