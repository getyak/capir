import { createHash } from "node:crypto";

import {
  maskIdentityHandle,
  normalizeIdentityHandle,
  parseIdentityHandleQuery,
  TalentSignalHttpError,
  type EvidenceFragmentInput,
  type PersonScopeIntent,
  type ResourceCaptureResponse,
} from "@talent-signal/contracts";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  reviewedConversationFragments,
} from "@/lib/conversation-transcript";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { extractDocument } from "@/lib/server/documentExtraction";
import {
  commitRelationshipResource,
  isIntegrationMode,
  loadRelationshipResource,
  loadRelationshipResources,
} from "@/lib/server/localBackend";

const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TextResourceInput = {
  request_id: string;
  captured_at: string;
  person_id?: string;
  relationship_context_id?: string;
  scope_mode?:
    | "existing"
    | "new_person"
    | "existing_person_new_context"
    | "identity_candidates";
  candidate_person_ids?: string[];
  contact_name?: string;
  relationship_context_label?: string;
  type: "contact" | "conversation" | "note" | "url";
  title?: string;
  value: string;
  transcript_messages?: unknown;
  attribution_reviewed?: boolean;
  identity_clue_confirmed?: boolean;
};

type ScopeFields = Pick<
  TextResourceInput,
  | "person_id"
  | "relationship_context_id"
  | "scope_mode"
  | "candidate_person_ids"
  | "contact_name"
  | "relationship_context_label"
>;

// `captured_at` is client-attested observation evidence. Validate it without
// calling Date.toISOString on an invalid value (that would throw a raw
// RangeError) and never fall back to server time.
function validCapturedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function derivedUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function canonicalUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("请使用 HTTP 或 HTTPS 公开 URL。");
  }
  url.hash = "";
  return url.toString();
}

function personScope(input: ScopeFields): PersonScopeIntent {
  const mode = input.scope_mode ?? "existing";
  if (
    ![
      "existing",
      "new_person",
      "existing_person_new_context",
      "identity_candidates",
    ].includes(mode)
  ) {
    throw new Error("关系范围模式无效。");
  }
  if (mode === "existing") {
    if (
      !input.person_id ||
      !input.relationship_context_id ||
      !UUID.test(input.person_id) ||
      !UUID.test(input.relationship_context_id)
    ) {
      throw new Error("所选关系范围无效。");
    }
    return {
      status: "confirmed",
      person_id: input.person_id,
      relationship_context: {
        status: "existing",
        relationship_context_id: input.relationship_context_id,
      },
      binding_basis:
        "The signed-in recruiter selected the visible person and relationship context.",
    };
  }

  const contactName = input.contact_name?.normalize("NFKC").trim() ?? "";
  const contextLabel =
    input.relationship_context_label?.normalize("NFKC").trim() || (mode === "new_person" ? "联系人资料" : "");
  if (mode === "identity_candidates") {
    const candidatePersonIds = [
      ...new Set(input.candidate_person_ids ?? []),
    ];
    if (
      candidatePersonIds.length < 2 ||
      candidatePersonIds.length > 20 ||
      candidatePersonIds.some((personId) => !UUID.test(personId)) ||
      contactName.length === 0 ||
      contactName.length > 200 ||
      contextLabel.length === 0 ||
      contextLabel.length > 200
    ) {
      throw new Error(
        "At least two possible people and the intended relationship context are required for identity review.",
      );
    }
    return {
      status: "candidates",
      candidate_person_ids: candidatePersonIds,
      display_name_hint: contactName,
      relationship_context: {
        status: "proposed",
        label: contextLabel,
        purpose: "Recruiter-defined relationship context awaiting identity",
      },
      reason:
        "More than one account-scoped person matched. The recruiter saved the source without binding it to either person.",
    };
  }
  if (
    contactName.length === 0 ||
    contactName.length > 200 ||
    contextLabel.length === 0 ||
    contextLabel.length > 200
  ) {
    throw new Error(
      "Confirm the person name and relationship context before saving the first source.",
    );
  }
  if (mode === "new_person") {
    return {
      status: "new_person",
      display_label: contactName,
      relationship_context: {
        status: "proposed",
        label: contextLabel,
        purpose: "Recruiter-defined relationship context",
      },
      binding_basis:
        "The signed-in recruiter explicitly chose to create a new person from this first source.",
    };
  }
  if (!input.person_id || !UUID.test(input.person_id)) {
    throw new Error("所选现有人物无效。");
  }
  return {
    status: "confirmed",
    person_id: input.person_id,
    relationship_context: {
      status: "proposed",
      label: contextLabel,
      purpose: "Recruiter-defined relationship context",
    },
    binding_basis:
      "The signed-in recruiter selected an existing person and explicitly created a separate relationship context.",
  };
}

function textFragments(
  input: TextResourceInput,
  clientResourceId: string,
): {
  displayName: string;
  sourceLocator?: string;
  fragments: EvidenceFragmentInput[];
  kind: "conversation_transcript" | "personal_note" | "public_url";
} {
  if (input.type === "conversation") {
    if (input.attribution_reviewed !== true) {
      throw new Error(
        "Review every transcript speaker before attaching the conversation.",
      );
    }
    return {
      displayName: input.title?.trim() || "Reviewed conversation transcript",
      kind: "conversation_transcript",
      fragments: reviewedConversationFragments(
        input.transcript_messages,
        clientResourceId,
      ),
    };
  }
  const value = input.value.normalize("NFKC").trim();
  if (value.length === 0 || value.length > 40_000) {
    throw new Error("请输入 1 至 40,000 个字符。");
  }
  if (input.type === "note") {
    return {
      displayName: input.title?.trim() || "Recruiter note",
      kind: "personal_note",
      fragments: [
        {
          client_resource_id: clientResourceId,
          kind: "note_revision",
          sequence: 0,
          text: value,
          locator: { kind: "note_revision", revision: 1 },
          attribution: {
            actor_kind: "recruiter",
            status: "confirmed",
          },
          review_status: "reviewed",
          parser: { name: "direct-note-input", version: "1.0.0" },
        },
      ],
    };
  }
  const url = canonicalUrl(value);
  return {
    displayName: input.title?.trim() || new URL(url).hostname,
    kind: "public_url",
    sourceLocator: url,
    fragments: [
      {
        client_resource_id: clientResourceId,
        kind: "url_excerpt",
        sequence: 0,
        text: url,
        locator: {
          kind: "url_excerpt",
          canonical_url: url,
          retrieved_at: input.captured_at,
        },
        attribution: {
          actor_kind: "public_source",
          status: "confirmed",
        },
        review_status: "reviewed",
        parser: { name: "explicit-url-input", version: "1.0.0" },
      },
    ],
  };
}

async function commitText(
  input: TextResourceInput,
  commit: typeof commitRelationshipResource,
): Promise<{
  receipts: ResourceCaptureResponse[];
  discovered_links: string[];
  parser_warnings: string[];
}> {
  if (
    !UUID.test(input.request_id)
  ) {
    throw new Error("来源请求 ID 无效。");
  }
  if (!validCapturedAt(input.captured_at)) {
    throw new Error(
      "无法确认该来源的观察时间，未保存任何内容。请刷新页面后重新提交。",
    );
  }
  const clientResourceId = `web-resource:${input.request_id}`;
  const scope = personScope(input);
  if (input.type === "contact") {
    const parsedHandle = parseIdentityHandleQuery(input.value);
    const displayHint = parsedHandle
      ? maskIdentityHandle(parsedHandle.type, parsedHandle.value)
      : null;
    const normalizedHandle = parsedHandle
      ? normalizeIdentityHandle(parsedHandle.type, parsedHandle.value)
      : null;
    if (
      !input.identity_clue_confirmed ||
      !parsedHandle ||
      !displayHint ||
      !normalizedHandle ||
      scope.status !== "confirmed" ||
      scope.relationship_context.status !== "existing"
    ) {
      throw new Error(
        "Confirm a valid identity clue on an existing person and relationship.",
      );
    }
    const receipt = await commit({
      request_id: input.request_id,
      captured_at: input.captured_at,
      person_scope: scope,
      channel: "chat",
      kind: "contact_record",
      display_name: `Confirmed ${parsedHandle.type} identity clue`,
      media_type: "text/plain",
      content_hash: createHash("sha256")
        .update(`${parsedHandle.type}:${normalizedHandle}`)
        .digest("hex"),
      confirmed_identity_handles: [
        {
          type: parsedHandle.type,
          value: parsedHandle.value,
          source_client_resource_id: clientResourceId,
        },
      ],
      fragments: [
        {
          client_resource_id: clientResourceId,
          kind: "contact_field",
          sequence: 0,
          text: displayHint,
          locator: {
            kind: "contact_field",
            field: parsedHandle.type,
            source_record_version: "agent-confirmed-clue-v1",
          },
          attribution: {
            actor_kind: "recruiter",
            status: "confirmed",
          },
          review_status: "reviewed",
          parser: {
            name: "direct-identity-clue-input",
            version: "1.0.0",
          },
        },
      ],
    });
    return {
      receipts: [receipt],
      discovered_links: [],
      parser_warnings: [],
    };
  }
  const resource = textFragments(input, clientResourceId);
  const receipt = await commit({
    request_id: input.request_id,
    captured_at: input.captured_at,
    person_scope: scope,
    channel: "chat",
    kind: resource.kind,
    display_name: resource.displayName,
    media_type:
      resource.kind === "public_url" ? "text/uri-list" : "text/plain",
    ...(resource.sourceLocator
      ? { source_locator: resource.sourceLocator }
      : {}),
    fragments: resource.fragments,
  });
  return {
    receipts: [receipt],
    discovered_links: [],
    parser_warnings: [],
  };
}

async function commitFile(
  form: FormData,
  commit: typeof commitRelationshipResource,
): Promise<{
  receipts: ResourceCaptureResponse[];
  discovered_links: string[];
  parser_warnings: string[];
}> {
  const requestId = String(form.get("request_id") ?? "");
  const capturedAt = String(form.get("captured_at") ?? "");
  const personId = String(form.get("person_id") ?? "");
  const relationshipContextId = String(
    form.get("relationship_context_id") ?? "",
  );
  const documentKind = String(form.get("document_kind") ?? "");
  const saveDiscoveredLinks =
    String(form.get("save_discovered_links") ?? "") === "true";
  const scopeMode = String(form.get("scope_mode") ?? "existing") as
    | "existing"
    | "new_person"
    | "existing_person_new_context";
  const contactName = String(form.get("contact_name") ?? "");
  const relationshipContextLabel = String(
    form.get("relationship_context_label") ?? "",
  );
  const file = form.get("file");
  if (
    !UUID.test(requestId) ||
    !(file instanceof File) ||
    !["resume", "document"].includes(documentKind)
  ) {
    throw new Error("文档接收信息不完整。");
  }
  if (!validCapturedAt(capturedAt)) {
    throw new Error(
      "无法确认该来源的观察时间，未保存任何内容。请刷新页面后重新提交。",
    );
  }

  const clientResourceId = `web-resource:${requestId}`;
  const extraction = await extractDocument(file, clientResourceId);
  const parent = await commit({
    request_id: requestId,
    captured_at: capturedAt,
    person_scope: personScope({
      scope_mode: scopeMode,
      ...(personId ? { person_id: personId } : {}),
      ...(relationshipContextId
        ? { relationship_context_id: relationshipContextId }
        : {}),
      ...(contactName ? { contact_name: contactName } : {}),
      ...(relationshipContextLabel
        ? {
            relationship_context_label: relationshipContextLabel,
          }
        : {}),
    }),
    channel: "web_upload",
    kind: documentKind as "resume" | "document",
    display_name: file.name,
    media_type: file.type || "application/octet-stream",
    byte_size: extraction.byte_size,
    content_hash: extraction.content_hash,
    source_locator: `web-document:${requestId}`,
    fragments: extraction.fragments,
  });

  const receipts = [parent];
  const boundPersonId = parent.identity.person_id;
  const boundRelationshipContextId =
    parent.identity.relationship_context_id;
  if (!boundPersonId || !boundRelationshipContextId) {
    throw new Error(
      "The first document must resolve to an explicit person and relationship context before links can be saved.",
    );
  }
  if (saveDiscoveredLinks) {
    for (const link of extraction.links) {
      const childRequestId = derivedUuid(`${requestId}\n${link}`);
      const childClientResourceId = `web-resource:${childRequestId}`;
      receipts.push(
        await commit({
          request_id: childRequestId,
          captured_at: capturedAt,
          person_id: boundPersonId,
          relationship_context_id: boundRelationshipContextId,
          channel: "web_upload",
          kind: "public_url",
          display_name: new URL(link).hostname,
          media_type: "text/uri-list",
          source_locator: link,
          discovered_from_resource_id: parent.resource.id,
          fragments: [
            {
              client_resource_id: childClientResourceId,
              kind: "url_excerpt",
              sequence: 0,
              text: link,
              locator: {
                kind: "url_excerpt",
                canonical_url: link,
                retrieved_at: capturedAt,
              },
              attribution: {
                actor_kind: "public_source",
                status: "confirmed",
              },
              review_status: "reviewed",
              parser: {
                name: "document-link-discovery",
                version: "1.0.0",
              },
            },
          ],
        }),
      );
    }
  }

  return {
    receipts,
    discovered_links: extraction.links,
    parser_warnings: extraction.parser_warnings,
  };
}

export async function GET(request: Request) {
  if (!isIntegrationMode()) {
    return response({ code: "local_integration_disabled" }, 404);
  }
  const session = await auth();
  if (!session?.user) {
    return response({ code: "authentication_required" }, 401);
  }
  const url = new URL(request.url);
  const resourceId = url.searchParams.get("resource_id");
  const personId = url.searchParams.get("person_id");
  const relationshipContextId = url.searchParams.get(
    "relationship_context_id",
  );
  try {
    if (resourceId) {
      if (!UUID.test(resourceId)) {
        return response({ code: "resource_id_invalid" }, 400);
      }
      return response(await loadRelationshipResource(resourceId));
    }
    if (
      !personId ||
      !relationshipContextId ||
      !UUID.test(personId) ||
      !UUID.test(relationshipContextId)
    ) {
      return response({ code: "resource_scope_invalid" }, 400);
    }
    return response(
      await loadRelationshipResources(
        personId,
        relationshipContextId,
      ),
    );
  } catch (error) {
    if (error instanceof TalentSignalHttpError) {
      return response(
        { code: error.code, message: error.message },
        error.status,
      );
    }
    return response({ code: "relationship_resources_unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  if (!isIntegrationMode()) {
    return response({ code: "local_integration_disabled" }, 404);
  }
  const session = await auth();
  if (!session?.user) {
    return response({ code: "authentication_required" }, 401);
  }
  if (!isAllowedMutationOrigin(request.headers)) {
    return response({ code: "cross_origin_resource_denied" }, 403);
  }
  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return response({ code: "resource_too_large" }, 413);
  }

  let writeAttempted = false;
  let acknowledgedWrites = 0;
  const commit: typeof commitRelationshipResource = async (input) => {
    writeAttempted = true;
    const receipt = await commitRelationshipResource(input);
    acknowledgedWrites += 1;
    return receipt;
  };
  try {
    const contentType =
      request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("application/json")) {
      return response(
        await commitText((await request.json()) as TextResourceInput, commit),
        201,
      );
    }
    if (contentType.startsWith("multipart/form-data")) {
      return response(await commitFile(await request.formData(), commit), 201);
    }
    return response({ code: "resource_content_type_invalid" }, 415);
  } catch (error) {
    if (error instanceof TalentSignalHttpError && acknowledgedWrites === 0) {
      return response(
        { code: error.code, message: error.message },
        error.status,
      );
    }
    if (writeAttempted) {
      // A transport or receipt-parse failure is not proof of rollback. A later
      // file/link rejection also cannot erase an acknowledged parent write.
      return response({
        code: "resource_intake_outcome_unknown",
        message: "无法确认此次提交的完整结果，内容可能已保存。请保留原内容并重试核实。",
      }, 503);
    }
    return response(
      {
        code: "resource_intake_failed",
        message:
          error instanceof Error
            ? error.message
            : "无法提交来源。",
      },
      422,
    );
  }
}
