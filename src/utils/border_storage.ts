import { z } from "zod";
import { databaseTransaction, idbRequest } from "./browser_database";
import { createRemoteRequest, StorageError, type StorageConfig } from "./label_storage";
import { createImageBorderArchive, pngBytes, pngDataUri, type ImageBorderArchive } from "./image_border";

const thumbnailSchema = z
  .string()
  .max(65536)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
export const borderSummarySchema = z
  .object({
    id: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => ![...name].some((character) => character.charCodeAt(0) < 32)),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    thumbnail: thumbnailSchema,
  })
  .refine((value) => value.width * value.height <= 16000000);
export type BorderSummary = z.infer<typeof borderSummarySchema>;
export interface BorderUpload {
  name: string;
  png: string;
  thumbnail: string;
}
export interface BorderStorage {
  list(): Promise<BorderSummary[]>;
  load(summary: BorderSummary): Promise<ImageBorderArchive>;
  add(upload: BorderUpload): Promise<BorderSummary>;
  delete(id: string): Promise<void>;
}

const prefix = "custom_border_";
const range = () => IDBKeyRange.bound(prefix, `${prefix}\uffff`);
function parseSummary(value: unknown): BorderSummary {
  const result = borderSummarySchema.safeParse(value);
  if (!result.success) throw new StorageError("invalid");
  return result.data;
}
function parseList(value: unknown): BorderSummary[] {
  if (!Array.isArray(value)) throw new StorageError("invalid");
  const summaries = value.map(parseSummary);
  if (new Set(summaries.map((item) => item.id)).size !== summaries.length) throw new StorageError("invalid");
  return summaries;
}

export function createBorderStorage(config: StorageConfig): BorderStorage {
  const request = config.mode === "remote" ? createRemoteRequest(config) : undefined;
  return {
    list: async () => {
      const values = request
        ? await request("/borders")
        : await databaseTransaction("readonly", (store) => idbRequest(store.getAll(range())));
      return parseList(values);
    },
    load: async (summary) => {
      summary = parseSummary(summary);
      let bytes: Uint8Array;
      if (request) {
        bytes = new Uint8Array(
          (await request(`/borders/${summary.id}`, "GET", undefined, { binary: true })) as ArrayBuffer,
        );
      } else {
        const record = await databaseTransaction("readonly", (store) =>
          idbRequest(store.get(`${prefix}${summary.id}`)),
        );
        if (!record) throw new StorageError("missing");
        const metadata = parseSummary(record);
        if (metadata.name !== summary.name || !(record.image instanceof Blob)) throw new StorageError("invalid");
        bytes = new Uint8Array(await record.image.arrayBuffer());
      }
      const archive = createImageBorderArchive(summary.id, summary.name, pngDataUri(bytes));
      const frame = archive.border.assets.frame;
      if (frame.width !== summary.width || frame.height !== summary.height) throw new StorageError("invalid");
      return archive;
    },
    add: async (upload) => {
      const name = borderSummarySchema.shape.name.parse(upload.name);
      const id = crypto.randomUUID();
      const archive = createImageBorderArchive(id, name, upload.png);
      thumbnailSchema.parse(upload.thumbnail);
      const thumb = createImageBorderArchive(id, name, upload.thumbnail).border.assets.frame;
      if (thumb.width > 128 || thumb.height > 64) throw new StorageError("invalid");
      const frame = archive.border.assets.frame;
      if (request) {
        const saved = parseSummary(
          await request("/borders", "POST", { name, image: upload.png, thumbnail: upload.thumbnail }),
        );
        if (saved.name !== name || saved.width !== frame.width || saved.height !== frame.height)
          throw new StorageError("invalid");
        return saved;
      }
      const summary = parseSummary({ id, name, width: frame.width, height: frame.height, thumbnail: upload.thumbnail });
      await databaseTransaction("readwrite", async (store) => {
        const records = parseList(await idbRequest(store.getAll(range())));
        if (records.some((record) => record.name === name)) throw new StorageError("conflict");
        await idbRequest(
          store.add({ ...summary, image: new Blob([pngBytes(upload.png)], { type: "image/png" }) }, `${prefix}${id}`),
        );
      });
      return summary;
    },
    delete: async (id) => {
      z.uuid().parse(id);
      if (request) {
        await request(`/borders/${id}`, "DELETE");
        return;
      }
      await databaseTransaction("readwrite", async (store) => {
        if (!(await idbRequest(store.get(`${prefix}${id}`)))) throw new StorageError("missing");
        await idbRequest(store.delete(`${prefix}${id}`));
      });
    },
  };
}
