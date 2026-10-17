import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { get, writable } from "svelte/store";

const bundle = buildSync({
  stdin: { contents: 'export { createFontLibrary } from "./src/utils/font_library.ts"; export { StorageError } from "./src/utils/label_storage.ts";', resolveDir: process.cwd() },
  bundle: true, platform: "browser", format: "esm", write: false,
});
globalThis.localStorage = { getItem: () => null };
const { createFontLibrary, StorageError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const local = { mode: "local", url: "", token: "" };
const remote = { mode: "remote", url: "https://fonts.example", token: "alice", userId: "alice" };
const font = (family = "测试字体", data = "data") => ({ family, gzippedDataB64: data, mimeType: "text/ttf" });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function backend() {
  const users = new Map();
  const calls = { load: 0, add: 0 };
  let serial = 0;
  let offline = false;
  const factory = (config) => {
    if (!users.has(config.token)) users.set(config.token, new Map());
    const fonts = users.get(config.token);
    const check = () => { if (offline) throw new StorageError("connection"); };
    return {
      list: async () => { check(); return [...fonts.values()].map(({ id, data }) => ({ id, family: data.family, mimeType: data.mimeType })); },
      load: async ({ id }) => { check(); calls.load++; return fonts.get(id); },
      add: async (data) => {
        check(); calls.add++;
        if ([...fonts.values()].some((font) => font.data.family === data.family)) throw new StorageError("conflict");
        const saved = { id: String(++serial), data };
        fonts.set(saved.id, saved);
        return saved;
      },
      delete: async (id) => { check(); if (!fonts.delete(id)) throw new StorageError("missing"); },
    };
  };
  return { factory, calls, setOffline: (value) => { offline = value; } };
}

test("two devices share remote additions and deletions while preserving each local library", async () => {
  const server = backend();
  const aLocal = writable([font("Local A")]);
  const bLocal = writable([font("Local B")]);
  const a = createFontLibrary(aLocal, async () => {}, server.factory);
  const b = createFontLibrary(bLocal, async () => {}, server.factory);
  await Promise.all([a.select(remote), b.select(remote)]);
  await a.add(font());
  assert.equal(server.calls.load, 0, "uploading device reuses its bytes");
  await b.refresh();
  assert.deepEqual(get(b.state).fonts, [font()]);
  assert.equal(server.calls.load, 1);
  await b.refresh();
  assert.equal(server.calls.load, 1, "metadata polling never re-downloads unchanged large files");
  await b.remove(font().family);
  await a.refresh();
  assert.deepEqual(get(a.state).fonts, []);
  await a.select(local);
  await b.select(local);
  assert.deepEqual(get(a.state).fonts, get(aLocal));
  assert.deepEqual(get(b.state).fonts, get(bLocal));
});

test("same-name replacements load new bytes and migration skips existing remote names", async () => {
  const server = backend();
  await server.factory(remote).add(font("Shared", "remote"));
  const localFonts = writable([font("Shared", "local"), font("Local only")]);
  const library = createFontLibrary(localFonts, async () => {}, server.factory);
  await library.select(remote);
  await library.uploadLocal();
  assert.deepEqual(get(library.state).fonts.map((f) => [f.family, f.gzippedDataB64]), [["Shared", "remote"], ["Local only", "data"]]);
  assert.equal(get(localFonts).length, 2);
  const storage = server.factory(remote);
  const original = (await storage.list()).find((f) => f.family === "Shared");
  await storage.delete(original.id);
  await storage.add(font("Shared", "replacement"));
  await library.refresh();
  assert.equal(get(library.state).fonts.find((f) => f.family === "Shared").gzippedDataB64, "replacement");
});

test("late downloads from a previous user cannot overwrite the current user's same-name font", async () => {
  const gate = deferred();
  const started = deferred();
  const applied = [];
  const library = createFontLibrary(writable([font("Local")]), async (fonts) => { applied.push(fonts); }, (config) => ({
    list: async () => [{ id: config.token, family: "Same", mimeType: "text/ttf" }],
    load: async () => {
      if (config.token === "alice") { started.resolve(); await gate.promise; }
      return { id: config.token, data: font("Same", config.token) };
    },
  }));
  const alice = library.select(remote);
  await started.promise;
  await library.select({ ...remote, token: "bob", userId: "bob" });
  gate.resolve();
  await alice;
  assert.deepEqual(get(library.state).fonts, [font("Same", "bob")]);
  assert.equal(applied.some((fonts) => fonts.some((f) => f.gzippedDataB64 === "alice")), false);
  await library.select(local);
  assert.deepEqual(get(library.state).fonts, [font("Local")]);
});

test("render readiness waits for font loading; failures keep the last good set and retry without local fallback", async () => {
  const server = backend();
  await server.factory(remote).add(font());
  const gate = deferred();
  let hold = true;
  const library = createFontLibrary(writable([font("Local")]), async (fonts) => { if (fonts.length && hold) await gate.promise; }, server.factory);
  const selecting = library.select(remote);
  let ready = false;
  const waiting = library.ready().then(() => { ready = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ready, false);
  hold = false;
  gate.resolve();
  await Promise.all([selecting, waiting]);
  server.setOffline(true);
  await library.refresh();
  assert.deepEqual(get(library.state).fonts, [font()]);
  assert.equal(get(library.state).error.code, "connection");
  await assert.rejects(library.add(font("Failed")), (e) => e.code === "connection");
  server.setOffline(false);
  await library.refresh();
  assert.equal(get(library.state).error, null);
  await library.select({ ...remote, token: "bob", userId: "bob" });
  assert.deepEqual(get(library.state).fonts, []);
});

test("an in-flight upload cannot update a different account after switching", async () => {
  const server = backend();
  const gate = deferred();
  const started = deferred();
  const library = createFontLibrary(writable([]), async () => {}, (config) => {
    const storage = server.factory(config);
    return { ...storage, add: async (data) => { started.resolve(); await gate.promise; return storage.add(data); } };
  });
  await library.select(remote);
  const uploading = library.add(font());
  await started.promise;
  await library.select({ ...remote, token: "bob", userId: "bob" });
  gate.resolve();
  await uploading;
  assert.deepEqual(get(library.state).fonts, []);
  assert.equal((await server.factory(remote).list()).length, 1);
  assert.equal((await server.factory({ ...remote, token: "bob" }).list()).length, 0);
});

test("unreadable downloaded fonts remain visible for removal without repeated downloads", async () => {
  const server = backend();
  await server.factory(remote).add(font("Unreadable"));
  const library = createFontLibrary(writable([]), async (fonts) => {
    if (fonts.some((font) => font.family === "Unreadable")) throw new Error("Invalid font");
  }, server.factory);
  await library.select(remote);
  assert.equal(get(library.state).fonts[0].family, "Unreadable");
  assert.match(get(library.state).error.message, /Invalid font/);
  await library.refresh();
  assert.equal(server.calls.load, 1);
  await library.remove("Unreadable");
  assert.deepEqual(get(library.state).fonts, []);
  assert.equal(get(library.state).error, null);
});

test("a background refresh racing an upload cannot hide the newly uploaded font", async () => {
  const server = backend();
  const uploadStarted = deferred();
  const finishUpload = deferred();
  const listingStarted = deferred();
  const finishListing = deferred();
  let pauseList = false;
  const library = createFontLibrary(writable([]), async () => {}, (config) => {
    const storage = server.factory(config);
    return {
      ...storage,
      add: async (font) => { uploadStarted.resolve(); await finishUpload.promise; return storage.add(font); },
      list: async () => {
        const snapshot = await storage.list();
        if (pauseList) { pauseList = false; listingStarted.resolve(); await finishListing.promise; }
        return snapshot;
      },
    };
  });
  await library.select(remote);
  const uploading = library.add(font());
  await uploadStarted.promise;
  pauseList = true;
  const background = library.refresh();
  await listingStarted.promise;
  finishUpload.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  finishListing.resolve();
  await Promise.all([uploading, background]);
  assert.deepEqual(get(library.state).fonts, [font()]);
  assert.equal(server.calls.load, 0);
});
