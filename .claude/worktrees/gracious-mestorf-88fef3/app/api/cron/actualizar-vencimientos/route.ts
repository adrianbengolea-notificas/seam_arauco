import { crearNotificacion } from "@/lib/notificaciones/crear-notificacion";
import { destinatariosSupervisoresAdmin } from "@/lib/notificaciones/destinatarios";
import {
  estadoVencimientoDesdeDias,
  diasParaVencimientoDesdeProximo,
} from "@/lib/vencimientos";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import type { Aviso } from "@/modules/notices/types";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const CHUNK = 400;

function autorizado(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization");
  return h === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.avisos);
  const snap = await col.get();

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  const now = new Date();

  for (const doc of snap.docs) {
    const data = doc.data() as Aviso;
    const prox = data.proximo_vencimiento;
    if (!prox) continue;

    let proxDate: Date | null = null;
    if (prox instanceof Timestamp) proxDate = prox.toDate();
    else if (prox && typeof (prox as Timestamp).toDate === "function") {
      proxDate = (prox as Timestamp).toDate();
    }
    if (!proxDate) continue;
    const dias = diasParaVencimientoDesdeProximo(proxDate, now);
    const nuevoEstado = estadoVencimientoDesdeDias(dias);
    const prevEstado = data.estado_vencimiento;
    const mtsa = data.frecuencia_plan_mtsa;

    batch.update(doc.ref, {
      dias_para_vencimiento: dias,
      estado_vencimiento: nuevoEstado,
      updated_at: FieldValue.serverTimestamp(),
    } as Record<string, unknown>);
    ops++;
    if (ops >= CHUNK) await flush();

    if (
      nuevoEstado === "vencido" &&
      prevEstado !== "vencido" &&
      (mtsa === "S" || mtsa === "A")
    ) {
      const dest = await destinatariosSupervisoresAdmin(data.centro);
      await crearNotificacion(dest, {
        tipo: "ot_vencida",
        titulo: `Aviso #${data.n_aviso} vencido sin ejecutar`,
        cuerpo:
          (data.texto_corto ?? "").trim().slice(0, 280) ||
          `Centro ${data.centro} · Próximo vencimiento superado.`,
        ...(data.ultima_ejecucion_ot_id ? { otId: data.ultima_ejecucion_ot_id } : {}),
      });
    }
  }

  await flush();
  return new Response(JSON.stringify({ ok: true, procesados: snap.size }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
