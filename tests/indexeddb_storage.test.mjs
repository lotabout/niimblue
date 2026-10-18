import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { gzipSync } from "node:zlib";
import { buildSync } from "esbuild";
import { get } from "svelte/store";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";

globalThis.IDBKeyRange = IDBKeyRange;
const bundle = buildSync({
  stdin: {
    contents: `
      export { createLocalFonts, createLocalIcons } from "./src/utils/local_media.ts";
      export { LocalDocumentStorage } from "./src/utils/local_document_storage.ts";
      export { databaseTransaction, idbRequest, databaseUsedSpace } from "./src/utils/browser_database.ts";
      export { createFontLibrary } from "./src/utils/font_library.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
});
globalThis.localStorage = { getItem: () => null };
const {
  createLocalFonts,
  createLocalIcons,
  LocalDocumentStorage: documents,
  databaseTransaction,
  idbRequest,
  databaseUsedSpace,
  createFontLibrary,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

let failWrite;
let writes;
let failRemoval;
let forbidLocalWrites;
for (const method of ["put", "add"]) {
  const original = IDBObjectStore.prototype[method];
  IDBObjectStore.prototype[method] = function (...args) {
    writes++;
    if (failWrite === "throw" || failWrite === writes) throw new DOMException("Quota exceeded", "QuotaExceededError");
    const request = original.apply(this, args);
    if (failWrite === "abort") request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  failWrite = null;
  failRemoval = false;
  forbidLocalWrites = false;
  writes = 0;
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: {
      value: (key, value) => {
        if (forbidLocalWrites) throw new DOMException("Quota exceeded", "QuotaExceededError");
        storage[key] = value;
      },
    },
    removeItem: {
      value: (key) => {
        if (failRemoval) throw new Error("Removal denied");
        delete storage[key];
      },
    },
  });
  globalThis.localStorage = storage;
});

const font = (family = "中文字体") => ({
  family,
  mimeType: "text/ttf",
  gzippedDataB64: gzipSync(Buffer.from("font bytes")).toString("base64"),
});
const icon = (name = "icon") => ({
  name,
  data: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10Z"/></svg>',
});
const image = "data:image/png;base64,abc";
const label = (title = "Image label") => ({
  title,
  label: {
    size: { width: 240, height: 96 },
    printDirection: "left",
    shape: "rect",
    split: "none",
    splitParts: 2,
    tailLength: 0,
    tailPos: "right",
    mirror: "none",
  },
  canvas: { version: "7.4.0", objects: [{ type: "Image", src: image }] },
  thumbnailBase64: image,
});
const stored = (key) => databaseTransaction("readonly", (store) => idbRequest(store.get(key)));

test("font and SVG libraries migrate and restore; font bytes are binary in IndexedDB", async () => {
  localStorage.setItem("user_fonts", JSON.stringify([font()]));
  localStorage.setItem("user_icons", JSON.stringify([icon()]));
  localStorage.setItem("config", '{"gridEnabled":true}');
  const fonts = createLocalFonts();
  const icons = createLocalIcons();
  await Promise.all([fonts.ready(), icons.ready()]);
  assert.deepEqual(get(fonts), [font()]);
  assert.deepEqual(get(icons), [icon()]);
  assert.equal(localStorage.getItem("user_fonts"), null);
  assert.equal(localStorage.getItem("user_icons"), null);
  assert.equal(localStorage.getItem("config"), '{"gridEnabled":true}');
  const raw = await stored("user_fonts");
  assert.ok(raw[0].gzip instanceof Uint8Array);
  assert.equal(raw[0].gzippedDataB64, undefined);
  assert.deepEqual(Buffer.from(raw[0].gzip), Buffer.from(font().gzippedDataB64, "base64"));
  const restored = createLocalFonts();
  await restored.ready();
  assert.deepEqual(get(restored), [font()]);
});

test("large local fonts and image documents work even when localStorage rejects every write", async () => {
  forbidLocalWrites = true;
  const fonts = createLocalFonts();
  const large = { ...font(), gzippedDataB64: Buffer.alloc(6 * 1024 * 1024, 42).toString("base64") };
  await fonts.update(() => [large]);
  const withImage = {
    ...label(),
    canvas: { version: "7.4.0", objects: [{ type: "Image", src: image + "x".repeat(6 * 1024 * 1024) }] },
  };
  const saved = await documents.saveLabel(withImage);
  await documents.saveDefaultTemplate(withImage);
  await documents.saveLabelDraft({ version: 1, label: withImage, document: { title: "", baseline: "" } });
  assert.deepEqual(get(fonts), [large]);
  assert.equal((await documents.loadLabel(saved.id)).canvas.objects[0].src, withImage.canvas.objects[0].src);
  assert.equal((await documents.loadDefaultTemplate()).canvas.objects[0].src, withImage.canvas.objects[0].src);
  assert.equal((await documents.loadLabelDraft()).label.canvas.objects[0].src, withImage.canvas.objects[0].src);
  assert.ok((await databaseUsedSpace()) > 20 * 1024);
  assert.deepEqual(Object.keys(localStorage), []);
});

for (const mode of ["throw", "abort"]) {
  test(`failed migration (${mode}) preserves the old source, publishes nothing, and can retry`, async () => {
    const original = JSON.stringify([font()]);
    localStorage.setItem("user_fonts", original);
    failWrite = mode;
    const fonts = createLocalFonts();
    await assert.rejects(fonts.ready());
    assert.equal(localStorage.getItem("user_fonts"), original);
    assert.deepEqual(get(fonts), []);
    assert.equal(await stored("user_fonts"), undefined);
    failWrite = null;
    await fonts.ready();
    assert.deepEqual(get(fonts), [font()]);
    assert.equal(localStorage.getItem("user_fonts"), null);
  });
}

test("a failed update never changes the visible library or its last committed data", async () => {
  const icons = createLocalIcons();
  await icons.update(() => [icon("original")]);
  failWrite = "abort";
  await assert.rejects(icons.update(() => [icon("replacement")]));
  assert.deepEqual(get(icons), [icon("original")]);
  assert.deepEqual(await stored("user_icons"), [icon("original")]);
  failWrite = null;
  await icons.update((previous) => [...previous, icon("retry")]);
  assert.deepEqual(
    get(icons).map((item) => item.name),
    ["original", "retry"],
  );
});

test("invalid legacy font data remains available instead of being discarded", async () => {
  for (const raw of [
    "{broken",
    '[{"family":"incomplete"}]',
    JSON.stringify([{ ...font(), gzippedDataB64: "invalid!!" }]),
  ]) {
    localStorage.setItem("user_fonts", raw);
    await assert.rejects(createLocalFonts().ready());
    assert.equal(localStorage.getItem("user_fonts"), raw);
    assert.equal(await stored("user_fonts"), undefined);
  }
});

test("migration cleanup can retry without restoring a stale source over a newer library", async (t) => {
  t.mock.method(console, "warn", () => {});
  localStorage.setItem("user_icons", JSON.stringify([icon("legacy")]));
  failRemoval = true;
  const icons = createLocalIcons();
  await icons.ready();
  await icons.update(() => [icon("edited")]);
  failRemoval = false;
  const restored = createLocalIcons();
  await restored.ready();
  assert.deepEqual(get(restored), [icon("edited")]);
  assert.equal(localStorage.getItem("user_icons"), null);
});

test("independent tabs and overlapping updates merge against the latest committed library", async () => {
  const a = createLocalIcons();
  const b = createLocalIcons();
  await Promise.all([a.ready(), b.ready()]);
  await Promise.all([
    a.update((items) => [...items, icon("A")]),
    b.update((items) => [...items, icon("B")]),
    a.update((items) => [...items, icon("C")]),
  ]);
  await a.refresh();
  assert.deepEqual(
    get(a)
      .map((item) => item.name)
      .sort(),
    ["A", "B", "C"],
  );
});

test("labels, thumbnails, drafts and defaults migrate with portable images and stable IDs", async () => {
  const original = label();
  const draft = {
    version: 1,
    label: label("Unsaved image"),
    document: { id: "saved_label_123_0", title: "Unsaved image", baseline: "" },
  };
  for (const [key, value] of Object.entries({
    saved_label_123_0: original,
    label_workspace_draft: draft,
    default_template: original,
  }))
    localStorage.setItem(key, JSON.stringify(value));
  assert.deepEqual(await documents.loadLabels(), [{ ...original, id: "saved_label_123_0" }]);
  assert.deepEqual(await documents.loadLabelDraft(), draft);
  assert.deepEqual(await documents.loadDefaultTemplate(), original);
  assert.deepEqual(Object.keys(localStorage), []);
  // The existing JSON export format still contains the image itself.
  const exported = JSON.stringify(await documents.loadLabel("saved_label_123_0"));
  await documents.importLabels([JSON.parse(exported)]);
  assert.equal((await documents.loadLabels()).length, 2);
  for (const saved of await documents.loadLabels()) assert.equal(saved.canvas.objects[0].src, image);
});

test("legacy canvas migration commits before removing either legacy field and is repeatable", async () => {
  localStorage.setItem("saved_canvas_props", JSON.stringify(label().label));
  localStorage.setItem("saved_canvas_data", JSON.stringify(label().canvas));
  failWrite = "abort";
  await assert.rejects(documents.loadLabels());
  assert.ok(localStorage.getItem("saved_canvas_props"));
  assert.ok(localStorage.getItem("saved_canvas_data"));
  failWrite = null;
  assert.equal((await documents.loadLabels()).length, 1);
  assert.equal((await documents.loadLabels()).length, 1);
  assert.deepEqual(Object.keys(localStorage), []);
});

test("bulk import rolls back all new records when a later write fails", async () => {
  const original = await documents.saveLabel(label("Original"));
  failWrite = writes + 2;
  await assert.rejects(documents.importLabels([label("Import A"), label("Import B")]));
  assert.deepEqual(
    (await documents.loadLabels()).map((item) => item.id),
    [original.id],
  );
});

test("unavailable IndexedDB reports failure and retries without erasing local data", async () => {
  localStorage.setItem("user_icons", JSON.stringify([icon()]));
  const factory = globalThis.indexedDB;
  delete globalThis.indexedDB;
  const icons = createLocalIcons();
  await assert.rejects(icons.ready(), /IndexedDB is unavailable/);
  assert.ok(localStorage.getItem("user_icons"));
  globalThis.indexedDB = factory;
  await icons.ready();
  assert.deepEqual(get(icons), [icon()]);
});

test("font rendering waits for IndexedDB hydration and upload/delete wait for durable writes", async () => {
  localStorage.setItem("user_fonts", JSON.stringify([font("Existing")]));
  const fonts = createLocalFonts();
  const applied = [];
  const library = createFontLibrary(fonts, async (items) => {
    applied.push(items);
  });
  const selected = library.select({ mode: "local", url: "", token: "" });
  await library.ready();
  await selected;
  assert.deepEqual(get(library.state).fonts, [font("Existing")]);
  assert.deepEqual(applied.at(-1), [font("Existing")]);
  failWrite = "abort";
  await assert.rejects(library.add(font("New")));
  assert.deepEqual(get(library.state).fonts, [font("Existing")]);
  failWrite = null;
  await library.add(font("New"));
  await library.remove("Existing");
  const restored = createLocalFonts();
  await restored.ready();
  assert.deepEqual(get(restored), [font("New")]);
});

test("overlapping draft writes recover the newest snapshot", async () => {
  const document = { title: "", baseline: "" };
  await Promise.all([
    documents.saveLabelDraft({ version: 1, label: label("First"), document }),
    documents.saveLabelDraft({ version: 1, label: label("Latest"), document }),
  ]);
  assert.equal((await documents.loadLabelDraft()).label.title, "Latest");
});
