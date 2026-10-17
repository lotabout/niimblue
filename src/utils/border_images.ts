import { BORDER_RASTER_ARTWORK as manifest } from "./border_catalog";

const urls = import.meta.glob<string>("../assets/borders/*/assets/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});
type Raster = { canvas: HTMLCanvasElement; href: string; levels: HTMLCanvasElement[] };
const originals = new Map<string, HTMLCanvasElement>();
// Keep only the most recently used color per motif; color-picker input must not grow an unbounded bitmap cache.
const tinted = new Map<string, { color: string; raster: Raster }>();
let loading: Promise<void> | undefined;

/** Decode before JSON restoration/printing completes. The same bundled PNGs work offline and in standalone builds. */
export function prepareBorderImages(): Promise<void> {
  return (loading ??= Promise.all(
    Object.entries(manifest).map(async ([name, asset]) => {
      const url = urls[asset.path];
      if (!url) throw new Error(`Missing border image: ${asset.file}`);
      const image = new Image();
      const ready = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Cannot load border image: ${asset.file}`));
      });
      image.src = url;
      await ready;
      const canvas = document.createElement("canvas");
      const [x, y, width, height] = asset.crop;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      // Crop by metadata at render time. The source PNG itself is never resampled or rewritten.
      ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      originals.set(name, canvas);
    }),
  )
    .then(() => undefined)
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}

export function borderImage(name: string, color: string): Raster | undefined {
  const source = originals.get(name);
  if (!source) return;
  const cached = tinted.get(name);
  if (cached?.color === color) return cached.raster;
  const canvas = color.toLowerCase() === "#000000" ? source : document.createElement("canvas");
  if (canvas !== source) {
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const raster = { canvas, href: "", levels: [canvas] };
  tinted.set(name, { color, raster });
  return raster;
}

/** Halving in stages preserves fine ink lines; one huge Canvas downscale can undersample them. */
export function borderImageAtSize(name: string, color: string, pixelWidth: number): HTMLCanvasElement | undefined {
  const raster = borderImage(name, color);
  if (!raster) return;
  let level = 0;
  let source = raster.canvas;
  while (source.width / 2 >= Math.max(1, pixelWidth) && source.height > 1) {
    level++;
    if (!raster.levels[level]) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(source.width / 2));
      canvas.height = Math.max(1, Math.floor(source.height / 2));
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      raster.levels.push(canvas);
    }
    source = raster.levels[level];
  }
  return source;
}

/** Embed pixels in SVG exports/thumbnails rather than depending on a file URL or a running server. */
export function borderImageHref(name: string, color = "#000000"): string {
  const raster = borderImage(name, color);
  if (!raster) throw new Error(`Border image has not finished loading: ${name}`);
  return (raster.href ||= raster.canvas.toDataURL("image/png"));
}
