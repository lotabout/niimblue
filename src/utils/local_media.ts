import { z } from "zod";
import { UserFontSchema, UserIconSchema, type UserFont, type UserIcon } from "$/types";
import { indexedDBStore } from "./indexeddb_store";

const fontsSchema = z.array(UserFontSchema);
const storedFontsSchema = z.array(
  z.object({
    family: z.string(),
    mimeType: z.string(),
    gzip: z.instanceof(Uint8Array),
  }),
);

// Keep the existing in-memory/font-loader API, but store compressed binary bytes on disk.
export function createLocalFonts() {
  return indexedDBStore<UserFont[]>("user_fonts", fontsSchema, [], {
    encode: (fonts) =>
      fonts.map(({ family, mimeType, gzippedDataB64 }) => ({
        family,
        mimeType,
        gzip: Uint8Array.from(atob(gzippedDataB64), (character) => character.charCodeAt(0)),
      })),
    decode: (value) =>
      storedFontsSchema.parse(value).map(({ family, mimeType, gzip }) => {
        const chunks: string[] = [];
        for (let i = 0; i < gzip.length; i += 32768) {
          chunks.push(String.fromCharCode(...gzip.subarray(i, i + 32768)));
        }
        return { family, mimeType, gzippedDataB64: btoa(chunks.join("")) };
      }),
  });
}

export function createLocalIcons() {
  return indexedDBStore<UserIcon[]>("user_icons", z.array(UserIconSchema), []);
}
