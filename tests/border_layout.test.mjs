import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { BORDER_RASTER_ARTWORK as rasterArtwork, BORDER_PACKAGES } from "../src/utils/border_catalog.ts";
import {
  BORDER_ANCHORS,
  BORDER_PRESETS,
  DEFAULT_BORDER_SETTINGS,
  borderMinimumDimensions,
  borderDefaultAnchor,
  borderPresetFeatures,
  borderTilePositions,
  borderPathsSvg,
  layoutBorder,
} from "../src/utils/border_layout.ts";

const settings = (preset, extras = {}) => ({ ...DEFAULT_BORDER_SETTINGS, preset, ...extras });
const parts = (w, h, options, role) => layoutBorder(w, h, options).filter((p) => p.role === role);

test("corner artwork keeps its geometry and size while right/bottom corners move", () => {
  const options = settings("corners");
  const small = parts(160, 80, options, "corner");
  const large = parts(280, 140, options, "corner");
  assert.equal(small.length, 4);
  assert.deepEqual(
    small.map(({ d, scale }) => ({ d, scale })),
    large.map(({ d, scale }) => ({ d, scale })),
  );
  assert.equal(large[0].x, small[0].x);
  assert.equal(large[0].y, small[0].y);
  assert.equal(large[1].x - small[1].x, 120);
  assert.equal(large[2].y - small[2].y, 60);
});

test("botanical, animal and bow motifs use bundled proportional RGBA PNGs", () => {
  assert.equal(Object.keys(rasterArtwork).length, 13);
  const used = new Set();
  for (const preset of Object.keys(BORDER_PRESETS)) {
    for (const part of layoutBorder(320, 180, settings(preset))) {
      if (!part.image) continue;
      used.add(part.image);
      assert.equal(part.d, "", "raster artwork must not retain a redrawn path");
      assert.equal(BORDER_PACKAGES[preset].assets[part.artwork].type, "png");
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(rasterArtwork).sort());
  for (const asset of Object.values(rasterArtwork)) {
    const png = readFileSync(new URL(`../src/${asset.path.slice(3)}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), asset.naturalWidth);
    assert.equal(png.readUInt32BE(20), asset.naturalHeight);
    assert.equal(png[25], 6, "PNG must have an alpha channel");
    const [x, y, width, height] = asset.crop;
    assert.ok(x > 0 && y > 0 && x + width < asset.naturalWidth && y + height < asset.naturalHeight);
    assert.ok(Math.abs(asset.width / asset.height - width / height) < 0.00001);
    assert.ok(!/^\d/.test(asset.file));
  }
});

test("SVG embeds each reused PNG once and keeps every transformed placement", () => {
  const paths = layoutBorder(320, 140, settings("meadow"));
  const images = paths.filter((p) => p.image);
  const svg = borderPathsSvg(paths, 2, () => "data:image/png;base64,example");
  assert.equal(images.length, 4);
  assert.equal((svg.match(/<image /g) ?? []).length, 2);
  assert.equal((svg.match(/<use /g) ?? []).length, images.length);
  assert.ok(svg.includes('href="data:image/png;base64,example"'));
  assert.ok(svg.includes("<path "), "connecting frame stays procedural");
  const other = borderPathsSvg(paths, 2, () => "data:image/png;base64,example");
  assert.notEqual(svg.match(/id="([^"]+)"/)[1], other.match(/id="([^"]+)"/)[1]);
  assert.throws(() => borderPathsSvg(paths, 2), /PNG resolver/);
});

test("visible preset translations have descriptive names without numbered prefixes", () => {
  for (const locale of ["en", "zh_cn"]) {
    const messages = JSON.parse(readFileSync(new URL(`../src/locale/dicts/${locale}.json`, import.meta.url)));
    for (const preset of Object.keys(BORDER_PRESETS)) {
      const name = messages[`params.border.preset.${preset}`];
      assert.ok(name && !/^\s*\d/.test(name), `${locale}: ${preset}`);
    }
  }
});

test("all eight anchors reposition artwork without resizing it", () => {
  for (const anchor of BORDER_ANCHORS) {
    const options = settings("rabbit", { decorationAnchor: anchor });
    const [a] = parts(160, 80, options, "anchor");
    const [b] = parts(280, 140, options, "anchor");
    const dx =
      anchor.includes("left") || anchor === "left" ? 0 : anchor.includes("right") || anchor === "right" ? 120 : 60;
    const dy =
      anchor.includes("top") || anchor === "top" ? 0 : anchor.includes("bottom") || anchor === "bottom" ? 60 : 30;
    assert.equal(b.x - a.x, dx, anchor);
    assert.equal(b.y - a.y, dy, anchor);
    assert.equal(a.scale, b.scale);
    assert.equal(a.d, b.d);
  }
});

test("repeated artwork adds whole motifs and preserves size during nonuniform resize", () => {
  const options = settings("flowers");
  const small = parts(160, 80, options, "repeat");
  const large = parts(340, 110, options, "repeat");
  assert.ok(large.length > small.length);
  assert.ok([...small, ...large].every((p) => p.scale === options.decorationSize / 24));
});

test("tiles stay centered, retain their gap and are never clipped", () => {
  for (const length of [0, 15, 16, 17, 38, 55, 100, 101]) {
    const positions = borderTilePositions(10, 10 + length, 16, 6);
    if (length < 16) {
      assert.deepEqual(positions, []);
      continue;
    }
    assert.equal(positions[0] - 8 - 10, 10 + length - positions.at(-1) - 8);
    for (let i = 1; i < positions.length; i++) assert.equal(positions[i] - positions[i - 1], 22);
    assert.ok(positions[0] >= 18);
    assert.ok(positions.at(-1) <= 10 + length - 8);
  }
});

test("mixed borders retain all three behaviors and avoid duplicate corner decorations", () => {
  const options = settings("garden", { decorationAnchor: "bottom-right" });
  const layout = layoutBorder(240, 96, options);
  assert.equal(layout.filter((p) => p.role === "corner").length, 3);
  assert.equal(layout.filter((p) => p.role === "anchor").length, 1);
  assert.ok(layout.some((p) => p.role === "repeat"));
  const decorations = layout.filter((p) => p.role === "corner" || p.role === "anchor");
  for (const tile of layout.filter((p) => p.role === "repeat")) {
    for (const art of decorations) {
      assert.ok(
        Math.abs(tile.x - art.x) >= options.decorationSize || Math.abs(tile.y - art.y) >= options.decorationSize,
      );
    }
  }
});

test("every preset remains finite and inside the frame at minimum supported dimensions", () => {
  for (const preset of Object.keys(BORDER_PRESETS)) {
    const options = settings(preset, { decorationSize: 32, inset: 6, lineWidth: 3 });
    const minimum = borderMinimumDimensions(options);
    const layout = layoutBorder(minimum.width, minimum.height, options);
    assert.ok(layout.length > 0, preset);
    for (const path of layout) {
      assert.ok(!/NaN|Infinity/.test(path.d), preset);
      assert.ok(Number.isFinite(path.scale));
      if (path.bounds) {
        const q = path.bounds;
        assert.ok(q.x >= options.inset && q.y >= options.inset, preset);
        assert.ok(q.x + q.width <= minimum.width - options.inset + 0.001, preset);
        assert.ok(q.y + q.height <= minimum.height - options.inset + 0.001, preset);
      }
    }
  }
});

test("catalog contains exactly the 17 retained designs and the original rounded border", () => {
  const requested = [1, 3, 4, 6, 7, 9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 21, 25];
  assert.deepEqual(
    Object.values(BORDER_PRESETS)
      .map((p) => p.referenceDesign)
      .filter((n) => n !== null),
    requested,
  );
  assert.equal(Object.keys(BORDER_PRESETS).length, 18);
  for (const old of ["corners", "flower", "rabbit", "dots", "flowers", "garden"]) {
    assert.ok(!(old in BORDER_PRESETS));
    assert.ok(layoutBorder(240, 96, settings(old)).length > 0, "saved legacy borders still render");
  }
});

test("borderless designs do not acquire a rectangular outline", () => {
  for (const preset of ["olive", "ginkgo", "bunny"]) {
    assert.ok(
      layoutBorder(240, 96, settings(preset)).every((p) => p.role !== "line"),
      preset,
    );
  }
});

test("selected artwork keeps its geometry and scale when resizing every design", () => {
  for (const preset of Object.keys(BORDER_PRESETS).filter((p) => BORDER_PRESETS[p].layout.sizing === "fixed")) {
    const options = settings(preset, { decorationAnchor: borderDefaultAnchor(preset) });
    const small = layoutBorder(240, 120, options).filter((p) => p.artwork && p.role !== "repeat");
    const large = layoutBorder(400, 200, options).filter((p) => p.artwork && p.role !== "repeat");
    assert.deepEqual(
      small.map((p) => [p.artwork, p.d, p.scale, p.matrix]),
      large.map((p) => [p.artwork, p.d, p.scale, p.matrix]),
      preset,
    );
    assert.deepEqual(
      small.map((p) => [p.bounds.width, p.bounds.height]),
      large.map((p) => [p.bounds.width, p.bounds.height]),
      preset,
    );
  }
});

test("new anchored artwork supports all eight positions", () => {
  for (const preset of Object.keys(BORDER_PRESETS).filter((p) => borderPresetFeatures(p).decoration)) {
    for (const decorationAnchor of BORDER_ANCHORS) {
      const options = settings(preset, { decorationAnchor });
      const a = layoutBorder(300, 180, options).find((p) => p.role === "anchor" && p.artwork);
      const b = layoutBorder(420, 240, options).find((p) => p.role === "anchor" && p.artwork);
      const dx =
        decorationAnchor.includes("left") || decorationAnchor === "left"
          ? 0
          : decorationAnchor.includes("right") || decorationAnchor === "right"
            ? 120
            : 60;
      const dy =
        decorationAnchor.includes("top") || decorationAnchor === "top"
          ? 0
          : decorationAnchor.includes("bottom") || decorationAnchor === "bottom"
            ? 60
            : 30;
      assert.ok(Math.abs(b.x - a.x - dx) < 0.001, preset + decorationAnchor);
      assert.ok(Math.abs(b.y - a.y - dy) < 0.001, preset + decorationAnchor);
    }
  }
});

test("stitches retain their dash lengths during resize", () => {
  const stitch = settings("stitch");
  const small = layoutBorder(180, 90, stitch).filter((p) => p.dash);
  const large = layoutBorder(360, 150, stitch).filter((p) => p.dash);
  assert.deepEqual(small[0].dash, large[0].dash);
});

test("image decorations are enlarged while keeping the original PNG aspect ratio", () => {
  for (const [preset, name, baseWidth] of [
    ["daisy", "daisy", 2.7],
    ["cat", "cat", 5.8],
    ["ribbon", "bow", 3.2],
  ]) {
    const [part] = layoutBorder(400, 200, settings(preset)).filter((p) => p.artwork === name);
    const asset = BORDER_PACKAGES[preset].assets[name];
    assert.ok(Math.abs(part.scale * asset.width - baseWidth * 16 * 1.25) < 0.00001);
    assert.ok(
      Math.abs((part.scale * asset.height) / (part.scale * asset.width) - asset.height / asset.width) < 0.00001,
    );
  }
});

test("olive branches form mirrored full-height side frames without stretching or colliding", () => {
  for (const [width, height] of [
    [300, 140],
    [400, 200],
    [120, 300],
  ]) {
    const options = settings("olive");
    const [left, right] = layoutBorder(width, height, options);
    const asset = BORDER_PACKAGES.olive.assets.olive;
    const margin = options.inset + options.lineWidth / 2;
    assert.equal(left.bounds.height, right.bounds.height);
    assert.ok(Math.abs(left.bounds.width / left.bounds.height - asset.width / asset.height) < 0.00001);
    assert.ok(left.bounds.x + left.bounds.width + 2 * options.decorationSize <= right.bounds.x + 0.001);
    assert.ok(Math.abs(left.x + right.x - width) < 0.00001);
    assert.equal(left.matrix[0], 1);
    assert.equal(right.matrix[0], -1);
    if (width > height) {
      assert.ok(Math.abs(left.bounds.y - margin) < 0.00001);
      assert.ok(Math.abs(left.bounds.height - (height - 2 * margin)) < 0.00001);
    }
  }
});
