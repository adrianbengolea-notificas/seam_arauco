import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { nombreCentro } from "@/lib/config/app-config";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";
import type { ItemRespuesta, PlanillaRespuesta, PlanillaTemplate } from "@/lib/firestore/types";
import { planillaFirmaResponsableSrc, planillaFirmaUsuarioSrc } from "@/lib/planillas/form-utils";
import { planillaItemKey } from "@/lib/planillas/item-key";
import type { WorkOrder } from "@/modules/work-orders/types";

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: "Helvetica", color: "#111" },
  frame: { borderWidth: 1.2, borderColor: "#000", flexGrow: 1 },
  banner: {
    borderBottomWidth: 1,
    borderColor: "#000",
    backgroundColor: "#dedede",
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  bannerTitle: { fontSize: 10, fontWeight: "bold", textTransform: "uppercase", textAlign: "center" },
  bannerSub: { fontSize: 7.5, marginTop: 3, textAlign: "center" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", borderBottomWidth: 1, borderColor: "#000" },
  metaBox: {
    width: "50%",
    flexDirection: "row",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#000",
    minHeight: 20,
  },
  metaBoxFull: {
    width: "100%",
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#000",
    minHeight: 20,
  },
  metaLab: { width: "34%", fontSize: 7, fontWeight: "bold", padding: 4, backgroundColor: "#f0f0f0", borderRightWidth: 1, borderColor: "#000" },
  metaVal: { flex: 1, fontSize: 8, padding: 4 },
  secHead: {
    backgroundColor: "#c8c8c8",
    borderBottomWidth: 1,
    borderColor: "#000",
    padding: 4,
    fontSize: 8,
    fontWeight: "bold",
  },
  datosRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  datosLab: {
    width: "14%",
    fontSize: 7,
    fontWeight: "bold",
    padding: 3,
    backgroundColor: "#f2f2f2",
    borderRightWidth: 1,
    borderColor: "#000",
  },
  datosVal: { width: "36%", fontSize: 7.5, padding: 3, borderRightWidth: 1, borderColor: "#000" },
  gridRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  th: {
    padding: 3,
    fontSize: 7,
    fontWeight: "bold",
    textAlign: "center",
    borderRightWidth: 1,
    borderColor: "#000",
    backgroundColor: "#e4e4e4",
  },
  tdN: { width: "5%", textAlign: "center", fontSize: 7, padding: 2, borderRightWidth: 1, borderColor: "#000" },
  tdTxt: { width: "61%", fontSize: 7, padding: 3, borderRightWidth: 1, borderColor: "#000", lineHeight: 1.25 },
  tdEst: { width: "11.33%", textAlign: "center", fontSize: 8, fontWeight: "bold", padding: 2, borderRightWidth: 1, borderColor: "#000" },
  obs: { minHeight: 44, padding: 6, fontSize: 8, lineHeight: 1.35, borderBottomWidth: 1, borderColor: "#000" },
  estadoRow: { flexDirection: "row", padding: 6, borderBottomWidth: 1, borderColor: "#000", alignItems: "center" },
  estadoLab: { fontSize: 8, fontWeight: "bold", width: "32%" },
  estadoVal: { fontSize: 9, fontWeight: "bold" },
  firmasRow: { flexDirection: "row", paddingTop: 6 },
  firmaCol: { flex: 1, borderWidth: 1, borderColor: "#000", marginHorizontal: 3, minHeight: 78, padding: 5 },
  firmaTit: { fontSize: 7, fontWeight: "bold", marginBottom: 4 },
  firmaImg: { width: 110, height: 40, marginBottom: 3 },
  firmaTxt: { fontSize: 7 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 28,
    right: 28,
    textAlign: "center",
    fontSize: 6.5,
    color: "#555",
  },
});

function marcarEstado(ir: ItemRespuesta | undefined, codigo: "BUENO" | "REGULAR" | "MALO"): string {
  const e = ir?.estado;
  if (!e) return "";
  if (codigo === "BUENO" && e === "BUENO") return "X";
  if (codigo === "REGULAR" && e === "REGULAR") return "X";
  if (codigo === "MALO" && e === "MALO") return "X";
  return "";
}

function datosEquipoRows(d: PlanillaRespuesta["datosEquipo"]): { label: string; value: string }[] {
  if (!d) return [];
  const frio = [d.frioCalor ? "Frío/Calor: Sí" : null, d.frioSolo ? "Solo frío: Sí" : null].filter(Boolean).join(" · ");
  return [
    { label: "Código", value: d.codigoEquipo ?? "—" },
    { label: "Marca", value: d.marca ?? "—" },
    { label: "Modelo", value: d.modelo ?? "—" },
    { label: "Tipo", value: d.tipo ?? "—" },
    { label: "Rendimiento", value: d.rendimiento ?? "—" },
    { label: "Tipo gas", value: d.tipoGas ?? "—" },
    { label: "Frigorías", value: d.frigorias ?? "—" },
    { label: "Potencia", value: d.potencia ?? "—" },
    { label: "Tipo placa", value: d.tipoPlaca ?? "—" },
    { label: "Modalidad", value: frio || "—" },
    { label: "Serie exterior", value: d.serie_ext ?? "—" },
    { label: "Serie interior", value: d.serie_int ?? "—" },
  ];
}

export function PlanillaAAPdfDocument({
  workOrder,
  template,
  respuesta,
}: {
  workOrder: WorkOrder;
  template: PlanillaTemplate;
  respuesta: PlanillaRespuesta;
}) {
  const actSec = template.secciones.find((x) => x.id === "aa_act");
  const items = actSec?.items ?? [];
  const d = respuesta.datosEquipo;
  const pairs = datosEquipoRows(d);
  const aviso = workOrder.aviso_numero?.trim() || workOrder.aviso_id?.trim() || "—";
  const freq = respuesta.frecuencia ? ` · Frec. ${respuesta.frecuencia}` : "";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.frame}>
          <View style={s.banner}>
            <Text style={s.bannerTitle}>Planilla de mantenimiento preventivo — Aire acondicionado</Text>
            <Text style={s.bannerSub}>Celulosa Arauco · {template.nombre}</Text>
          </View>

          <View style={s.metaGrid}>
            <View style={s.metaBox}>
              <Text style={s.metaLab}>Centro / Planta</Text>
              <Text style={s.metaVal}>{nombreCentro(workOrder.centro)}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLab}>N.º orden Seam</Text>
              <Text style={s.metaVal}>{workOrder.n_ot}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLab}>Aviso SAP</Text>
              <Text style={s.metaVal}>{aviso}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLab}>Fecha</Text>
              <Text style={s.metaVal}>{formatFirestoreDate(workOrder.created_at, "dd/MM/yyyy")}{freq}</Text>
            </View>
            <View style={s.metaBoxFull}>
              <Text style={s.metaLab}>Ubicación técnica</Text>
              <Text style={s.metaVal}>{workOrder.ubicacion_tecnica}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLab}>Código activo</Text>
              <Text style={s.metaVal}>{workOrder.codigo_activo_snapshot}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLab}>Equipo (planilla)</Text>
              <Text style={s.metaVal}>{respuesta.equipoCodigo?.trim() || "—"}</Text>
            </View>
          </View>

          <Text style={s.secHead}>Datos del equipo</Text>
          {Array.from({ length: Math.ceil(pairs.length / 2) }).map((_, rowIdx) => {
            const a = pairs[rowIdx * 2];
            const b = pairs[rowIdx * 2 + 1];
            return (
              <View key={rowIdx} style={s.datosRow} wrap={false}>
                <Text style={s.datosLab}>{a?.label ?? ""}</Text>
                <Text style={s.datosVal}>{a?.value ?? ""}</Text>
                <Text style={s.datosLab}>{b?.label ?? ""}</Text>
                <Text style={[s.datosVal, { borderRightWidth: 0 }]}>{b?.value ?? ""}</Text>
              </View>
            );
          })}

          <Text style={s.secHead}>Actividades — marcar según inspección (B bueno · R regular · M malo)</Text>
          <View style={s.gridRow} wrap={false}>
            <Text style={[s.th, { width: "5%" }]}>N.º</Text>
            <Text style={[s.th, { width: "61%", textAlign: "left", paddingLeft: 4 }]}>Descripción</Text>
            <Text style={[s.th, { width: "11.33%" }]}>B</Text>
            <Text style={[s.th, { width: "11.33%" }]}>R</Text>
            <Text style={[s.th, { width: "11.34%", borderRightWidth: 0 }]}>M</Text>
          </View>
          {items.map((it, idx) => {
            const key = planillaItemKey("aa_act", it.id);
            const ir = respuesta.respuestas[key];
            const obs = ir?.observacion || ir?.comentario;
            return (
              <View key={it.id} wrap={false}>
                <View style={s.gridRow}>
                  <Text style={s.tdN}>{idx + 1}</Text>
                  <Text style={s.tdTxt}>
                    {it.label}
                    {obs ? `\nObs.: ${obs}` : ""}
                  </Text>
                  <Text style={s.tdEst}>{marcarEstado(ir, "BUENO")}</Text>
                  <Text style={s.tdEst}>{marcarEstado(ir, "REGULAR")}</Text>
                  <Text style={[s.tdEst, { borderRightWidth: 0 }]}>{marcarEstado(ir, "MALO")}</Text>
                </View>
              </View>
            );
          })}

          <View style={s.estadoRow} wrap={false}>
            <Text style={s.estadoLab}>Estado final del equipo</Text>
            <Text style={s.estadoVal}>{respuesta.estadoFinal ?? "—"}</Text>
          </View>

          <Text style={s.secHead}>Observaciones</Text>
          <Text style={s.obs}>{respuesta.observacionesFinales?.trim() || "—"}</Text>

          <View style={s.firmasRow}>
            <View style={s.firmaCol}>
              <Text style={s.firmaTit}>Nombre y firma (Arauco / planta)</Text>
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
              <Text style={s.firmaTit}>Firma técnico SEAM</Text>
              {planillaFirmaResponsableSrc(respuesta) ? (
                <Image src={planillaFirmaResponsableSrc(respuesta)!} style={s.firmaImg} />
              ) : null}
              <Text style={s.firmaTxt}>{respuesta.firmaResponsableNombre ?? "—"}</Text>
            </View>
          </View>
        </View>
        <Text style={s.footer} fixed>
          Documento generado desde Arauco-Seam · OT {workOrder.n_ot} · Planilla firmada
        </Text>
      </Page>
    </Document>
  );
}
