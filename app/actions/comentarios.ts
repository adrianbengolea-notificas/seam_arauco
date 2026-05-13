"use server";

import { failure, success, type ActionResult } from "@/lib/actions/action-result";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { getAdminDb } from "@/firebase/firebaseAdmin";
import { crearNotificacionSeguro } from "@/lib/notificaciones/crear-notificacion";
import { destinatariosSupervisoresAdmin } from "@/lib/notificaciones/destinatarios";
import type { Comentario } from "@/lib/firestore/types";
import type { Rol } from "@/lib/permisos/index";
import { toPermisoRol } from "@/lib/permisos/index";
import { requirePermisoFromToken } from "@/lib/permisos/server";
import type { UserProfileWithUid } from "@/modules/users/repository";
import type { WorkOrder } from "@/modules/work-orders/types";
import {
  addComentarioAdmin,
  appendHistorialAdmin,
  getComentarioAdmin,
  getWorkOrderById,
  listComentarioDocsAdmin,
} from "@/modules/work-orders/repository";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import { tecnicoPuedeVerOtEnCentro } from "@/modules/work-orders/tecnico-ot-access";
import { z } from "zod";

function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return fn()
    .then((data) => success(data))
    .catch((e: unknown) => {
      if (isAppError(e)) return Promise.resolve(failure(e));
      const err = new AppError("INTERNAL", e instanceof Error ? e.message : "Error interno", { cause: e });
      return Promise.resolve(failure(err));
    });
}

const agregarSchema = z.object({
  texto: z.string().min(1).max(12_000),
  respondidoA: z.string().optional(),
});

function ensurePuedeVerOt(session: UserProfileWithUid, wo: WorkOrder): void {
  const r = toPermisoRol(session.rol);
  if (r === "superadmin") return;
  if (r === "admin" || r === "supervisor" || r === "cliente_arauco") {
    if (wo.centro !== session.centro) throw new AppError("FORBIDDEN", "Centro no permitido");
    return;
  }
  if (r === "tecnico") {
    if (!tecnicoPuedeVerOtEnCentro(wo, session.uid, centrosEfectivosDelUsuario(session))) {
      throw new AppError(
        "FORBIDDEN",
        "Solo comentarios sobre OTs de tu centro (asignadas o sin asignar)",
      );
    }
  }
}

export async function agregarComentario(
  idToken: string,
  otId: string,
  raw: z.infer<typeof agregarSchema>,
): Promise<ActionResult<Comentario>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "comentarios:crear");
    const data = agregarSchema.parse(raw);
    const wo = await getWorkOrderById(otId);
    if (!wo) throw new AppError("NOT_FOUND", "OT no encontrada");
    ensurePuedeVerOt(session, wo);

    let respondidoA = data.respondidoA?.trim();
    if (respondidoA) {
      const prev = await getComentarioAdmin(otId, respondidoA);
      if (!prev) throw new AppError("VALIDATION", "El comentario citado no existe");
    } else {
      respondidoA = undefined;
    }

    const autorRol = toPermisoRol(session.rol) as Rol;
    const comentarioId = await addComentarioAdmin(otId, {
      otId,
      texto: data.texto.trim(),
      autorId: session.uid,
      autorNombre: session.display_name?.trim() || session.email || session.uid,
      autorRol,
      respondidoA,
      leido: false,
      leidoPor: {},
    });

    const nombreAutor = session.display_name?.trim() || session.email || session.uid;
    await appendHistorialAdmin(otId, {
      tipo: "COMENTARIO",
      actor_uid: session.uid,
      payload: {
        comentarioId,
        texto: `Comentario de ${nombreAutor}`,
      },
    });

    const destinatarios = (await destinatariosSupervisoresAdmin(wo.centro)).filter((d) => d.uid !== session.uid);
    crearNotificacionSeguro(destinatarios, {
      tipo: "comentario_nuevo",
      titulo: `Nuevo comentario en OT n.º ${wo.n_ot}`,
      cuerpo: data.texto.trim().slice(0, 280),
      otId,
    });

    if (respondidoA) {
      const original = await getComentarioAdmin(otId, respondidoA);
      if (original && original.autorId !== session.uid) {
        crearNotificacionSeguro(
          [{ uid: original.autorId, rol: original.autorRol, centro: wo.centro }],
          {
            tipo: "comentario_respondido",
            titulo: `Respondieron tu comentario en OT n.º ${wo.n_ot}`,
            cuerpo: data.texto.trim().slice(0, 280),
            otId,
          },
        );
      }
    }

    const created = await getComentarioAdmin(otId, comentarioId);
    if (!created) throw new AppError("INTERNAL", "No se pudo leer el comentario creado");
    return created;
  });
}

export async function marcarComentariosLeidos(idToken: string, otId: string): Promise<ActionResult<void>> {
  return wrap(async () => {
    const session = await requirePermisoFromToken(idToken, "comentarios:ver");
    const wo = await getWorkOrderById(otId);
    if (!wo) throw new AppError("NOT_FOUND", "OT no encontrada");
    ensurePuedeVerOt(session, wo);

    const docs = await listComentarioDocsAdmin(otId);
    const db = getAdminDb();
    let batch = db.batch();
    let n = 0;
    const leidoPath = `leidoPor.${session.uid}`;
    for (const d of docs) {
      batch.update(d.ref, {
        [leidoPath]: true,
      });
      n++;
      if (n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  });
}
