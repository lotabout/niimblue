import { writable } from "svelte/store";
import { cache } from "fabric";
import type { UserFont } from "$/types";

export const loadedFonts = writable<FontFace[]>([]);
let generation = 0;
type InstalledFont = { font: UserFont; face: FontFace };
let installed = new Map<string, InstalledFont>();

export async function loadCustomFonts(fonts: UserFont[]): Promise<void> {
  const scope = ++generation;
  if (!fonts.length) {
    if (installed.size) {
      for (const { face } of installed.values()) document.fonts.delete(face);
      installed.clear();
      cache.clearFontCache();
      loadedFonts.set([]);
    }
    return;
  }
  const next = new Map<string, InstalledFont>();
  await Promise.all(
    fonts.map(async (font) => {
      const previous = installed.get(font.family);
      let entry =
        previous?.font.gzippedDataB64 === font.gzippedDataB64 && previous.font.mimeType === font.mimeType
          ? previous
          : undefined;
      if (!entry) {
        const bytes = Uint8Array.from(atob(font.gzippedDataB64), (c) => c.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        const data = await new Response(stream).arrayBuffer();
        entry = { font, face: await new FontFace(font.family, data).load() };
      }
      next.set(font.family, entry);
    }),
  );
  if (scope !== generation) return;
  if (next.size === installed.size && [...next].every(([family, entry]) => installed.get(family) === entry)) return;
  for (const [family, { face }] of installed) {
    if (next.get(family)?.face !== face) document.fonts.delete(face);
  }
  for (const { face } of next.values()) document.fonts.add(face);
  // Fabric caches character widths by family, including fallback metrics.
  cache.clearFontCache();
  installed = next;
  loadedFonts.set([...next.values()].map(({ face }) => face));
}
