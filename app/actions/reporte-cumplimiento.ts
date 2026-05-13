"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError } from "@/lib/errors/app-error";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type SitioLabel =
  | "Esperanza"
  | "Bossetti"
  | "Yporá"
  | "Piray"
  | "Garita"
  | "Otro";

export type DisciplinaLabel = "AA" | "ELECTRICO" | "GG";

export type SitioMetrica = {
  sitio: SitioLabel;
  planificadas: number;
  ejecutadas: number;
  pct: number;
};

export type DisciplinaMetrica = {
  planificadas: number;
  ejecutadas: number;
  pct: number;
  por_sitio: SitioMetrica[];
};

export type CorrectivoFila = {
  n_ot: string;
  aviso_numero: string;
  descripcion: string;
  especialidad: string;
  ubicacion: string;
  sitio: SitioLabel;
  planificado: boolean;
  ejecutado: boolean;
  fecha: string | null;
};

export type OTFilaDetalle = {
  n_ot: string;
  aviso_numero: string;
  descripcion: string;
  especialidad: DisciplinaLabel | string;
  frecuencia: string;
  ubicacion: string;
  sitio: SitioLabel;
  estado: string;
  tipo: "preventivo" | "correctivo";
  planificada: boolean;
  ejecutada: boolean;
  fecha_ejecucion: string | null;
  fecha_creacion: string;
};

export type CorrectivosPorEspecialidad = {
  AA: number;
  ELECTRICO: number;
  GG: number;
  /** Especialidad no reconocida o vacía */
  otro: number;
};

export type CentroResumen = {
  centro: string;
  disciplinas: Record<DisciplinaLabel, DisciplinaMetrica>;
  correctivos: {
    planificados: number;
    no_planificados: number;
    total: number;
    pct_cumplimiento: number;
    por_especialidad: CorrectivosPorEspecialidad;
  };
  totales: {
    preventivos_planificados: number;
    preventivos_ejecutados: number;
    pct_general: number;
    pct_certificacion: number;
  };
};

export type ReporteCumplimientoData = {
  periodo: { mes: number; año: number; label: string };
  centro: string;
  disciplinas: Record<DisciplinaLabel, DisciplinaMetrica>;
  correctivos: {
    planificados: number;
    no_planificados: number;
    total: number;
    pct_cumplimiento: number;
    /** Distribución de correctivos del período por especialidad (AA / Eléctrico / GG). */
    por_especialidad: CorrectivosPorEspecialidad;
    detalle: CorrectivoFila[];
  };
  ots_detalle: OTFilaDetalle[];
  totales: {
    preventivos_planificados: number;
    preventivos_ejecutados: number;
    pct_general: number;
    /** Índice de certificación ponderado: AA×50% + Eléctrico×40% + GG×10% */
    pct_certificacion: number;
  };
  /** Presente solo cuando centro = "todas" */
  por_centro?: CentroResumen[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MESES_ES = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function sitioDesdeUt(ut: string | undefined): SitioLabel {
  if (!ut) return "Otro";
  const prefix = ut.split("-")[0]?.toUpperCase() ?? "";
  if (prefix === "ESPE" || prefix === "ESP") return "Esperanza";
  if (prefix === "BOSS" || prefix === "BOS") return "Bossetti";
  if (prefix === "YPOR" || prefix === "YPO") return "Yporá";
  if (prefix === "PIRA" || prefix === "PIR") return "Piray";
  if (prefix === "GARI" || prefix === "GAR") return "Garita";
  return "Otro";
}

function normalizarEsp(esp: string): DisciplinaLabel | string {
  const u = esp?.toUpperCase() ?? "";
  if (u === "AA") return "AA";
  if (u === "ELECTRICO" || u === "ELÉCTRICO" || u === "HG") return "ELECTRICO";
  if (u === "GG" || u === "GENERADOR") return "GG";
  return esp;
}

function esDisciplina(esp: string): esp is DisciplinaLabel {
  return esp === "AA" || esp === "ELECTRICO" || esp === "GG";
}

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

function emptyDisciplina(): DisciplinaMetrica {
  const sitios: SitioLabel[] = ["Esperanza", "Bossetti", "Yporá", "Piray", "Garita", "Otro"];
  return {
    planificadas: 0,
    ejecutadas: 0,
    pct: 0,
    por_sitio: sitios.map((s) => ({ sitio: s, planificadas: 0, ejecutadas: 0, pct: 0 })),
  };
}

// ─── Core query por un centro ─────────────────────────────────────────────────

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
  const [prevPlanSnap, prevEjecSnap, corrSnap] = await Promise.all([
    db.collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "in", ["PREVENTIVO", "CORRECTIVO_PREVENTIVO"])
      .where("created_at", ">=", inicio)
      .where("created_at", "<", fin)
      .get(),
    db.collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "in", ["PREVENTIVO", "CORRECTIVO_PREVENTIVO"])
      .where("estado", "==", "CERRADA")
      .where("fecha_fin_ejecucion", ">=", inicio)
      .where("fecha_fin_ejecucion", "<", fin)
      .get(),
    db.collection(COLLECTIONS.work_orders)
      .where("centro", "==", centro)
      .where("tipo_trabajo", "in", ["CORRECTIVO", "EMERGENCIA", "URGENTE"])
      .where("created_at", ">=", inicio)
      .where("created_at", "<", fin)
      .get(),
  ]);

  const discMap: Record<DisciplinaLabel, DisciplinaMetrica> = {
    AA: emptyDisciplina(),
    ELECTRICO: emptyDisciplina(),
    GG: emptyDisciplina(),
  };

  const ejecIds = new Set(prevEjecSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => d.id));
  const otsDetalle: OTFilaDetalle[] = [];

  for (const doc of prevPlanSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    const esp = normalizarEsp(String(d.especialidad ?? ""));
    const sitio = sitioDesdeUt(d.ubicacion_tecnica as string | undefined);
    const ejecutada = ejecIds.has(doc.id);

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
        fecha_ejecucion: ejecutada
          ? tsToDateStr(d.fecha_fin_ejecucion as FirebaseFirestore.Timestamp | null)
          : null,
        fecha_creacion: tsToDateStr(d.created_at as FirebaseFirestore.Timestamp) ?? "",
      });
    }
  }

  for (const doc of prevEjecSnap.docs) {
    if (prevPlanSnap.docs.some((p: FirebaseFirestore.QueryDocumentSnapshot) => p.id === doc.id)) continue;
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    const esp = normalizarEsp(String(d.especialidad ?? ""));
    const sitio = sitioDesdeUt(d.ubicacion_tecnica as string | undefined);

    if (esDisciplina(esp)) {
      discMap[esp].ejecutadas++;
      const sp = discMap[esp].por_sitio.find((s) => s.sitio === sitio);
      if (sp) sp.ejecutadas++;
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
        planificada: false,
        ejecutada: true,
        fecha_ejecucion: tsToDateStr(d.fecha_fin_ejecucion as FirebaseFirestore.Timestamp | null),
        fecha_creacion: tsToDateStr(d.created_at as FirebaseFirestore.Timestamp) ?? "",
      });
    }
  }

  for (const disc of Object.values(discMap)) {
    disc.pct = disc.planificadas > 0
      ? Math.round((disc.ejecutadas / disc.planificadas) * 100) / 100
      : 0;
    for (const sp of disc.por_sitio) {
      sp.pct = sp.planificadas > 0
        ? Math.round((sp.ejecutadas / sp.planificadas) * 100) / 100
        : 0;
    }
  }

  const corrDetalle: CorrectivoFila[] = [];
  let corrPlan = 0;
  let corrNoPlan = 0;
  const porEspCorr = emptyPorEspecialidadCorrectivos();

  for (const doc of corrSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.archivada === true) continue;
    const tienAviso = Boolean(d.aviso_id || d.aviso_numero);
    const ejecutado = d.estado === "CERRADA";
    const sitio = sitioDesdeUt(d.ubicacion_tecnica as string | undefined);
    const esp = normalizarEsp(String(d.especialidad ?? ""));
    if (esDisciplina(esp)) porEspCorr[esp]++;
    else porEspCorr.otro++;

    if (tienAviso) corrPlan++; else corrNoPlan++;

    if (incluirDetalle) {
      corrDetalle.push({
        n_ot: String(d.n_ot ?? ""),
        aviso_numero: String(d.aviso_numero ?? ""),
        descripcion: String(d.texto_trabajo ?? ""),
        especialidad: esDisciplina(esp) ? esp : (String(d.especialidad ?? "").trim() || "—"),
        ubicacion: String(d.ubicacion_tecnica ?? ""),
        sitio,
        planificado: tienAviso,
        ejecutado,
        fecha: tsToDateStr(d.fecha_fin_ejecucion as FirebaseFirestore.Timestamp | null)
          ?? tsToDateStr(d.created_at as FirebaseFirestore.Timestamp | null),
      });
    }
  }

  const corrTotal = corrSnap.docs.filter(
    (doc) => (doc.data() as { archivada?: boolean }).archivada !== true,
  ).length;
  const corrEjecutados = corrDetalle.filter((c) => c.ejecutado).length
    + (!incluirDetalle ? 0 : 0);

  return {
    discMap,
    correctivos: {
      planificados: corrPlan,
      no_planificados: corrNoPlan,
      total: corrTotal,
      pct_cumplimiento: corrTotal > 0
        ? Math.round((corrEjecutados / corrTotal) * 100) / 100
        : 0,
      por_especialidad: porEspCorr,
      detalle: corrDetalle,
    },
    otsDetalle,
  };
}

function calcularTotales(discMap: Record<DisciplinaLabel, DisciplinaMetrica>) {
  const totalPlan = discMap.AA.planificadas + discMap.ELECTRICO.planificadas + discMap.GG.planificadas;
  const totalEjec = discMap.AA.ejecutadas + discMap.ELECTRICO.ejecutadas + discMap.GG.ejecutadas;
  const pctAA   = discMap.AA.planificadas       > 0 ? discMap.AA.ejecutadas       / discMap.AA.planificadas       : 0;
  const pctElec = discMap.ELECTRICO.planificadas > 0 ? discMap.ELECTRICO.ejecutadas / discMap.ELECTRICO.planificadas : 0;
  const pctGG   = discMap.GG.planificadas       > 0 ? discMap.GG.ejecutadas       / discMap.GG.planificadas       : 0;
  return {
    preventivos_planificados: totalPlan,
    preventivos_ejecutados: totalEjec,
    pct_general: totalPlan > 0 ? Math.round((totalEjec / totalPlan) * 100) / 100 : 0,
    pct_certificacion: Math.round((pctAA * 0.5 + pctElec * 0.4 + pctGG * 0.1) * 10000) / 10000,
  };
}

function mergeDiscMap(
  base: Record<DisciplinaLabel, DisciplinaMetrica>,
  other: Record<DisciplinaLabel, DisciplinaMetrica>,
): Record<DisciplinaLabel, DisciplinaMetrica> {
  const discs: DisciplinaLabel[] = ["AA", "ELECTRICO", "GG"];
  for (const disc of discs) {
    base[disc].planificadas += other[disc].planificadas;
    base[disc].ejecutadas += other[disc].ejecutadas;
    for (const sp of base[disc].por_sitio) {
      const otherSp = other[disc].por_sitio.find((s) => s.sitio === sp.sitio);
      if (otherSp) {
        sp.planificadas += otherSp.planificadas;
        sp.ejecutadas += otherSp.ejecutadas;
      }
    }
  }
  // recalc pct
  for (const disc of discs) {
    base[disc].pct = base[disc].planificadas > 0
      ? Math.round((base[disc].ejecutadas / base[disc].planificadas) * 100) / 100
      : 0;
    for (const sp of base[disc].por_sitio) {
      sp.pct = sp.planificadas > 0 ? Math.round((sp.ejecutadas / sp.planificadas) * 100) / 100 : 0;
    }
  }
  return base;
}

// ─── Schema validación ────────────────────────────────────────────────────────

const InputSchema = z.object({
  centro: z.string().trim().min(1),
  mes: z.number().int().min(1).max(12),
  año: z.number().int().min(2020).max(2099),
  centros_lista: z.array(z.string()).optional(),
});

// ─── Server Action ────────────────────────────────────────────────────────────

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

    // ─── Modo TODAS ─────────────────────────────────────────────────────────
    if (centro === "todas" && centros_lista && centros_lista.length > 0) {
      const resultados = await Promise.all(
        centros_lista.map((c) => calcularCentro(db, c, inicio, fin, true)),
      );

      const aggDisc: Record<DisciplinaLabel, DisciplinaMetrica> = {
        AA: emptyDisciplina(),
        ELECTRICO: emptyDisciplina(),
        GG: emptyDisciplina(),
      };
      let aggCorrPlan = 0;
      let aggCorrNoPlan = 0;
      let aggCorrTotal = 0;
      const aggPorEspCorr = emptyPorEspecialidadCorrectivos();
      const aggOtsDetalle: OTFilaDetalle[] = [];
      const aggCorrDetalle: CorrectivoFila[] = [];

      const porCentro: CentroResumen[] = [];

      for (let i = 0; i < centros_lista.length; i++) {
        const r = resultados[i];
        const c = centros_lista[i];
        mergeDiscMap(aggDisc, r.discMap);
        aggCorrPlan += r.correctivos.planificados;
        aggCorrNoPlan += r.correctivos.no_planificados;
        aggCorrTotal += r.correctivos.total;
        aggPorEspCorr.AA += r.correctivos.por_especialidad.AA;
        aggPorEspCorr.ELECTRICO += r.correctivos.por_especialidad.ELECTRICO;
        aggPorEspCorr.GG += r.correctivos.por_especialidad.GG;
        aggPorEspCorr.otro += r.correctivos.por_especialidad.otro;
        aggOtsDetalle.push(...r.otsDetalle);
        aggCorrDetalle.push(...r.correctivos.detalle);

        const cTotales = calcularTotales(r.discMap);
        porCentro.push({
          centro: c,
          disciplinas: r.discMap,
          correctivos: {
            planificados: r.correctivos.planificados,
            no_planificados: r.correctivos.no_planificados,
            total: r.correctivos.total,
            pct_cumplimiento: r.correctivos.pct_cumplimiento,
            por_especialidad: r.correctivos.por_especialidad,
          },
          totales: cTotales,
        });
      }

      const aggEjecutados = aggCorrDetalle.filter((c) => c.ejecutado).length;
      const totales = calcularTotales(aggDisc);

      return success({
        periodo: { mes, año, label: periodoLabel },
        centro: "todas",
        disciplinas: aggDisc,
        correctivos: {
          planificados: aggCorrPlan,
          no_planificados: aggCorrNoPlan,
          total: aggCorrTotal,
          pct_cumplimiento: aggCorrTotal > 0
            ? Math.round((aggEjecutados / aggCorrTotal) * 100) / 100
            : 0,
          por_especialidad: aggPorEspCorr,
          detalle: aggCorrDetalle,
        },
        ots_detalle: aggOtsDetalle,
        totales,
        por_centro: porCentro,
      });
    }

    // ─── Modo centro único ───────────────────────────────────────────────────
    const { discMap, correctivos, otsDetalle } = await calcularCentro(
      db, centro, inicio, fin, true,
    );

    return success({
      periodo: { mes, año, label: periodoLabel },
      centro,
      disciplinas: discMap,
      correctivos,
      ots_detalle: otsDetalle,
      totales: calcularTotales(discMap),
    });
  } catch (e) {
    if (e instanceof AppError) return failure(e);
    return failure(new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno"));
  }
}
