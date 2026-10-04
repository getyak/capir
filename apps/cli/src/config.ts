/**
 * Named test-environment configuration.
 *
 * Every command requires an explicit named environment. There is no default
 * remote fallback: an unknown name or an unregistered origin fails before any
 * dispatch. Origins must be exact (no path, query, fragment, or embedded
 * credentials) and HTTPS unless they are a literal loopback address.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CapirCliError, EXIT, invalidArgument } from "./errors.js";

export interface CapirEnvironment {
  name: string;
  backendOrigin: string;
  webOrigin: string;
}

export function configDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.CAPIR_CONFIG_DIR?.trim() || join(homedir(), ".config", "talent-signal", "capir");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]"]);

export function validateOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidArgument(
      "CAPIR_ENVIRONMENT_INVALID",
      `${label} must be an absolute http(s) origin.`,
    );
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    url.origin !== value ||
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !loopback)
  ) {
    throw invalidArgument(
      "CAPIR_ENVIRONMENT_INVALID",
      `${label} must be an exact HTTPS origin (literal loopback may use HTTP) with no path, query, fragment, or embedded credentials.`,
    );
  }
  return value;
}

interface RawEnvironment {
  backend_origin?: unknown;
  web_origin?: unknown;
}

export function resolveEnvironment(
  name: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CapirEnvironment {
  if (!name) {
    throw invalidArgument(
      "CAPIR_ENVIRONMENT_REQUIRED",
      "Select an explicit named test environment with --env <name>.",
    );
  }
  const file = join(configDirectory(env), "environments.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CapirCliError(
        "CAPIR_ENVIRONMENT_MISSING",
        EXIT.INVALID_ARGUMENTS,
        `No capir environment file exists at ${file}.`,
      );
    }
    throw new CapirCliError(
      "CAPIR_ENVIRONMENT_INVALID",
      EXIT.INVALID_ARGUMENTS,
      `The capir environment file at ${file} is not valid JSON.`,
    );
  }
  const environments = (raw as { environments?: Record<string, RawEnvironment> })
    .environments;
  const selected = environments?.[name];
  if (!selected) {
    const known = Object.keys(environments ?? {}).sort();
    throw new CapirCliError(
      "CAPIR_ENVIRONMENT_MISSING",
      EXIT.INVALID_ARGUMENTS,
      `Unknown environment "${name}". Known environments: ${known.length ? known.join(", ") : "(none)"}.`,
    );
  }
  const backendOrigin = validateOrigin(
    typeof selected.backend_origin === "string" ? selected.backend_origin : "",
    `backend_origin of environment "${name}"`,
  );
  const webOrigin = validateOrigin(
    typeof selected.web_origin === "string" ? selected.web_origin : "",
    `web_origin of environment "${name}"`,
  );
  return { name, backendOrigin, webOrigin };
}
