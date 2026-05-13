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
  if (ir.checklist || ir.servis) return true;
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
        if (!seccionItemCompleto(sec, it.id, respuesta)) {
          return { ok: false, mensaje: `Falta completar: ${it.label}` };
        }
        if (
          template.id === "GG" &&
          it.acciones?.length &&
          ir?.accionSeleccionada &&
          accionRequiereObs(ir.accionSeleccionada) &&
          !ir.observacion?.trim()
        ) {
          return { ok: false, mensaje: `Observación obligatoria en: ${it.label}` };
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
    if (!respuesta.firmaUsuario?.trim() || !respuesta.firmaUsuarioNombre?.trim()) {
      return { ok: false, mensaje: "Falta la firma y nombre del usuario (conformidad)." };
    }
    if (!respuesta.firmaResponsable?.trim() || !respuesta.firmaResponsableNombre?.trim()) {
      return { ok: false, mensaje: "Falta la firma y nombre del responsable de mantenimiento." };
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
