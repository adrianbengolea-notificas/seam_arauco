import { describe, expect, it } from "vitest";
import {
  assetIdImportDesdeEspecialidad,
  esActivoSinteticoAireGeneral,
  esActivoSinteticoGeneral,
  syntheticAaAssetId,
  syntheticEeAssetId,
} from "@/lib/assets/synthetic-gral-asset";

describe("synthetic-gral-asset", () => {
  it("genera IDs deterministas por centro", () => {
    expect(syntheticEeAssetId("PC01")).toBe("ee-gral-pc01");
    expect(syntheticAaAssetId("PT01")).toBe("aa-gral-pt01");
  });

  it("fuerza EE-GRAL para eléctrico aunque haya UT en catálogo", () => {
    expect(assetIdImportDesdeEspecialidad("E", "PC01", "split-123")).toBe("ee-gral-pc01");
  });

  it("usa AA-GRAL solo cuando no hay activo en catálogo", () => {
    expect(assetIdImportDesdeEspecialidad("A", "PC01", "")).toBe("aa-gral-pc01");
    expect(assetIdImportDesdeEspecialidad("A", "PC01", "split-123")).toBe("split-123");
  });

  it("detecta activos sintéticos AA en KPIs", () => {
    expect(esActivoSinteticoAireGeneral("AA-GRAL", "aa-gral-pc01")).toBe(true);
    expect(esActivoSinteticoGeneral("AA-GRAL", "aa-gral-pc01")).toBe(true);
    expect(esActivoSinteticoGeneral("SPLIT-01", "split-real")).toBe(false);
  });
});
