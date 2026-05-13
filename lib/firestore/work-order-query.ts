import { where, type QueryFieldFilterConstraint } from "firebase/firestore";

/**
 * Excluye OT marcadas como archivadas (soft-delete).
 * Usa igualdad explícita para alinear con los índices compuestos de `firestore.indexes.json`
 * (`archivada` + `centro` + `orderBy`, etc.). `not-in` cuenta como desigualdad y no combina
 * con `or(...)` en Firestore Standard; además los índices del repo están definidos con `== false`.
 */
export function woConstraintExcluirArchivadas(): QueryFieldFilterConstraint {
  return where("archivada", "==", false);
}
