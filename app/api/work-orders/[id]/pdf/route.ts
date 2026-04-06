import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { verifyIdTokenOrThrow } from "@/lib/auth/verify-id-token";
import {
  getPlanillaTemplateAdmin,
  getSignedPlanillaRespuestaAdmin,
  getWorkOrderById,
  listHistorialAdmin,
} from "@/modules/work-orders/repository";
import { listMaterialesOtAdmin } from "@/modules/materials/repository";
import { WorkOrderPdfDocument } from "@/modules/work-orders/pdf/WorkOrderPdfDocument";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await verifyIdTokenOrThrow(token);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;
  const workOrder = await getWorkOrderById(id);
  if (!workOrder) {
    return new NextResponse("Not found", { status: 404 });
  }

  const materiales = await listMaterialesOtAdmin(id);
  const historial = await listHistorialAdmin(id);

  const planillaRespuesta = await getSignedPlanillaRespuestaAdmin(id);
  const planillaTemplate = planillaRespuesta
    ? await getPlanillaTemplateAdmin(planillaRespuesta.templateId)
    : null;

  try {
    const stream = await renderToStream(
      React.createElement(WorkOrderPdfDocument, {
        workOrder,
        materiales,
        historial,
        planillaTemplate,
        planillaRespuesta,
      }) as Parameters<typeof renderToStream>[0],
    );

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Arauco-Seam-OT-${workOrder.n_ot}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[PDF] OT", e);
    return new NextResponse("Error generating PDF", { status: 500 });
  }
}
