import { describe, expect, it } from "vitest";
import {
  deriveCentroFromEquipmentCode,
  deriveCentroPlantCodeFromUbicacionTecnica,
  normalizeCentro,
  resolveCentroForAviso,
} from "@/lib/firestore/derive-centro";

describe("deriveCentroPlantCodeFromUbicacionTecnica", () => {
  it("mapea BOSS a PF01 como fallback UT", () => {
    expect(deriveCentroPlantCodeFromUbicacionTecnica("BOSS-BOS-ADM-CHALET-SGENERAD")).toBe("PF01");
  });
});

describe("deriveCentroFromEquipmentCode", () => {
  it("distingue PM02 de PF01 por código SAP", () => {
    expect(deriveCentroFromEquipmentCode("PM02CH50KVA")).toBe("PM02");
    expect(deriveCentroFromEquipmentCode("PF01VB100KVA")).toBe("PF01");
  });
});

describe("normalizeCentro", () => {
  it("prioriza prefijo del código sobre UT BOSS→PF01", () => {
    expect(
      normalizeCentro("", "BOSS-BOS-ADM-CHALET-SGENERAD", "PM02CH50KVA"),
    ).toBe("PM02");
  });
});

describe("resolveCentroForAviso", () => {
  it("prioriza centro del activo sobre UT ambigua", () => {
    expect(
      resolveCentroForAviso({
        rawCentro: "PF01",
        ut: "BOSS-BOS-ADM-VIGILA-OFICINA1",
        codigoEquipo: "PM02VIG01",
        assetCentro: "PM02",
      }),
    ).toBe("PM02");
  });

  it("respeta centroForzado sobre activo", () => {
    expect(
      resolveCentroForAviso({
        centroForzado: "PM02",
        rawCentro: "PF01",
        ut: "BOSS-BOS-ADM",
        assetCentro: "PF01",
      }),
    ).toBe("PM02");
  });

  it("eléctrico + UT BOSS → PM02 aunque Excel diga PF01", () => {
    expect(
      resolveCentroForAviso({
        rawCentro: "PF01",
        ut: "BOSS-BOS-ADM-CHALET",
        especialidad: "ELECTRICO",
        assetCentro: "PF01",
        codigoEquipo: "EE-GRAL",
      }),
    ).toBe("PM02");
  });

  it("eléctrico + UT BOSS con código import E → PM02", () => {
    expect(
      resolveCentroForAviso({
        rawCentro: "",
        ut: "BOSS-BOS-ADM-ADMIN1",
        especialidad: "E",
      }),
    ).toBe("PM02");
  });

  it("eléctrico + UT YPOR sigue en PF01", () => {
    expect(
      resolveCentroForAviso({
        rawCentro: "PF01",
        ut: "YPOR-YPO-GOF-VIVERO",
        especialidad: "ELECTRICO",
      }),
    ).toBe("PF01");
  });
});
