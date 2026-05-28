import { preferredNumericAvisoId } from "@/lib/import/aviso-numero-canonical";
import { AppError } from "@/lib/errors/app-error";

/** Número de aviso SAP normalizado para mostrar y para `n_ot` cuando hay aviso. */
export function numeroAvisoVisible(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!t) return "";
  return preferredNumericAvisoId(t) ?? t;
}

/** `n_ot` alineado al número de aviso (regla de negocio: OT = aviso SAP). */
export function nOtDesdeNumeroAviso(raw: string | null | undefined): string {
  const visible = numeroAvisoVisible(raw);
  if (!visible) {
    throw new AppError("VALIDATION", "Número de aviso requerido para la orden de trabajo.");
  }
  return visible;
}

/** Número operativo único para listas, PDF y programa (aviso SAP o ref. provisoria). */
export function workOrderNumeroOperativo(wo: {
  n_ot?: string | null;
  aviso_numero?: string | null;
  aviso_id?: string | null;
}): string {
  const aviso = numeroAvisoVisible(wo.aviso_numero);
  if (aviso) return aviso;
  const ot = String(wo.n_ot ?? "").trim();
  if (ot) return ot;
  return String(wo.aviso_id ?? "").trim() || "—";
}

/** OTs históricas con correlativo interno distinto del aviso SAP. */
export function workOrderReferenciasDistintas(wo: {
  n_ot?: string | null;
  aviso_numero?: string | null;
}): boolean {
  const aviso = numeroAvisoVisible(wo.aviso_numero);
  const ot = String(wo.n_ot ?? "").trim();
  return Boolean(aviso && ot && aviso !== ot);
}

export function mensajeAntecesorOrdenPendiente(ant: { n_ot: string; n_aviso: string }): string {
  const aviso = numeroAvisoVisible(ant.n_aviso) || ant.n_aviso.trim();
  const ot = String(ant.n_ot ?? "").trim();
  if (aviso && ot && aviso !== ot) {
    return `Cerrá primero la OT n.º ${ot} (aviso SAP ${aviso}) del mismo mantenimiento antes de generar una nueva.`;
  }
  const unico = aviso || ot;
  return `Cerrá primero la orden n.º ${unico} del mismo mantenimiento antes de generar una nueva.`;
}
