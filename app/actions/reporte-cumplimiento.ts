"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  META_CORRECTIVOS_REPORTE,
  META_CRITERIOS_REPORTE,
  calcularTotalesPreventivo,
  emptyDiscMap,
  esDisciplina,
  esOtCerradaEnPeriodo,
  finalizarDiscMap,
  mergeDiscMap,
  normalizarEsp,
  sitioDesdeUt,
  type CentroResumen,
  type CorrectivoFila,
  type CorrectivosPorEspecialidad,
  type DisciplinaLabel,
  type DisciplinaMetrica,
  type OTFilaDetalle,
  type ReporteCumplimientoData,
} from "@/lib/reportes/cumplimiento-metrics";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

// Nota: este archivo "use server" solo puede exportar funciones async.
// Re-exportar tipos o constantes desde acá rompía la evaluación del módulo en
// producción (ReferenceError al registrar server references). Los tipos y
// META_* viven en lib/reportes/cumplimiento-metrics.

const MESES_ES = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function tsToDateStr(ts: FirebaseFirestore.Timestamp | null | undefined): string | null {
  if (!ts) return null;
  try {
    return ts.toDate().toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch {
    return null;
  }
}

function rangeMes(año: number, mes: number): { inicio: Timestamp; fin: Timestamp } {
  const inicio = Timestamp.fromDate(new Date(año, mes - 1, 1, 0, 0, 0));
  const fin = Timestamp.fromDate(new Date(año, mes, 1, 0, 0, 0));
  return { inicio, fin };
}

function emptyPorEspecialidadCorrectivos(): CorrectivosPorEspecialidad {
  return { AA: 0, ELECTRICO: 0, GG: 0, otro: 0 };
}

function esPreventivoPuro(tipo: unknown): boolean {
  return tipo === "PREVENTIVO";
}

const TIPOS_CORRECTIVO_REPORTE = ["CORRECTIVO", "EMERGENCIA", "URGENTE"] as const;

async function calcularCentro(
  db: FirebaseFirestore.Firestore,
  centro: string,
  inicio: Timestamp,
  fin: Timestamp,
  incluirDetalle: boolean,
): Promise<{
  discMap: Record<DisciplinaLabel, DisciplinaMetrica>;
  correctivos: ReporteCumplimientoData["correctivos"];
  otsDetalle: OTFilaDetalle[];
}> {
  const [prevSnap, corrCerradosSnap, corrCreadosSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("fecha_inicio_programada", ">=", inicio)
      .where("fecha_inicio_programada", "<", fin)
      .get(),
    db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "in", [...TIPOS_CORRECTIVO_REPORTE])
      .where("estado", "==", "CERRADA")
      .where("fecha_fin_ejecucion", ">=", inicio)
      .where("fecha_fin_ejecucion", "<", fin)
      .get(),
    db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "in", [...TIPOS_CORRECTIVO_REPORTE])
      .where("created_at", ">=", inicio)
      .where("created_at", "<", fin)
      .get(),
  ]);

  const discMap = emptyDiscMap();
  const otsDetalle: OTFilaDetalle[] = [];
  const inicioMs = inicio.toMillis();
  const finMs = fin.toMillis();

  for (const doc of prevSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    if (!esPreventivoPuro(d.tipo_trabajo)) continue;

    const esp = normalizarEsp(String(d.especialidad ?? ""));
    const sitio = sitioDesdeUt(d.ubicacion_tecnica as string | undefined);
    const ejecutada = esOtCerradaEnPeriodo(d.estado, d.fecha_fin_ejecucion, inicioMs, finMs);
    const fechaCierreStr = tsToDateStr(
      d.fecha_fin_ejecucion as FirebaseFirestore.Timestamp | null,
    );

    if (esDisciplina(esp)) {
      discMap[esp].planificadas++;
      const sp = discMap[esp].por_sitio.find((s) => s.sitio === sitio);
      if (sp) sp.planificadas++;
      if (ejecutada) {
        discMap[esp].ejecutadas++;
        const spE = discMap[esp].por_sitio.find((s) => s.sitio === sitio);
        if (spE) spE.ejecutadas++;
      }
    }

    if (incluirDetalle) {
      otsDetalle.push({
        n_ot: String(d.n_ot ?? ""),
        aviso_numero: String(d.aviso_numero ?? ""),
        descripcion: String(d.texto_trabajo ?? ""),
        especialidad: esp,
        frecuencia: String(d.frecuencia_plan_mtsa ?? d.frecuencia ?? ""),
        ubicacion: String(d.ubicacion_tecnica ?? ""),
        sitio,
        estado: String(d.estado ?? ""),
        tipo: "preventivo",
        planificada: true,
        ejecutada,
        fecha_ejecucion: fechaCierreStr,
        fecha_creacion: tsToDateStr(d.created_at as FirebaseFirestore.Timestamp) ?? "",
      });
    }
  }

  finalizarDiscMap(discMap);

  const corrDetalle: CorrectivoFila[] = [];
  const corrDetalleIds = new Set<string>();
  let corrPlan = 0;
  let corrNoPlan = 0;
  let corrRealizados = 0;
  let corrPendientes = 0;
  const porEspCorr = emptyPorEspecialidadCorrectivos();

  const pushCorrDetalle = (
    docId: string,
    d: Record<string, unknown>,
    ejecutado: boolean,
    esp: DisciplinaLabel | string,
    sitio: ReturnType<typeof sitioDesdeUt>,
    tienAviso: boolean,
  ) => {
    if (tienAviso) corrPlan++;
    else corrNoPlan++;
    if (!incluirDetalle || corrDetalleIds.has(docId)) return;
    corrDetalleIds.add(docId);
    corrDetalle.push({
      n_ot: String(d.n_ot ?? ""),
      aviso_numero: String(d.aviso_numero ?? ""),
      descripcion: String(d.texto_trabajo ?? ""),
      especialidad: esDisciplina(esp) ? esp : (String(d.especialidad ?? "").trim() || "—"),
      ubicacion: String(d.ubicacion_tecnica ?? ""),
      sitio,
      planificado: tienAviso,
      ejecutado,
      fecha:
        tsToDateStr(d.fecha_fin_ejecucion as FirebaseFirestore.Timestamp | null)
        ?? tsToDateStr(d.created_at as FirebaseFirestore.Timestamp | null),
    });
  };

  for (const doc of corrCerradosSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    const sitio = sitioDesdeUt(d.ubicacion_tecnica as string | undefined);
    const esp = normalizarEsp(String(d.especialidad ?? ""));
    const tienAviso = Boolean(d.aviso_id || d.aviso_numero);

    corrRealizados++;
    if (esDisciplina(esp)) porEspCorr[esp]++;
    else porEspCorr.otro++;
    pushCorrDetalle(doc.id, d, true, esp, sitio, tienAviso);
  }

  for (const doc of corrCreadosSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    if (
      esOtCerradaEnPeriodo(d.estado, d.fecha_fin_ejecucion, inicioMs, finMs)
    ) {
      continue;
    }
    const sitio = sitioDesdeUt(d.ubicacion_tecnica as string | undefined);
    const esp = normalizarEsp(String(d.especialidad ?? ""));
    const tienAviso = Boolean(d.aviso_id || d.aviso_numero);

    corrPendientes++;
    pushCorrDetalle(doc.id, d, false, esp, sitio, tienAviso);
  }

  const corrTotal = corrRealizados + corrPendientes;

  return {
    discMap,
    correctivos: {
      planificados: corrPlan,
      no_planificados: corrNoPlan,
      total: corrTotal,
      realizados: corrRealizados,
      pendientes: corrPendientes,
      pct_cumplimiento:
        corrTotal > 0 ? Math.round((corrRealizados / corrTotal) * 100) / 100 : 0,
      por_especialidad: porEspCorr,
      detalle: corrDetalle,
    },
    otsDetalle,
  };
}

const InputSchema = z.object({
  centro: z.string().trim().min(1),
  mes: z.number().int().min(1).max(12),
  año: z.number().int().min(2020).max(2099),
  centros_lista: z.array(z.string()).optional(),
});

export async function actionGetReporteCumplimiento(
  token: string,
  input: { centro: string; mes: number; año: number; centros_lista?: string[] },
): Promise<ActionResult<ReporteCumplimientoData>> {
  try {
    await requirePermisoFromToken(token, "reportes:ver_cumplimiento");

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("VALIDATION", "Parámetros inválidos: " + parsed.error.message);
    }
    const { centro, mes, año, centros_lista } = parsed.data;
    const { inicio, fin } = rangeMes(año, mes);
    const db = getAdminDb();
    const periodoLabel = `${MESES_ES[mes]} ${año}`;

    if (centro === "todas" && centros_lista && centros_lista.length > 0) {
      const resultados = await Promise.all(
        centros_lista.map((c) => calcularCentro(db, c, inicio, fin, true)),
      );

      const aggDisc = emptyDiscMap();
      let aggCorrPlan = 0;
      let aggCorrNoPlan = 0;
      let aggCorrTotal = 0;
      let aggCorrRealizados = 0;
      const aggPorEspCorr = emptyPorEspecialidadCorrectivos();
      const aggOtsDetalle: OTFilaDetalle[] = [];
      const aggCorrDetalle: CorrectivoFila[] = [];
      const porCentro: CentroResumen[] = [];

      for (let i = 0; i < centros_lista.length; i++) {
        const r = resultados[i]!;
        const c = centros_lista[i]!;
        mergeDiscMap(aggDisc, r.discMap);
        aggCorrPlan += r.correctivos.planificados;
        aggCorrNoPlan += r.correctivos.no_planificados;
        aggCorrTotal += r.correctivos.total;
        aggCorrRealizados += r.correctivos.realizados;
        aggPorEspCorr.AA += r.correctivos.por_especialidad.AA;
        aggPorEspCorr.ELECTRICO += r.correctivos.por_especialidad.ELECTRICO;
        aggPorEspCorr.GG += r.correctivos.por_especialidad.GG;
        aggPorEspCorr.otro += r.correctivos.por_especialidad.otro;
        aggOtsDetalle.push(...r.otsDetalle);
        aggCorrDetalle.push(...r.correctivos.detalle);

        porCentro.push({
          centro: c,
          disciplinas: r.discMap,
          correctivos: r.correctivos,
          totales: calcularTotalesPreventivo(r.discMap),
        });
      }

      const totales = calcularTotalesPreventivo(aggDisc);

      return success({
        periodo: { mes, año, label: periodoLabel },
        centro: "todas",
        meta: META_CRITERIOS_REPORTE,
        meta_correctivos: META_CORRECTIVOS_REPORTE,
        disciplinas: aggDisc,
        correctivos: {
          planificados: aggCorrPlan,
          no_planificados: aggCorrNoPlan,
          total: aggCorrTotal,
          realizados: aggCorrRealizados,
          pendientes: aggCorrTotal - aggCorrRealizados,
          pct_cumplimiento:
            aggCorrTotal > 0
              ? Math.round((aggCorrRealizados / aggCorrTotal) * 100) / 100
              : 0,
          por_especialidad: aggPorEspCorr,
          detalle: aggCorrDetalle,
        },
        ots_detalle: aggOtsDetalle,
        totales,
        por_centro: porCentro,
      });
    }

    const { discMap, correctivos, otsDetalle } = await calcularCentro(
      db,
      centro,
      inicio,
      fin,
      true,
    );

    return success({
      periodo: { mes, año, label: periodoLabel },
      centro,
      meta: META_CRITERIOS_REPORTE,
      meta_correctivos: META_CORRECTIVOS_REPORTE,
      disciplinas: discMap,
      correctivos,
      ots_detalle: otsDetalle,
      totales: calcularTotalesPreventivo(discMap),
    });
  } catch (e) {
    if (e instanceof AppError) return failure(e);
    return failure(new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno"));
  }
}
