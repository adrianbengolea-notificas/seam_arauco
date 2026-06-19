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

  it("no trata SSGG ambiguo como GG: usa especialidad persistida (AA)", () => {
    expect(
      especialidadEfectivaAviso({
        especialidad: "AA",
        texto_corto: "MTTO MENSUAL-SSGG PC01COM02",
      }),
    ).toBe("AA");
  });

  it("con especialidad persistida GG, la descripción no la pisa", () => {
    expect(
      especialidadEfectivaAviso({
        especialidad: "GG",
        texto_corto: "CHECK PF01GF164KVA",
      }),
    ).toBe("GG");
  });

  it("sin especialidad persistida, SSGG-02 en texto → GG", () => {
    expect(
      especialidadEfectivaAviso({
        texto_corto: "MTTO SEMESTRAL SSGG-02 PM02CH50KVA",
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

  it("excluye avisos AA con plan SAP SSGG del filtro GG", () => {
    const aviso = { especialidad: "AA" as const, texto_corto: "MTTO MENSUAL-SSGG PF01HOS22" };
    expect(avisoPasaFiltroEspecialidadUi(aviso, "GG")).toBe(false);
    expect(avisoPasaFiltroEspecialidadUi(aviso, "AA")).toBe(true);
  });
});
