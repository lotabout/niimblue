import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(repo, "scripts/package-compose.sh");

test("storage image includes every runtime Python module in its COPY sources and build context", () => {
  const server = path.join(repo, "server");
  const dockerfile = readFileSync(path.join(server, "Dockerfile"), "utf8");
  const copySources = dockerfile
    .split("\n")
    .filter((line) => line.startsWith("COPY "))
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1));
  // This context deliberately denies everything except explicit file exceptions.
  const ignoreRules = readFileSync(path.join(server, ".dockerignore"), "utf8")
    .split("\n")
    .map((line) => line.trim());
  assert.equal(ignoreRules[0], "**");
  const runtimeModules = readdirSync(server).filter((file) => file.endsWith(".py") && !file.startsWith("test_"));
  assert.ok(runtimeModules.length > 0);
  for (const file of runtimeModules) {
    assert.ok(copySources.includes(file), `${file} must be copied into the storage image`);
    assert.ok(ignoreRules.includes(`!${file}`), `${file} must be allowed into the storage build context`);
  }
});

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "niimblue package test "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const log = path.join(root, "docker.jsonl");
  // Exercise the real archive workflow without a daemon, network, or real images.
  writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NIIMBLUE_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "info" || args[1] === "version") process.exit(0);
if (args[0] === "buildx" && args[1] === "build") {
  process.exit(process.env.NIIMBLUE_TEST_FAIL_BUILD === "1" ? 1 : 0);
}
if (args[0] === "image" && args[1] === "save") {
  fs.writeFileSync(args[args.indexOf("--output") + 1], "fake exported images");
  process.exit(0);
}
process.exit(2);
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    TMPDIR: root,
    NIIMBLUE_TEST_LOG: log,
  };
  return { root, env, calls: () => readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) };
}

test("Compose bundles contain images and runtime configuration for each target architecture", async (t) => {
  for (const platform of ["linux/amd64", "linux/arm64"]) {
    await t.test(platform, (t) => {
      const { root, env, calls } = fixture(t);
      const archive = path.join(root, "output with spaces", "niimblue.tar.gz");
      const result = spawnSync("bash", [script, "--platform", platform, "--output", archive], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const extract = path.join(root, "extracted");
      mkdirSync(extract);
      const unpack = spawnSync("tar", ["-xzf", archive, "-C", extract], { encoding: "utf8" });
      assert.equal(unpack.status, 0, unpack.stderr);
      const bundle = path.join(extract, "niimblue");
      assert.deepEqual(readdirSync(bundle).sort(), [
        ".env.deploy.example",
        "BUILD.txt",
        "LICENSE",
        "README.zh-CN.md",
        "compose.bind.yaml",
        "compose.yaml",
        "images.tar",
      ]);
      assert.equal(
        readFileSync(path.join(bundle, "compose.yaml"), "utf8"),
        readFileSync(path.join(repo, "compose.yaml"), "utf8"),
      );
      assert.equal(
        readFileSync(path.join(bundle, "compose.bind.yaml"), "utf8"),
        readFileSync(path.join(repo, "compose.bind.yaml"), "utf8"),
      );
      const template = readFileSync(path.join(bundle, ".env.deploy.example"), "utf8");
      assert.ok(template.includes(`NIIMBLUE_PLATFORM=${platform}\n`));
      assert.match(template, /^NIIMBLUE_STORAGE_TOKEN=$/m);
      assert.equal(readFileSync(path.join(bundle, "images.tar"), "utf8"), "fake exported images");
      const builds = calls().filter((args) => args[0] === "buildx" && args[1] === "build");
      assert.equal(builds.length, 2);
      for (const args of builds) {
        assert.equal(args[args.indexOf("--platform") + 1], platform);
        assert.ok(args.includes("--load"));
      }
      assert.equal(builds[0][builds[0].indexOf("--target") + 1], "https-server");
      assert.equal(builds[0].at(-1), path.resolve(repo));
      assert.equal(builds[1].at(-1), path.join(repo, "server"));
      const save = calls().find((args) => args[0] === "image" && args[1] === "save");
      assert.deepEqual(save.slice(-2), ["niimblue-web:local", "niimblue-storage:local"]);
      assert.ok(!readdirSync(root).some((name) => name.startsWith("niimblue-compose.")));
    });
  }
});

test("packaging refuses invalid arguments and overwriting an existing archive", (t) => {
  const { root, env } = fixture(t);
  for (const args of [["--platform", "linux/386"], ["--output"], ["--unknown"]]) {
    const result = spawnSync("bash", [script, ...args], { cwd: root, env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
  }
  const archive = path.join(root, "existing.tar.gz");
  writeFileSync(archive, "keep this archive");
  const result = spawnSync("bash", [script, "--output", archive], { cwd: root, env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(archive, "utf8"), "keep this archive");
});

test("a failed image build leaves no archive or temporary staging directory", (t) => {
  const { root, env } = fixture(t);
  const result = spawnSync("bash", [script, "--output", path.join(root, "failed.tar.gz")], {
    cwd: root,
    env: { ...env, NIIMBLUE_TEST_FAIL_BUILD: "1" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(root).sort(), ["bin", "docker.jsonl"]);
});
