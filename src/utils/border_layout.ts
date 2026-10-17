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

export const BORDER_PRESETS = {
  rounded: { line: true },
  corners: { corners: "flower", line: true },
  flower: { decoration: "flower", line: true },
  rabbit: { decoration: "rabbit", line: true },
  dots: { repeat: "dot", line: false },
  flowers: { repeat: "flower", line: false },
  garden: { corners: "flower", decoration: "rabbit", repeat: "dot", line: true },
} satisfies Record<string, BorderRecipe>;
export type BorderPreset = keyof typeof BORDER_PRESETS;

export interface BorderSettings {
  preset: BorderPreset;
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
}

export function borderMinimumSize(settings: BorderSettings): number {
  // Leave room for two decorations and a connecting edge. Never shrink the artwork to fit.
  const repeat = (BORDER_PRESETS[settings.preset] as BorderRecipe | undefined)?.repeat;
  return Math.ceil(2 * settings.inset + (repeat ? 3 : 2) * settings.decorationSize + settings.lineWidth + 6);
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
export function layoutBorder(width: number, height: number, settings: BorderSettings): BorderPath[] {
  const recipe: BorderRecipe = BORDER_PRESETS[settings.preset] ?? BORDER_PRESETS.rounded;
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

export function borderPathsSvg(paths: BorderPath[], lineWidth: number): string {
  return paths
    .map(
      (p) =>
        `<path d="${p.d}" transform="translate(${p.x} ${p.y}) scale(${p.scale})" fill="${p.filled ? "currentColor" : "none"}" stroke="${p.filled ? "none" : "currentColor"}" stroke-width="${lineWidth / p.scale}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
}

export function borderPreviewSvg(preset: BorderPreset): string {
  const settings = { ...DEFAULT_BORDER_SETTINGS, preset, decorationAnchor: "bottom-right" as const };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 68" color="black">${borderPathsSvg(layoutBorder(150, 68, settings), settings.lineWidth)}</svg>`;
}
