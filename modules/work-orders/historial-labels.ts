import type { HistorialEventoTipo, WorkOrderHistorialEvent } from "@/modules/work-orders/types";

/** Etiqueta corta de plantillas (AA / GG / …) para historial y PDF. */
export function etiquetaPlanillaTemplateCorta(id: string): string {
  switch (id) {
    case "GG":
      return "GG";
    case "AA":
      return "AA";
    case "ELEC":
      return "Elec";
    case "CORRECTIVO":
      return "Correctivo";
    default:
      return id || "—";
  }
}

const ESTADO_OT_ETIQUETA: Record<string, string> = {
  BORRADOR: "Borrador",
  ABIERTA: "Abierta",
  EN_EJECUCION: "En ejecución",
  PENDIENTE_FIRMA_SOLICITANTE: "Pendiente firma solicitante",
  LISTA_PARA_CIERRE: "Lista para cierre",
  CERRADA: "Cerrada",
  ANULADA: "Anulada",
};

export function historialEstadoEtiqueta(codigo: string | undefined): string {
  if (!codigo) return "—";
  return ESTADO_OT_ETIQUETA[codigo] ?? codigo.replaceAll("_", " ").toLowerCase();
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Evita mostrar cadenas que parecen UID de Firebase como si fueran nombre. */
function pareceUidFirebase(s: string): boolean {
  return /^[a-zA-Z0-9_-]{20,}$/.test(s);
}

/** Nombre legible embebido en el payload o en `datos` (si existe). */
export function historialNombreEnPayload(p: Record<string, unknown>): string | null {
  const candidatos = [
    str(p.usuarioNombre),
    str(p.actorNombre),
    str(p.autorNombre),
    str(p.tecnicoNombre),
    str(p.displayName),
  ];
  for (const c of candidatos) {
    if (c && !pareceUidFirebase(c)) return c;
  }
  const datos = p.datos;
  if (datos && typeof datos === "object" && !Array.isArray(datos)) {
    const d = datos as Record<string, unknown>;
    const anidados = [str(d.usuarioNombre), str(d.actorNombre), str(d.displayName)];
    for (const c of anidados) {
      if (c && !pareceUidFirebase(c)) return c;
    }
  }
  return null;
}

function conActor(frase: string, actorNombre: string | null): string {
  const nombre = actorNombre?.trim();
  if (nombre && !pareceUidFirebase(nombre)) return `${frase} por ${nombre}`;
  return `${frase} por un usuario`;
}

const TITLES: Record<HistorialEventoTipo, string> = {
  CREADA: "OT creada",
  ESTADO_CAMBIO: "Cambio de estado",
  ASIGNACION: "Asignación de técnico",
  MATERIAL: "Material",
  EVIDENCIA: "Evidencia",
  FIRMA_TECNICO: "Firma del técnico",
  FIRMA_USUARIO: "Firma usuario de planta",
  CIERRE: "Cierre",
  CIERRE_HISTORICO: "Cierre histórico (empalme documentado)",
  INFORME_ACTUALIZADO: "Informe actualizado",
  PLANILLA_INICIADA: "Planilla iniciada",
  PLANILLA_FIRMADA: "Planilla firmada",
  COMENTARIO: "Comentario",
  MATERIAL_NORMALIZADO_IA: "Material (normalización interna)",
  ARCHIVADA: "OT archivada",
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
      if (p.desasignado) return "sin técnico asignado";
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
    case "COMENTARIO":
      return String(p.texto ?? p.comentarioId ?? "");
    case "MATERIAL_NORMALIZADO_IA":
      return String(p.lineId ?? "");
    case "ARCHIVADA":
      return "oculta en listados";
    default:
      return "";
  }
}

/**
 * Texto para la UI de detalle de OT: sin UIDs ni ids internos.
 * `actorNombre` = nombre ya resuelto (payload o `users/{uid}`).
 */
export function historialEventoTextoUsuario(
  ev: WorkOrderHistorialEvent,
  actorNombre: string | null,
): string {
  const p = ev.payload ?? {};
  const nombre =
    historialNombreEnPayload(p as Record<string, unknown>) ?? actorNombre?.trim() ?? null;

  switch (ev.tipo) {
    case "CREADA":
      return conActor("OT creada", nombre);
    case "PLANILLA_INICIADA": {
      const tpl = etiquetaPlanillaTemplateCorta(str(p.templateId));
      return conActor(`Planilla ${tpl} iniciada`, nombre);
    }
    case "PLANILLA_FIRMADA": {
      const tpl = etiquetaPlanillaTemplateCorta(str(p.templateId));
      return conActor(`Planilla ${tpl} firmada`, nombre);
    }
    case "ESTADO_CAMBIO": {
      const desde = historialEstadoEtiqueta(str(p.desde));
      const hacia = historialEstadoEtiqueta(str(p.hacia));
      const tramo =
        str(p.desde) && str(p.hacia)
          ? `${desde} → ${hacia}`
          : str(p.hacia)
            ? `→ ${hacia}`
            : str(p.desde)
              ? `${desde} →`
              : "Estado actualizado";
      return conActor(`Estado cambiado: ${tramo}`, nombre);
    }
    case "ASIGNACION":
      if (p.desasignado) return conActor("Técnico desasignado; la orden quedó para el equipo de la planta", nombre);
      return conActor("Asignación de técnico registrada", nombre);
    case "MATERIAL":
      return conActor("Material registrado", nombre);
    case "EVIDENCIA":
      return conActor("Evidencia adjuntada", nombre);
    case "FIRMA_TECNICO":
      return conActor("Firma del técnico registrada", nombre);
    case "FIRMA_USUARIO":
      return conActor("Firma del usuario de planta registrada", nombre);
    case "CIERRE":
      return conActor("OT cerrada", nombre);
    case "CIERRE_HISTORICO":
      return conActor("Orden registrada como completada en fecha histórica (empalme documentado)", nombre);
    case "INFORME_ACTUALIZADO":
      return conActor("Informe actualizado", nombre);
    case "COMENTARIO": {
      const texto = str(p.texto);
      if (texto) return texto;
      return conActor("Comentario publicado", nombre);
    }
    case "MATERIAL_NORMALIZADO_IA":
      return "Material vinculado al catálogo (normalización automática)";
    case "ARCHIVADA":
      return conActor("Orden archivada y oculta para el trabajo operativo diario", nombre);
    default:
      return historialEventoTitulo(ev.tipo);
  }
}
