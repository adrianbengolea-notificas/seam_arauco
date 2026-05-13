import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";
import type { ItemRespuesta, ItemTemplate, PlanillaRespuesta, PlanillaTemplate } from "@/lib/firestore/types";
import { planillaFirmaResponsableSrc, planillaFirmaUsuarioSrc } from "@/lib/planillas/form-utils";
import { planillaItemKey } from "@/lib/planillas/item-key";
import type { WorkOrder } from "@/modules/work-orders/types";

const s = StyleSheet.create({
  page: { padding: 22, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  docFrame: { borderWidth: 1, borderColor: "#000" },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingBottom: 6,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#000",
  },
  logo: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  titleRight: {
    flex: 1,
    fontSize: 9,
    textAlign: "right",
    textDecoration: "underline",
    fontStyle: "italic",
    paddingLeft: 12,
    lineHeight: 1.25,
  },
  infoBox: { borderWidth: 1, borderColor: "#000", marginBottom: 0 },
  infoRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#000", minHeight: 18 },
  infoRowLast: { flexDirection: "row", minHeight: 18 },
  infoLab: {
    fontSize: 7.5,
    fontWeight: "bold",
    padding: 4,
    borderRightWidth: 1,
    borderRightColor: "#000",
    backgroundColor: "#f5f5f5",
  },
  infoVal: { flex: 1, fontSize: 8, padding: 4 },
  locBar: {
    flexDirection: "row",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: "#000",
    minHeight: 20,
  },
  locLab: {
    width: "22%",
    fontSize: 7.5,
    fontWeight: "bold",
    padding: 4,
    borderRightWidth: 1,
    borderColor: "#000",
    backgroundColor: "#ebebeb",
  },
  locVal: { fontSize: 8, padding: 4, borderRightWidth: 1, borderColor: "#000" },
  tableOuter: { borderWidth: 1, borderTopWidth: 0, borderColor: "#000" },
  tableHeadRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#000", backgroundColor: "#e8e8e8" },
  thMain: {
    width: "58%",
    fontSize: 8,
    fontWeight: "bold",
    fontStyle: "italic",
    textAlign: "center",
    padding: 4,
    borderRightWidth: 1,
    borderColor: "#000",
  },
  thChk: {
    width: "21%",
    fontSize: 8,
    fontWeight: "bold",
    fontStyle: "italic",
    textAlign: "center",
    padding: 4,
    borderRightWidth: 1,
    borderColor: "#000",
  },
  thSrv: {
    width: "21%",
    fontSize: 8,
    fontWeight: "bold",
    fontStyle: "italic",
    textAlign: "center",
    padding: 4,
  },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#000", minHeight: 14 },
  tdMain: {
    width: "58%",
    fontSize: 7,
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderColor: "#000",
    lineHeight: 1.2,
  },
  tdMainBold: {
    width: "58%",
    fontSize: 7,
    fontWeight: "bold",
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderColor: "#000",
    lineHeight: 1.2,
  },
  tdChk: {
    width: "21%",
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "center",
    padding: 2,
    borderRightWidth: 1,
    borderColor: "#000",
  },
  tdSrv: { width: "21%", fontSize: 9, fontWeight: "bold", textAlign: "center", padding: 2 },
  obsTitle: { fontSize: 8, fontWeight: "bold", marginTop: 6, marginBottom: 2, paddingLeft: 2 },
  obsBox: { borderWidth: 1, borderColor: "#000", minHeight: 72, padding: 4 },
  obsText: { fontSize: 8, lineHeight: 1.35, marginBottom: 4 },
  obsLine: { borderBottomWidth: 0.6, borderBottomColor: "#999", height: 11, marginTop: 0 },
  firmasRow: { flexDirection: "row", marginTop: 10, paddingTop: 4 },
  firmaCol: {
    width: "48%",
    borderWidth: 1,
    borderColor: "#000",
    marginHorizontal: "1%",
    minHeight: 78,
    padding: 5,
  },
  firmaTit: { fontSize: 7, fontWeight: "bold", marginBottom: 3 },
  firmaImg: { width: 105, height: 38, marginBottom: 2 },
  firmaTxt: { fontSize: 7 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 22,
    right: 22,
    textAlign: "center",
    fontSize: 6,
    color: "#444",
  },
});

function frecuenciaChequeoLabel(ot: WorkOrder): string {
  const f = ot.frecuencia?.toLowerCase() ?? "";
  if (!f) return "—";
  return f.replaceAll("_", " ");
}

function resolveGgChecklists(template: PlanillaTemplate): {
  motor: { id: string; titulo: string; items: ItemTemplate[] };
  generador: { id: string; titulo: string; items: ItemTemplate[] };
} {
  const byId = (id: string) => template.secciones.find((x) => x.id === id);
  const motorSec = byId("gg_motor");
  const genSec = byId("gg_generador");
  const checklists = template.secciones.filter((x) => x.tipo === "checklist" && x.items?.length);
  return {
    motor: {
      id: motorSec?.id ?? checklists[0]?.id ?? "gg_motor",
      titulo: motorSec?.titulo ?? "Motor",
      items: motorSec?.items ?? checklists[0]?.items ?? [],
    },
    generador: {
      id: genSec?.id ?? checklists[1]?.id ?? "gg_generador",
      titulo: genSec?.titulo ?? "Generador y tableros TTA",
      items: genSec?.items ?? checklists[1]?.items ?? [],
    },
  };
}

function textoLibreGgObs(template: PlanillaTemplate, respuesta: PlanillaRespuesta): string {
  const obsSec = template.secciones.find((x) => x.id === "gg_obs");
  if (!obsSec) return "";
  return respuesta.textoLibrePorSeccion?.[obsSec.id]?.trim() ?? "";
}

/** Marca Ch.list / Servis para cada subfila (modelo accionesRespuestas o legacy). */
function marksForSubrow(ir: ItemRespuesta | undefined, accion: string | null, isFirstSubrow: boolean): { cl: string; srv: string } {
  if (accion == null) {
    // Ítem sin acciones
    return { cl: ir?.checklist ? "X" : "", srv: ir?.servis ? "X" : "" };
  }
  // Nuevo modelo: per acción
  if (ir?.accionesRespuestas) {
    const ar = ir.accionesRespuestas[accion];
    return { cl: ar?.checklist ? "X" : "", srv: ar?.servis ? "X" : "" };
  }
  // Legacy: accionSeleccionada marca la primera subfila que coincide
  const matches = ir?.accionSeleccionada === accion;
  const useRow = matches || (isFirstSubrow && !ir?.accionSeleccionada);
  if (!useRow) return { cl: "", srv: "" };
  return { cl: ir?.checklist ? "X" : "", srv: ir?.servis ? "X" : "" };
}

function GgThreeColTable({
  firstColTitle,
  seccionId,
  items,
  respuesta,
}: {
  firstColTitle: string;
  seccionId: string;
  items: ItemTemplate[];
  respuesta: PlanillaRespuesta;
}) {
  return (
    <View style={s.tableOuter} wrap={false}>
      <View style={s.tableHeadRow}>
        <Text style={s.thMain}>{firstColTitle}</Text>
        <Text style={s.thChk}>Check list</Text>
        <Text style={s.thSrv}>Servis</Text>
      </View>
      {items.map((it) => {
        const ir = respuesta.respuestas[planillaItemKey(seccionId, it.id)];
        const acciones = it.acciones?.length ? it.acciones : [];
        if (acciones.length === 0) {
          const m = marksForSubrow(ir, null, true);
          return (
            <View key={it.id} style={s.tr} wrap={false}>
              <Text style={s.tdMainBold}>{it.label}</Text>
              <Text style={s.tdChk}>{m.cl}</Text>
              <Text style={s.tdSrv}>{m.srv}</Text>
            </View>
          );
        }
        return (
          <View key={it.id}>
            <View style={s.tr} wrap={false}>
              <Text style={s.tdMainBold}>{it.label}</Text>
              <Text style={s.tdChk} />
              <Text style={s.tdSrv} />
            </View>
            {acciones.map((acc, j) => {
              const m = marksForSubrow(ir, acc, j === 0);
              return (
                <View key={`${it.id}-${acc}`} style={s.tr} wrap={false}>
                  <Text style={s.tdMain}>{"   · "}{acc}</Text>
                  <Text style={s.tdChk}>{m.cl}</Text>
                  <Text style={s.tdSrv}>{m.srv}</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export function PlanillaGGPdfDocument({
  workOrder,
  template,
  respuesta,
}: {
  workOrder: WorkOrder;
  template: PlanillaTemplate;
  respuesta: PlanillaRespuesta;
}) {
  const { motor, generador } = resolveGgChecklists(template);
  const d = respuesta.datosEquipo;
  const aviso = workOrder.aviso_numero?.trim() || workOrder.aviso_id?.trim() || workOrder.n_ot;
  const motorMarcaModelo = [d?.gg_motor_marca, d?.gg_motor_modelo].filter(Boolean).join(" ").trim() || "—";
  const generadorMarcaModelo = [d?.gg_gen_marca, d?.gg_gen_modelo].filter(Boolean).join(" ").trim() || "—";
  const serieMotor = d?.gg_motor_serie?.trim() || "—";
  const serieGenerador = d?.gg_gen_serie?.trim() || "—";
  const potenciaKva = d?.gg_gen_kva?.trim() || "—";
  const combustible = d?.gg_combustible?.trim() || "—";
  const equipoLine = [workOrder.codigo_activo_snapshot, workOrder.texto_trabajo?.trim()]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 200);
  const obsText = textoLibreGgObs(template, respuesta);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.docFrame}>
          <View style={{ padding: 8 }}>
            <View style={s.headerRow}>
              <Text style={s.logo}>arauco</Text>
              <Text style={s.titleRight}>
                Mantenimientos de grupos generadores de energía Arauco
              </Text>
            </View>

            <View style={s.infoBox}>
              <View style={s.infoRow}>
                <Text style={[s.infoLab, { width: "18%" }]}>Proveedor :</Text>
                <Text style={[s.infoVal, { width: "32%" }]}>SEAM</Text>
                <Text style={[s.infoLab, { width: "18%" }]}>Fecha :</Text>
                <Text style={[s.infoVal, { borderRightWidth: 0, width: "32%" }]}>
                  {formatFirestoreDate(workOrder.created_at, "dd/MM/yyyy")}
                </Text>
              </View>
              <View style={s.infoRow}>
                <Text style={[s.infoLab, { width: "22%" }]}>Pedido de Compra :</Text>
                <Text style={[s.infoVal, { width: "28%" }]}>{aviso}</Text>
                <Text style={[s.infoLab, { width: "22%" }]}>Tipo de chequeo :</Text>
                <Text style={[s.infoVal, { borderRightWidth: 0, width: "28%" }]}>
                  ({frecuenciaChequeoLabel(workOrder)}; etc.)
                </Text>
              </View>
              <View style={s.infoRow}>
                <Text style={[s.infoLab, { width: "12%" }]}>Equipo :</Text>
                <Text style={[s.infoVal, { flex: 1, borderRightWidth: 0 }]}>{equipoLine || "—"}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={[s.infoLab, { width: "28%" }]}>Motor : (Marca y modelo)</Text>
                <Text style={[s.infoVal, { width: "37%" }]}>{motorMarcaModelo}</Text>
                <Text style={[s.infoLab, { width: "15%" }]}>N° de serie:</Text>
                <Text style={[s.infoVal, { width: "20%", borderRightWidth: 0 }]}>{serieMotor}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={[s.infoLab, { width: "28%" }]}>Generador : (marca y modelo)</Text>
                <Text style={[s.infoVal, { width: "20%" }]}>{generadorMarcaModelo}</Text>
                <Text style={[s.infoLab, { width: "13%" }]}>N° de serie:</Text>
                <Text style={[s.infoVal, { width: "13%" }]}>{serieGenerador}</Text>
                <Text style={[s.infoLab, { width: "16%" }]}>Potencia KVA:</Text>
                <Text style={[s.infoVal, { width: "10%", borderRightWidth: 0 }]}>{potenciaKva}</Text>
              </View>
              <View style={s.infoRowLast}>
                <Text style={[s.infoLab, { width: "22%" }]}>Tipo de combustible:</Text>
                <Text style={[s.infoVal, { flex: 1, borderRightWidth: 0 }]}>{combustible}</Text>
              </View>
            </View>

            <View style={s.locBar} wrap={false}>
              <Text style={[s.locLab, { width: "20%" }]}>Ubicación Técnica:</Text>
              <Text style={[s.locVal, { width: "32%" }]}>{workOrder.ubicacion_tecnica}</Text>
              <Text style={[s.locLab, { width: "18%" }]}>Responsable:</Text>
              <Text style={[s.locVal, { width: "30%", borderRightWidth: 0 }]}>
                {workOrder.tecnico_asignado_nombre ?? "—"}
              </Text>
            </View>

            <GgThreeColTable firstColTitle="Motor" seccionId={motor.id} items={motor.items} respuesta={respuesta} />
            <GgThreeColTable
              firstColTitle="Generador y tableros TTA"
              seccionId={generador.id}
              items={generador.items}
              respuesta={respuesta}
            />

            <Text style={s.obsTitle}>Observaciones :</Text>
            <View style={s.obsBox}>
              {obsText ? <Text style={s.obsText}>{obsText}</Text> : null}
              {Array.from({ length: 7 }).map((_, i) => (
                <View key={i} style={s.obsLine} />
              ))}
            </View>

            <View style={s.firmasRow} wrap={false}>
              <View style={s.firmaCol}>
                <Text style={s.firmaTit}>Firma y nombre — Arauco (planta)</Text>
                {planillaFirmaUsuarioSrc(respuesta) ? (
                  <Image src={planillaFirmaUsuarioSrc(respuesta)!} style={s.firmaImg} />
                ) : null}
                <Text style={s.firmaTxt}>
                  {respuesta.firmaUsuarioNombre ?? "—"} · Leg. {respuesta.firmaUsuarioLegajo ?? "—"}
                </Text>
                <Text style={s.firmaTxt}>
                  {respuesta.firmaUsuarioFecha ? formatFirestoreDate(respuesta.firmaUsuarioFecha) : ""}
                </Text>
              </View>
              <View style={s.firmaCol}>
                <Text style={s.firmaTit}>Firma técnico — SEAM</Text>
                {planillaFirmaResponsableSrc(respuesta) ? (
                  <Image src={planillaFirmaResponsableSrc(respuesta)!} style={s.firmaImg} />
                ) : null}
                <Text style={s.firmaTxt}>{respuesta.firmaResponsableNombre ?? "—"}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          Generado en Arauco-Seam · OT {workOrder.n_ot} · Planilla firmada
        </Text>
      </Page>
    </Document>
  );
}
