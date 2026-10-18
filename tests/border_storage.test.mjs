import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { deflateSync, crc32 } from "node:zlib";
import { buildSync } from "esbuild";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";

globalThis.IDBKeyRange = IDBKeyRange;
globalThis.localStorage = { getItem: () => null };
const bundle = buildSync({
  stdin: {
    contents: `
    export * from "./src/utils/border_storage.ts";
    export * from "./src/utils/image_border.ts";
    export { serializeBorderArchive, parseBorderArchive } from "./src/utils/border_package.ts";
    export { databaseTransaction, idbRequest } from "./src/utils/browser_database.ts";
    export { LocalDocumentStorage } from "./src/utils/local_document_storage.ts";
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
});
const {
  createBorderStorage,
  createImageBorderArchive,
  imageBorderSource,
  imageBorderRect,
  pngDataUri,
  pngBytes,
  serializeBorderArchive,
  parseBorderArchive,
  databaseTransaction,
  idbRequest,
  LocalDocumentStorage,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function png(width = 16, height = 8) {
  const chunk = (type, data) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(type), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(content));
    return Buffer.concat([header, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const local = { mode: "local", url: "", token: "" };
const remote = { mode: "remote", url: "https://borders.example", token: "alice", userId: "alice" };
const upload = (name = "透明花框") => ({ name, png: pngDataUri(png()), thumbnail: pngDataUri(png(8, 4)) });
const summary = (id = "c9a1becd-f319-42b0-b96b-e2ba9d124e2f") => ({
  id,
  name: upload().name,
  width: 16,
  height: 8,
  thumbnail: upload().thumbnail,
});
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = { getItem: () => null };
  globalThis.fetch = originalFetch;
});

test("pure image border packages round-trip independently of the built-in catalog", () => {
  const archive = createImageBorderArchive(summary().id, "Original colors", upload().png);
  assert.equal(archive.border.layout.engine, "niimblue-image");
  assert.equal(archive.border.layout.fit, "contain");
  assert.deepEqual(parseBorderArchive(serializeBorderArchive(archive)), archive);
  assert.equal(imageBorderSource(archive), upload().png);
  assert.deepEqual(Buffer.from(pngBytes(imageBorderSource(archive))), png());
});

test("image sizing preserves aspect ratio or explicitly stretches, including insets", () => {
  assert.deepEqual(imageBorderRect(200, 200, 100, 50, 10, "contain"), { x: 10, y: 55, width: 180, height: 90 });
  assert.deepEqual(imageBorderRect(200, 200, 100, 50, 10, "stretch"), { x: 10, y: 10, width: 180, height: 180 });
  assert.deepEqual(imageBorderRect(100, 40, 100, 50, 0, "contain"), { x: 10, y: 0, width: 80, height: 40 });
});

test("invalid image packages reject external sources, mismatched identity and excessive pixel sizes", () => {
  const original = createImageBorderArchive(summary().id, "Frame", upload().png);
  for (const change of [
    (value) => {
      value.files["assets/frame.png"] = "https://example.com/frame.png";
    },
    (value) => {
      value.border.assets.frame.crop[0] = 1;
    },
    (value) => {
      value.border.layout.version = 2;
    },
    (value) => {
      value.border.legacyPreset = "rounded";
    },
    (value) => {
      value.border.assets.extra = value.border.assets.frame;
    },
    (value) => {
      value.border.assets.frame.naturalWidth = 9000;
    },
  ]) {
    const copy = structuredClone(original);
    change(copy);
    assert.throws(() => parseBorderArchive(JSON.stringify(copy)));
  }
});

test("local border library stores PNG blobs in IndexedDB and survives a new storage instance", async () => {
  globalThis.localStorage.setItem = () => {
    throw new Error("localStorage must not hold images");
  };
  const storage = createBorderStorage(local);
  const saved = await storage.add(upload());
  assert.equal(saved.name, upload().name);
  assert.deepEqual(await createBorderStorage(local).list(), [saved]);
  const archive = await createBorderStorage(local).load(saved);
  assert.equal(imageBorderSource(archive), upload().png);
  const record = await databaseTransaction("readonly", (store) => idbRequest(store.get(`custom_border_${saved.id}`)));
  assert.ok(record.image instanceof Blob);
  assert.equal(record.image.type, "image/png");
  assert.deepEqual(Buffer.from(await record.image.arrayBuffer()), png());
  await storage.delete(saved.id);
  assert.deepEqual(await storage.list(), []);
  await assert.rejects(storage.load(saved), (error) => error.code === "missing");
});

test("duplicate local names are rejected atomically, including simultaneous uploads", async () => {
  const a = createBorderStorage(local),
    b = createBorderStorage(local);
  const results = await Promise.allSettled([a.add(upload()), b.add(upload())]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "conflict");
  assert.equal((await a.list()).length, 1);
});

test("failed local upload does not leave an unusable border record", async (t) => {
  const original = IDBObjectStore.prototype.add;
  t.mock.method(IDBObjectStore.prototype, "add", function (...args) {
    const request = original.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
  const storage = createBorderStorage(local);
  await assert.rejects(storage.add(upload()));
  assert.deepEqual(await storage.list(), []);
});

test("labels retain an embedded border after the reusable library record is deleted", async () => {
  const storage = createBorderStorage(local);
  const entry = await storage.add(upload());
  const archive = await storage.load(entry);
  const label = await LocalDocumentStorage.saveLabel({
    title: "Portable frame",
    label: { size: { width: 240, height: 96 }, printDirection: "left" },
    canvas: {
      version: "7.4.0",
      objects: [{ type: "LabelBorder", borderId: archive.border.id, borderPackage: archive }],
    },
  });
  await storage.delete(entry.id);
  const restored = await LocalDocumentStorage.loadLabel(label.id);
  assert.equal(imageBorderSource(restored.canvas.objects[0].borderPackage), upload().png);
  await LocalDocumentStorage.importLabels([JSON.parse(JSON.stringify(restored))]);
  assert.equal((await LocalDocumentStorage.loadLabels()).length, 2);
});

test("remote border storage uses authenticated metadata/upload and binary image downloads", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/borders")) return Response.json(options.method === "POST" ? summary() : [summary()]);
    return new Response(png(), { headers: { "Content-Type": "image/png" } });
  };
  const storage = createBorderStorage(remote);
  assert.deepEqual(await storage.list(), [summary()]);
  const saved = await storage.add(upload());
  assert.equal(imageBorderSource(await storage.load(saved)), upload().png);
  await storage.delete(saved.id);
  assert.equal(calls[0].url, "https://borders.example/api/v1/borders");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: upload().name,
    image: upload().png,
    thumbnail: upload().thumbnail,
  });
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, "Bearer alice");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.credentials, "omit");
  }
});

test("remote failures never fall back to the local library", async () => {
  for (const [status, code] of [
    [401, "auth"],
    [404, "missing"],
    [409, "conflict"],
    [413, "invalid"],
    [500, "connection"],
  ]) {
    globalThis.fetch = async () => Response.json({}, { status });
    await assert.rejects(createBorderStorage(remote).add(upload()), (error) => error.code === code);
  }
  assert.deepEqual(await createBorderStorage(local).list(), []);
});

test("remote libraries and retained adapters keep the originally selected credentials", async () => {
  const tokens = [];
  globalThis.fetch = async (_url, options) => {
    tokens.push(options.headers.Authorization);
    return Response.json([]);
  };
  const config = { ...remote };
  const alice = createBorderStorage(config);
  config.token = "bob";
  const bob = createBorderStorage(config);
  await alice.list();
  await bob.list();
  assert.deepEqual(tokens, ["Bearer alice", "Bearer bob"]);
});

test("corrupt remote metadata or mismatched image dimensions are rejected", async () => {
  globalThis.fetch = async () => Response.json([{ ...summary(), width: 99999 }]);
  await assert.rejects(createBorderStorage(remote).list(), (error) => error.code === "invalid");
  globalThis.fetch = async () => new Response(png(8, 4));
  await assert.rejects(createBorderStorage(remote).load(summary()), (error) => error.code === "invalid");
});
