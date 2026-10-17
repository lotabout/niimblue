import { BORDER_PACKAGES, BORDER_RASTER_ARTWORK, type BorderPreset } from "./border_catalog.ts";
import type { BorderManifest } from "./border_package.ts";
export type { BorderPreset } from "./border_catalog.ts";

export const isRasterArtwork = (name: string): boolean => Object.hasOwn(BORDER_RASTER_ARTWORK, name);

/** Original vector artwork, in a 24 × 24 coordinate system. No external assets. */
export const BORDER_MOTIFS = {
  flower:
    "M12 8 C5 -1 0 7 7 12 C-1 17 7 25 12 16 C17 25 25 17 17 12 C25 7 17 -1 12 8 Z M15 12 A3 3 0 1 1 9 12 A3 3 0 1 1 15 12 Z",
  rabbit:
    "M7 11 C1 -2 9 -2 10 9 C11 -3 19 -2 16 11 C23 14 22 23 12 23 C2 23 1 15 7 11 Z M8 16 L8 17 M16 16 L16 17 M11 19 L12 20 L13 19",
  dot: "M16 12 A4 4 0 1 1 8 12 A4 4 0 1 1 16 12 Z",
} as const;

export type BorderMotif = keyof typeof BORDER_MOTIFS;
export const BORDER_ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
] as const;
export type BorderAnchor = (typeof BORDER_ANCHORS)[number];

export interface BorderRecipe {
  corners?: BorderMotif;
  decoration?: BorderMotif;
  repeat?: BorderMotif;
  line: boolean;
}

const LEGACY_BORDER_PRESETS = {
  rounded: { line: true },
  corners: { corners: "flower", line: true },
  flower: { decoration: "flower", line: true },
  rabbit: { decoration: "rabbit", line: true },
  dots: { repeat: "dot", line: false },
  flowers: { repeat: "flower", line: false },
  garden: { corners: "flower", decoration: "rabbit", repeat: "dot", line: true },
} satisfies Record<string, BorderRecipe>;
export const BORDER_PRESETS = BORDER_PACKAGES;
export type SavedBorderPreset = BorderPreset | keyof typeof LEGACY_BORDER_PRESETS;

export function isBorderPreset(value: string): value is SavedBorderPreset {
  return Object.hasOwn(BORDER_PRESETS, value) || Object.hasOwn(LEGACY_BORDER_PRESETS, value);
}

export function borderPresetFeatures(preset: SavedBorderPreset): { decoration: boolean; repeat: boolean } {
  if (Object.hasOwn(BORDER_PRESETS, preset)) return BORDER_PRESETS[preset as BorderPreset].features;
  const legacy = LEGACY_BORDER_PRESETS[preset as keyof typeof LEGACY_BORDER_PRESETS] as BorderRecipe;
  return { decoration: !!legacy.decoration, repeat: !!legacy.repeat };
}

export function borderDefaultAnchor(preset: SavedBorderPreset): BorderAnchor {
  return BORDER_PACKAGES[preset as BorderPreset]?.defaults.decorationAnchor ?? "top";
}

export interface BorderSettings {
  preset: SavedBorderPreset;
  decorationSize: number;
  decorationAnchor: BorderAnchor;
  patternSpacing: number;
  lineWidth: number;
  inset: number;
  borderColor: string;
}

export const DEFAULT_BORDER_SETTINGS: BorderSettings = {
  preset: "rounded",
  decorationSize: 16,
  decorationAnchor: "top",
  patternSpacing: 6,
  lineWidth: 2,
  inset: 2,
  borderColor: "#000000",
};

export interface BorderPath {
  d: string;
  x: number;
  y: number;
  scale: number;
  filled: boolean;
  /** Layout metadata is also useful for testing constant-size decorations. */
  role: "line" | "corner" | "anchor" | "repeat";
  matrix?: [number, number, number, number, number, number];
  weight?: number;
  dash?: number[];
  bounds?: { x: number; y: number; width: number; height: number };
  artwork?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export function borderMinimumSize(settings: BorderSettings): number {
  if (!Object.hasOwn(LEGACY_BORDER_PRESETS, settings.preset)) {
    const minimum = BORDER_PACKAGES[settings.preset as BorderPreset].layout.minimum;
    return Math.ceil(
      2 * settings.inset + Math.min(minimum.width, minimum.height) * settings.decorationSize + settings.lineWidth + 6,
    );
  }
  const factor = borderPresetFeatures(settings.preset).repeat ? 3 : 2;
  return Math.ceil(2 * settings.inset + factor * settings.decorationSize + settings.lineWidth + 6);
}

export function borderMinimumDimensions(settings: BorderSettings): { width: number; height: number } {
  if (Object.hasOwn(LEGACY_BORDER_PRESETS, settings.preset)) {
    const minimum = borderMinimumSize(settings);
    return { width: minimum, height: minimum };
  }
  const minimum = BORDER_PACKAGES[settings.preset as BorderPreset].layout.minimum;
  const margin = 2 * settings.inset + settings.lineWidth + 6;
  return {
    width: Math.ceil(minimum.width * settings.decorationSize + margin),
    height: Math.ceil(minimum.height * settings.decorationSize + margin),
  };
}

/** Center whole tiles, keeping both tile size and the requested gap constant. */
export function borderTilePositions(start: number, end: number, size: number, gap: number): number[] {
  const length = end - start;
  if (size <= 0 || gap < 0 || length < size) return [];
  const count = Math.floor((length + gap) / (size + gap));
  const used = count * size + (count - 1) * gap;
  const first = start + (length - used) / 2 + size / 2;
  return Array.from({ length: count }, (_, i) => first + i * (size + gap));
}

/** Lay out vectors anew for every size: fixed corners, anchored art and repeated edge tiles can coexist. */
function layoutLegacyBorder(width: number, height: number, settings: BorderSettings): BorderPath[] {
  const recipe: BorderRecipe =
    LEGACY_BORDER_PRESETS[settings.preset as keyof typeof LEGACY_BORDER_PRESETS] ?? LEGACY_BORDER_PRESETS.rounded;
  const size = settings.decorationSize;
  const margin = settings.inset + size / 2 + settings.lineWidth / 2;
  const left = margin;
  const right = width - margin;
  const top = margin;
  const bottom = height - margin;
  if (right <= left || bottom <= top) return [];

  const points: Record<BorderAnchor, [number, number]> = {
    "top-left": [left, top],
    top: [width / 2, top],
    "top-right": [right, top],
    right: [right, height / 2],
    "bottom-right": [right, bottom],
    bottom: [width / 2, bottom],
    "bottom-left": [left, bottom],
    left: [left, height / 2],
  };
  const decorations: BorderPath[] = [];
  const motif = (name: BorderMotif, x: number, y: number, role: BorderPath["role"]): BorderPath => ({
    d: BORDER_MOTIFS[name],
    x: x - size / 2,
    y: y - size / 2,
    scale: size / 24,
    filled: name === "dot",
    role,
  });
  if (recipe.corners) {
    for (const anchor of ["top-left", "top-right", "bottom-right", "bottom-left"] as const) {
      // An anchored decoration replaces a corner flower if they occupy the same anchor.
      if (recipe.decoration && settings.decorationAnchor === anchor) continue;
      decorations.push(motif(recipe.corners, ...points[anchor], "corner"));
    }
  }
  if (recipe.decoration) {
    decorations.push(motif(recipe.decoration, ...points[settings.decorationAnchor], "anchor"));
  }

  const result: BorderPath[] = [];
  const addLine = (d: string) => result.push({ d, x: 0, y: 0, scale: 1, filled: false, role: "line" });
  // Cut edge segments around decorations instead of painting an opaque white patch over label content.
  const freeSegments = (start: number, end: number, constant: number, horizontal: boolean): [number, number][] => {
    const exclusions = decorations
      .filter((p) => constant >= (horizontal ? p.y : p.x) - 2 && constant <= (horizontal ? p.y : p.x) + size + 2)
      .map((p): [number, number] => [(horizontal ? p.x : p.y) - 2, (horizontal ? p.x : p.y) + size + 2])
      .sort((a, b) => a[0] - b[0]);
    const segments: [number, number][] = [];
    let cursor = start;
    for (const [a, b] of exclusions) {
      if (b <= cursor || a >= end) continue;
      if (a > cursor) segments.push([cursor, Math.min(a, end)]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < end) segments.push([cursor, end]);
    return segments;
  };

  const radius = Math.min(size / 2, (right - left) / 2, (bottom - top) / 2);
  const edges = [
    { horizontal: true, constant: top, start: left + radius, end: right - radius },
    { horizontal: true, constant: bottom, start: left + radius, end: right - radius },
    { horizontal: false, constant: left, start: top + radius, end: bottom - radius },
    { horizontal: false, constant: right, start: top + radius, end: bottom - radius },
  ];
  for (const { horizontal, constant, start, end } of edges) {
    for (const [a, b] of freeSegments(start, end, constant, horizontal)) {
      if (recipe.line) addLine(horizontal ? `M${a} ${constant} H${b}` : `M${constant} ${a} V${b}`);
      if (recipe.repeat) {
        for (const position of borderTilePositions(a, b, size, settings.patternSpacing)) {
          result.push(
            motif(recipe.repeat, horizontal ? position : constant, horizontal ? constant : position, "repeat"),
          );
        }
      }
    }
  }
  if (recipe.line) {
    const arcs: [BorderAnchor, string][] = [
      ["top-left", `M${left} ${top + radius} Q${left} ${top} ${left + radius} ${top}`],
      ["top-right", `M${right - radius} ${top} Q${right} ${top} ${right} ${top + radius}`],
      ["bottom-right", `M${right} ${bottom - radius} Q${right} ${bottom} ${right - radius} ${bottom}`],
      ["bottom-left", `M${left + radius} ${bottom} Q${left} ${bottom} ${left} ${bottom - radius}`],
    ];
    for (const [anchor, d] of arcs) {
      const [cx, cy] = points[anchor];
      const occupied = decorations.some(
        (p) => Math.abs(p.x + size / 2 - cx) < size && Math.abs(p.y + size / 2 - cy) < size,
      );
      if (!occupied) addLine(d);
    }
  }
  return [...result, ...decorations];
}

type ArtworkName = string;
type Cutout = { x: number; y: number; width: number; height: number };

/** Artwork stays in its own coordinate system; only the connecting geometry depends on the frame size. */
export function layoutBorder(
  width: number,
  height: number,
  settings: BorderSettings,
  definition?: BorderManifest,
): BorderPath[] {
  if (definition?.layout.recipe === "rounded")
    return layoutLegacyBorder(width, height, { ...settings, preset: "rounded" });
  if (!definition && Object.hasOwn(LEGACY_BORDER_PRESETS, settings.preset))
    return layoutLegacyBorder(width, height, settings);
  definition ??= BORDER_PACKAGES[settings.preset as BorderPreset];
  const preset = definition.layout.recipe;
  const artwork = definition.assets;
  const artworkScale = definition.layout.artworkScale;
  const d = settings.decorationSize;
  const p = settings.inset + settings.lineWidth / 2;
  const l = p + d * 0.9,
    r = width - l,
    t = p + d * 0.9,
    b = height - t;
  const cx = width / 2,
    cy = height / 2;
  const paths: BorderPath[] = [];
  const cutouts: Cutout[] = [];
  const line = (path: string, weight = 1, dash?: number[], filled = false, role: BorderPath["role"] = "line") => {
    paths.push({ d: path, x: 0, y: 0, scale: 1, filled, role, weight, dash });
  };
  const dot = (x: number, y: number, radius: number) =>
    line(
      `M${x + radius} ${y} A${radius} ${radius} 0 1 1 ${x - radius} ${y} A${radius} ${radius} 0 1 1 ${x + radius} ${y} Z`,
      1,
      undefined,
      true,
      "repeat",
    );
  const art = (
    name: ArtworkName,
    x: number,
    y: number,
    w: number,
    role: BorderPath["role"] = "anchor",
    rotation = 0,
    mirror = false,
    cut = true,
  ) => {
    const source = artwork[name];
    if (!source) throw new Error(`Missing border artwork: ${name}`);
    if (source.type === "png") w *= artworkScale;
    const scale = w / source.width;
    const h = source.height * scale;
    const angle = (rotation * Math.PI) / 180;
    const a = Math.cos(angle) * (mirror ? -1 : 1),
      bb = Math.sin(angle) * (mirror ? -1 : 1);
    const c = -Math.sin(angle),
      dd = Math.cos(angle);
    const bw = Math.abs(a) * w + Math.abs(c) * h,
      bh = Math.abs(bb) * w + Math.abs(dd) * h;
    // Protect the stroke, including when the frame is at its minimum dimensions.
    x = Math.max(p + bw / 2, Math.min(width - p - bw / 2, x));
    y = Math.max(p + bh / 2, Math.min(height - p - bh / 2, y));
    const bounds = { x: x - bw / 2, y: y - bh / 2, width: bw, height: bh };
    if (cut) cutouts.push(bounds);
    const matrix: BorderPath["matrix"] = [
      a,
      bb,
      c,
      dd,
      -(a * source.width + c * source.height) / 2,
      -(bb * source.width + dd * source.height) / 2,
    ];
    if (source.type === "png") {
      paths.push({
        d: "",
        x,
        y,
        scale,
        matrix,
        bounds,
        artwork: name,
        image: `${definition.id}/${name}`,
        imageWidth: source.width,
        imageHeight: source.height,
        filled: false,
        role,
      });
      return;
    }
    for (const component of source.paths)
      paths.push({
        d: component.d,
        x,
        y,
        scale,
        matrix,
        bounds,
        artwork: name,
        weight: 1,
        filled: "filled" in component && component.filled === true,
        role,
      });
  };
  const anchor = (w: number): [number, number] => {
    const value = settings.decorationAnchor;
    return [
      value.includes("left") || value === "left"
        ? l + w * 0.25
        : value.includes("right") || value === "right"
          ? r - w * 0.25
          : cx,
      value.includes("top") || value === "top" ? t : value.includes("bottom") || value === "bottom" ? b : cy,
    ];
  };
  const anchored = (name: ArtworkName, size: number, yOffset = 0) => {
    const w = d * size;
    const [x, y] = anchor(w * (artwork[name].type === "png" ? artworkScale : 1));
    art(name, x, y + yOffset, w);
  };
  const segments = (start: number, end: number, fixed: number, horizontal: boolean): [number, number][] => {
    const gap = settings.lineWidth + 1;
    const blocks = cutouts
      .filter((q) =>
        horizontal
          ? fixed >= q.y - gap && fixed <= q.y + q.height + gap
          : fixed >= q.x - gap && fixed <= q.x + q.width + gap,
      )
      .map((q) => (horizontal ? [q.x - gap, q.x + q.width + gap] : [q.y - gap, q.y + q.height + gap]))
      .sort((a, b) => a[0] - b[0]);
    const result: [number, number][] = [];
    let cursor = start;
    for (const [a, b] of blocks) {
      if (b <= cursor || a >= end) continue;
      if (a > cursor) result.push([cursor, Math.min(a, end)]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < end) result.push([cursor, end]);
    return result;
  };
  const wave = (x1: number, y1: number, x2: number, y2: number, amplitude: number, step: number, weight = 1) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 0.01) return;
    const ux = (x2 - x1) / length,
      uy = (y2 - y1) / length;
    const point = (along: number, normal = 0) => `${x1 + ux * along - uy * normal} ${y1 + uy * along + ux * normal}`;
    const centers = borderTilePositions(0, length, step, 0);
    let path = `M${x1} ${y1}`;
    for (const center of centers) {
      const start = center - step / 2;
      path += ` L${point(start)} Q${point(start + step / 4, amplitude)} ${point(center)} Q${point(center + step / 4, -amplitude)} ${point(start + step)}`;
    }
    line(path + ` L${x2} ${y2}`, weight);
  };
  const outline = (x1 = l, y1 = t, x2 = r, y2 = b, radius = d * 0.65, mode = "solid", weight = 1) => {
    radius = Math.max(0, Math.min(radius, (x2 - x1) / 2, (y2 - y1) / 2));
    const dash =
      mode === "dotted"
        ? [0.01, Math.max(settings.lineWidth * 2, settings.patternSpacing)]
        : mode === "dashed"
          ? [d * 0.36, Math.max(2, settings.patternSpacing * 0.7)]
          : undefined;
    const edges = [
      { h: true, fixed: y1, start: x1 + radius, end: x2 - radius },
      { h: true, fixed: y2, start: x1 + radius, end: x2 - radius },
      { h: false, fixed: x1, start: y1 + radius, end: y2 - radius },
      { h: false, fixed: x2, start: y1 + radius, end: y2 - radius },
    ];
    for (const edge of edges)
      for (const [a, z] of segments(edge.start, edge.end, edge.fixed, edge.h)) {
        if (mode === "wavy")
          wave(
            edge.h ? a : edge.fixed,
            edge.h ? edge.fixed : a,
            edge.h ? z : edge.fixed,
            edge.h ? edge.fixed : z,
            d * 0.16,
            d * 0.85 + settings.patternSpacing * 0.5,
            weight,
          );
        else line(edge.h ? `M${a} ${edge.fixed} H${z}` : `M${edge.fixed} ${a} V${z}`, weight, dash);
      }
    if (!radius) return;
    const corners: [number, number, string][] = [
      [x1, y1, `M${x1} ${y1 + radius} Q${x1} ${y1} ${x1 + radius} ${y1}`],
      [x2, y1, `M${x2 - radius} ${y1} Q${x2} ${y1} ${x2} ${y1 + radius}`],
      [x2, y2, `M${x2} ${y2 - radius} Q${x2} ${y2} ${x2 - radius} ${y2}`],
      [x1, y2, `M${x1 + radius} ${y2} Q${x1} ${y2} ${x1} ${y2 - radius}`],
    ];
    for (const [x, y, path] of corners) {
      const occupied = cutouts.some(
        (q) => x >= q.x - radius && x <= q.x + q.width + radius && y >= q.y - radius && y <= q.y + q.height + radius,
      );
      if (!occupied) line(path, weight, dash);
    }
  };

  switch (preset) {
    case "atelier": {
      outline(l, t, r, b, d * 0.7);
      const inset = d * 0.24;
      for (const y of [t + inset, b - inset]) line(`M${l + d} ${y} H${r - d}`, 0.65);
      for (const x of [l + inset, r - inset]) line(`M${x} ${t + d} V${b - d}`, 0.65);
      for (const [x, y, sx, sy] of [
        [l, t, 1, 1],
        [r, t, -1, 1],
        [r, b, -1, -1],
        [l, b, 1, -1],
      ]) {
        for (const [ox, oy] of [
          [0.36, 0.36],
          [0.65, 0.3],
          [0.3, 0.65],
        ])
          dot(x + sx * d * ox, y + sy * d * oy, Math.max(0.7, d * 0.055));
      }
      break;
    }
    case "stardust":
      art("sparkle", r - (b - t) / 2 - d * 0.85, t, d * 1.05);
      outline(l, t, r, b, (b - t) / 2, "dotted", 1.35);
      break;
    case "postage": {
      const step = d * 0.58 + settings.patternSpacing * 0.25;
      const scallop = (x: number, y: number, dx: number, dy: number, length: number) => {
        const centers = borderTilePositions(0, length, step, 0);
        const point = (s: number, n = 0) => `${x + dx * s - dy * n} ${y + dy * s + dx * n}`;
        let path = `M${x} ${y}`;
        for (const center of centers)
          path += ` L${point(center - step / 2)} Q${point(center, step * 0.65)} ${point(center + step / 2)}`;
        line(path + ` L${point(length)}`);
      };
      scallop(l, t, 1, 0, r - l);
      scallop(r, t, 0, 1, b - t);
      scallop(r, b, -1, 0, r - l);
      scallop(l, b, 0, -1, b - t);
      const gap = step * 0.7 + settings.lineWidth;
      outline(l + gap, t + gap, r - gap, b - gap, 0, "solid", 0.6);
      break;
    }
    case "olive": {
      if (definition.layout.sizing === "frame-height") {
        // A side frame fills the label height with uniform scaling; leave room between mirrored branches.
        const source = artwork.olive;
        const ratio = source.width / source.height;
        const availableWidth = Math.max(0, (width - 2 * p - d * 2) / 2);
        const sideHeight = Math.min(height - 2 * p, availableWidth / ratio);
        const sideWidth = sideHeight * ratio;
        art("olive", p + sideWidth / 2, cy, sideWidth / artworkScale, "anchor", 0, false, false);
        art("olive", width - p - sideWidth / 2, cy, sideWidth / artworkScale, "anchor", 0, true, false);
      } else {
        art("olive", p + d * 0.9, cy, d * 1.7, "anchor", 0, false, false);
        art("olive", width - p - d * 0.9, cy, d * 1.7, "anchor", 0, true, false);
      }
      break;
    }
    case "daisy":
      anchored("daisy", 2.7);
      outline();
      break;
    case "ginkgo":
      art("ginkgo", l + d * 0.2, t + d * 0.4, d * 2.15, "corner");
      art("ginkgo", r - d * 0.2, b - d * 0.4, d * 2.15, "corner", 180);
      art("ginkgoLeaf", l + d * 0.15, t + d * 2, d * 0.45, "anchor", -25, false, false);
      art("ginkgoLeaf", r - d * 0.1, b - d * 2, d * 0.45, "anchor", 155, false, false);
      break;
    case "berries":
      anchored("berry", 2.9);
      outline(l, t, r, b, 0);
      outline(l + d * 0.23, t + d * 0.23, r - d * 0.23, b - d * 0.23, 0, "solid", 0.65);
      break;
    case "cat":
      anchored("cat", 5.8, -d * 0.65);
      outline();
      break;
    case "bunny":
      anchored("bunny", 2.25, -d * 0.25);
      art("sparkle", l, t + d * 0.4, d * 0.55, "corner", 0, false, false);
      art("sparkle", l + d * 0.9, t - d * 0.35, d * 0.8, "corner", 0, false, false);
      break;
    case "birds":
      anchored("birds", 3.6, -d * 0.72);
      outline(l, t, r, b, 0);
      break;
    case "whale": {
      art("whale", l + d * 0.9, b - d * 0.95, d * 3.8, "anchor", 0, false, false);
      for (let i = 0; i < 3; i++)
        wave(
          l + d * (i === 2 ? 0.3 : 3),
          b + (i - 0.5) * d * 0.3,
          r,
          b + (i - 0.5) * d * 0.3,
          d * 0.2,
          d * 2.5 + settings.patternSpacing,
          i === 1 ? 0.7 : 1,
        );
      for (const [x, y, radius] of [
        [l, t, 1.5],
        [l + d * 0.18, t + d * 0.7, 1],
        [r, t + d * 0.3, 1.3],
        [r - d * 0.25, b - d, 1.7],
      ])
        line(
          `M${x + radius} ${y} A${radius} ${radius} 0 1 1 ${x - radius} ${y} A${radius} ${radius} 0 1 1 ${x + radius} ${y} Z`,
          0.7,
        );
      break;
    }
    case "ink": {
      const q = settings.lineWidth,
        w = r - l,
        h = b - t;
      line(
        `M${l} ${t + d} C${l - q} ${t - q} ${l + d} ${t - q * 2} ${l + d * 2} ${t} C${l + w * 0.5} ${t + q * 2} ${r - d} ${t - q * 3} ${r} ${t} L${r} ${t + q * 2} C${r - d} ${t - q} ${l + w * 0.5} ${t + q * 3} ${l + d * 2} ${t + q} Q${l + q} ${t + q} ${l + q} ${t + d} Z`,
        1,
        undefined,
        true,
      );
      line(
        `M${r} ${t} C${r + q * 2} ${t + h * 0.3} ${r - q * 2} ${b - d} ${r} ${b - q} Q${r - q} ${b + q} ${r - d} ${b} C${l + w * 0.6} ${b - q} ${l + d} ${b + q * 3} ${l} ${b} L${l} ${b - q * 2} C${l + d} ${b} ${l + w * 0.6} ${b - q * 3} ${r - d} ${b - q} Q${r - q} ${b - q} ${r - q} ${b - d} C${r - q * 3} ${t + h * 0.3} ${r + q} ${t + q} ${r} ${t} Z`,
        1,
        undefined,
        true,
      );
      line(
        `M${l} ${b} C${l - q * 3} ${b - d} ${l + q * 2} ${t + h * 0.3} ${l} ${t + d} L${l + q * 1.4} ${t + d} C${l + q * 3} ${t + h * 0.3} ${l - q} ${b - d} ${l + q} ${b} Z`,
        1,
        undefined,
        true,
      );
      break;
    }
    case "nouveau": {
      art("lily", cx, t - d * 0.15, d * 2.8);
      for (const [a, z] of segments(l + d, r - d, t, true))
        line(`M${a} ${t} Q${(a + z) / 2} ${t + d * 0.25} ${z} ${t}`, 0.8);
      for (const [x, sign] of [
        [l, 1],
        [r, -1],
      ]) {
        const h = b - t;
        line(
          `M${x + sign * d * 1.1} ${t} C${x - sign * d} ${t - d * 0.4} ${x + sign * d * 0.6} ${t + h * 0.38} ${x} ${cy} C${x - sign * d * 0.7} ${b - d} ${x + sign * d} ${b + d * 0.5} ${x + sign * d * 1.2} ${b} C${x + sign * d * 0.5} ${b - d * 0.7} ${x - sign * d * 0.4} ${b + d * 0.4} ${x + sign * d * 0.7} ${b + d * 0.2}`,
          0.8,
        );
        line(
          `M${x + sign * d * 0.5} ${t + d * 0.3} C${x - sign * d * 0.5} ${cy} ${x + sign * d * 0.65} ${b - d * 0.8} ${x + sign * d * 0.8} ${b}`,
          0.55,
        );
      }
      wave(l + d * 1.1, b, r - d * 1.1, b, d * 0.14, d * 3, 0.8);
      break;
    }
    case "ribbon":
      art("bow", r - d * 0.35, t + d * 0.25, d * 3.2, "anchor", 9);
      for (const offset of [0, d * 0.26]) {
        line(
          `M${l} ${t + d + offset} C${l - d * 0.15} ${t - d * 0.8 + offset} ${l + d * 2} ${t + d * 0.9 + offset} ${cx} ${t + offset} Q${r - d * 1.5} ${t - d * 0.15 + offset} ${r - d * 1.6} ${t + offset}`,
          0.8,
        );
        line(
          `M${r + offset} ${t + d * 2} C${r - d * 0.4 + offset} ${cy} ${r + d * 0.8 + offset} ${b - d * 0.7} ${r - d * 0.4 + offset} ${b} L${r - d * 0.1 + offset} ${b - d * 0.7}`,
          0.8,
        );
      }
      break;
    case "cloud": {
      const h = b - t,
        w = r - l;
      line(
        `M${l + h * 0.3} ${t + h * 0.2} C${l + w * 0.22} ${t - d * 0.55} ${cx - d} ${t + d * 0.35} ${cx} ${t + d * 0.2} C${cx + d} ${t - d * 0.45} ${r - h * 0.1} ${t - d * 0.2} ${r - h * 0.1} ${t + h * 0.28} C${r + d} ${t + h * 0.35} ${r + d * 0.25} ${b - h * 0.15} ${r - h * 0.25} ${b - h * 0.15} C${r - h * 0.4} ${b + d * 0.4} ${cx + d} ${b + d * 0.2} ${cx - d * 0.15} ${b} C${cx - d} ${b + d * 0.3} ${l + h * 0.15} ${b + d * 0.3} ${l + h * 0.12} ${b - h * 0.2} C${l - d} ${b - h * 0.1} ${l - d * 0.6} ${t + h * 0.3} ${l + h * 0.3} ${t + h * 0.2} Z`,
      );
      art("sparkle", r - d * 0.25, t + d * 0.05, d * 0.7, "corner", 0, false, false);
      art("sparkle", r + d * 0.75, t + d * 0.5, d * 0.4, "corner", 0, false, false);
      break;
    }
    case "stitch":
      anchored("needle", 2.4);
      outline(l, t, r, b, d * 0.35, "dashed");
      break;
    case "meadow":
      art("petal", cx, b, d * 1.8);
      art("laurel", cx - d * 1.65, b, d * 1.6, "anchor", 0, false, false);
      art("laurel", cx + d * 1.65, b, d * 1.6, "anchor", 0, true, false);
      art("petal", r - d * 0.1, t - d * 0.1, d * 0.9, "corner", 30);
      outline(l, t, r, b, d * 0.65, "wavy");
      break;
  }
  // Render connecting lines first, so fine details remain legible where components meet.
  return [...paths.filter((q) => !q.artwork), ...paths.filter((q) => q.artwork)];
}

let svgSequence = 0;
export function borderPathsSvg(paths: BorderPath[], lineWidth: number, imageHref?: (name: string) => string): string {
  const prefix = `border-images-${svgSequence++}`;
  const images = [...new Set(paths.flatMap((part) => (part.image ? [part.image] : [])))];
  const definitions = images
    .map((name, index) => {
      if (!imageHref) throw new Error("A PNG resolver is required for raster border artwork");
      const source = paths.find((part) => part.image === name)!;
      return `<image id="${prefix}-${index}" href="${imageHref(name)}" width="${source.imageWidth}" height="${source.imageHeight}" preserveAspectRatio="none"/>`;
    })
    .join("");
  return (
    (definitions ? `<defs>${definitions}</defs>` : "") +
    paths
      .map((part) => {
        const matrix = part.matrix ? ` matrix(${part.matrix.join(" ")})` : "";
        const transform = `translate(${part.x} ${part.y}) scale(${part.scale})${matrix}`;
        if (part.image) return `<use href="#${prefix}-${images.indexOf(part.image)}" transform="${transform}"/>`;
        const dash = part.dash ? ` stroke-dasharray="${part.dash.map((n) => n / part.scale).join(" ")}"` : "";
        return `<path d="${part.d}" transform="${transform}" fill="${part.filled ? "currentColor" : "none"}" stroke="${part.filled ? "none" : "currentColor"}" stroke-width="${(lineWidth * (part.weight ?? 1)) / part.scale}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
      })
      .join("")
  );
}

export function borderPreviewSvg(preset: BorderPreset, imageHref?: (name: string) => string): string {
  const settings = {
    ...DEFAULT_BORDER_SETTINGS,
    preset,
    decorationSize: 12,
    lineWidth: 1.1,
    patternSpacing: 4,
    decorationAnchor: borderDefaultAnchor(preset),
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 84" color="black">${borderPathsSvg(layoutBorder(180, 84, settings), settings.lineWidth, imageHref)}</svg>`;
}
