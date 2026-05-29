import { describe, expect, it } from "vitest";
import {
  avisoPasaBusqueda,
  busquedaProgramaListaParaCrossWeek,
  textoBusquedaAvisoEnPrograma,
} from "@/modules/scheduling/busqueda-programa-aviso";
import type { AvisoSlot } from "@/modules/scheduling/types";

const avisoBase: AvisoSlot = {
  numero: "11/375283",
  descripcion: "Cambio de rodamiento bomba",
  tipo: "preventivo",
  urgente: false,
  equipoCodigo: "BOM-01",
  ubicacion: "UT-100",
};

describe("avisoPasaBusqueda", () => {
  it("coincide por número de aviso sin espacios", () => {
    expect(avisoPasaBusqueda(avisoBase, "375283")).toBe(true);
    expect(avisoPasaBusqueda(avisoBase, "11/375283")).toBe(true);
  });

  it("coincide por descripción y contexto de localidad", () => {
    expect(avisoPasaBusqueda(avisoBase, "rodamiento")).toBe(true);
    expect(
      avisoPasaBusqueda(avisoBase, "secado", {
        localidad: "SEC-01",
        especialidad: "GG",
      }),
    ).toBe(false);
  });
});

describe("textoBusquedaAvisoEnPrograma", () => {
  it("incluye especialidad legible en el índice", () => {
    const txt = textoBusquedaAvisoEnPrograma(avisoBase, { especialidad: "Electrico" });
    expect(txt).toContain("electrico");
  });
});

describe("busquedaProgramaListaParaCrossWeek", () => {
  it("acepta números cortos y exige al menos 2 caracteres en texto libre", () => {
    expect(busquedaProgramaListaParaCrossWeek("7")).toBe(true);
    expect(busquedaProgramaListaParaCrossWeek("ab")).toBe(true);
    expect(busquedaProgramaListaParaCrossWeek("a")).toBe(false);
    expect(busquedaProgramaListaParaCrossWeek("")).toBe(false);
  });
});
