import { get, writable, type Readable } from "svelte/store";
import type { UserFont } from "$/types";
import { createFontStorage, type FontStorage, type StoredFont } from "$/utils/font_storage";
import { StorageError, type StorageConfig } from "$/utils/label_storage";

export interface FontLibraryState {
  fonts: UserFont[];
  loading: boolean;
  error: unknown;
}

// Remote fonts live in memory, avoiding localStorage's small quota for CJK fonts.
// The original local library is preserved independently for switching and migration.
export function createFontLibrary(
  localFonts: Readable<UserFont[]> & {
    ready?: () => Promise<void>;
    update: (updater: (fonts: UserFont[]) => UserFont[]) => void | Promise<void>;
  },
  loadFonts: (fonts: UserFont[]) => Promise<void>,
  storageFactory: (config: StorageConfig) => FontStorage = createFontStorage,
) {
  const state = writable<FontLibraryState>({ fonts: [], loading: false, error: null });
  let config: StorageConfig = { mode: "local", url: "", token: "" };
  let generation = 0;
  let cached: StoredFont[] = [];
  let pending: Promise<void> | undefined;

  const refresh = (): Promise<void> => {
    if (pending) return pending;
    const scope = generation;
    const currentConfig = config;
    state.update((s) => ({ ...s, loading: true }));
    const job = (async () => {
      try {
        let next: StoredFont[] = [];
        let fonts: UserFont[];
        if (currentConfig.mode === "local") {
          await localFonts.ready?.();
          fonts = get(localFonts);
        } else {
          const storage = storageFactory(currentConfig);
          const summaries = await storage.list();
          if (scope !== generation) return;
          const byId = new Map(cached.map((font) => [font.id, font]));
          next = await Promise.all(
            summaries.map(async (summary) => {
              const font = byId.get(summary.id) ?? (await storage.load(summary));
              if (font.id !== summary.id || font.data.family !== summary.family) throw new StorageError("invalid");
              return font;
            }),
          );
          fonts = next.map((font) => font.data);
        }
        if (scope !== generation) return;
        // Keep a successfully downloaded but unreadable font visible so the
        // user can remove it, and avoid re-downloading its large file on retry.
        cached = next;
        state.update((s) => ({ ...s, fonts }));
        await loadFonts(fonts);
        if (scope !== generation) return;
        state.set({ fonts, loading: false, error: null });
      } catch (error) {
        if (scope === generation) state.update((s) => ({ ...s, loading: false, error }));
      }
    })();
    pending = job;
    void job.finally(() => {
      if (pending === job) pending = undefined;
    });
    return job;
  };

  const ready = async () => {
    while (pending) await pending;
  };

  const select = (nextConfig: StorageConfig): Promise<void> => {
    generation++;
    config = { ...nextConfig };
    cached = [];
    pending = undefined;
    state.set({ fonts: [], loading: true, error: null });
    // Invalidate in-flight browser FontFace loads and remove the previous user's faces.
    void loadFonts([]);
    return refresh();
  };

  const add = async (font: UserFont) => {
    const scope = generation;
    const currentConfig = config;
    await ready();
    if (scope !== generation) return;
    if (get(state).fonts.some((f) => f.family === font.family)) throw new StorageError("conflict");
    if (currentConfig.mode === "local") {
      await localFonts.update((fonts) => [...fonts, font]);
    } else {
      const saved = await storageFactory(currentConfig).add(font);
      await ready();
      if (scope !== generation) return;
      cached.push(saved);
    }
    await ready();
    if (scope === generation) await refresh();
  };

  const remove = async (family: string) => {
    const scope = generation;
    const currentConfig = config;
    await ready();
    if (scope !== generation) return;
    if (currentConfig.mode === "local") {
      await localFonts.update((fonts) => fonts.filter((font) => font.family !== family));
    } else {
      const font = cached.find((font) => font.data.family === family);
      if (!font) throw new StorageError("missing");
      try {
        await storageFactory(currentConfig).delete(font.id);
      } catch (error) {
        if (!(error instanceof StorageError && error.code === "missing")) throw error;
      }
    }
    await ready();
    if (scope === generation) await refresh();
  };

  const uploadLocal = async () => {
    const scope = generation;
    const currentConfig = config;
    if (currentConfig.mode !== "remote") return;
    await localFonts.ready?.();
    await refresh();
    if (scope !== generation) return;
    if (get(state).error) throw get(state).error;
    const storage = storageFactory(currentConfig);
    const existing = new Set(get(state).fonts.map((font) => font.family));
    try {
      for (const font of get(localFonts)) {
        if (scope !== generation) return;
        if (existing.has(font.family)) continue;
        try {
          const saved = await storage.add(font);
          await ready();
          if (scope !== generation) return;
          cached.push(saved);
        } catch (error) {
          // Concurrent migration must not overwrite another device's same-name font.
          if (!(error instanceof StorageError && error.code === "conflict")) throw error;
        }
      }
    } finally {
      await ready();
      if (scope === generation) await refresh();
    }
  };

  return { state: { subscribe: state.subscribe }, select, refresh, ready, add, remove, uploadLocal };
}
