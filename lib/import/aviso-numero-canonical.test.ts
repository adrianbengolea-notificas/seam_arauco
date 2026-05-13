import { describe, expect, it } from "vitest";
import {
  avisoDocId,
  candidateAvisoDocIds,
  normalizeNAvisoCompare,
  preferredNumericAvisoId,
  nAvisoStringsForFirestoreInQuery,
} from "./aviso-numero-canonical";

describe("aviso-numero-canonical", () => {
  it("normalizeNAvisoCompare unifica formatos numéricos", () => {
    expect(normalizeNAvisoCompare("11375283")).toBe("11375283");
    expect(normalizeNAvisoCompare("11/375283")).toBe("11375283");
    expect(normalizeNAvisoCompare("0011375283")).toBe("11375283");
    expect(normalizeNAvisoCompare("11-375283")).toBe("11375283");
  });

  it("preferredNumericAvisoId", () => {
    expect(preferredNumericAvisoId("11/375283")).toBe("11375283");
    expect(preferredNumericAvisoId("AB-1")).toBeNull();
  });

  it("candidateAvisoDocIds incluye variantes", () => {
    const c = candidateAvisoDocIds("11/375283");
    expect(c).toContain("11-375283");
    expect(c).toContain("11375283");
  });

  it("avisoDocId reemplaza barras", () => {
    expect(avisoDocId("11/375283")).toBe("11-375283");
  });

  it("nAvisoStringsForFirestoreInQuery amplía variantes para query in", () => {
    const s = new Set(nAvisoStringsForFirestoreInQuery("11/375283"));
    expect(s.has("11/375283")).toBe(true);
    expect(s.has("11375283")).toBe(true);
  });
});