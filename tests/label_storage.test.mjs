import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["src/utils/label_storage.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
});
function freshLocalStorage() {
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: {
      value: (key, value) => {
        storage[key] = value;
      },
    },
    removeItem: {
      value: (key) => {
        delete storage[key];
      },
    },
  });
  return storage;
}
globalThis.localStorage = freshLocalStorage();
const { createLabelStorage, setStorageConfig, normalizeStorageConfig, storageKey, StorageError } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const remote = { mode: "remote", url: "https://storage.example.com/", token: "shared-test-token" };
const label = (title = "Cable") => ({
  title,
  label: { size: { width: 240, height: 96 }, printDirection: "left" },
  canvas: { version: "7.4.0", objects: [] },
});
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.localStorage = freshLocalStorage();
  globalThis.fetch = originalFetch;
  setStorageConfig({ mode: "local", url: "", token: "" });
});

test("switching between independent libraries preserves local labels and strips imported identity", async () => {
  const local = createLabelStorage();
  const saved = await local.save(label());
  setStorageConfig(remote);
  assert.equal(storageKey(), "remote:https://storage.example.com");
  assert.equal((await local.load(saved.id)).title, "Cable");
  setStorageConfig({ mode: "local", url: "", token: "" });
  await createLabelStorage().import([{ ...saved, title: "Imported" }]);
  const labels = await createLabelStorage().list();
  assert.equal(labels.length, 2);
  assert.notEqual(labels[0].id, labels[1].id);
  assert.equal((await local.load(saved.id)).title, "Cable");
});

test("remote saves send expected revisions and preserve identity only for explicit updates", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: "remote-uuid", revision: 4, data: label() });
  };
  const storage = createLabelStorage(remote);
  const updated = await storage.save({ ...label(), id: "local-id", storageRevision: 100 }, "remote-uuid", 3);
  assert.equal(updated.storageRevision, 4);
  assert.equal(calls[0].url, "https://storage.example.com/api/v1/labels/remote-uuid");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${remote.token}`);
  assert.equal(calls[0].options.redirect, "error");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.revision, 3);
  assert.equal(body.data.id, undefined);
  assert.equal(body.data.storageRevision, undefined);
  await storage.save(updated);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(JSON.parse(calls[1].options.body).revision, undefined);
});

test("connection failures, stale writes and missing labels cannot fall back to local saves", async () => {
  const storage = createLabelStorage(remote);
  for (const [status, code] of [
    [401, "auth"],
    [409, "conflict"],
    [404, "missing"],
    [500, "connection"],
  ]) {
    globalThis.fetch = async () => Response.json({}, { status });
    await assert.rejects(
      storage.save(label(), "id", 1),
      (error) => error instanceof StorageError && error.code === code,
    );
  }
  globalThis.fetch = async () => {
    throw new TypeError("Offline");
  };
  await assert.rejects(storage.save(label()), (error) => error.code === "connection");
  assert.equal((await createLabelStorage().list()).length, 0);
  globalThis.fetch = async () => Response.json({}, { status: 404 });
  assert.equal(await storage.load("deleted"), null);
});

test("settings reject public HTTP or credential-bearing endpoints; connection test checks API compatibility", async () => {
  for (const url of [
    "http://example.com",
    "http://192.167.1.1",
    "http://192.169.1.1",
    "http://172.15.255.255",
    "http://172.32.0.1",
    "http://192.168.1.1.example.com",
    "http://10.example.com",
    "http://192.168.1.1?token=secret",
    "http://user:password@192.168.1.1",
    "https://user:password@example.com",
    "https://example.com?token=secret",
    "https://example.com/#secret",
    "file:///tmp/db",
  ]) {
    assert.throws(() => normalizeStorageConfig({ ...remote, url }), StorageError);
  }
  assert.equal(normalizeStorageConfig({ ...remote, url: "http://localhost:8787/" }).url, "http://localhost:8787");
  globalThis.fetch = async () => Response.json({ status: "ok" });
  await assert.rejects(createLabelStorage(remote).test(), (error) => error.code === "invalid");
  globalThis.fetch = async () => Response.json({ apiVersion: 1, storage: "sqlite" });
  await createLabelStorage(remote).test();
});

test("LAN storage permits HTTP on RFC1918 IPv4 ranges and loopback without upgrading the URL", () => {
  for (const host of [
    "192.168.0.1",
    "192.168.255.254",
    "10.0.0.1",
    "10.255.255.254",
    "172.16.0.1",
    "172.31.255.254",
    "127.0.0.1",
    "127.0.0.2",
    "localhost",
    "[::1]",
  ]) {
    const url = `http://${host}:8787`;
    assert.equal(normalizeStorageConfig({ ...remote, url: `${url}/` }).url, url);
    assert.equal(storageKey({ ...remote, url }), `remote:${url}`);
  }
});

test("connection identifies the token's user without a username field and scopes drafts by user", async () => {
  globalThis.fetch = async (_url, options) => {
    const userId = options.headers.Authorization === `Bearer ${remote.token}` ? "alice" : "bob";
    return Response.json({ apiVersion: 1, storage: "sqlite", userId });
  };
  const aliceId = await createLabelStorage(remote).test();
  const bobId = await createLabelStorage({ ...remote, token: "bob-token" }).test();
  assert.equal(aliceId, "alice");
  assert.equal(bobId, "bob");
  const aliceKey = storageKey({ ...remote, userId: aliceId });
  const bobKey = storageKey({ ...remote, userId: bobId });
  assert.notEqual(aliceKey, bobKey);
  assert.equal(aliceKey, "remote:https://storage.example.com#user:alice");
  assert.equal(aliceKey.includes(remote.token), false);
  setStorageConfig({ ...remote, userId: aliceId });
  assert.equal(storageKey(), aliceKey);
  assert.equal(JSON.parse(localStorage.getItem("label_storage_config")).userId, "alice");
  assert.equal(storageKey({ ...remote, token: "rotated-alice-token", userId: aliceId }), aliceKey);
});
