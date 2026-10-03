// Bookworm uses glibc. The SDK's native package is optional to pnpm but required
// by this runtime: a failed platform download must fail the installation layer.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

if (process.platform !== "linux") {
  throw new Error("This build check requires the Linux Bookworm runtime.");
}
const app = createRequire(path.resolve(__dirname, "../package.json"));
const sdk = createRequire(app.resolve("@anthropic-ai/claude-agent-sdk"));
const binary = sdk.resolve(
  `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude`,
);
fs.accessSync(binary, fs.constants.X_OK);
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
  timeout: 30_000,
}).trim();
if (!version) throw new Error("Claude native runtime returned no version.");
console.log(`Native Agent runtime verified: linux-${process.arch}; ${version}`);
