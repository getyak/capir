import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const brandRoot = path.join(repositoryRoot, "brand");
const manifest = JSON.parse(
  await readFile(path.join(brandRoot, "assets.json"), "utf8"),
);

const inkPath =
  "M38 10.5c-4.3-2.1-9.2-2.8-14-1.6C12.1 11.8 5.7 24.2 9.9 35.6c3.8 10.2 14.8 15.8 25.2 12.9";
const signalPath = "M43.8 15.6c7.4 6.1 8.6 17 2.7 24.5";

function pngDimensions(buffer, file) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", `${file} is not a PNG`);
  assert.equal(
    buffer.subarray(12, 16).toString("ascii"),
    "IHDR",
    `${file} has no PNG IHDR`,
  );

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function pngHasAlpha(buffer) {
  const colorType = buffer.readUInt8(25);
  return colorType === 4 || colorType === 6;
}

for (const file of manifest.svg) {
  const source = await readFile(path.join(brandRoot, file), "utf8");
  assert.match(source, /<svg\b/, `${file} is not an SVG`);
  assert.ok(source.includes(inkPath), `${file} changed the ink geometry`);
  assert.ok(source.includes(signalPath), `${file} changed the signal geometry`);
}

for (const asset of manifest.png) {
  const buffer = await readFile(path.join(brandRoot, asset.file));
  assert.deepEqual(
    pngDimensions(buffer, asset.file),
    { width: asset.width, height: asset.height },
    `${asset.file} has the wrong dimensions`,
  );
  if (asset.file.startsWith("png/app-icon-")) {
    assert.equal(
      pngHasAlpha(buffer),
      false,
      `${asset.file} must not include an alpha channel`,
    );
  }
}

const runtimeSources = [
  "apps/web/public/brand/symbol-ink.svg",
  "apps/web/components/brand-mark.tsx",
  "apps/web/app/icon.tsx",
  "apps/browser-extension/load-unpacked/sidepanel.html",
  "apps/browser-extension/load-unpacked/icons/icon-source.svg",
];

for (const file of runtimeSources) {
  const source = await readFile(path.join(repositoryRoot, file), "utf8");
  assert.ok(source.includes(inkPath), `${file} drifted from the ink geometry`);
  assert.ok(
    source.includes(signalPath),
    `${file} drifted from the signal geometry`,
  );
}

assert.equal(
  await readFile(path.join(repositoryRoot, "apps/web/public/brand/symbol-ink.svg"), "utf8"),
  await readFile(path.join(brandRoot, "svg/talent-signal-symbol-ink.svg"), "utf8"),
  "Workspace monochrome mark must match the approved ink asset",
);

const canonicalAppIcon = await readFile(
  path.join(brandRoot, "png/app-icon-1024.png"),
);
const iosAppIcons = [
  "apps/ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png",
];

for (const file of iosAppIcons) {
  const appIcon = await readFile(path.join(repositoryRoot, file));
  assert.ok(
    canonicalAppIcon.equals(appIcon),
    `${file} drifted from the canonical app icon`,
  );
}

const macIconRoot = "apps/macos/Resources/Assets.xcassets/AppIcon.appiconset";
const macIcons = JSON.parse(await readFile(path.join(repositoryRoot, macIconRoot, "Contents.json"), "utf8"));
assert.equal(macIcons.images.length, 10, "macOS must include all standard icon sizes");
for (const item of macIcons.images) {
  assert.equal(item.idiom, "mac");
  const size = Number.parseInt(item.size, 10) * Number.parseInt(item.scale, 10);
  const file = `${macIconRoot}/${item.filename}`;
  const buffer = await readFile(path.join(repositoryRoot, file));
  assert.deepEqual(pngDimensions(buffer, file), { width: size, height: size });
}

const extensionIcons = [
  ["apps/browser-extension/load-unpacked/icons/icon-16.png", 16],
  ["apps/browser-extension/load-unpacked/icons/icon-32.png", 32],
  ["apps/browser-extension/load-unpacked/icons/icon-48.png", 48],
  ["apps/browser-extension/load-unpacked/icons/icon-128.png", 128],
];

for (const [file, size] of extensionIcons) {
  const buffer = await readFile(path.join(repositoryRoot, file));
  assert.deepEqual(
    pngDimensions(buffer, file),
    { width: size, height: size },
    `${file} has the wrong extension-icon dimensions`,
  );
}

const rootReadme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
assert.ok(
  rootReadme.includes("brand/svg/talent-signal-readme-mark.svg"),
  "README.md does not render the approved repository mark",
);
assert.ok(
  rootReadme.includes("brand/README.md"),
  "README.md does not route readers to the brand guide",
);

console.log(
  `Brand asset check passed: ${manifest.svg.length} SVG sources and ${manifest.png.length} PNG exports.`,
);
