import rounded from "../assets/borders/rounded/border.json" with { type: "json" };
import atelier from "../assets/borders/atelier/border.json" with { type: "json" };
import stardust from "../assets/borders/stardust/border.json" with { type: "json" };
import postage from "../assets/borders/postage/border.json" with { type: "json" };
import olive from "../assets/borders/olive/border.json" with { type: "json" };
import daisy from "../assets/borders/daisy/border.json" with { type: "json" };
import ginkgo from "../assets/borders/ginkgo/border.json" with { type: "json" };
import berries from "../assets/borders/berries/border.json" with { type: "json" };
import cat from "../assets/borders/cat/border.json" with { type: "json" };
import bunny from "../assets/borders/bunny/border.json" with { type: "json" };
import birds from "../assets/borders/birds/border.json" with { type: "json" };
import whale from "../assets/borders/whale/border.json" with { type: "json" };
import ink from "../assets/borders/ink/border.json" with { type: "json" };
import nouveau from "../assets/borders/nouveau/border.json" with { type: "json" };
import ribbon from "../assets/borders/ribbon/border.json" with { type: "json" };
import cloud from "../assets/borders/cloud/border.json" with { type: "json" };
import stitch from "../assets/borders/stitch/border.json" with { type: "json" };
import meadow from "../assets/borders/meadow/border.json" with { type: "json" };
import type { BorderManifest } from "./border_package.ts";

const packages = {
  rounded,
  atelier,
  stardust,
  postage,
  olive,
  daisy,
  ginkgo,
  berries,
  cat,
  bunny,
  birds,
  whale,
  ink,
  nouveau,
  ribbon,
  cloud,
  stitch,
  meadow,
};
export type BorderPreset = keyof typeof packages;
// Every built-in manifest is schema-validated in the package round-trip tests.
export const BORDER_PACKAGES = packages as unknown as Record<BorderPreset, BorderManifest>;

export const BORDER_RASTER_ARTWORK = Object.fromEntries(
  Object.entries(BORDER_PACKAGES).flatMap(([key, border]) =>
    Object.entries(border.assets).flatMap(([name, asset]) =>
      asset.type === "png"
        ? [[`${border.id}/${name}`, { ...asset, path: `../assets/borders/${key}/${asset.file}` }]]
        : [],
    ),
  ),
) as Record<string, import("./border_package.ts").BorderPngAsset & { path: string }>;

export function findBorderPackage(id: string): BorderManifest | undefined {
  return Object.values(BORDER_PACKAGES).find((border) => border.id === id || border.legacyPreset === id);
}

export function borderPresetName(preset: BorderPreset, locale: string): string {
  const names = BORDER_PACKAGES[preset].name;
  return names[locale] || names.en;
}
