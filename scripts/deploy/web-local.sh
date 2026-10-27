#!/usr/bin/env bash
set -euo pipefail
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "${TS_WEB_INFISICAL_INJECTED:-false}" != "true" ]]; then
  exec "$repository_root/scripts/infisical/run.sh" staging /web -- \
    env TS_WEB_INFISICAL_INJECTED=true "$0" "$@"
fi
command_name="${1:-start}"
if [[ "$command_name" != "build" && "$command_name" != "start" && "$command_name" != "check" ]]; then
  echo "Usage: $0 [build|start|check]" >&2
  exit 2
fi
# Only the server process talks to the backend. Never expose its credentials to clients.
export NODE_ENV=production
export AUTH_TRUST_HOST=true
export TALENT_SIGNAL_ALLOW_LAN_HTTP=false
export AUTH_DEFAULT_ACCOUNT_ENABLED=false
export AUTH_DEFAULT_ACCOUNT_QUICK_LOGIN=false
# This flag selects the authenticated backend product; false selects the old demo.
export TALENT_SIGNAL_INTEGRATION_MODE=true
node --input-type=module - <<'NODE'
import { execFileSync } from "node:child_process";
const origin = new URL(process.env.AUTH_URL ?? "");
if (!process.env.AUTH_SECRET?.trim()) throw new Error("AUTH_SECRET is required in staging:/web");
if (!process.env.TALENT_SIGNAL_BACKEND_URL?.trim()) throw new Error("TALENT_SIGNAL_BACKEND_URL is required in staging:/web");
if (origin.protocol !== "https:" || !origin.hostname.endsWith(".ts.net") || origin.port !== "10443"
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
  throw new Error("Resident Web AUTH_URL must be the Tailscale HTTPS origin on port 10443");
}
const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" }));
const hostname = status.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
if (status.BackendState !== "Running" || !hostname || origin.hostname !== hostname) {
  throw new Error("Resident Web AUTH_URL must match this running Tailscale node's MagicDNS name");
}
NODE
# Activation checks the actual configuration producer before stopping the
# current listener. This mode neither builds nor opens a listening socket.
if [[ "$command_name" == "check" ]]; then
  exit 0
fi
cd "$repository_root"
if [[ "$command_name" == "build" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Build resident releases from a clean committed worktree." >&2
    exit 1
  fi
  revision="$(git rev-parse HEAD)"
  pnpm --filter @talent-signal/web build
  if [[ "$revision" != "$(git rev-parse HEAD)" || -n "$(git status --porcelain)" ]]; then
    echo "Source changed during build; refusing to issue a release receipt." >&2
    exit 1
  fi
  node --input-type=module - "$revision" <<'NODE'
import fs from "node:fs";
const buildID = fs.readFileSync("apps/web/.next/BUILD_ID", "utf8").trim();
fs.writeFileSync("apps/web/.next/talent-signal-release.json", JSON.stringify({revision: process.argv[2], buildID}));
NODE
  exit 0
fi
if [[ ! -f "$repository_root/apps/web/.next/BUILD_ID" ]]; then
  echo "Build the resident Web release before starting it." >&2
  exit 1
fi
# https://nextjs.org/docs/app/api-reference/cli/next#next-start-options
# Use the built release directly; service recovery must not bootstrap a package manager.
cd "$repository_root/apps/web"
exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
