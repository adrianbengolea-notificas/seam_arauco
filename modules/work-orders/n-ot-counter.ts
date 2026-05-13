import { getAdminDb } from "@/firebase/firebaseAdmin";
import { FieldValue, type Transaction } from "firebase-admin/firestore";

/** Fragmentos del correlativo: menos contención que un único doc `counters/work_orders`. */
const NUM_SHARDS = 32;
/**
 * Piso numérico para el esquema fragmentado. Los correlativos históricos del contador único suelen quedar por debajo;
 * si un proyecto ya superó este valor, subir la constante antes de desplegar.
 */
const SHARDED_N_OT_BASE = 2_000_000;

const shardsCol = () =>
  getAdminDb().collection("counters").doc("work_orders_shards").collection("shards");

/**
 * Reserva el siguiente `n_ot` dentro de la misma transacción Firestore que crea la orden (y actualiza el aviso).
 */
export async function allocateNextNotNumberInTransaction(txn: Transaction): Promise<number> {
  const shardId = Math.floor(Math.random() * NUM_SHARDS);
  const shardRef = shardsCol().doc(String(shardId));
  const shardSnap = await txn.get(shardRef);
  const prev = (shardSnap.data()?.seq as number | undefined) ?? 0;
  const nextLocal = prev + 1;
  txn.set(
    shardRef,
    { seq: nextLocal, updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return SHARDED_N_OT_BASE + shardId + NUM_SHARDS * nextLocal;
}
