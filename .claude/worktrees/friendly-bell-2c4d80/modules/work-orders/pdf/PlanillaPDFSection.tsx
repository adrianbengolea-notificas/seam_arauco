import React from "react";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { planillaItemKey } from "@/lib/planillas/item-key";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";
import type { PlanillaRespuesta, PlanillaTemplate, SeccionTemplate } from "@/lib/firestore/types";
import type { WorkOrder } from "@/modules/work-orders/types";

const s = StyleSheet.create({
  wrap: { marginTop: 14 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  arauco: { fontSize: 14, fontWeight: "bold", color: "#0f172a" },
  title: { fontSize: 11, fontWeight: "bold", backgroundColor: "#e4e4e7", padding: 6, marginTop: 10 },
  sub: { fontSize: 9, marginBottom: 4, color: "#52525b" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e4e4e7", paddingVertical: 4 },
  cellLabel: { width: "42%", fontSize: 8, paddingRight: 4 },
  cellSm: { width: "12%", fontSize: 8, textAlign: "center" },
  cellMd: { width: "18%", fontSize: 8, textAlign: "center" },
  obsNote: { fontSize: 7, color: "#71717a", marginTop: 2, marginLeft: 4 },
  sigBox: { marginTop: 12, borderWidth: 1, borderColor: "#a1a1aa", padding: 8, minHeight: 70 },
  sigImg: { width: 120, height: 48, marginBottom: 4 },
});

function itemSummary(
  seccion: SeccionTemplate,
  itemId: string,
  r: PlanillaRespuesta,
): string {
  const ir = r.respuestas[planillaItemKey(seccion.id, itemId)];
  if (!ir) return "—";
  if (ir.estado) return ir.estado;
  const bits: string[] = [];
  if (ir.checklist) bits.push("CL");
  if (ir.servis) bits.push("Srv");
  if (ir.accionSeleccionada) bits.push(ir.accionSeleccionada);
  if (ir.verificada !== undefined) bits.push(ir.verificada ? "Verif." : "No verif.");
  if (ir.cantEnFalla !== undefined) bits.push(`Fallas:${ir.cantEnFalla}`);
  if (ir.operativas !== undefined) bits.push(`Op:${ir.operativas}`);
  if (bits.length) return bits.join(" · ");
  return "—";
}

export function PlanillaPDFSection({
  workOrder,
  template,
  respuesta,
}: {
  workOrder: WorkOrder;
  template: PlanillaTemplate;
  respuesta: PlanillaRespuesta;
}) {
  return (
    <View style={s.wrap} wrap={false}>
      <View style={s.brandRow}>
        <Text style={s.arauco}>ARAUCO</Text>
        <Text style={{ fontSize: 9 }}>Planilla digital · {template.nombre}</Text>
      </View>
      <Text style={s.sub}>
        OT {workOrder.n_ot} · Aviso {workOrder.aviso_numero ?? workOrder.aviso_id ?? "—"} ·{" "}
        {workOrder.ubicacion_tecnica} · {formatFirestoreDate(workOrder.created_at)}
      </Text>
      {respuesta.equipoCodigo ? (
        <Text style={s.sub}>Equipo código: {respuesta.equipoCodigo}</Text>
      ) : null}

      {template.secciones.map((sec) => (
        <View key={sec.id} wrap={false}>
          <Text style={s.title}>{sec.titulo}</Text>
          {sec.tipo === "datos_equipo" && respuesta.datosEquipo ? (
            <View style={{ marginTop: 6 }}>
              {Object.entries(respuesta.datosEquipo).map(([k, v]) =>
                v !== undefined && v !== null && String(v) !== "" ? (
                  <Text key={k} style={{ fontSize: 8, marginBottom: 2 }}>
                    {k}: {String(v)}
                  </Text>
                ) : null,
              )}
            </View>
          ) : null}

          {sec.tipo === "checklist" && sec.items ? (
            <View style={{ marginTop: 4 }}>
              {sec.items.map((it) => {
                const ir = respuesta.respuestas[planillaItemKey(sec.id, it.id)];
                const obs = ir?.observacion || ir?.comentario;
                return (
                  <View key={it.id} wrap={false}>
                    <View style={s.row}>
                      <Text style={s.cellLabel}>{it.label}</Text>
                      <Text style={{ flex: 1, fontSize: 8 }}>{itemSummary(sec, it.id, respuesta)}</Text>
                    </View>
                    {obs ? <Text style={s.obsNote}>{obs}</Text> : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {sec.tipo === "grilla" && sec.items ? (
            <View style={{ marginTop: 4 }}>
              <View style={[s.row, { backgroundColor: "#fafafa", fontWeight: "bold" }]}>
                <Text style={s.cellLabel}>Ítem</Text>
                <Text style={s.cellSm}>Verif.</Text>
                <Text style={s.cellMd}>Fallas</Text>
                <Text style={s.cellMd}>Oper.</Text>
                <Text style={{ flex: 1, fontSize: 8 }}>Notas</Text>
              </View>
              {sec.items.map((it) => {
                const ir = respuesta.respuestas[planillaItemKey(sec.id, it.id)];
                const note = ir?.comentario || ir?.observacion;
                return (
                  <View key={it.id} wrap={false}>
                    <View style={s.row}>
                      <Text style={s.cellLabel}>{it.label}</Text>
                      <Text style={s.cellSm}>{ir?.verificada ? "Sí" : "—"}</Text>
                      <Text style={s.cellMd}>{ir?.cantEnFalla ?? "—"}</Text>
                      <Text style={s.cellMd}>{ir?.operativas ?? "—"}</Text>
                      <Text style={{ flex: 1, fontSize: 8 }}>{note ?? ""}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {sec.tipo === "libre" ? (
            <Text style={{ fontSize: 8, marginTop: 4, lineHeight: 1.35 }}>
              {sec.id === "corr_actividad"
                ? respuesta.actividadRealizada
                : sec.id === "corr_mats"
                  ? respuesta.materialesTexto
                  : sec.id === "corr_obs"
                    ? respuesta.observacionesUsuario
                    : sec.id === "corr_ssgg"
                      ? respuesta.controlCalidadSSGG
                      : sec.id === "elec_rec"
                        ? respuesta.recomendaciones
                        : sec.id === "elec_pedido"
                          ? respuesta.pedidoMateriales
                          : sec.id === "aa_obs"
                            ? respuesta.observacionesFinales
                            : respuesta.textoLibrePorSeccion?.[sec.id] ?? "—"}
            </Text>
          ) : null}

          {sec.tipo === "datos_persona" && respuesta.filasPersonal?.length ? (
            <View style={{ marginTop: 4 }}>
              {respuesta.filasPersonal.map(
                (row, i) =>
                  row.nombreApellido || row.cargoCategoria || row.observaciones ? (
                    <Text key={i} style={{ fontSize: 8, marginBottom: 3 }}>
                      {i + 1}. {row.nombreApellido ?? ""} · {row.cargoCategoria ?? ""} ·{" "}
                      {row.observaciones ?? ""}
                    </Text>
                  ) : null,
              )}
            </View>
          ) : null}

          {sec.tipo === "estado_final" ? (
            <Text style={{ fontSize: 9, marginTop: 4, fontWeight: "bold" }}>
              Estado final: {respuesta.estadoFinal ?? "—"}
            </Text>
          ) : null}
        </View>
      ))}

      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <View style={[s.sigBox, { flex: 1 }]}>
          <Text style={{ fontSize: 8, fontWeight: "bold", marginBottom: 4 }}>Firma usuario</Text>
          {respuesta.firmaUsuario ? (
            <Image src={respuesta.firmaUsuario} style={s.sigImg} />
          ) : null}
          <Text style={{ fontSize: 8 }}>
            {respuesta.firmaUsuarioNombre} · Leg. {respuesta.firmaUsuarioLegajo ?? "—"}
          </Text>
          <Text style={{ fontSize: 7, color: "#71717a" }}>
            {respuesta.firmaUsuarioFecha ? formatFirestoreDate(respuesta.firmaUsuarioFecha) : ""}
          </Text>
        </View>
        <View style={[s.sigBox, { flex: 1 }]}>
          <Text style={{ fontSize: 8, fontWeight: "bold", marginBottom: 4 }}>Firma responsable</Text>
          {respuesta.firmaResponsable ? (
            <Image src={respuesta.firmaResponsable} style={s.sigImg} />
          ) : null}
          <Text style={{ fontSize: 8 }}>{respuesta.firmaResponsableNombre}</Text>
        </View>
      </View>
    </View>
  );
}
