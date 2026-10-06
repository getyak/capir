// Security behaviour of the composer document-preview route. Extraction itself
// is covered by documentExtraction tests; here `extractDocument` is mocked so
// every assertion can prove the guards fire before any byte is parsed: stale
// or missing account scope, cross-origin posts, oversized or malformed bodies,
// unsupported types and parser failures never leak content or exception text.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  claimsMock,
  extractDocumentMock,
  isIntegrationModeMock,
  commitRelationshipResourceMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  claimsMock: vi.fn(),
  extractDocumentMock: vi.fn(),
  isIntegrationModeMock: vi.fn(),
  commitRelationshipResourceMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "synthetic-secret",
  authenticatedBackendClient: vi.fn(),
  readBackendSessionClaims: claimsMock,
  readPrimaryBackendSessionClaims: vi.fn(),
  backendAuthBaseUrl: () => "https://backend.invalid",
}));
vi.mock("@/lib/server/documentExtraction", () => ({
  extractDocument: extractDocumentMock,
}));
vi.mock("@/lib/server/localBackend", () => ({
  isIntegrationMode: isIntegrationModeMock,
  commitRelationshipResource: commitRelationshipResourceMock,
}));

import { BackendSessionExpiredError } from "@/lib/backend-session";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

import { POST } from "./route";

const URL = "http://127.0.0.1:3000/api/local-integration/document-preview";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

// One frozen credential: bindings are HMACs over the exact claim values, so a
// per-call timestamp would change the binding and only fail intermittently.
const CLAIMS = {
  backendAccessToken: "token",
  backendAccountId: ACCOUNT_ID,
  backendAccountName: "Test",
  backendAccountSlug: "test",
  backendExpiresAt: "2099-01-01T00:00:00.000Z",
  backendRole: "admin" as const,
  backendUserId: "11111111-1111-4111-8111-111111111111",
  backendUsername: "tester",
};

function claims() {
  return { ...CLAIMS };
}

type RequestOptions = {
  name?: string | null;
  /** Raw header value, used to exercise malformed percent-encoding. */
  rawName?: string;
  type?: string;
  origin?: string | null;
  scope?: string | null;
  session?: string | null;
  body?: BodyInit | null;
  stream?: ReadableStream<Uint8Array>;
  reads?: { count: number };
};

function request(options: RequestOptions = {}): Request {
  const headers: Record<string, string> = {
    host: "127.0.0.1:3000",
    "content-type": options.type ?? "application/pdf",
  };
  if (options.rawName !== undefined) {
    headers["x-document-name"] = options.rawName;
  } else if (options.name !== null) {
    headers["x-document-name"] = encodeURIComponent(options.name ?? "cv.pdf");
  }
  if (options.origin !== null) headers.origin = options.origin ?? "http://127.0.0.1:3000";
  if (options.scope !== null) headers["x-talent-signal-workspace"] = options.scope ?? ACCOUNT_ID;
  if (options.session !== null) {
    headers["x-workspace-session"] = options.session ?? workspaceSessionsBinding(claims());
  }
  if (options.stream) {
    return new Request(URL, {
      method: "POST",
      headers,
      body: options.stream,
      duplex: "half",
    } as RequestInit);
  }
  return new Request(URL, {
    method: "POST",
    headers,
    body: options.body ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  });
}

/**
 * A body whose pulls are observable. Undici prefetches a chunk on its own
 * schedule, so "before reading bytes" is asserted with `bodyUsed`: a route
 * that rejects early never disturbs the stream.
 */
function countingStream(chunks: Uint8Array[], reads: { count: number }) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      reads.count += 1;
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]!);
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  isIntegrationModeMock.mockReturnValue(true);
  authMock.mockResolvedValue({ user: { id: "recruiter" } });
  claimsMock.mockResolvedValue(claims());
  extractDocumentMock.mockResolvedValue({
    byte_size: 5,
    content_hash: "hash",
    fragments: [{ text: "第一段文本" }, { text: "第二段文本" }],
    links: [],
    parser_warnings: ["合成警告"],
  });
});

describe("document preview guard order", () => {
  it("rejects anonymous requests before reading the body", async () => {
    authMock.mockResolvedValue(null);
    const reads = { count: 0 };
    const pending = request({ stream: countingStream([new Uint8Array(8)], reads) });
    const result = await POST(pending);
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({
      code: "authentication_required",
    });
    expect(pending.bodyUsed).toBe(false);
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin posts before reading the body", async () => {
    const reads = { count: 0 };
    const pending = request({
      origin: "http://evil.invalid",
      stream: countingStream([new Uint8Array(8)], reads),
    });
    const result = await POST(pending);
    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toEqual({
      code: "cross_origin_document_denied",
    });
    expect(pending.bodyUsed).toBe(false);
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a stale backend session before reading the body", async () => {
    claimsMock.mockRejectedValue(new BackendSessionExpiredError());
    const reads = { count: 0 };
    const pending = request({ stream: countingStream([new Uint8Array(8)], reads) });
    const result = await POST(pending);
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({
      code: "backend_session_expired",
    });
    expect(pending.bodyUsed).toBe(false);
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong rendered workspace scope", async () => {
    const missing = await POST(request({ scope: null }));
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toEqual({ code: "workspace_scope_stale" });

    const wrong = await POST(request({ scope: "33333333-3333-4333-8333-333333333333" }));
    expect(wrong.status).toBe(409);
    expect(extractDocumentMock).not.toHaveBeenCalled();
    expect(commitRelationshipResourceMock).not.toHaveBeenCalled();
  });

  it("rejects a stale workspace binding", async () => {
    const result = await POST(request({ session: "not-the-current-binding" }));
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual({ code: "session_stale" });
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("accepts the contact-handoff binding derived from the same claims", async () => {
    const result = await POST(
      request({ session: contactHandoffSessionVersion(claims()) }),
    );
    expect(result.status).toBe(200);
    expect(extractDocumentMock).toHaveBeenCalledTimes(1);
  });
});

describe("document preview request bounds", () => {
  it("bounds the full stream, not only Content-Length", async () => {
    const chunk = new Uint8Array(2 * 1024 * 1024);
    const reads = { count: 0 };
    const result = await POST(
      request({
        name: "huge.pdf",
        stream: countingStream([chunk, chunk, chunk, chunk], reads),
      }),
    );
    expect(result.status).toBe(413);
    await expect(result.json()).resolves.toEqual({ code: "document_too_large" });
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects malformed document identity", async () => {
    const unnamed = await POST(request({ name: null }));
    expect(unnamed.status).toBe(400);
    await expect(unnamed.json()).resolves.toEqual({ code: "document_name_invalid" });

    const traversal = await POST(request({ name: "../secrets.pdf" }));
    expect(traversal.status).toBe(400);

    const badEncoding = await POST(
      request({ rawName: "%E0%A4%A" }),
    );
    expect(badEncoding.status).toBe(400);
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported document types locally", async () => {
    const text = await POST(
      request({ name: "notes.txt", type: "text/plain", body: "hi" }),
    );
    expect(text.status).toBe(415);
    await expect(text.json()).resolves.toEqual({
      code: "document_type_unsupported",
    });

    const archive = await POST(
      request({ name: "bundle.zip", type: "application/zip" }),
    );
    expect(archive.status).toBe(415);
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects an empty body honestly", async () => {
    const result = await POST(request({ body: new Uint8Array(0) }));
    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ code: "document_empty" });
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });
});

describe("document preview extraction outcome", () => {
  it("returns text, warnings and count without storing anything", async () => {
    const result = await POST(request({ name: "cv.pdf" }));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(result.json()).resolves.toEqual({
      text: "第一段文本\n\n第二段文本",
      warnings: ["合成警告"],
      count: "第一段文本\n\n第二段文本".length,
    });
    expect(commitRelationshipResourceMock).not.toHaveBeenCalled();
  });

  it("answers parser failures with a generic error and no exception text", async () => {
    extractDocumentMock.mockRejectedValue(
      new Error("raw parser internals /private/path secret-token"),
    );
    const result = await POST(request({ name: "cv.pdf" }));
    expect(result.status).toBe(422);
    const body = await result.text();
    expect(body).toContain("document_parse_failed");
    expect(body).not.toContain("raw parser internals");
    expect(body).not.toContain("secret-token");
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(commitRelationshipResourceMock).not.toHaveBeenCalled();
  });

  it("stays closed outside local integration mode", async () => {
    isIntegrationModeMock.mockReturnValue(false);
    const result = await POST(request());
    expect(result.status).toBe(404);
    await expect(result.json()).resolves.toEqual({
      code: "local_integration_disabled",
    });
    expect(extractDocumentMock).not.toHaveBeenCalled();
  });
});
