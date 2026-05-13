import { openDB, type DBSchema, type IDBPDatabase } from "idb";

type OtRow = {
  id: string;
  json: string;
  updatedAtMs: number;
  dayKey: string;
};

interface CmmsDB extends DBSchema {
  work_orders_day: {
    key: string;
    value: OtRow;
    indexes: { "by-day": string };
  };
  outbox: {
    key: string;
    value: {
      id: string;
      type: string;
      payloadJson: string;
      createdAtMs: number;
    };
  };
}

const DB_NAME = "industrial-cmms-v1";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CmmsDB>> | null = null;

export function getOtDb(): Promise<IDBPDatabase<CmmsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CmmsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore("work_orders_day", { keyPath: "id" });
        store.createIndex("by-day", "dayKey");
        db.createObjectStore("outbox", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export function dayKeyFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function cacheWorkOrdersForDay(rows: Array<{ id: string; json: unknown }>, dayKey: string) {
  const db = await getOtDb();
  const tx = db.transaction("work_orders_day", "readwrite");
  for (const r of rows) {
    await tx.store.put({
      id: r.id,
      json: JSON.stringify(r.json),
      updatedAtMs: Date.now(),
      dayKey,
    });
  }
  await tx.done;
}

export async function loadCachedWorkOrdersForDay(dayKey: string): Promise<unknown[]> {
  const db = await getOtDb();
  const all = await db.getAllFromIndex("work_orders_day", "by-day", dayKey);
  return all.map((r) => JSON.parse(r.json) as unknown);
}

export async function enqueueOutbox(type: string, payload: unknown) {
  const db = await getOtDb();
  const id = crypto.randomUUID();
  await db.put("outbox", {
    id,
    type,
    payloadJson: JSON.stringify(payload),
    createdAtMs: Date.now(),
  });
}

export async function drainOutbox(
  handler: (item: { id: string; type: string; payload: unknown }) => Promise<void>,
): Promise<void> {
  const db = await getOtDb();
  const items = await db.getAll("outbox");
  for (const item of items) {
    await handler({ id: item.id, type: item.type, payload: JSON.parse(item.payloadJson) });
    await db.delete("outbox", item.id);
  }
}
