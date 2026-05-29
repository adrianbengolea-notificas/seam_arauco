import { describe, expect, it } from "vitest";
import { avisoDocIdsToTryForWorkOrder } from "@/modules/work-orders/resolve-aviso-vinculado";

describe("avisoDocIdsToTryForWorkOrder", () => {
  it("prioriza aviso_id y variantes numéricas del número SAP", () => {
    const ids = avisoDocIdsToTryForWorkOrder({
      aviso_id: "doc-directo",
      aviso_numero: "11/375283",
      n_ot: "11375283",
    });
    expect(ids[0]).toBe("doc-directo");
    expect(ids).toContain("11375283");
    expect(ids).toContain("11-375283");
  });
});
