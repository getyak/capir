import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  BackendSessionExpiredError,
  backendSessionIsExpired,
} from "@/lib/backend-session";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { extractDocument } from "@/lib/server/documentExtraction";
import { isIntegrationMode } from "@/lib/server/localBackend";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

/**
 * Bounded Web extraction preview for composer document intake.
 *
 * This route only extracts text for an explicit, user-driven preview. It never
 * commits a resource, never calls a model, and never stores or logs bytes or
 * text anywhere: the caller receives text/warnings/count and the request is
 * forgotten. PNG/JPEG/WebP attachments keep the governed attachment path and
 * never come through here.
 *
 * Guard order is deliberate and tested: origin and account scope (rendered
 * workspace versus active backend claims) are rejected before a single body
 * byte is read, and the full request stream is bounded before parsing.
 */

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const PDF_MAX_BYTES = 6 * 1024 * 1024;
const DOCX_MAX_BYTES = 3 * 1024 * 1024;

type PreviewKind = "pdf" | "docx";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

function documentKind(input: {
  name: string;
  type: string;
}): PreviewKind | null {
  const type = input.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const suffix = input.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (type === "application/pdf" || suffix === ".pdf") return "pdf";
  if (
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    suffix === ".docx"
  ) {
    return "docx";
  }
  return null;
}

/**
 * Bound the full request stream while reading it. `Content-Length` is only a
 * fast path: a lying or absent header cannot bypass the byte bound.
 */
async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<ArrayBuffer | "too_large" | "empty"> {
  const body = request.body;
  if (!body) return "empty";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return "empty";
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

export async function POST(request: Request) {
  if (!isIntegrationMode()) {
    return reply({ code: "local_integration_disabled" }, 404);
  }
  const session = await auth();
  if (!session?.user) {
    return reply({ code: "authentication_required" }, 401);
  }
  if (!isAllowedMutationOrigin(request.headers)) {
    return reply({ code: "cross_origin_document_denied" }, 403);
  }

  // Account scope is resolved and the rendered workspace validated against the
  // active backend claims before any request byte is read.
  let claims;
  try {
    claims = await readBackendSessionClaims();
  } catch (error) {
    if (error instanceof BackendSessionExpiredError) {
      return reply({ code: "backend_session_expired" }, 401);
    }
    return reply({ code: "document_preview_unavailable" }, 503);
  }
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
    return reply({ code: "backend_session_expired" }, 401);
  }
  const scope = request.headers.get("x-talent-signal-workspace");
  if (!scope || scope !== claims.backendAccountId) {
    return reply({ code: "workspace_scope_stale" }, 409);
  }
  const bound = request.headers.get("x-workspace-session");
  if (
    !bound ||
    (bound !== workspaceSessionsBinding(claims) &&
      bound !== contactHandoffSessionVersion(claims))
  ) {
    return reply({ code: "session_stale" }, 409);
  }

  // Document identity is validated before the body is touched.
  const rawName = request.headers.get("x-document-name") ?? "";
  let name = "";
  try {
    name = decodeURIComponent(rawName).trim();
  } catch {
    return reply({ code: "document_name_invalid" }, 400);
  }
  if (!name || name.length > 255 || name.includes("/") || name.includes("\\")) {
    return reply({ code: "document_name_invalid" }, 400);
  }
  const type = request.headers.get("content-type") ?? "";
  const kind = documentKind({ name, type });
  if (!kind) {
    return reply({ code: "document_type_unsupported" }, 415);
  }
  const limit = kind === "pdf" ? PDF_MAX_BYTES : DOCX_MAX_BYTES;
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    return reply({ code: "document_too_large" }, 413);
  }

  const body = await readBoundedBody(request, limit).catch(() => "empty");
  if (body === "too_large") {
    return reply({ code: "document_too_large" }, 413);
  }
  if (body === "empty") {
    return reply({ code: "document_empty" }, 400);
  }

  try {
    const extraction = await extractDocument(
      new File([body], name, {
        type:
          kind === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      `document-preview:${crypto.randomUUID()}`,
    );
    const text = extraction.fragments
      .map((fragment) => fragment.text)
      .join("\n\n");
    return reply({
      text,
      warnings: extraction.parser_warnings,
      count: text.length,
    });
  } catch {
    // Parser failures never echo exception text: response and logs stay free
    // of document content and parser internals.
    return reply({ code: "document_parse_failed" }, 422);
  }
}
