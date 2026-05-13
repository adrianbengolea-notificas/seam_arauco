import { runMatchMaterialCatalogo } from "@/lib/ai/flows/match-material-catalogo";
import {
  applySalidaStockPorOtTransaction,
  getMaterialCatalogItemAdmin,
  listActiveMaterialsCatalogAdmin,
} from "@/modules/materials/repository";
import { getMaterialOtLineAdmin, updateMaterialOtLineAdmin } from "@/modules/work-orders/repository";
import type { Especialidad } from "@/modules/notices/types";

function especialidadParaPrompt(esp: Especialidad): string {
  if (esp === "ELECTRICO") return "E";
  if (esp === "GG" || esp === "HG") return "GG";
  return "A";
}

/**
 * IA en segundo plano: no bloquea la respuesta HTTP de `addMaterialToOT`.
 */
export function scheduleMaterialCatalogMatchAfterCreate(input: {
  workOrderId: string;
  lineId: string;
  textoOriginal: string;
  cantidad: number;
  unidad: string;
  especialidad: Especialidad;
  registradoPorUid: string;
}): void {
  void (async () => {
    const linePath = `${input.workOrderId}/${input.lineId}`;
    try {
      const snap = await getMaterialOtLineAdmin(input.workOrderId, input.lineId);
      if (!snap || snap.schema_version !== 1) return;
      if (snap.normalizacion && snap.normalizacion !== "pendiente") return;

      const catalogoSnapshot = await listActiveMaterialsCatalogAdmin(50);
      const ia = await runMatchMaterialCatalogo({
        textoOriginal: input.textoOriginal,
        especialidad: especialidadParaPrompt(input.especialidad),
        cantidad: input.cantidad,
        unidad: input.unidad,
        catalogoSnapshot: catalogoSnapshot.map((c) => ({
          id: c.id,
          codigo_material: c.codigo_material,
          descripcion: c.descripcion,
          unidad_medida: c.unidad_medida,
        })),
      });

      const lineAgain = await getMaterialOtLineAdmin(input.workOrderId, input.lineId);
      if (!lineAgain || lineAgain.normalizacion !== "pendiente") return;

      if (ia.confianza >= 0.85 && ia.matchEncontrado && ia.catalogoId && ia.codigoMaterial) {
        const mat = await getMaterialCatalogItemAdmin(ia.catalogoId);
        if (!mat || mat.activo === false) {
          await updateMaterialOtLineAdmin(input.workOrderId, input.lineId, {
            normalizacion: "sin_match",
            nombre_normalizado: ia.nombreNormalizado,
            confianza_ia: ia.confianza,
          });
          return;
        }
        await applySalidaStockPorOtTransaction({
          materialId: ia.catalogoId,
          codigoMaterial: ia.codigoMaterial,
          descripcionMaterial: mat.descripcion,
          cantidad: input.cantidad,
          unidad: input.unidad,
          otId: input.workOrderId,
          registradoPorUid: input.registradoPorUid,
        });
        await updateMaterialOtLineAdmin(input.workOrderId, input.lineId, {
          catalogo_id: ia.catalogoId,
          codigo_material: ia.codigoMaterial,
          descripcion_match: ia.descripcionMatch ?? mat.descripcion,
          confianza_ia: ia.confianza,
          normalizacion: "auto_confirmada",
        });
        return;
      }

      if (ia.confianza >= 0.6 && ia.confianza < 0.85) {
        const revPatch: Record<string, unknown> = {
          confianza_ia: ia.confianza,
          nombre_normalizado: ia.nombreNormalizado,
          normalizacion: "revision_pendiente",
        };
        if (ia.catalogoId) revPatch.catalogo_id = ia.catalogoId;
        if (ia.codigoMaterial) revPatch.codigo_material = ia.codigoMaterial;
        if (ia.descripcionMatch) revPatch.descripcion_match = ia.descripcionMatch;
        await updateMaterialOtLineAdmin(input.workOrderId, input.lineId, revPatch);
        return;
      }

      await updateMaterialOtLineAdmin(input.workOrderId, input.lineId, {
        normalizacion: "sin_match",
        nombre_normalizado: ia.nombreNormalizado,
        confianza_ia: ia.confianza,
      });
    } catch (e) {
      console.error("[material-match]", linePath, e);
      try {
        await updateMaterialOtLineAdmin(input.workOrderId, input.lineId, {
          normalizacion: "sin_match",
          nombre_normalizado: input.textoOriginal.trim(),
        });
      } catch {
        /* ignore */
      }
    }
  })();
}
