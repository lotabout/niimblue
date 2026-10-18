import { z } from "zod";

export const BORDER_RECIPE_IDS = [
  "rounded",
  "atelier",
  "stardust",
  "postage",
  "olive",
  "daisy",
  "ginkgo",
  "berries",
  "cat",
  "bunny",
  "birds",
  "whale",
  "ink",
  "nouveau",
  "ribbon",
  "cloud",
  "stitch",
  "meadow",
] as const;
const positive = z.number().finite().positive().max(32768);
const anchor = z.enum(["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left"]);
const pngAsset = z
  .object({
    type: z.literal("png"),
    file: z.string().regex(/^assets\/[a-z][a-z0-9-]*\.png$/),
    naturalWidth: positive.int(),
    naturalHeight: positive.int(),
    crop: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), positive.int(), positive.int()]),
    width: positive,
    height: positive,
  })
  .strict()
  .refine((asset) => {
    const [x, y, width, height] = asset.crop;
    return (
      x + width <= asset.naturalWidth &&
      y + height <= asset.naturalHeight &&
      Math.abs(asset.width / asset.height - width / height) < 0.00001
    );
  }, "Invalid PNG crop or aspect ratio");
const pathsAsset = z
  .object({
    type: z.literal("paths"),
    width: positive,
    height: positive,
    paths: z
      .array(
        z
          .object({
            d: z
              .string()
              .min(1)
              .max(100000)
              .regex(/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/),
            filled: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const proceduralLayout = z
  .object({
    engine: z.literal("niimblue-procedural"),
    version: z.literal(1),
    recipe: z.enum(BORDER_RECIPE_IDS),
    artworkScale: z.number().min(0.25).max(4),
    sizing: z.enum(["fixed", "frame-height"]),
    minimum: z.object({ width: z.number().min(2).max(32), height: z.number().min(2).max(32) }).strict(),
  })
  .strict();
const imageLayout = z
  .object({
    engine: z.literal("niimblue-image"),
    version: z.literal(1),
    fit: z.enum(["contain", "stretch"]),
  })
  .strict();
export const borderManifestSchema = z
  .object({
    format: z.literal("niimblue-border"),
    schemaVersion: z.literal(1),
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/)
      .max(128),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .max(32),
    legacyPreset: z.enum(BORDER_RECIPE_IDS).optional(),
    name: z
      .record(z.string(), z.string().min(1).max(100))
      .refine((names) => !!names.en, "English fallback name is required"),
    referenceDesign: z.number().int().positive().nullable().optional(),
    features: z.object({ decoration: z.boolean(), repeat: z.boolean() }).strict(),
    defaults: z
      .object({
        decorationSize: z.number().min(4).max(80),
        decorationAnchor: anchor,
        patternSpacing: z.number().min(0).max(80),
        lineWidth: z.number().min(0.5).max(12),
        inset: z.number().min(0).max(60),
        borderColor: z.string().regex(/^#[0-9a-f]{6}$/i),
      })
      .strict(),
    layout: z.discriminatedUnion("engine", [proceduralLayout, imageLayout]),
    assets: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), z.union([pngAsset, pathsAsset])),
    provenance: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type BorderManifest = z.infer<typeof borderManifestSchema>;
export type ProceduralBorderManifest = BorderManifest & { layout: z.infer<typeof proceduralLayout> };
export type ImageBorderManifest = BorderManifest & { layout: z.infer<typeof imageLayout> };
export type BorderPngAsset = z.infer<typeof pngAsset>;

const REQUIRED_ARTWORK: Partial<Record<(typeof BORDER_RECIPE_IDS)[number], string[]>> = {
  stardust: ["sparkle"],
  olive: ["olive"],
  daisy: ["daisy"],
  ginkgo: ["ginkgo", "ginkgoLeaf"],
  berries: ["berry"],
  cat: ["cat"],
  bunny: ["bunny", "sparkle"],
  birds: ["birds"],
  whale: ["whale"],
  nouveau: ["lily"],
  ribbon: ["bow"],
  cloud: ["sparkle"],
  stitch: ["needle"],
  meadow: ["petal", "laurel"],
};

export function validateBorderManifest(value: unknown): BorderManifest {
  const border = borderManifestSchema.parse(value);
  if (border.layout.engine === "niimblue-image") {
    const frame = border.assets.frame;
    if (Object.keys(border.assets).length !== 1 || frame?.type !== "png" || border.legacyPreset)
      throw new Error("Image borders require exactly one PNG frame and no legacy preset");
    if (frame.naturalWidth > 8192 || frame.naturalHeight > 8192 || frame.naturalWidth * frame.naturalHeight > 16000000)
      throw new Error("Border image exceeds the pixel limit");
    if (frame.crop.some((value, index) => value !== [0, 0, frame.naturalWidth, frame.naturalHeight][index]))
      throw new Error("Image borders must preserve the entire image");
    return border;
  }
  if (border.layout.sizing === "frame-height" && border.layout.recipe !== "olive")
    throw new Error("Frame-height sizing requires the olive side-frame recipe");
  for (const name of REQUIRED_ARTWORK[border.layout.recipe] ?? []) {
    if (!Object.hasOwn(border.assets, name)) throw new Error(`Missing artwork: ${name}`);
  }
  return border;
}

export interface BorderArchive {
  format: "niimblue-border-package";
  schemaVersion: 1;
  border: BorderManifest;
  /** Original PNG data URIs, indexed by package-relative path; no external dependencies. */
  files: Record<string, string>;
}
const archiveSchema = z
  .object({
    format: z.literal("niimblue-border-package"),
    schemaVersion: z.literal(1),
    border: z.unknown(),
    files: z.record(z.string(), z.string().max(14 * 1024 * 1024)),
  })
  .strict();

export function validateBorderArchive(value: unknown): BorderArchive {
  const archive = archiveSchema.parse(value);
  const border = validateBorderManifest(archive.border);
  const expected = new Set(Object.values(border.assets).flatMap((asset) => (asset.type === "png" ? [asset.file] : [])));
  if (
    Object.keys(archive.files).length !== expected.size ||
    Object.keys(archive.files).some((file) => !expected.has(file))
  )
    throw new Error("Package files must exactly match the border's PNG assets");
  for (const asset of Object.values(border.assets)) {
    if (asset.type !== "png") continue;
    const uri = archive.files[asset.file];
    if (!uri || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri))
      throw new Error(`Missing PNG data: ${asset.file}`);
    const bytes = atob(uri.slice("data:image/png;base64,".length));
    const byte = (i: number) => bytes.charCodeAt(i);
    const uint32 = (i: number) => byte(i) * 0x1000000 + byte(i + 1) * 0x10000 + byte(i + 2) * 0x100 + byte(i + 3);
    if (
      bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" ||
      bytes.slice(12, 16) !== "IHDR" ||
      uint32(16) !== asset.naturalWidth ||
      uint32(20) !== asset.naturalHeight ||
      byte(25) !== 6
    )
      throw new Error(`PNG header does not match the manifest: ${asset.file}`);
  }
  return { format: "niimblue-border-package", schemaVersion: 1, border, files: archive.files };
}

export async function createBorderArchive(
  border: BorderManifest,
  loadFile: (path: string) => Promise<string>,
): Promise<BorderArchive> {
  border = validateBorderManifest(border);
  const files: Record<string, string> = {};
  for (const asset of Object.values(border.assets)) {
    if (asset.type === "png" && !Object.hasOwn(files, asset.file)) files[asset.file] = await loadFile(asset.file);
  }
  return validateBorderArchive({ format: "niimblue-border-package", schemaVersion: 1, border, files });
}

export function serializeBorderArchive(archive: BorderArchive): string {
  return JSON.stringify(validateBorderArchive(archive)) + "\n";
}

export function parseBorderArchive(json: string): BorderArchive {
  if (json.length > 24 * 1024 * 1024) throw new Error("Border package is too large");
  return validateBorderArchive(JSON.parse(json));
}
