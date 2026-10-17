import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BORDER_ANCHORS,
  BORDER_PRESETS,
  DEFAULT_BORDER_SETTINGS,
  borderMinimumSize,
  borderTilePositions,
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
    const min = borderMinimumSize(options);
    const layout = layoutBorder(min, min, options);
    assert.ok(layout.length > 0, preset);
    for (const path of layout) {
      assert.ok(!/NaN|Infinity/.test(path.d), preset);
      assert.ok(Number.isFinite(path.scale));
      if (path.role !== "line") {
        assert.ok(path.x >= options.inset && path.y >= options.inset, preset);
        assert.ok(path.x + options.decorationSize <= min - options.inset, preset);
        assert.ok(path.y + options.decorationSize <= min - options.inset, preset);
      }
    }
  }
});
