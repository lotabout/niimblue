import { z } from "zod";
import type { UserFont } from "$/types";
import { createRemoteRequest, StorageError, type StorageConfig } from "$/utils/label_storage";

const FontSummarySchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1),
  mimeType: z.enum(["text/ttf", "text/woff2", "font/ttf", "font/woff2"]),
});
export type FontSummary = z.infer<typeof FontSummarySchema>;
export type StoredFont = { id: string; data: UserFont };
export interface FontStorage {
  list(): Promise<FontSummary[]>;
  load(font: FontSummary): Promise<StoredFont>;
  add(font: UserFont): Promise<StoredFont>;
  delete(id: string): Promise<void>;
}

export function createFontStorage(config: StorageConfig): FontStorage {
  const request = createRemoteRequest(config);
  return {
    list: async () => {
      const result = z.array(FontSummarySchema).safeParse(await request("/fonts"));
      if (!result.success) throw new StorageError("invalid");
      const fonts = result.data;
      if (
        new Set(fonts.map((f) => f.id)).size !== fonts.length ||
        new Set(fonts.map((f) => f.family)).size !== fonts.length
      ) {
        throw new StorageError("invalid");
      }
      return fonts;
    },
    load: async (font) => {
      const data = (await request(`/fonts/${encodeURIComponent(font.id)}`, "GET", undefined, {
        binary: true,
      })) as ArrayBuffer;
      // Preserve the local font representation; wire and disk formats are binary gzip.
      const gzippedDataB64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([data]));
      });
      return { id: font.id, data: { family: font.family, mimeType: font.mimeType, gzippedDataB64 } };
    },
    add: async (font) => {
      const bytes = Uint8Array.from(atob(font.gzippedDataB64), (c) => c.charCodeAt(0));
      const result = FontSummarySchema.safeParse(
        await request("/fonts", "POST", new Blob([bytes], { type: "application/gzip" }), {
          headers: { "X-Font-Family": encodeURIComponent(font.family), "X-Font-Type": font.mimeType },
        }),
      );
      if (!result.success) throw new StorageError("invalid");
      return { id: result.data.id, data: { ...font, family: result.data.family } };
    },
    delete: async (id) => {
      await request(`/fonts/${encodeURIComponent(id)}`, "DELETE");
    },
  };
}
