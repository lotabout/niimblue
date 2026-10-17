import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { gzipSync } from "node:zlib";

const bundle = buildSync({ entryPoints: ["src/utils/font_storage.ts"], bundle: true, platform: "browser", format: "esm", write: false });
globalThis.localStorage = { getItem: () => null };
// Node has Blob and fetch, but not the browser FileReader used for local font compatibility.
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((bytes) => { this.result = `data:application/gzip;base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); });
  }
};
const { createFontStorage } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const config = { mode: "remote", url: "https://fonts.example", token: "secret" };

test("font upload and download use authenticated binary gzip rather than Base64 JSON", async () => {
  const summary = { id: "font-id", family: "中文字体", mimeType: "text/ttf" };
  const compressed = gzipSync(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(12 * 1024 * 1024)]));
  const font = { family: summary.family, mimeType: summary.mimeType, gzippedDataB64: compressed.toString("base64") };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return Response.json(summary);
    if (url.endsWith("/fonts")) return Response.json([summary]);
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(compressed, { headers: { "Content-Type": "application/gzip" } });
  };
  const storage = createFontStorage(config);
  assert.deepEqual(await storage.add(font), { id: summary.id, data: font });
  const upload = calls[0].options;
  assert.equal(upload.headers["Content-Type"], "application/gzip");
  assert.equal(decodeURIComponent(upload.headers["X-Font-Family"]), font.family);
  assert.deepEqual(Buffer.from(await upload.body.arrayBuffer()), compressed);
  assert.deepEqual(await storage.list(), [summary]);
  assert.deepEqual(await storage.load(summary), { id: summary.id, data: font });
  await storage.delete(summary.id);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, "Bearer secret");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
  }
});

test("font metadata validation rejects duplicate identities and unsupported formats", async () => {
  const storage = createFontStorage(config);
  const summary = { id: "id", family: "Name", mimeType: "text/ttf" };
  for (const response of [{}, [summary, summary], [{ ...summary, mimeType: "text/html" }]]) {
    globalThis.fetch = async () => Response.json(response);
    await assert.rejects(storage.list(), (e) => e.code === "invalid");
  }
  globalThis.fetch = async () => Response.json({}, { status: 401 });
  await assert.rejects(storage.load(summary), (e) => e.code === "auth");
});
