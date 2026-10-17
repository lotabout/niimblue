import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const bundle = await build({
  entryPoints: ["src/utils/font_loader.ts"], bundle: true, platform: "browser", format: "esm", write: false,
  plugins: [{ name: "fake-fabric-cache", setup(builder) {
    builder.onResolve({ filter: /^fabric$/ }, () => ({ path: "fabric", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const cache = { clearFontCache() { globalThis.fontCacheClears++; } };" }));
  } }],
});
const { loadCustomFonts, loadedFonts } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const font = (family, bytes) => ({ family, mimeType: "text/ttf", gzippedDataB64: gzipSync(bytes).toString("base64") });
const faces = new Set();
globalThis.document = { fonts: faces };
globalThis.fontCacheClears = 0;
let gate;
let started;
globalThis.FontFace = class {
  constructor(family, data) { this.family = family; this.data = Buffer.from(data).toString(); }
  async load() {
    if (this.data === "delayed") { started(); await gate; }
    if (this.data === "invalid") throw new Error("Invalid font");
    return this;
  }
};

test("browser loader replaces same-name font bytes, clears Fabric metrics, and avoids duplicate loads", async () => {
  const original = font("Same name", "first");
  await loadCustomFonts([original]);
  const oldFace = [...faces][0];
  const clears = globalThis.fontCacheClears;
  await loadCustomFonts([original]);
  assert.equal(faces.size, 1);
  assert.equal(globalThis.fontCacheClears, clears);
  await loadCustomFonts([font("Same name", "replacement")]);
  assert.equal(faces.size, 1);
  assert.equal(faces.has(oldFace), false);
  assert.equal([...faces][0].data, "replacement");
  assert.ok(globalThis.fontCacheClears > clears);
});

test("scope clearing invalidates pending FontFace loads so old accounts cannot reappear", async () => {
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const loadingStarted = new Promise((resolve) => { started = resolve; });
  const oldLoad = loadCustomFonts([font("Same name", "delayed")]);
  await loadingStarted;
  const clearing = loadCustomFonts([]);
  assert.equal(faces.size, 0, "previous account is removed synchronously");
  await clearing;
  await loadCustomFonts([font("Same name", "current user")]);
  release();
  await oldLoad;
  assert.deepEqual([...faces].map((face) => face.data), ["current user"]);
});

test("failed font decoding keeps the last installed set and reports the error", async () => {
  const before = [...faces];
  await assert.rejects(loadCustomFonts([font("Broken", "invalid")]), /Invalid font/);
  assert.deepEqual([...faces], before);
  let reported;
  const unsubscribe = loadedFonts.subscribe((fonts) => { reported = fonts; });
  assert.deepEqual(reported, before);
  unsubscribe();
  await loadCustomFonts([]);
});
