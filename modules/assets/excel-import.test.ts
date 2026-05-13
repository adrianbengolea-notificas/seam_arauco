import { describe, expect, it } from "vitest";
import { inferEspecialidadPredeterminada } from "./excel-import";

describe("inferEspecialidadPredeterminada", () => {
  it("marca AA cuando la denominación empieza con AIRE en hoja GG", () => {
    expect(
      inferEspecialidadPredeterminada("AIRE RECEPCION ENFERMERIA", "PC01AD118", "GG"),
    ).toBe("AA");
  });

  it("no pisar AA si la fila ya es coherente con la hoja", () => {
    expect(inferEspecialidadPredeterminada("SPLIT sala 12", "", "GG")).toBe("AA");
    expect(inferEspecialidadPredeterminada("Grupo electrógeno 1", "GG01", "GG")).toBe("GG");
  });

  it("no convertir compresores a AA", () => {
    expect(inferEspecialidadPredeterminada("Compresor de aire 01", "C01", "GG")).toBe("GG");
  });
});
