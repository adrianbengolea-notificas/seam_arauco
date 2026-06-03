import { describe, expect, it } from "vitest";
import { resolveEspecialidadParaPlantilla, selectTemplate } from "@/lib/planillas/select-template";
import type { WorkOrder } from "@/modules/work-orders/types";

function ot(partial: Partial<WorkOrder>): WorkOrder {
  return {
    id: "wo1",
    n_ot: "11376336",
    aviso_id: "av1",
    asset_id: "as1",
    centro: "BOSS",
    especialidad: "AA",
    tipo_trabajo: "PREVENTIVO",
    estado: "ABIERTA",
    texto_trabajo: "MTTO SEMESTRAL AA",
    ubicacion_tecnica: "UT",
    frecuencia: "SEMESTRAL",
    firma_tecnico: null,
    firma_usuario: null,
    created_at: null as never,
    updated_at: null as never,
    ...partial,
  };
}

describe("resolveEspecialidadParaPlantilla", () => {
  it("prioriza AA de la OT sobre GG del aviso (cambio manual de aviso / ciclo anterior)", () => {
    expect(
      resolveEspecialidadParaPlantilla(ot({ especialidad: "AA" }), { especialidadAviso: "GG" }),
    ).toBe("AA");
  });

  it("corrige OT genérica con especialidad concreta del aviso", () => {
    expect(
      resolveEspecialidadParaPlantilla(ot({ especialidad: "GG" }), { especialidadAviso: "AA" }),
    ).toBe("AA");
  });

  it("usa activo cuando OT y aviso son genéricos", () => {
    expect(
      resolveEspecialidadParaPlantilla(ot({ especialidad: "GG" }), {
        especialidadAviso: "GG",
        especialidadActivo: "ELECTRICO",
      }),
    ).toBe("ELECTRICO");
  });
});

describe("selectTemplate", () => {
  it("sugiere AA para preventivo AA aunque el aviso vinculado sea GG", () => {
    expect(
      selectTemplate(ot({ especialidad: "AA", tipo_trabajo: "PREVENTIVO" }), {
        especialidadAviso: "GG",
      }),
    ).toBe("AA");
  });

  it("sugiere ELEC para preventivo eléctrico", () => {
    expect(
      selectTemplate(ot({ especialidad: "ELECTRICO", tipo_trabajo: "PREVENTIVO" }), {
        especialidadAviso: "GG",
      }),
    ).toBe("ELEC");
  });

  it("sugiere GG solo cuando todas las fuentes son genéricas", () => {
    expect(
      selectTemplate(ot({ especialidad: "GG", tipo_trabajo: "PREVENTIVO" }), {
        especialidadAviso: "GG",
      }),
    ).toBe("GG");
  });
});
