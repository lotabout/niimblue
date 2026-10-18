import { z } from "zod";

const DATABASE_NAME = "niimblue";
const STORE_NAME = "documents";
let opening: Promise<IDBDatabase> | undefined;
let factory: IDBFactory | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  if (factory !== globalThis.indexedDB) {
    factory = globalThis.indexedDB;
    opening = undefined;
  }
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => {
      opening = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      blocked = true;
      opening = undefined;
      reject(new Error("Close other NiimBlue tabs and retry opening local storage."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      db.onclose = () => {
        opening = undefined;
      };
      resolve(db);
    };
  });
  const pending = opening;
  void pending.catch(() => {
    if (opening === pending) opening = undefined;
  });
  return opening;
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves only after commit, never just after the final request succeeds. */
export async function databaseTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, mode);
  const committed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Local storage transaction aborted."));
    transaction.onerror = () => {
      /* The abort event reports the transaction failure. */
    };
  });
  // Install a rejection handler immediately, including when action itself fails first.
  void committed.catch(() => {});
  try {
    const result = await action(transaction.objectStore(STORE_NAME));
    await committed;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Already committed or aborted. */
    }
    await committed.catch(() => {});
    throw error;
  }
}

export interface StorageCodec<T> {
  encode(value: T): unknown;
  decode(value: unknown): T;
}

export const jsonCodec = <T>(schema: z.ZodType<T>): StorageCodec<T> => ({
  encode: (value) => schema.parse(value),
  decode: (value) => schema.parse(value),
});

/** Copy before deleting. Existing database values win when migration is retried. */
export async function migrateLocalStorage<T>(
  key: string,
  schema: z.ZodType<T>,
  codec: StorageCodec<T> = jsonCodec(schema),
): Promise<void> {
  const raw = localStorage.getItem(key);
  if (raw === null) return;
  await databaseTransaction("readwrite", async (store) => {
    const current = await idbRequest(store.get(key));
    if (current === undefined) {
      await idbRequest(store.put(codec.encode(schema.parse(JSON.parse(raw))), key));
    } else {
      codec.decode(current);
    }
  });
  // Removal can fail (or an old tab can change the value); the committed copy is safe.
  try {
    if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
  } catch (error) {
    console.warn("Could not remove migrated localStorage entry:", key, error);
  }
}

export async function readDatabaseValue<T>(
  key: string,
  schema: z.ZodType<T>,
  codec: StorageCodec<T> = jsonCodec(schema),
): Promise<T | null> {
  await migrateLocalStorage(key, schema, codec);
  return databaseTransaction("readonly", async (store) => {
    const value = await idbRequest(store.get(key));
    return value === undefined ? null : codec.decode(value);
  });
}

export async function writeDatabaseValue<T>(key: string, value: T | undefined, schema: z.ZodType<T>): Promise<void> {
  await migrateLocalStorage(key, schema);
  const parsed = value === undefined ? undefined : schema.parse(value);
  await databaseTransaction("readwrite", async (store) => {
    if (parsed === undefined) await idbRequest(store.delete(key));
    else await idbRequest(store.put(parsed, key));
  });
}

/** Approximate stored payload size in KiB; excludes browser database bookkeeping. */
export async function databaseUsedSpace(): Promise<number> {
  const values = await databaseTransaction("readonly", (store) => idbRequest(store.getAll()));
  const size = (value: unknown): number => {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + size(item), 0);
    if (value && typeof value === "object")
      return Object.entries(value).reduce((sum, [key, item]) => sum + size(key) + size(item), 0);
    return 8;
  };
  return Math.ceil(size(values) / 1024);
}
