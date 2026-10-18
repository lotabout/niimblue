import { writable, type Readable, type Updater } from "svelte/store";
import { z } from "zod";
import { databaseTransaction, idbRequest, jsonCodec, readDatabaseValue, type StorageCodec } from "./browser_database";

export interface AsyncPersistedStore<T> extends Readable<T> {
  ready(): Promise<void>;
  refresh(): Promise<void>;
  update(updater: Updater<T>): Promise<void>;
}

/** Publish changes only after their transaction commits. Retry failed initial loads. */
export function indexedDBStore<T>(
  key: string,
  schema: z.ZodType<T>,
  initialValue: T,
  codec: StorageCodec<T> = jsonCodec(schema),
): AsyncPersistedStore<T> {
  const state = writable(initialValue);
  let loaded = false;
  let loading: Promise<void> | undefined;
  let queue = Promise.resolve();
  const refresh = (): Promise<void> => {
    if (loading) return loading;
    const job = queue.then(async () => {
      const value = await readDatabaseValue(key, schema, codec);
      state.set(value ?? initialValue);
      loaded = true;
    });
    loading = job;
    void job.then(
      () => {
        loading = undefined;
      },
      () => {
        loading = undefined;
      },
    );
    return job;
  };
  const ready = () => (loaded ? Promise.resolve() : refresh());
  const update = (updater: Updater<T>): Promise<void> => {
    const initialized = ready();
    const job = queue.then(async () => {
      await initialized;
      const next = await databaseTransaction("readwrite", async (store) => {
        const stored = await idbRequest(store.get(key));
        const previous = stored === undefined ? initialValue : codec.decode(stored);
        const value = schema.parse(updater(previous));
        await idbRequest(store.put(codec.encode(value), key));
        return value;
      });
      state.set(next);
    });
    queue = job.catch(() => {});
    return job;
  };
  return { subscribe: state.subscribe, ready, refresh, update };
}
