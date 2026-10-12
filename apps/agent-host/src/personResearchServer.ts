import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import { connect } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  fingerprint,
  ContactResearchToolRequestSchema,
  type ContactResearchToolResponse,
  PersonResearchServiceRequestSchema,
  type PersonResearchServiceResponse,
} from "@talent-signal/agent";

import {
  runPersonResearchServiceRequest,
  type PersonResearchServiceDependencies,
} from "./personResearchService.js";
import { runContactResearchTool, type ContactResearchDependencies } from "./contactResearchService.js";
import {
  boundedDiagnosticCode,
  CONTACT_TOOLS_ERROR_CODE_SET,
} from "./diagnosticCodes.js";

const MAX_BODY_BYTES = 13_500_000;
const MAX_ACTIVE_RUNS = 2;

async function clearStaleSocket(socketPath: string): Promise<void> {
  let entry;
  try {
    entry = await fs.lstat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!entry.isSocket()) {
    throw new Error(
      "The person-research socket path exists and is not a Unix socket.",
    );
  }
  const active = await new Promise<boolean>((accept, reject) => {
    const socket = connect(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      accept(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
        accept(false);
      } else {
        reject(error);
      }
    });
  });
  if (active) {
    throw new Error("The person-research Unix socket is already in use.");
  }
  await fs.unlink(socketPath);
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function body(request: IncomingMessage, maximumBytes = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > maximumBytes) {
    throw new Error("PERSON_RESEARCH_REQUEST_TOO_LARGE");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maximumBytes) {
      throw new Error("PERSON_RESEARCH_REQUEST_TOO_LARGE");
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export interface PersonResearchServerOptions
  extends PersonResearchServiceDependencies {
  socketPath: string;
  environment?: NodeJS.ProcessEnv;
  contactResearch?: ContactResearchDependencies;
}

export async function startPersonResearchServer(
  options: PersonResearchServerOptions,
) {
  if (!isAbsolute(options.socketPath)) {
    throw new Error("The person-research Unix socket path must be absolute.");
  }
  const socketPath = resolve(options.socketPath);
  await fs.mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await clearStaleSocket(socketPath);
  const active = new Map<
    string,
    { identity: string; promise: Promise<PersonResearchServiceResponse> }
  >();
  const researchCalls = new Map<string, { identity: string; promise: Promise<ContactResearchToolResponse>;
    controller: AbortController; subscribers: number }>();
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/v1/contact-research/tools") {
      if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
        json(response, 415, { error: "CONTACT_RESEARCH_JSON_REQUIRED" });
        return;
      }
      try {
        const parsed = ContactResearchToolRequestSchema.parse(await body(request, 100_000));
        const key = `${parsed.task_id}:${parsed.call_id}`;
        const identity = fingerprint(parsed);
        const existing = researchCalls.get(key);
        if (existing && existing.identity !== identity) {
          json(response, 409, { error: "CONTACT_RESEARCH_CALL_ID_CONFLICT" });
          return;
        }
        if (!existing && researchCalls.size + active.size >= MAX_ACTIVE_RUNS) {
          json(response, 503, { error: "CONTACT_RESEARCH_CAPACITY_EXHAUSTED" });
          return;
        }
        const controller = existing?.controller ?? new AbortController();
        const entry = existing ?? { identity, controller, subscribers: 0,
          promise: runContactResearchTool(parsed, options.environment, options.contactResearch, controller.signal) };
        if (!existing) researchCalls.set(key, entry);
        entry.subscribers++;
        let detached = false;
        const detach = () => {
          if (detached) return;
          detached = true; entry.subscribers--;
          if (!entry.subscribers) entry.controller.abort(new Error("CONTACT_RESEARCH_CLIENT_CLOSED"));
        };
        response.once("close", detach);
        if (response.destroyed) detach();
        try { const result = await entry.promise; if (!response.destroyed) json(response, 200, result); }
        finally { response.removeListener("close", detach); detach(); if (!existing) researchCalls.delete(key); }
      } catch (error) {
        // Only finite recognized diagnostics cross this boundary: an arbitrary
        // error.code or code-shaped error.message is never forwarded.
        json(response, 502, {
          error: boundedDiagnosticCode(
            error,
            CONTACT_TOOLS_ERROR_CODE_SET,
            "CONTACT_RESEARCH_UNAVAILABLE",
          ),
        });
      }
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/person-research") {
      json(response, 404, { error: "PERSON_RESEARCH_ROUTE_NOT_FOUND" });
      return;
    }
    if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
      json(response, 415, { error: "PERSON_RESEARCH_JSON_REQUIRED" });
      return;
    }
    try {
      const parsed = PersonResearchServiceRequestSchema.parse(
        await body(request),
      );
      const identity = fingerprint({
        runID: parsed.run_id,
        objective: parsed.objective,
        authorization: parsed.authorization,
        mediaType: parsed.image.media_type,
        byteSize: parsed.image.byte_size,
        contentHash: parsed.image.content_hash,
      });
      const existing = active.get(parsed.run_id);
      if (existing && existing.identity !== identity) {
        json(response, 409, { error: "PERSON_RESEARCH_RUN_ID_CONFLICT" });
        return;
      }
      if (!existing && active.size + researchCalls.size >= MAX_ACTIVE_RUNS) {
        json(response, 503, { error: "PERSON_RESEARCH_CAPACITY_EXHAUSTED" });
        return;
      }
      const pending = existing?.promise ?? runPersonResearchServiceRequest(
        parsed,
        options.environment ?? process.env,
        options,
      );
      if (!existing) active.set(parsed.run_id, { identity, promise: pending });
      try {
        json(response, 200, await pending);
      } finally {
        if (!existing) active.delete(parsed.run_id);
      }
    } catch (error) {
      const tooLarge =
        error instanceof Error &&
        error.message === "PERSON_RESEARCH_REQUEST_TOO_LARGE";
      json(response, tooLarge ? 413 : 400, {
        error: tooLarge
          ? "PERSON_RESEARCH_REQUEST_TOO_LARGE"
          : "PERSON_RESEARCH_REQUEST_INVALID",
      });
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      accept();
    });
  });
  await fs.chmod(socketPath, 0o600);
  return server;
}
