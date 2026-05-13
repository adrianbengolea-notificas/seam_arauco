/**
 * Núcleo del cron motor-ot-diario (compartible por la ruta API, actions y pruebas).
 * No incluye autenticación HTTP — la valida el caller.
 */
import { crearNotificacionSeguro } from "@/lib/notificaciones/crear-notificacion";
import { destinatariosSupervisoresAdmin } from "@/lib/notificaciones/destinatarios";
import { refinarPropuestaOtsConIa } from "@/lib/ai/flows/generar-propuesta-ots";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { ensurePlansForCentro, listPlanesMantenimientoCentro } from "@/lib/plan-mantenimiento/admin";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { mergeAdvertenciasAcotadas } from "@/lib/motor/advertencias-merge";
import { mergeCentroConfig } from "@/modules/centros/merge-config";
import { buildPropuestaGreedyMotor } from "@/lib/scheduling/motor-greedy";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { getIsoWeekId, parseIsoWeekToBounds } from "@/modules/scheduling/iso-week";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { listUserProfilesFiltered } from "@/modules/users/repository";
import type { WorkOrder } from "@/modules/work-orders/types";
import type { OtPropuestaFirestore, PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { FieldValue } from "firebase-admin/firestore";

function metricasDesdeItems(items: OtPropuestaFirestore[], greedyMetricas: PropuestaSemanaFirestore["metricas"]) {
  const carga: Record<string, number> = {};
  for (const i of items) {
    const k = i.especialidad;
    carga[k] = (carga[k] ?? 0) + 1;
  }
  return {
    ...greedyMetricas,
    total_ots_propuestas: items.length,
    carga_por_especialidad: carga,
  };
}

/** Firestore no acepta `undefined` en documentos; elimina claves opcionales no definidas (p. ej. `tecnico_sugerido_id`). */
function itemsPropuestaSinUndefined(items: OtPropuestaFirestore[]): Record<string, unknown>[] {
  return items.map((item) => {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as unknown as Record<string, unknown>)) {
      if (v !== undefined) row[k] = v;
    }
    return row;
  });
}

function notificarPropuestaMergeNuevos(): boolean {
  const v = process.env.CRON_NOTIFY_PROPUESTA_MERGE_NUEVOS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type MotorOtDiarioCentroResult = {
  centro: string;
  propuestaId: string;
  items: number;
  skipped?: boolean;
  reason?: string;
  merged?: boolean;
  mergeNuevos?: number;
  notificacionMerge?: boolean;
  /** Advertencias de esta corrida (también persistidas en la propuesta cuando se escribe). */
  advertencias?: string[];
};

export type MotorOtDiarioResult = {
  ok: true;
  semanaId: string;
  centros: MotorOtDiarioCentroResult[];
};

export type RunMotorOtDiarioOptions = {
  /** Si se informa, solo esos centros (normalmente subconjunto de KNOWN_CENTROS). */
  centros?: readonly string[];
  /** Por defecto semana ISO de hoy. */
  semanaId?: string;
  /** Ignorar la protección de 23h (usar solo desde disparadores manuales, no desde el cron). */
  bypassIdempotencia?: boolean;
};

/**
 * Ejecuta una pasada del motor de propuestas semanales (la grilla se publica solo con aprobación manual).
 */
const MS_23H_IDEMPOTENCIA = 23 * 60 * 60 * 1000;
/** Máximo de OTs recientes leídas por centro; al llegar al tope pueden quedar correctivos abiertos fuera del muestreo. */
const LIMITE_ORDENES_MOTOR_RECENT = 200;

export async function runMotorOtDiario(opts?: RunMotorOtDiarioOptions): Promise<MotorOtDiarioResult> {
  const db = getAdminDb();
  const semanaId = opts?.semanaId?.trim() || getIsoWeekId(new Date());
  const { start: weekStart } = parseIsoWeekToBounds(semanaId);

  const targetCentros = opts?.centros?.length
    ? [...new Set(opts.centros.map((c) => c.trim()).filter(Boolean))]
    : [...KNOWN_CENTROS];

  const bypassIdempotencia =
    opts?.bypassIdempotencia === true ||
    process.env.MOTOR_OT_SKIP_IDEMPOTENCY === "1" ||
    process.env.MOTOR_OT_SKIP_IDEMPOTENCY === "true";

  if (!bypassIdempotencia) {
    const lockRef = db.collection(COLLECTIONS.motor_ot_diario_runs).doc(semanaId);
    const lockSnap = await lockRef.get();
    const lastMs = lockSnap.data()?.last_completed_at?.toMillis?.() ?? 0;
    if (lastMs > 0 && Date.now() - lastMs < MS_23H_IDEMPOTENCIA) {
      return {
        ok: true,
        semanaId,
        centros: targetCentros.map((centro) => ({
          centro,
          propuestaId: propuestaSemanaDocId(centro, semanaId),
          items: 0,
          skipped: true,
          reason: "idempotencia_23h",
        })),
      };
    }
  }

  const out: MotorOtDiarioCentroResult[] = [];
  const avisarMergeNuevos = notificarPropuestaMergeNuevos();

  for (const centro of targetCentros) {
    const c = centro.trim();
    if (!c) continue;

    await ensurePlansForCentro(c);

    const [planes, centroSnap, woSnap, tecnicosRaw] = await Promise.all([
      listPlanesMantenimientoCentro(c),
      db.collection(COLLECTIONS.centros).doc(c).get(),
      db
        .collection(COLLECTIONS.work_orders)
        .where("centro", "==", c)
        .where("archivada", "not-in", [true])
        .orderBy("created_at", "desc")
        .limit(LIMITE_ORDENES_MOTOR_RECENT)
        .get(),
      listUserProfilesFiltered({
        centro: c,
        rol: "tecnico",
        activo: true,
        limit: 200,
      }),
    ]);

    const cfg = mergeCentroConfig(centroSnap.data() as Record<string, unknown> | undefined);
    const correctivos = woSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) }))
      .filter(
        (w) => w.sub_tipo === "correctivo" && (w.estado === "ABIERTA" || w.estado === "EN_EJECUCION"),
      );

    const tecnicos = tecnicosRaw.map((u) => ({
      uid: u.uid,
      display_name: u.display_name,
      especialidades: u.especialidades,
    }));

    const greedy = buildPropuestaGreedyMotor({
      centro: c,
      semanaId,
      weekStart,
      config: cfg.config_motor,
      planes,
      correctivos,
      tecnicos,
    });

    let refinada: Awaited<ReturnType<typeof refinarPropuestaOtsConIa>>;
    try {
      refinada = await refinarPropuestaOtsConIa({
        centro: c,
        semana: semanaId,
        items: greedy.items,
        historialAjustes: [],
        configCentro: cfg.config_motor,
        advertenciasMotor: greedy.advertencias,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      refinada = {
        items: greedy.items,
        cambiosRespectoMotor: [],
        nuevasAdvertencias: [
          `Refinamiento IA no disponible (fallback a propuesta base): ${msg}`,
        ],
      };
    }

    const advertencias = [...greedy.advertencias, ...refinada.nuevasAdvertencias];
    if (
      correctivos.length >= LIMITE_ORDENES_MOTOR_RECENT ||
      woSnap.size >= LIMITE_ORDENES_MOTOR_RECENT
    ) {
      advertencias.push(
        `Se procesaron solo los primeros ${LIMITE_ORDENES_MOTOR_RECENT} correctivos abiertos. Existen posiblemente más sin proponer. Revisá el listado de correctivos.`,
      );
    }
    const advertenciasRespuesta = [...advertencias];
    const docId = propuestaSemanaDocId(c, semanaId);
    const propRef = db.collection(COLLECTIONS.propuestas_semana).doc(docId);
    const existente = await propRef.get();

    if (existente.exists) {
      const prev = { id: existente.id, ...(existente.data() as Omit<PropuestaSemanaFirestore, "id">) };
      if (prev.status !== "pendiente_aprobacion") {
        out.push({
          centro: c,
          propuestaId: docId,
          items: prev.items?.length ?? 0,
          skipped: true,
          reason: prev.status,
          advertencias: advertenciasRespuesta,
        });
        continue;
      }

      const prevItems = prev.items ?? [];
      const finalizados = prevItems.filter((i) => i.status !== "propuesta");
      if (finalizados.length > 0) {
        const planesUsados = new Set(
          finalizados.map((i) => i.plan_id).filter((x): x is string => Boolean(x?.trim())),
        );
        const otsUsadas = new Set(
          finalizados.map((i) => i.work_order_id).filter((x): x is string => Boolean(x?.trim())),
        );
        const motorSinConflictos = refinada.items.filter((i) => {
          if (i.plan_id?.trim() && planesUsados.has(i.plan_id.trim())) return false;
          if (i.work_order_id?.trim() && otsUsadas.has(i.work_order_id.trim())) return false;
          return true;
        });
        const merged = [...finalizados, ...motorSinConflictos];
        const metricas = metricasDesdeItems(merged, greedy.metricas);

        await propRef.set({
          id: docId,
          centro: c,
          semana: semanaId,
          generada_en: FieldValue.serverTimestamp(),
          generada_por: "motor_ia",
          status: merged.some((i) => i.status === "propuesta") ? "pendiente_aprobacion" : "aprobada",
          items: itemsPropuestaSinUndefined(merged),
          advertencias: mergeAdvertenciasAcotadas(prev.advertencias, advertencias),
          metricas,
        } as Record<string, unknown>);

        const nNuevos = motorSinConflictos.length;
        let notificacionMerge = false;
        if (avisarMergeNuevos && nNuevos > 0) {
          const dest = await destinatariosSupervisoresAdmin(c);
          crearNotificacionSeguro(dest, {
            tipo: "propuesta_disponible",
            titulo: `Propuesta actualizada · ${semanaId} · ${c}`,
            cuerpo: `El motor agregó ${nNuevos} ítem(es) nuevo(s) a la propuesta en curso. Revisá /programa/aprobacion?semana=${semanaId}.`,
            href: `/programa/aprobacion?semana=${encodeURIComponent(semanaId)}`,
          });
          notificacionMerge = true;
        }

        out.push({
          centro: c,
          propuestaId: docId,
          items: merged.length,
          merged: true,
          mergeNuevos: nNuevos,
          notificacionMerge,
          advertencias: advertenciasRespuesta,
        });
        continue;
      }
    }

    await propRef.set({
      id: docId,
      centro: c,
      semana: semanaId,
      generada_en: FieldValue.serverTimestamp(),
      generada_por: "motor_ia",
      status: "pendiente_aprobacion",
      items: itemsPropuestaSinUndefined(refinada.items),
      advertencias: mergeAdvertenciasAcotadas([], advertencias),
      metricas: greedy.metricas,
    } as Record<string, unknown>);

    const dest = await destinatariosSupervisoresAdmin(c);
    crearNotificacionSeguro(dest, {
      tipo: "propuesta_disponible",
      titulo: `Propuesta de OTs lista · ${semanaId} · ${c}`,
      cuerpo: `${refinada.items.length} ítems propuestados. Revisá /programa/aprobacion?semana=${semanaId}.`,
      href: `/programa/aprobacion?semana=${encodeURIComponent(semanaId)}`,
    });

    out.push({
      centro: c,
      propuestaId: docId,
      items: refinada.items.length,
      advertencias: advertenciasRespuesta,
    });
  }

  if (!bypassIdempotencia) {
    await db
      .collection(COLLECTIONS.motor_ot_diario_runs)
      .doc(semanaId)
      .set(
        {
          last_completed_at: FieldValue.serverTimestamp(),
          semana_id: semanaId,
        } as Record<string, unknown>,
        { merge: true },
      );
  }

  return { ok: true, semanaId, centros: out };
}
