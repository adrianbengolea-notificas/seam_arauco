import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { verifyIdTokenOrThrow } from "@/lib/auth/verify-id-token";
import { tienePermiso, toPermisoRol } from "@/lib/permisos/index";
import { getUserProfileByUid } from "@/modules/users/repository";
import {
  getPlanillaTemplateAdmin,
  getSignedPlanillaRespuestaAdmin,
  getWorkOrderById,
} from "@/modules/work-orders/repository";
import { hydratePlanillaFirmasForPdf } from "@/lib/pdf/hydrate-planilla-firmas";
import { WorkOrderPdfDocument } from "@/modules/work-orders/pdf/WorkOrderPdfDocument";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";
import { tecnicoPuedeVerOtEnCentro } from "@/modules/work-orders/tecnico-ot-access";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let uid: string;
  try {
    ({ uid } = await verifyIdTokenOrThrow(token));
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;
  const workOrder = await getWorkOrderById(id);
  if (!workOrder) {
    return new NextResponse("Not found", { status: 404 });
  }

  const profile = await getUserProfileByUid(uid);
  if (!profile?.activo) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const r = toPermisoRol(profile.rol);
  const puedePdf = tienePermiso(r, "ot:descargar_pdf") || tienePermiso(r, "cliente:descargar_pdf");
  if (!puedePdf) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (r === "tecnico" && !tecnicoPuedeVerOtEnCentro(workOrder, uid, centrosEfectivosDelUsuario(profile))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const planillaRespuesta = await getSignedPlanillaRespuestaAdmin(id);
  if (!planillaRespuesta) {
    return new NextResponse(
      "No hay planilla firmada para esta orden. El PDF incluye únicamente la planilla; el resto de la información está en el sistema.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const planillaTemplate = await getPlanillaTemplateAdmin(planillaRespuesta.templateId);
  if (!planillaTemplate) {
    return new NextResponse("Plantilla de planilla no disponible.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const planillaParaPdf = await hydratePlanillaFirmasForPdf(planillaRespuesta);
    const stream = await renderToStream(
      React.createElement(WorkOrderPdfDocument, {
        workOrder,
        planillaTemplate,
        planillaRespuesta: planillaParaPdf,
      }) as Parameters<typeof renderToStream>[0],
    );

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Arauco-Seam-planilla-${workOrder.n_ot}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[PDF] OT", e);
    return new NextResponse("Error generating PDF", { status: 500 });
  }
}
