#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
let environment, sandbox, checkOnly = false;
const seen = new Set();
function invalid() {
  console.error("Usage: ai-workspace-entry.mjs --env <named-test-environment> [--sandbox <uuid> | --check-only]");
  process.exit(2);
}
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  if (seen.has(flag)) invalid();
  seen.add(flag);
  if (flag === "--check-only") checkOnly = true;
  else if (flag === "--env" || flag === "--sandbox") {
    const value = argv[++i];
    if (!value || value.startsWith("-")) invalid();
    if (flag === "--env") environment = value;
    else sandbox = value;
  } else invalid();
}
if (!environment || (sandbox && checkOnly) || (sandbox && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sandbox))) invalid();

function run(args) {
  const result = spawnSync(process.env.CAPIR_BIN || "capir", [...args, "--env", environment], {
    encoding: "utf8", shell: false, timeout: 330_000, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.signal) {
    console.error(result.error?.code === "ENOENT"
      ? "capir is not installed. Install the reviewed CLI and configure the named test environment."
      : "capir did not complete; inspect the scoped command status before retrying.");
    process.exit(3);
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    // capir owns credential redaction; never print this process's environment.
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 3);
  }
  return result.stdout;
}

const auth = run(["auth", "status"]);
if (checkOnly) process.stdout.write(auth);
else process.stdout.write(run(sandbox
  ? ["sandbox", "status", sandbox, "--open", "web"]
  : ["sandbox", "start", "--scenario", "daily", "--model-policy", "replay", "--open", "web"]));
