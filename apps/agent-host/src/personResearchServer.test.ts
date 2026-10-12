import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTACT_RESEARCH_CONTRACT,
  ContactResearchToolRequestSchema,
} from "@talent-signal/agent";
import { afterEach, describe, expect, it } from "vitest";

import { startPersonResearchServer } from "./personResearchServer.js";

const temporaryDirectories: string[] = [];
const servers: Array<{ close: (callback: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve())),
  ));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

function browseRequest() {
  const url = "https://example.com/";
  return ContactResearchToolRequestSchema.parse({
    contract_version: CONTACT_RESEARCH_CONTRACT,
    task_id: randomUUID(),
    call_id: randomUUID(),
    anchors: ["Synthetic private context"],
    input: {
      operation: "browse",
      source: {
        source_id: createHash("sha256").update(`exa:${url}`).digest("hex"),
        url,
        title: "Example",
        text: "",
        channel: "web",
        provider_id: "exa",
        provider_request_id: null,
        content_hash: "a".repeat(64),
        retrieved_at: new Date().toISOString(),
        stage: "discovered",
      },
    },
  });
}

async function contactToolsRequest(
  socketPath: string,
  request: ReturnType<typeof browseRequest> = browseRequest(),
): Promise<{ status: number; body: string }> {
  const payload = Buffer.from(JSON.stringify(request));
  return new Promise((accept, reject) => {
    const request = httpRequest({
      socketPath,
      path: "/v1/contact-research/tools",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": payload.byteLength,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => accept({
        status: response.statusCode ?? 500,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(4_000, () => request.destroy(new Error("Synthetic contact-tools request timed out.")));
    request.on("error", reject);
    request.end(payload);
  });
}

async function serverWithBrowse(
  browse: (url: string, signal: AbortSignal, environment?: NodeJS.ProcessEnv) => Promise<never>,
) {
  const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-contact-tools-"));
  temporaryDirectories.push(stateRoot);
  const socketPath = join(stateRoot, "person-research.sock");
  const server = await startPersonResearchServer({
    socketPath,
    stateRoot,
    contactResearch: { browse },
  });
  servers.push(server);
  return socketPath;
}

describe("contact-tools error boundary", () => {
  it("rejects arbitrary Error.code and code-shaped Error.message content", async () => {
    for (const failure of [
      Object.assign(new Error("boom"), { code: "SECRET_CODE_CANARY" }),
      Object.assign(new Error("SECRET_MESSAGE_CANARY"), { code: "CONTACT_RESEARCH_ARBITRARY_SECRET" }),
      new Error("BROWSER_ARBITRARY_SECRET_CANARY"),
      new Error("CONTACT_RESEARCH_ARBITRARY_SECRET_CANARY"),
      Object.assign(new Error("SECRET_MESSAGE_CANARY"), {
        name: "BROWSER_SECRET_NAME_CANARY",
        stack: "Error: SECRET_MESSAGE_CANARY\n    at SECRET_STACK_CANARY",
        cause: new Error("SECRET_CAUSE_CANARY"),
      }),
    ]) {
      const socketPath = await serverWithBrowse(async () => { throw failure; });
      const result = await contactToolsRequest(socketPath);
      // Arbitrary codes and code-shaped messages map to the fixed fallback.
      expect(result.status).toBe(502);
      expect(JSON.parse(result.body)).toEqual({ error: "CONTACT_RESEARCH_UNAVAILABLE" });
      for (const canary of ["CANARY", "SECRET"]) {
        expect(result.body).not.toContain(canary);
      }
    }
  });

  it("preserves recognized fixed diagnostics and real socket transient codes", async () => {
    for (const [failure, expected] of [
      [new Error("BROWSER_HTTP_LIMIT"), "BROWSER_HTTP_LIMIT"],
      [new Error("BROWSER_RESPONSE_BYTE_LIMIT"), "BROWSER_RESPONSE_BYTE_LIMIT"],
      [new Error("CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE"), "CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE"],
      [Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), "ECONNRESET"],
    ] as const) {
      const socketPath = await serverWithBrowse(async () => { throw failure; });
      const result = await contactToolsRequest(socketPath);
      expect(result.status).toBe(502);
      expect(JSON.parse(result.body)).toEqual({ error: expected });
    }
  });

  it("keeps call-identity conflict handling and its fixed diagnostic", async () => {
    let release!: (error: Error) => void;
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => { dispatched = resolve; });
    const pending = new Promise<never>((_resolve, reject) => { release = reject; });
    const socketPath = await serverWithBrowse(async () => {
      dispatched();
      return pending;
    });
    const firstRequest = browseRequest();
    const first = contactToolsRequest(socketPath, firstRequest);
    let firstResponse: Awaited<typeof first> | undefined;
    try {
      // Observe real dispatch; an early transport/validation failure must not
      // leave this barrier or the owned server waiting forever.
      await Promise.race([
        started,
        first.then(() => { throw new Error("Initial request completed before dispatch."); }),
      ]);
      const conflicting = ContactResearchToolRequestSchema.parse({
        ...firstRequest,
        anchors: ["Different synthetic context"],
      });
      const response = await contactToolsRequest(socketPath, conflicting);
      expect(response.status).toBe(409);
      expect(JSON.parse(response.body)).toEqual({ error: "CONTACT_RESEARCH_CALL_ID_CONFLICT" });
    } finally {
      // Settle and drain owned work even when the conflict assertion fails.
      release(new Error("BROWSER_HTTP_LIMIT"));
      firstResponse = await first;
    }
    expect(firstResponse.status).toBe(502);
  });
});
