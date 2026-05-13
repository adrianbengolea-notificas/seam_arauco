import type {
  ItemRespuesta,
  PlanillaRespuesta,
  PlanillaTemplate,
  SeccionTemplate,
} from "@/lib/firestore/types";
import { planillaItemKey } from "@/lib/planillas/item-key";

function itemTieneRespuesta(ir: ItemRespuesta | undefined): boolean {
  if (!ir) return false;
  for (const [k, v] of Object.entries(ir)) {
    if (v === undefined || v === null) continue;
    if (k === "cantEnFalla" || k === "operativas") {
      if (typeof v === "number" && !Number.isNaN(v)) return true;
      continue;
    }
    if (typeof v === "boolean" && v === false) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return true;
  }
  return false;
}

function ggItemCompleto(ir: ItemRespuesta | undefined, acciones?: string[]): boolean {
  if (!ir) return false;
  // Nuevo modelo: per-acción
  if (ir.accionesRespuestas && acciones?.length) {
    return acciones.some((a) => {
      const ar = ir.accionesRespuestas![a];
      return ar?.checklist || ar?.servis;
    });
  }
  // Items sin acciones: checklist/servis a nivel ítem
  if (ir.checklist || ir.servis) return true;
  // Legacy: accionSeleccionada del modelo anterior
  if (ir.accionSeleccionada?.trim()) return true;
  if (ir.observacion?.trim()) return true;
  if (!acciones?.length && (ir.checklist === false || ir.servis === false)) return true;
  return false;
}

/** Respuesta suficiente para contar el ítem en progreso (cualquier dato cargado). */
export function seccionItemCompleto(
  seccion: SeccionTemplate,
  itemId: string,
  respuesta: PlanillaRespuesta | null | undefined,
): boolean {
  if (!respuesta) return false;
  const key = planillaItemKey(seccion.id, itemId);
  const ir = respuesta.respuestas[key];
  if (seccion.tipo === "checklist" && respuesta.templateId === "GG") {
    const it = seccion.items?.find((x) => x.id === itemId);
    return ggItemCompleto(ir, it?.acciones);
  }
  if (seccion.tipo === "checklist") {
    return Boolean(
      itemTieneRespuesta(ir) &&
        (ir?.estado !== undefined || Boolean(ir?.checklist) || Boolean(ir?.servis)),
    );
  }
  if (seccion.tipo === "grilla") return itemTieneRespuesta(ir);
  return false;
}

function textoLibreSeccion(seccion: SeccionTemplate, r: PlanillaRespuesta | null | undefined): string {
  if (!r) return "";
  if (seccion.id === "aa_obs") {
    const dedicated = r.observacionesFinales?.trim() ?? "";
    if (dedicated) return dedicated;
    return r.textoLibrePorSeccion?.[seccion.id]?.trim() ?? "";
  }
  const fromMap = r.textoLibrePorSeccion?.[seccion.id]?.trim() ?? "";
  if (fromMap) return fromMap;
  switch (seccion.id) {
    case "corr_actividad":
      return r.actividadRealizada?.trim() ?? "";
    case "corr_mats":
      return r.materialesTexto?.trim() ?? "";
    case "corr_obs":
      return r.observacionesUsuario?.trim() ?? "";
    case "corr_ssgg":
      return r.controlCalidadSSGG?.trim() ?? "";
    case "elec_rec":
      return r.recomendaciones?.trim() ?? "";
    case "elec_pedido":
      return r.pedidoMateriales?.trim() ?? "";
    default:
      return "";
  }
}

function datosEquipoCompleto(r: PlanillaRespuesta | null | undefined): boolean {
  if (!r?.datosEquipo) return false;
  const d = r.datosEquipo;
  return Boolean(
    (d.rendimiento || d.tipoGas || d.frigorias || d.tipoPlaca || d.potencia || d.serie_ext || d.serie_int || d.marca || d.modelo),
  );
}

export function planillaProgreso(template: PlanillaTemplate, respuesta: PlanillaRespuesta | null | undefined): {
  hechos: number;
  total: number;
  pct: number;
} {
  let hechos = 0;
  let total = 0;

  for (const sec of template.secciones) {
    if (sec.tipo === "datos_equipo") {
      total += 1;
      if (datosEquipoCompleto(respuesta)) hechos += 1;
      continue;
    }
    if (sec.tipo === "estado_final") {
      total += 1;
      if (respuesta?.estadoFinal) hechos += 1;
      continue;
    }
    if (sec.tipo === "datos_persona") {
      if (!sec.obligatorio) continue;
      total += 1;
      const filas = respuesta?.filasPersonal ?? [];
      if (
        filas.some(
          (row) =>
            row.nombreApellido?.trim() || row.cargoCategoria?.trim() || row.observaciones?.trim(),
        )
      ) {
        hechos += 1;
      }
      continue;
    }
    if (sec.tipo === "libre") {
      total += 1;
      if (textoLibreSeccion(sec, respuesta)) hechos += 1;
      continue;
    }
    if (sec.tipo === "checklist" || sec.tipo === "grilla") {
      for (const it of sec.items ?? []) {
        total += 1;
        if (seccionItemCompleto(sec, it.id, respuesta)) hechos += 1;
      }
    }
  }

  const pctRounded = total === 0 ? 0 : Math.min(100, Math.round((hechos / total) * 100));
  return { hechos, total, pct: pctRounded };
}

function accionRequiereObs(accion: string): boolean {
  const a = accion.toLowerCase();
  return a.includes("cambiar") || a.includes("reemplazar");
}

/** Firma capturada desde canvas: data URL de imagen (evita `.trim()` sobre null/undefined). */
export function firmaImagenDataUrlValida(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith("data:image/") && s.length >= 80;
}

/** URL firmada de Storage (planilla ya persistida sin base64). */
export function firmaPlanillaStorageUrlValida(s: string | null | undefined): boolean {
  return typeof s === "string" && /^https?:\/\//i.test(s.trim()) && s.trim().length > 60;
}

export function planillaFirmaUsuarioSrc(r: Pick<PlanillaRespuesta, "firmaUsuario" | "firmaUsuarioDownloadUrl">): string | null {
  const u = r.firmaUsuarioDownloadUrl?.trim();
  if (u) return u;
  const legacy = r.firmaUsuario?.trim();
  return legacy && legacy.length > 0 ? legacy : null;
}

export function planillaFirmaResponsableSrc(
  r: Pick<PlanillaRespuesta, "firmaResponsable" | "firmaResponsableDownloadUrl">,
): string | null {
  const u = r.firmaResponsableDownloadUrl?.trim();
  if (u) return u;
  const legacy = r.firmaResponsable?.trim();
  return legacy && legacy.length > 0 ? legacy : null;
}

function firmaPlanillaParValida(
  dataUrl: string | null | undefined,
  storageUrl: string | null | undefined,
): boolean {
  return firmaImagenDataUrlValida(dataUrl) || firmaPlanillaStorageUrlValida(storageUrl);
}

export function validatePlanillaFirmable(
  template: PlanillaTemplate,
  respuesta: PlanillaRespuesta,
  opts: { isAdmin?: boolean; omitFirmas?: boolean } = {},
): { ok: true } | { ok: false; mensaje: string } {
  const isAdmin = opts.isAdmin ?? false;
  const omitFirmas = opts.omitFirmas ?? false;

  for (const sec of template.secciones) {
    if (sec.soloAdmin && !isAdmin) continue;

    if (sec.tipo === "checklist" || sec.tipo === "grilla") {
      for (const it of sec.items ?? []) {
        if (!it.obligatorio) continue;
        const key = planillaItemKey(sec.id, it.id);
        const ir = respuesta.respuestas[key];
        /** Checklist (cualquier plantilla): se puede firmar y cerrar la OT sin marcar todos los ítems. Siguen valiendo observaciones obligatorias por fila/estado/acción. */
        const checklistPermiteSinMarcarTodo = sec.tipo === "checklist";
        if (!checklistPermiteSinMarcarTodo && !seccionItemCompleto(sec, it.id, respuesta)) {
          return { ok: false, mensaje: `Falta completar: ${it.label}` };
        }
        if (template.id === "GG" && it.acciones?.length && ir?.accionesRespuestas) {
          for (const accion of it.acciones) {
            const ar = ir.accionesRespuestas[accion];
            if (
              ar &&
              (ar.checklist || ar.servis) &&
              accionRequiereObs(accion) &&
              !ar.observacion?.trim()
            ) {
              return {
                ok: false,
                mensaje: `Falta texto en la observación de «${accion}» (${it.label}). Al marcar cambio o reemplazo hay que describir qué se hizo; si no hubo cambio, quitá Check list/Servis en esa fila.`,
              };
            }
          }
        }
        if (it.requiereObsEn?.length && ir?.estado && it.requiereObsEn.includes(ir.estado)) {
          if (!ir.observacion?.trim()) {
            return { ok: false, mensaje: `Observación obligatoria en: ${it.label}` };
          }
        }
        if (sec.tipo === "grilla") {
          const cant = ir?.cantEnFalla ?? 0;
          if (cant > 0 && !(ir?.comentario?.trim() || ir?.observacion?.trim())) {
            return { ok: false, mensaje: `Comentarios obligatorios si hay fallas: ${it.label}` };
          }
        }
      }
    }

    if (sec.tipo === "libre" && sec.obligatorio && !textoLibreSeccion(sec, respuesta)) {
      return { ok: false, mensaje: `Completá: ${sec.titulo}` };
    }

    if (sec.tipo === "datos_equipo" && sec.obligatorio && !datosEquipoCompleto(respuesta)) {
      return { ok: false, mensaje: `Completá datos del equipo: ${sec.titulo}` };
    }

    if (sec.tipo === "estado_final" && !respuesta.estadoFinal) {
      return { ok: false, mensaje: "Indicá el estado final del equipo." };
    }
  }

  if (!omitFirmas) {
    if (
      !firmaPlanillaParValida(respuesta.firmaUsuario, respuesta.firmaUsuarioDownloadUrl) ||
      !respuesta.firmaUsuarioNombre?.trim()
    ) {
      return { ok: false, mensaje: "Falta la firma y nombre de quien firma por Arauco." };
    }
    if (
      !firmaPlanillaParValida(respuesta.firmaResponsable, respuesta.firmaResponsableDownloadUrl) ||
      !respuesta.firmaResponsableNombre?.trim()
    ) {
      return { ok: false, mensaje: "Falta la firma y nombre del técnico SEAM." };
    }
  }

  return { ok: true };
}

export function planillaItemsOkSinFirmas(
  template: PlanillaTemplate,
  respuesta: PlanillaRespuesta,
  opts: { isAdmin?: boolean } = {},
): boolean {
  return validatePlanillaFirmable(template, respuesta, { ...opts, omitFirmas: true }).ok;
}

/** Payload completo de borrador a partir del estado local (evita perder campos al debouncear parches parciales). */
export function planillaBorradorPatchFromState(s: PlanillaRespuesta): Partial<PlanillaRespuesta> {
  return {
    datosEquipo: s.datosEquipo,
    respuestas: s.respuestas,
    textoLibrePorSeccion: s.textoLibrePorSeccion,
    actividadRealizada: s.actividadRealizada,
    materialesTexto: s.materialesTexto,
    recomendaciones: s.recomendaciones,
    pedidoMateriales: s.pedidoMateriales,
    observacionesUsuario: s.observacionesUsuario,
    estadoFinal: s.estadoFinal,
    observacionesFinales: s.observacionesFinales,
    controlCalidadSSGG: s.controlCalidadSSGG,
    filasPersonal: s.filasPersonal,
    firmaUsuario: s.firmaUsuario,
    firmaUsuarioNombre: s.firmaUsuarioNombre,
    firmaUsuarioLegajo: s.firmaUsuarioLegajo,
    firmaUsuarioStoragePath: s.firmaUsuarioStoragePath,
    firmaUsuarioDownloadUrl: s.firmaUsuarioDownloadUrl,
    firmaResponsable: s.firmaResponsable,
    firmaResponsableNombre: s.firmaResponsableNombre,
    firmaResponsableStoragePath: s.firmaResponsableStoragePath,
    firmaResponsableDownloadUrl: s.firmaResponsableDownloadUrl,
  };
}
