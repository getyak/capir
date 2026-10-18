import { request as httpRequest } from "node:http";
import { isAbsolute } from "node:path";
import {
  ContactResearchToolRequestSchema,
  ContactResearchToolResponseSchema,
  type ContactResearchToolRequest,
  type ContactResearchToolResponse,
} from "@talent-signal/agent";

import {
  CONTACT_RESEARCH_SERVER_ERROR_CODE_SET,
} from "../lib/diagnosticCodes.js";

export interface ContactResearchClient {
  execute(input: unknown, signal: AbortSignal): Promise<ContactResearchToolResponse>;
}

function readbackMismatch(): never {
  throw new Error("CONTACT_RESEARCH_READBACK_MISMATCH");
}

/** Bind an untrusted Agent Host response to the exact request before persistence. */
export function assertContactResearchResponseMatchesRequest(
  request: ContactResearchToolRequest,
  response: ContactResearchToolResponse,
): void {
  if (response.task_id !== request.task_id || response.call_id !== request.call_id) readbackMismatch();
  if (request.input.operation !== "fetch") {
    if (response.fetch_outcomes.length > 0) readbackMismatch();
    return;
  }
  if (response.channels.length > 0 || response.fetch_outcomes.length !== request.input.sources.length) {
    readbackMismatch();
  }
  for (const [index, source] of request.input.sources.entries()) {
    const outcome = response.fetch_outcomes[index];
    if (!outcome || outcome.source_id !== source.source_id || outcome.channel !== source.channel ||
        outcome.provider !== source.provider_id) readbackMismatch();
    if (source.provider_id === "exa" ? outcome.status === "unsupported" : outcome.status !== "unsupported") {
      readbackMismatch();
    }
  }
  const successful = response.fetch_outcomes.filter(outcome => outcome.status === "ok");
  if (response.sources.length !== successful.length) readbackMismatch();
  for (const [index, outcome] of successful.entries()) {
    const source = response.sources[index];
    const requested = request.input.sources.find(item => item.source_id === outcome.source_id);
    if (!source || !requested || source.source_id !== requested.source_id || source.url !== requested.url ||
        source.channel !== requested.channel || source.provider_id !== requested.provider_id || source.stage !== "fetched") {
      readbackMismatch();
    }
  }
}

export class LocalContactResearchClient implements ContactResearchClient {
  constructor(private readonly socketPath: string) {
    if (!isAbsolute(socketPath)) throw new Error("CONTACT_RESEARCH_SOCKET_INVALID");
  }
  async execute(input: unknown, signal: AbortSignal) {
    const parsed = ContactResearchToolRequestSchema.parse(input);
    const payload = Buffer.from(JSON.stringify(parsed));
    const body = await new Promise<string>((accept, reject) => {
      const req = httpRequest({ socketPath: this.socketPath, path: "/v1/contact-research/tools",
        method: "POST", signal, timeout: 35_000,
        headers: { "content-type": "application/json", "content-length": payload.byteLength } }, (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) response.destroy(new Error("CONTACT_RESEARCH_RESPONSE_TOO_LARGE"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          if (response.statusCode !== 200) {
            let code = `CONTACT_RESEARCH_HTTP_${response.statusCode}`;
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              // Only the finite server-emitted vocabulary is accepted from a
              // server error body. Client-owned codes (status-derived
              // `CONTACT_RESEARCH_HTTP_*`, timeout, readback, socket, test
              // injection) are never claimable by a server payload: a body
              // claiming them is refused and the real status-derived
              // diagnostic is kept unchanged.
              if (typeof body.error === "string" && CONTACT_RESEARCH_SERVER_ERROR_CODE_SET.has(body.error)) {
                code = body.error;
              }
            } catch { /* Keep the bounded HTTP status when the error is not structured. */ }
            reject(new Error(code));
          }
          else accept(Buffer.concat(chunks).toString("utf8"));
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("CONTACT_RESEARCH_TIMEOUT")));
      req.end(payload);
    });
    const result = ContactResearchToolResponseSchema.parse(JSON.parse(body));
    assertContactResearchResponseMatchesRequest(parsed, result);
    return result;
  }
}
