import type { HistorialEventoTipo, WorkOrderHistorialEvent } from "@/modules/work-orders/types";

const TITLES: Record<HistorialEventoTipo, string> = {
  CREADA: "OT creada",
  ESTADO_CAMBIO: "Cambio de estado",
  ASIGNACION: "Asignación de técnico",
  MATERIAL: "Material",
  EVIDENCIA: "Evidencia",
  FIRMA_TECNICO: "Firma del técnico",
  FIRMA_USUARIO: "Firma usuario de planta",
  CIERRE: "Cierre",
  INFORME_ACTUALIZADO: "Informe actualizado",
  PLANILLA_INICIADA: "Planilla iniciada",
  PLANILLA_FIRMADA: "Planilla firmada",
};

export function historialEventoTitulo(tipo: HistorialEventoTipo): string {
  return TITLES[tipo] ?? tipo;
}

/** Texto corto para PDF / CSV (sin HTML). */
export function historialEventoResumen(ev: WorkOrderHistorialEvent): string {
  const p = ev.payload ?? {};
  switch (ev.tipo) {
    case "CREADA":
      return `n_ot ${String(p.n_ot ?? "")} · aviso ${String(p.aviso_id ?? "—")}`;
    case "ESTADO_CAMBIO":
      return [p.desde ? `desde ${String(p.desde)}` : null, p.hacia ? `→ ${String(p.hacia)}` : null]
        .filter(Boolean)
        .join(" ");
    case "ASIGNACION":
      return `técnico uid ${String(p.tecnicoUid ?? "")}`;
    case "MATERIAL":
      return `línea ${String(p.lineId ?? "")} · ${String(p.codigo ?? p.schema ?? "")}`;
    case "EVIDENCIA":
      return String(p.evidenciaId ?? p.path ?? "");
    case "FIRMA_TECNICO":
    case "FIRMA_USUARIO":
      return String(p.signed_at ?? "");
    case "CIERRE":
      return String(p.modo ?? p.motivo ?? "");
    case "INFORME_ACTUALIZADO":
      return `longitud ${String(p.longitud ?? "")}`;
    case "PLANILLA_INICIADA":
      return `template ${String(p.templateId ?? "")} · resp ${String(p.respuestaId ?? "")}`;
    case "PLANILLA_FIRMADA":
      return `resp ${String(p.respuestaId ?? "")}`;
    default:
      return "";
  }
}
