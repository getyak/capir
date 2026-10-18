// Fetch the required native archive in its own pnpm process before the full
// workspace install. Registry identity must match the frozen lock's CAFS key.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function nativeRuntimePackage(manifest, platform, arch) {
  if (platform !== "linux" || !["arm64", "x64"].includes(arch)) {
    throw new Error("Native SDK prefetch requires Linux arm64 or x64.");
  }
  const version = manifest.dependencies?.["@anthropic-ai/claude-agent-sdk"];
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Native SDK prefetch requires an exact stable SDK version.");
  }
  return `@anthropic-ai/claude-agent-sdk-linux-${arch}@${version}`;
}

function prefetchNativeRuntime() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  const target = nativeRuntimePackage(manifest, process.platform, process.arch);
  const result = spawnSync("pnpm", ["store", "add", target], { stdio: "inherit" });
  if (result.error) {
    console.error("Native SDK prefetch could not start pnpm.");
    return 1;
  }
  return result.status ?? 1;
}

module.exports = { nativeRuntimePackage, prefetchNativeRuntime };

if (require.main === module) {
  process.exitCode = prefetchNativeRuntime();
}
