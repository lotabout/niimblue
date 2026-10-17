// Node 22.6+: node --experimental-strip-types scripts/export-border.mjs olive /tmp/olive.niimborder
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BORDER_PACKAGES } from "../src/utils/border_catalog.ts";
import { createBorderArchive, serializeBorderArchive } from "../src/utils/border_package.ts";

const [key, destination] = process.argv.slice(2);
if (!Object.hasOwn(BORDER_PACKAGES, key ?? "") || !destination) {
  console.error(
    `Usage: node --experimental-strip-types scripts/export-border.mjs <${Object.keys(BORDER_PACKAGES).join("|")}> <output.niimborder>`,
  );
  process.exit(1);
}
const root = fileURLToPath(new URL(`../src/assets/borders/${key}/`, import.meta.url));
const archive = await createBorderArchive(
  BORDER_PACKAGES[key],
  async (path) => `data:image/png;base64,${(await readFile(resolve(root, path))).toString("base64")}`,
);
await mkdir(dirname(resolve(destination)), { recursive: true });
await writeFile(destination, serializeBorderArchive(archive));
console.log(`Exported ${archive.border.id}@${archive.border.version} to ${resolve(destination)}`);
