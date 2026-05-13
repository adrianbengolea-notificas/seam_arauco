import { where, type QueryFieldFilterConstraint } from "firebase/firestore";

/**
 * Excluye OT marcadas como archivadas (soft-delete).
 * `not-in [true]` incluye documentos sin campo `archivada` (históricos).
 */
export function woConstraintExcluirArchivadas(): QueryFieldFilterConstraint {
  return where("archivada", "not-in", [true]);
}
