import { get, writable } from "svelte/store";
import { z } from "zod";
import { ExportedLabelTemplateSchema, type ExportedLabelTemplate } from "$/types";
import { LocalStoragePersistence } from "$/utils/persistence";

export const StorageConfigSchema = z.object({
  mode: z.enum(["local", "remote"]),
  url: z.string(),
  token: z.string(),
  userId: z.string().min(1).optional(),
});
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type StoredLabel = ExportedLabelTemplate & { storageRevision?: number };
export type StorageErrorCode = "connection" | "auth" | "conflict" | "missing" | "invalid";

export class StorageError extends Error {
  constructor(public code: StorageErrorCode) {
    super(`storage.error.${code}`);
  }
}

const CONFIG_KEY = "label_storage_config";
function readConfig(): StorageConfig {
  try {
    const parsed = StorageConfigSchema.safeParse(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null"));
    if (parsed.success) return normalizeStorageConfig(parsed.data);
  } catch {
    /* A damaged setting must not prevent opening the editor. */
  }
  return { mode: "local", url: "", token: "" };
}
const configStore = writable<StorageConfig>(readConfig());
export const storageConfig = { subscribe: configStore.subscribe };

function allowsLocalHttp(hostname: string): boolean {
  if (["localhost", "[::1]"].includes(hostname)) return true;
  // URL has already canonicalized IPv4 literals. Match the full address, not a
  // hostname prefix such as 192.168.1.1.example.com.
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
  const [first, second] = hostname.split(".").map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function normalizeStorageConfig(config: StorageConfig): StorageConfig {
  const result = StorageConfigSchema.parse(config);
  if (result.mode === "local") return result;
  try {
    const url = new URL(result.url.trim());
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && allowsLocalHttp(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !result.token.trim()
    ) {
      throw new Error("Invalid remote settings");
    }
    return { ...result, mode: "remote", url: url.href.replace(/\/+$/, ""), token: result.token.trim() };
  } catch {
    throw new StorageError("invalid");
  }
}

// No credentials in document metadata or recovery drafts.
export function storageKey(config = get(storageConfig)): string {
  if (config.mode === "local") return "local";
  const remote = normalizeStorageConfig(config);
  return `remote:${remote.url}${remote.userId ? `#user:${encodeURIComponent(remote.userId)}` : ""}`;
}

export function setStorageConfig(config: StorageConfig): void {
  const normalized = normalizeStorageConfig(config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
  configStore.set(normalized);
}

export interface LabelStorage {
  list(): Promise<StoredLabel[]>;
  load(id: string): Promise<StoredLabel | null>;
  save(label: ExportedLabelTemplate, id?: string, revision?: number): Promise<StoredLabel>;
  delete(id: string, revision?: number): Promise<void>;
  import(labels: ExportedLabelTemplate[]): Promise<void>;
  test(): Promise<string | undefined>;
}

const PayloadSchema = ExportedLabelTemplateSchema.omit({ id: true });
const RemoteLabelSchema = z.object({ id: z.string(), revision: z.number().int().positive(), data: PayloadSchema });
function decodeLabel(value: unknown): StoredLabel {
  const parsed = RemoteLabelSchema.safeParse(value);
  if (!parsed.success) throw new StorageError("invalid");
  return { ...parsed.data.data, id: parsed.data.id, storageRevision: parsed.data.revision };
}

export function createRemoteRequest(config: StorageConfig) {
  const remote = normalizeStorageConfig(config);
  return async (
    path: string,
    method = "GET",
    body?: unknown,
    options: { binary?: boolean; headers?: Record<string, string> } = {},
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`${remote.url}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${remote.token}`,
          ...(body === undefined ? {} : { "Content-Type": body instanceof Blob ? body.type : "application/json" }),
          ...options.headers,
        },
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(options.binary || body instanceof Blob ? 120000 : 20000),
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      });
    } catch {
      throw new StorageError("connection");
    }
    if (!response.ok) {
      throw new StorageError(
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 409
            ? "conflict"
            : response.status === 404
              ? "missing"
              : response.status === 400 || response.status === 413 || response.status === 415
                ? "invalid"
                : "connection",
      );
    }
    if (response.status === 204) return;
    try {
      return options.binary ? await response.arrayBuffer() : await response.json();
    } catch {
      throw new StorageError("invalid");
    }
  };
}

export function createLabelStorage(config = get(storageConfig)): LabelStorage {
  if (config.mode === "local") {
    return {
      list: async () => LocalStoragePersistence.loadLabels(),
      load: async (id) => LocalStoragePersistence.loadLabel(id),
      save: async (label, id) => LocalStoragePersistence.saveLabel(label, id),
      delete: async (id) => LocalStoragePersistence.deleteLabel(id),
      import: async (labels) => {
        const { zodErrors, otherErrors } = LocalStoragePersistence.appendLabels(labels);
        if (zodErrors.length || otherErrors.length) throw zodErrors[0] ?? otherErrors[0];
      },
      test: async () => undefined,
    };
  }
  const request = createRemoteRequest(config);
  return {
    list: async () => {
      const data = await request("/labels");
      if (!Array.isArray(data)) throw new StorageError("invalid");
      return data.map(decodeLabel);
    },
    load: async (id) => {
      try {
        return decodeLabel(await request(`/labels/${encodeURIComponent(id)}`));
      } catch (e) {
        if (e instanceof StorageError && e.code === "missing") return null;
        throw e;
      }
    },
    save: async (label, id, revision) =>
      decodeLabel(
        await request(id ? `/labels/${encodeURIComponent(id)}` : "/labels", id ? "PUT" : "POST", {
          data: PayloadSchema.parse(label),
          ...(id ? { revision } : {}),
        }),
      ),
    delete: async (id, revision) => {
      await request(`/labels/${encodeURIComponent(id)}`, "DELETE", { revision });
    },
    import: async (labels) => {
      await request("/labels/import", "POST", { labels: labels.map((label) => PayloadSchema.parse(label)) });
    },
    test: async () => {
      const health = await request("/health");
      const parsed = z
        .object({
          apiVersion: z.literal(1),
          storage: z.literal("sqlite"),
          userId: z.string().min(1).optional(),
        })
        .safeParse(health);
      if (!parsed.success) throw new StorageError("invalid");
      return parsed.data.userId;
    },
  };
}
