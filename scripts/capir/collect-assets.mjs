#!/usr/bin/env node
/**
 * Collect the built platform archives into the assets input for
 * `scripts/capir/manifest.mjs build`: exactly one archive per supported
 * platform, each with its verified sha256 and byte size.
 *
 *   node scripts/capir/collect-assets.mjs --version 0.2.0 --dir build/release --out assets.json
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_PLATFORMS } from "./platforms.mjs";

export function collectAssets({ version, dir }) {
  const files = new Set(readdirSync(dir));
  return SUPPORTED_PLATFORMS.map((platform) => {
    const filename = `capir-${version}-${platform}.tar.gz`;
    if (!files.has(filename))
      throw new Error(`missing release archive ${filename} in ${dir}`);
    const path = join(dir, filename);
    return {
      platform,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      size: statSync(path).size,
    };
  });
}

function isMainModule(metaUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMainModule(import.meta.url)) {
  const values = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) values[argv[index].slice(2)] = argv[index + 1];
  try {
    const assets = collectAssets({ version: values.version, dir: values.dir });
    writeFileSync(values.out, `${JSON.stringify(assets, null, 2)}\n`);
    process.stdout.write(`wrote ${values.out} (${assets.length} platforms)\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
