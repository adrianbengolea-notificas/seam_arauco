import { describe, expect, it } from "vitest";
import {
  avisoPasaFiltroEspecialidadUi,
  especialidadEfectivaAviso,
} from "@/modules/notices/filtro-especialidad-aviso";

describe("especialidadEfectivaAviso", () => {
  it("prioriza AA explícito en descripción sobre GG persistido", () => {
    expect(
      especialidadEfectivaAviso({
        especialidad: "GG",
        texto_corto: "MTTO ANUAL AA PF01GAR01",
      }),
    ).toBe("AA");
  });

  it("usa especialidad persistida si la descripción no indica otra", () => {
    expect(
      especialidadEfectivaAviso({
        especialidad: "GG",
        texto_corto: "MTTO ANUAL GRUPO GENERADOR PF01",
      }),
    ).toBe("GG");
  });
});

describe("avisoPasaFiltroEspecialidadUi", () => {
  it("excluye avisos AA mal clasificados como GG al filtrar GG", () => {
    const aviso = { especialidad: "GG" as const, texto_corto: "MTTO SEMESTRAL AA PM02EXPO3" };
    expect(avisoPasaFiltroEspecialidadUi(aviso, "GG")).toBe(false);
    expect(avisoPasaFiltroEspecialidadUi(aviso, "AA")).toBe(true);
  });
});
