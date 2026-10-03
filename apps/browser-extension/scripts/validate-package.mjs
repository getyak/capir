import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "../load-unpacked");
const requiredFiles = [
  "manifest.json",
  "service-worker.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  // The evaluation corpus fixtures/candidate-momentum-v1.json is optional and
  // private (GET-134); it is injected only by the private harness.
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

for (const file of requiredFiles) {
  await access(path.join(extensionRoot, file));
}

const manifest = JSON.parse(
  await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
);
if (manifest.manifest_version !== 3) {
  throw new Error("The load-unpacked package must use Manifest V3.");
}

const scriptFiles = [
  "service-worker.js",
  "sidepanel.js",
  ...(await readdir(path.join(extensionRoot, "lib")))
    .filter((file) => file.endsWith(".js"))
    .map((file) => `lib/${file}`),
];

for (const file of scriptFiles) {
  execFileSync(process.execPath, ["--check", path.join(extensionRoot, file)], {
    stdio: "inherit",
  });
}

const sourceText = await Promise.all(
  scriptFiles.map((file) => readFile(path.join(extensionRoot, file), "utf8")),
);
if (sourceText.some((text) => /https?:\/\/(?!localhost|127\.0\.0\.1)/.test(text))) {
  throw new Error("Remote URLs are not allowed in the extension package.");
}

console.log(
  `Validated load-unpacked package: ${requiredFiles.length} required files, ${scriptFiles.length} local scripts.`,
);
