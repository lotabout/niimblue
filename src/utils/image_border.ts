import { validateBorderArchive, type BorderArchive, type ImageBorderManifest } from "./border_package";

export const MAX_BORDER_BYTES = 10 * 1024 * 1024;
export const MAX_BORDER_PIXELS = 16000000;
export type ImageBorderArchive = BorderArchive & { border: ImageBorderManifest };
export type ImageBorderFit = "contain" | "stretch";

export function validateImageBorderArchive(value: unknown): ImageBorderArchive {
  const archive = validateBorderArchive(value);
  if (archive.border.layout.engine !== "niimblue-image") throw new Error("Expected an image border package");
  if (pngBytes(imageBorderSource(archive as ImageBorderArchive)).byteLength > MAX_BORDER_BYTES)
    throw new Error("Border image exceeds 10 MiB");
  return archive as ImageBorderArchive;
}

export function imageBorderSource(archive: ImageBorderArchive): string {
  const frame = archive.border.assets.frame;
  if (frame.type !== "png") throw new Error("Missing frame image");
  return archive.files[frame.file];
}

export function pngBytes(uri: string): Uint8Array<ArrayBuffer> {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)) throw new Error("Expected a PNG image");
  return Uint8Array.from(atob(uri.slice(22)), (character) => character.charCodeAt(0));
}

export function pngDataUri(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return `data:image/png;base64,${btoa(chunks.join(""))}`;
}

export function createImageBorderArchive(id: string, name: string, source: string): ImageBorderArchive {
  const bytes = pngBytes(source);
  if (bytes.length < 33) throw new Error("Invalid PNG image");
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  return validateImageBorderArchive({
    format: "niimblue-border-package",
    schemaVersion: 1,
    border: {
      format: "niimblue-border",
      schemaVersion: 1,
      id: `user.border.b${id.replaceAll("-", "")}`,
      version: "1.0.0",
      name: { en: name },
      features: { decoration: false, repeat: false },
      defaults: {
        decorationSize: 16,
        decorationAnchor: "top",
        patternSpacing: 6,
        lineWidth: 2,
        inset: 0,
        borderColor: "#000000",
      },
      layout: { engine: "niimblue-image", version: 1, fit: "contain" },
      assets: {
        frame: {
          type: "png",
          file: "assets/frame.png",
          naturalWidth: width,
          naturalHeight: height,
          crop: [0, 0, width, height],
          width,
          height,
        },
      },
    },
    files: { "assets/frame.png": source },
  });
}

export function imageBorderRect(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  inset: number,
  fit: ImageBorderFit,
) {
  const availableWidth = Math.max(1, width - inset * 2),
    availableHeight = Math.max(1, height - inset * 2);
  const ratio = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const w = fit === "stretch" ? availableWidth : sourceWidth * ratio;
  const h = fit === "stretch" ? availableHeight : sourceHeight * ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export async function decodeBorderImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

/** Normalize supported uploads to one portable RGBA PNG; keep the original colors and alpha. */
export async function prepareBorderUpload(file: File) {
  if (file.size > MAX_BORDER_BYTES) throw new Error("borders.error.size");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("borders.error.format");
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeBorderImage(url);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_BORDER_PIXELS)
      throw new Error("borders.error.pixels");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    const png = canvas.toDataURL("image/png");
    if (pngBytes(png).byteLength > MAX_BORDER_BYTES) throw new Error("borders.error.size");
    canvas.width = 128;
    canvas.height = 64;
    const rect = imageBorderRect(128, 64, width, height, 2, "contain");
    canvas.getContext("2d")!.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    return { png, thumbnail: canvas.toDataURL("image/png"), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
