import { crearNotificacionSeguro } from "@/lib/notificaciones/crear-notificacion";
import { destinatariosSupervisoresAdmin } from "@/lib/notificaciones/destinatarios";
import { refinarPropuestaOtsConIa } from "@/lib/ai/flows/generar-propuesta-ots";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { ensurePlansForCentro, listPlanesMantenimientoCentro } from "@/lib/plan-mantenimiento/admin";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { mergeCentroConfig } from "@/modules/centros/merge-config";
import { tryAutoPublicarPropuestaMotor } from "@/modules/scheduling/programa-propuesta-bridge";
import { buildPropuestaGreedyMotor } from "@/lib/scheduling/motor-greedy";
import { propuestaSemanaDocId } from "@/lib/scheduling/propuesta-id";
import { getIsoWeekId, parseIsoWeekToBounds } from "@/modules/scheduling/iso-week";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { listUserProfilesFiltered } from "@/modules/users/repository";
import type { WorkOrder } from "@/modules/work-orders/types";
import type { OtPropuestaFirestore, PropuestaSemanaFirestore } from "@/lib/firestore/plan-mantenimiento-types";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

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

function autorizado(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization");
  return h === `Bearer ${secret}`;
}

/** Si es true, al hacer merge se notifica cuando el motor agrega ítems nuevos (variable `CRON_NOTIFY_PROPUESTA_MERGE_NUEVOS`). */
function notificarPropuestaMergeNuevos(): boolean {
  const v = process.env.CRON_NOTIFY_PROPUESTA_MERGE_NUEVOS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = getAdminDb();
  const semanaId = getIsoWeekId(new Date());
  const { start: weekStart } = parseIsoWeekToBounds(semanaId);
  const out: Array<{
    centro: string;
    propuestaId: string;
    items: number;
    skipped?: boolean;
    reason?: string;
    merged?: boolean;
    mergeNuevos?: number;
    notificacionMerge?: boolean;
  }> = [];

  const avisarMergeNuevos = notificarPropuestaMergeNuevos();

  for (const centro of KNOWN_CENTROS) {
    const c = centro.trim();
    if (!c) continue;

    await ensurePlansForCentro(c);
    const planes = await listPlanesMantenimientoCentro(c);

    const centroSnap = await db.collection(COLLECTIONS.centros).doc(c).get();
    const cfg = mergeCentroConfig(centroSnap.data() as Record<string, unknown> | undefined);

    const woSnap = await db.collection(COLLECTIONS.work_orders).where("centro", "==", c).limit(200).get();
    const correctivos = woSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<WorkOrder, "id">) }))
      .filter(
        (w) => w.sub_tipo === "correctivo" && (w.estado === "ABIERTA" || w.estado === "EN_EJECUCION"),
      );

    const tecnicosRaw = await listUserProfilesFiltered({
      centro: c,
      rol: "tecnico",
      activo: true,
      limit: 200,
    });
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

    const refinada = await refinarPropuestaOtsConIa({
      centro: c,
      semana: semanaId,
      items: greedy.items,
      historialAjustes: [],
      configCentro: cfg.config_motor,
      advertenciasMotor: greedy.advertencias,
    });

    const advertencias = [...greedy.advertencias, ...refinada.nuevasAdvertencias];
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
          items: merged,
          advertencias: [...(prev.advertencias ?? []), ...advertencias],
          metricas,
        } as Record<string, unknown>);

        const nNuevos = motorSinConflictos.length;
        let notificacionMerge = false;
        if (avisarMergeNuevos && nNuevos > 0) {
          const dest = await destinatariosSupervisoresAdmin(c);
          crearNotificacionSeguro(dest, {
            tipo: "propuesta_disponible",
            titulo: `Propuesta actualizada · ${semanaId} · ${c}`,
            cuerpo: `El motor agregó ${nNuevos} ítem(es) nuevo(s) a la propuesta en curso. Revisá /programa/aprobacion.`,
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
      items: refinada.items,
      advertencias,
      metricas: greedy.metricas,
    } as Record<string, unknown>);

    const dest = await destinatariosSupervisoresAdmin(c);
    crearNotificacionSeguro(dest, {
      tipo: "propuesta_disponible",
      titulo: `Propuesta de OTs lista · ${semanaId} · ${c}`,
      cuerpo: `${refinada.items.length} ítems propuestos. Revisá el programa.`,
    });

    out.push({ centro: c, propuestaId: docId, items: refinada.items.length });
  }

  const auto_publicacion: Array<{ centro: string; did?: boolean; reason?: string; error?: string }> = [];
  for (const centro of KNOWN_CENTROS) {
    const c = centro.trim();
    if (!c) continue;
    try {
      const centroSnap = await db.collection(COLLECTIONS.centros).doc(c).get();
      const cfgMerged = mergeCentroConfig(centroSnap.data() as Record<string, unknown> | undefined);
      const r = await tryAutoPublicarPropuestaMotor({ centro: c, semanaId, cfg: cfgMerged });
      auto_publicacion.push({ centro: c, did: r.did, reason: r.reason });
    } catch (e) {
      auto_publicacion.push({
        centro: c,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, semanaId, centros: out, auto_publicacion }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
