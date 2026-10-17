import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { BORDER_PACKAGES, findBorderPackage } from "../src/utils/border_catalog.ts";
import {
  createBorderArchive,
  parseBorderArchive,
  serializeBorderArchive,
  validateBorderManifest,
} from "../src/utils/border_package.ts";
import { DEFAULT_BORDER_SETTINGS, layoutBorder, borderPathsSvg } from "../src/utils/border_layout.ts";

const archiveFor = (key) =>
  createBorderArchive(
    BORDER_PACKAGES[key],
    async (file) =>
      `data:image/png;base64,${(await readFile(new URL(`../src/assets/borders/${key}/${file}`, import.meta.url))).toString("base64")}`,
  );

test("each border package has a stable unique ID, version and all local resources", async () => {
  const ids = new Set();
  for (const [key, manifest] of Object.entries(BORDER_PACKAGES)) {
    assert.deepEqual(validateBorderManifest(manifest), manifest);
    assert.ok(!ids.has(manifest.id));
    ids.add(manifest.id);
    assert.equal(findBorderPackage(key), manifest);
    assert.equal(findBorderPackage(manifest.id), manifest);
    const archive = await archiveFor(key);
    assert.deepEqual(parseBorderArchive(serializeBorderArchive(archive)), archive);
    assert.equal(
      Object.keys(archive.files).length,
      Object.values(manifest.assets).filter((a) => a.type === "png").length,
    );
  }
});

test("multi-motif package includes every referenced image locally", async () => {
  const archive = await archiveFor("meadow");
  assert.deepEqual(Object.keys(archive.files).sort(), ["assets/laurel.png", "assets/petal.png"]);
  assert.equal(archive.border.assets.laurel.file, "assets/laurel.png");
});

test("imported and renamed packages render using only their manifest and embedded resources", async () => {
  const archive = await archiveFor("daisy");
  archive.border.id = "personal.flower";
  archive.border.name.en = "My flower";
  delete archive.border.legacyPreset;
  const imported = parseBorderArchive(serializeBorderArchive(archive));
  const options = { ...DEFAULT_BORDER_SETTINGS, preset: "daisy", decorationAnchor: "top-left" };
  const paths = layoutBorder(300, 140, options, imported.border);
  const image = paths.find((p) => p.image);
  assert.equal(image.image, "personal.flower/daisy");
  const svg = borderPathsSvg(paths, 2, (id) => imported.files[imported.border.assets[id.split("/").at(-1)].file]);
  assert.ok(svg.includes('href="data:image/png;base64,'));
  assert.ok(!svg.includes("http:"));
  assert.equal(
    paths.find((p) => p.role === "line").d,
    layoutBorder(300, 140, options).find((p) => p.role === "line").d,
  );
});

test("package validation rejects missing or external resources and unsupported engines", async () => {
  const original = await archiveFor("meadow");
  const bad = (change) => {
    const copy = structuredClone(original);
    change(copy);
    assert.throws(() => parseBorderArchive(JSON.stringify(copy)));
  };
  bad((a) => delete a.files["assets/laurel.png"]);
  bad((a) => (a.files["extra.png"] = a.files["assets/petal.png"]));
  bad((a) => (a.files["assets/petal.png"] = "https://example.com/petal.png"));
  bad((a) => (a.border.assets.petal.file = "../petal.png"));
  bad((a) => (a.border.layout.version = 2));
  bad((a) => (a.border.schemaVersion = 2));
  bad((a) => a.border.assets.petal.naturalWidth++);
  bad((a) => (a.border.assets.petal.crop[2] *= 100));
  bad((a) => delete a.border.assets.laurel);
  bad((a) => (a.border.id = "01"));
  bad((a) => (a.files["assets/petal.png"] = "data:image/png;base64,bm90LWEtcG5n"));
});
