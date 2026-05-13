import React from "react";
import { Document, Page, StyleSheet, Text } from "@react-pdf/renderer";
import type { PlanillaRespuesta, PlanillaTemplate } from "@/lib/firestore/types";
import { PlanillaAAPdfDocument } from "@/modules/work-orders/pdf/PlanillaAAPdf";
import { PlanillaGGPdfDocument } from "@/modules/work-orders/pdf/PlanillaGGPdf";
import { PlanillaPDFSection } from "@/modules/work-orders/pdf/PlanillaPDFSection";
import type { WorkOrder } from "@/modules/work-orders/types";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#e4e4e7",
    paddingTop: 8,
    textAlign: "center",
    color: "#a1a1aa",
    fontSize: 8,
  },
});

/**
 * PDF de descarga: solo la planilla firmada (formato papel según tipo).
 * Los demás datos de la orden permanecen en la aplicación.
 */
export function WorkOrderPdfDocument({
  workOrder,
  planillaTemplate,
  planillaRespuesta,
}: {
  workOrder: WorkOrder;
  planillaTemplate: PlanillaTemplate;
  planillaRespuesta: PlanillaRespuesta;
}) {
  if (planillaTemplate.id === "AA") {
    return (
      <PlanillaAAPdfDocument workOrder={workOrder} template={planillaTemplate} respuesta={planillaRespuesta} />
    );
  }

  if (planillaTemplate.id === "GG") {
    return (
      <PlanillaGGPdfDocument workOrder={workOrder} template={planillaTemplate} respuesta={planillaRespuesta} />
    );
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PlanillaPDFSection workOrder={workOrder} template={planillaTemplate} respuesta={planillaRespuesta} />
        <Text style={styles.footer} fixed>
          Planilla firmada · Arauco-Seam · OT {workOrder.n_ot}
        </Text>
      </Page>
    </Document>
  );
}
