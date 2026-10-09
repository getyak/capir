/**
 * Shared test adapters: a stub capir backend over real HTTP, disposable
 * environment configuration, and direct invocations of the built CLI.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
export const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));

export function uuid() {
  return randomUUID();
}

export function token43(char = "t") {
  return char.repeat(43);
}

export function scenarioDigest(char = "a") {
  return char.repeat(64);
}

export function sandboxResponse(overrides = {}) {
  const id = overrides.id ?? uuid();
  return {
    schema_version: "capir.v1",
    sandbox: {
      id,
      state: "ready",
      generation: 1,
      scenario: {
        id: "daily",
        version: "1",
        digest: scenarioDigest(),
      },
      member_role: "member",
      model_policy: "strict_replay",
      expires_at: "2026-10-01T12:00:00.000Z",
      entry_path: `/capir/sandboxes/${id}`,
      failure_code: null,
      workspace: null,
      ...overrides,
    },
  };
}

export function capabilitiesResponse(backendOrigin, webOrigin) {
  return {
    schema_version: "capir.v1",
    enabled: true,
    max_active_sandboxes: 3,
    web_handoff_available: true,
    scenarios: [
      { id: "daily", version: "1", digest: scenarioDigest() },
      { id: "empty", version: "1", digest: scenarioDigest("b") },
    ],
    model_policy: "strict_replay",
    approved_recordings: [],
    supported_tasks: ["people.read", "relationship.read", "notes.write", "tasks.read", "tasks.write"],
    unsupported: ["live", "record", "test", "eval", "mcp", "native", "refresh"],
    backend_origins: [backendOrigin],
    web_origins: [webOrigin],
  };
}

/**
 * Minimal recording stub of the capir backend routes over real HTTP.
 * `respond` receives ({ method, path, body, headers, calls }) and returns
 * { status, json }.
 */
export async function startStubBackend(respond) {
  const calls = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      const record = {
        method: request.method,
        path: request.url,
        headers: request.headers,
        body,
      };
      calls.push(record);
      let result;
      try {
        result = respond({ ...record, calls });
      } catch (error) {
        result = { status: 500, json: { error: { code: "STUB_FAILURE", message: String(error), request_id: "stub" } } };
      }
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(JSON.stringify(result.json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function writeEnvironment(directory, name, backendOrigin, webOrigin) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(directory, "environments.json"),
    JSON.stringify({
      environments: { [name]: { backend_origin: backendOrigin, web_origin: webOrigin } },
    }),
  );
}

export function runCliBin(args, env = {}, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // Bounded by default so a genuine failure returns instead of hanging the
    // suite; callers may pass a tighter or wider deadline explicitly.
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    timer.unref();
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
