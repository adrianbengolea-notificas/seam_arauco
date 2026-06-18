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
  timestampToMillis,
  type CentroResumen,
  type CertificacionReporte,
  type CorrectivoFila,
  type CorrectivosPorEspecialidad,
  type DisciplinaLabel,
  type DisciplinaMetrica,
  type OTFilaDetalle,
  type OperativoReporte,
  type ReporteCumplimientoData,
} from "@/lib/reportes/cumplimiento-metrics";
import {
  acumularEjecutadosCertificacion,
  calcularCertificacionDisciplina,
  calcularIndiceCertificacion,
  emptyEjecutadosCertificacion,
  inicioSemestreMs,
  inicioTrimestreMs,
  META_OPERATIVO,
  metasCertificacionParaAño,
  PESOS_CERTIFICACION_CONTRATO,
  tierFrecuenciaDesdeOt,
  type EjecutadosCertificacion,
  type MetasCertificacion,
} from "@/lib/reportes/certificacion-objetivos";
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

function emptyEjecutadosPorDisciplina(): Record<DisciplinaLabel, EjecutadosCertificacion> {
  return {
    AA: emptyEjecutadosCertificacion(),
    ELECTRICO: emptyEjecutadosCertificacion(),
    GG: emptyEjecutadosCertificacion(),
  };
}

async function cargarMetasCertificacion(
  db: FirebaseFirestore.Firestore,
  año: number,
): Promise<{ metas: MetasCertificacion; fuente: "firestore" | "default" } | null> {
  const snap = await db.collection(COLLECTIONS.metas_certificacion).doc(String(año)).get();
  if (snap.exists) {
    const raw = snap.data() as Partial<MetasCertificacion> | undefined;
    if (raw?.disciplinas?.AA && raw.disciplinas.ELECTRICO && raw.disciplinas.GG) {
      return {
        metas: {
          año,
          pesos: raw.pesos ?? PESOS_CERTIFICACION_CONTRATO,
          disciplinas: raw.disciplinas,
          notas: raw.notas,
        },
        fuente: "firestore",
      };
    }
  }
  const def = metasCertificacionParaAño(año);
  if (def) return { metas: def, fuente: "default" };
  return null;
}

function contarPreventivosCerrados(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  inicioMs: number,
  finMs: number,
  inicioTrimMs: number,
  inicioSemMs: number,
  inicioAñoMs: number,
): Record<DisciplinaLabel, EjecutadosCertificacion> {
  const out = emptyEjecutadosPorDisciplina();

  for (const doc of docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    if (!esPreventivoPuro(d.tipo_trabajo)) continue;
    if (d.estado !== "CERRADA") continue;

    const finOtMs = timestampToMillis(d.fecha_fin_ejecucion);
    if (finOtMs == null || finOtMs < inicioAñoMs || finOtMs >= finMs) continue;

    const esp = normalizarEsp(String(d.especialidad ?? ""));
    if (!esDisciplina(esp)) continue;

    const tier = tierFrecuenciaDesdeOt({
      frecuencia_plan_mtsa: d.frecuencia_plan_mtsa as string | undefined,
      frecuencia: d.frecuencia as string | undefined,
    });

    const bucket = out[esp];
    const enMes = finOtMs >= inicioMs && finOtMs < finMs;

    if (enMes) {
      bucket.totalMes++;
      if (tier) bucket.mes[tier]++;
    }
    if (tier === "T" && finOtMs >= inicioTrimMs && finOtMs < finMs) bucket.acumTrim++;
    if (tier === "S" && finOtMs >= inicioSemMs && finOtMs < finMs) bucket.acumSem++;
    if (tier === "A" && finOtMs >= inicioAñoMs && finOtMs < finMs) bucket.acumAnual++;
  }

  return out;
}

function mergeEjecutadosCertificacion(
  base: Record<DisciplinaLabel, EjecutadosCertificacion>,
  other: Record<DisciplinaLabel, EjecutadosCertificacion>,
): void {
  for (const disc of ["AA", "ELECTRICO", "GG"] as DisciplinaLabel[]) {
    acumularEjecutadosCertificacion(base, disc, other[disc]);
  }
}

function armarOperativo(
  ejecutados: Record<DisciplinaLabel, EjecutadosCertificacion>,
): OperativoReporte {
  const aa = ejecutados.AA.totalMes;
  const el = ejecutados.ELECTRICO.totalMes;
  const gg = ejecutados.GG.totalMes;
  return {
    ejecutados_por_especialidad: { AA: aa, ELECTRICO: el, GG: gg },
    total_ejecutados: aa + el + gg,
    descripcion: META_OPERATIVO,
  };
}

function armarCertificacion(
  ejecutados: Record<DisciplinaLabel, EjecutadosCertificacion>,
  metasPack: { metas: MetasCertificacion; fuente: "firestore" | "default" } | null,
  año: number,
  mes: number,
): CertificacionReporte {
  if (!metasPack) {
    return {
      configurada: false,
      fuente: null,
      año,
      indice: 0,
      pesos: PESOS_CERTIFICACION_CONTRATO,
      por_especialidad: {
        AA: calcularCertificacionDisciplina(
          { mensual: 0, trimestral: 0, semestral: 0, anual: 0 },
          ejecutados.AA,
          mes,
        ),
        ELECTRICO: calcularCertificacionDisciplina(
          { mensual: 0, trimestral: 0, semestral: 0, anual: 0 },
          ejecutados.ELECTRICO,
          mes,
        ),
        GG: calcularCertificacionDisciplina(
          { mensual: 0, trimestral: 0, semestral: 0, anual: 0 },
          ejecutados.GG,
          mes,
        ),
      },
    };
  }

  const porEsp = {
    AA: calcularCertificacionDisciplina(metasPack.metas.disciplinas.AA, ejecutados.AA, mes),
    ELECTRICO: calcularCertificacionDisciplina(
      metasPack.metas.disciplinas.ELECTRICO,
      ejecutados.ELECTRICO,
      mes,
    ),
    GG: calcularCertificacionDisciplina(metasPack.metas.disciplinas.GG, ejecutados.GG, mes),
  };

  return {
    configurada: true,
    fuente: metasPack.fuente,
    año,
    indice: calcularIndiceCertificacion(porEsp, metasPack.metas.pesos),
    pesos: metasPack.metas.pesos,
    por_especialidad: porEsp,
    notas: metasPack.metas.notas,
  };
}

function enriquecerTotales(
  totales: ReturnType<typeof calcularTotalesPreventivo>,
  certificacion: CertificacionReporte,
): ReturnType<typeof calcularTotalesPreventivo> {
  if (certificacion.configurada) {
    return { ...totales, pct_certificacion: certificacion.indice };
  }
  return totales;
}

async function calcularCentro(
  db: FirebaseFirestore.Firestore,
  centro: string,
  año: number,
  mes: number,
  inicio: Timestamp,
  fin: Timestamp,
  metasPack: { metas: MetasCertificacion; fuente: "firestore" | "default" } | null,
  incluirDetalle: boolean,
): Promise<{
  discMap: Record<DisciplinaLabel, DisciplinaMetrica>;
  correctivos: ReporteCumplimientoData["correctivos"];
  otsDetalle: OTFilaDetalle[];
  ejecutadosCert: Record<DisciplinaLabel, EjecutadosCertificacion>;
  operativo: OperativoReporte;
  certificacion: CertificacionReporte;
}> {
  const inicioAño = Timestamp.fromDate(new Date(año, 0, 1, 0, 0, 0));
  const [prevSnap, prevCerradosSnap, corrCerradosSnap, corrCreadosSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("fecha_inicio_programada", ">=", inicio)
      .where("fecha_inicio_programada", "<", fin)
      .get(),
    db
      .collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "==", "PREVENTIVO")
      .where("estado", "==", "CERRADA")
      .where("fecha_fin_ejecucion", ">=", inicioAño)
      .where("fecha_fin_ejecucion", "<", fin)
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
  const inicioAñoMs = inicioAño.toMillis();
  const inicioTrimMs = inicioTrimestreMs(año, mes);
  const inicioSemMs = inicioSemestreMs(año, mes);

  const ejecutadosCert = contarPreventivosCerrados(
    prevCerradosSnap.docs,
    inicioMs,
    finMs,
    inicioTrimMs,
    inicioSemMs,
    inicioAñoMs,
  );
  const operativo = armarOperativo(ejecutadosCert);
  const certificacion = armarCertificacion(ejecutadosCert, metasPack, año, mes);

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
    ejecutadosCert,
    operativo,
    certificacion,
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
    const metasPack = await cargarMetasCertificacion(db, año);

    if (centro === "todas" && centros_lista && centros_lista.length > 0) {
      const resultados = await Promise.all(
        centros_lista.map((c) =>
          calcularCentro(db, c, año, mes, inicio, fin, metasPack, true),
        ),
      );

      const aggDisc = emptyDiscMap();
      const aggEjecutados = emptyEjecutadosPorDisciplina();
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
        mergeEjecutadosCertificacion(aggEjecutados, r.ejecutadosCert);
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

        const totalesCentro = enriquecerTotales(
          calcularTotalesPreventivo(r.discMap),
          r.certificacion,
        );
        porCentro.push({
          centro: c,
          disciplinas: r.discMap,
          correctivos: r.correctivos,
          totales: totalesCentro,
          operativo: r.operativo,
          certificacion: r.certificacion,
        });
      }

      const operativo = armarOperativo(aggEjecutados);
      const certificacion = armarCertificacion(aggEjecutados, metasPack, año, mes);
      const totales = enriquecerTotales(calcularTotalesPreventivo(aggDisc), certificacion);

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
        operativo,
        certificacion,
        por_centro: porCentro,
      });
    }

    const resultado = await calcularCentro(
      db,
      centro,
      año,
      mes,
      inicio,
      fin,
      metasPack,
      true,
    );

    const totales = enriquecerTotales(
      calcularTotalesPreventivo(resultado.discMap),
      resultado.certificacion,
    );

    return success({
      periodo: { mes, año, label: periodoLabel },
      centro,
      meta: META_CRITERIOS_REPORTE,
      meta_correctivos: META_CORRECTIVOS_REPORTE,
      disciplinas: resultado.discMap,
      correctivos: resultado.correctivos,
      ots_detalle: resultado.otsDetalle,
      totales,
      operativo: resultado.operativo,
      certificacion: resultado.certificacion,
    });
  } catch (e) {
    if (e instanceof AppError) return failure(e);
    return failure(new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno"));
  }
}
