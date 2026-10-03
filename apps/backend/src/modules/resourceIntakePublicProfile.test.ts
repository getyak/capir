import {
  CONTRACT_VERSION,
  type ResourceCaptureRequest,
} from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

import { validateResourceRequest } from "./resourceIntake.js";

const personId = "11111111-1111-4111-8111-111111111111";
const contextId = "22222222-2222-4222-8222-222222222222";
const contentHash = "a".repeat(64);
const profileURL = "https://example.com/in/zhou-yu";

function request(): ResourceCaptureRequest {
  return {
    contract_version: CONTRACT_VERSION,
    idempotency_key: "reviewed-public-profile-validation",
    channel: "chat",
    purpose: "Preserve a recruiter-reviewed public profile",
    captured_at: "2026-09-02T08:00:00.000Z",
    source_timezone: "Asia/Shanghai",
    person_scope: {
      status: "confirmed",
      person_id: personId,
      relationship_context: {
        status: "existing",
        relationship_context_id: contextId,
      },
      binding_basis:
        "The recruiter reviewed the identity and explicitly selected this person.",
    },
    resource: {
      client_resource_id: "reviewed-public-profile-1",
      kind: "contact_record",
      display_name: "Reviewed public profile",
      media_type: "text/plain",
      observed_at: "2026-09-02T07:58:00.000Z",
      source_timezone: "Asia/Shanghai",
      content_hash: contentHash,
      source_locator: profileURL,
      retention: {
        requested_mode: "ephemeral",
        source_scope: "reviewed_selected_text",
      },
    },
    reviewed_public_profile: {
      result_id: "result-1",
      provider_id: "provider-1",
      platform: "linkedin",
      profile_url: profileURL,
      display_name: "周屿",
      match_basis: "Name and role matched the supplied context.",
      content_hash: contentHash,
      retrieved_at: "2026-09-02T07:58:00.000Z",
      card_headline: "VP Product · Example Co.",
      use_avatar: false,
    },
    fragments: [
      {
        client_resource_id: "reviewed-public-profile-1",
        kind: "contact_field",
        sequence: 0,
        text: "Recruiter reviewed the public profile.",
        locator: {
          kind: "contact_field",
          field: "source_note",
          source_record_version: "1",
        },
        attribution: { actor_kind: "recruiter", status: "confirmed" },
        review_status: "reviewed",
        parser: {
          name: "ios-agent-public-profile-review",
          version: "1.0.0",
        },
      },
    ],
  };
}

describe("reviewed public profile intake boundary", () => {
  it("accepts an exact HTTPS source attached to a confirmed person", () => {
    expect(() => validateResourceRequest(request())).not.toThrow();
  });

  it("rejects profile provenance that differs from the governed resource", () => {
    const value = request();
    value.resource.source_locator = "https://example.com/in/someone-else";

    expect(() => validateResourceRequest(value)).toThrowError(
      /match the governed source URL and content hash/,
    );
  });

  it("rejects public card promotion while identity is unresolved", () => {
    const value = request();
    value.person_scope = {
      status: "unresolved",
      display_name_hint: "周屿",
      handles: [],
      reason: "Identity ownership is not yet confirmed.",
    };

    expect(() => validateResourceRequest(value)).toThrowError(
      /requires an explicitly bound person/,
    );
  });

  it("rejects a non-HTTPS avatar", () => {
    const value = request();
    if (value.reviewed_public_profile) {
      value.reviewed_public_profile.provider_id = "licensed-provider";
      value.reviewed_public_profile.avatar_url =
        "http://example.com/avatar.jpg";
      value.reviewed_public_profile.avatar_rights_basis =
        "provider_display_license";
      value.reviewed_public_profile.use_avatar = true;
    }

    expect(() => validateResourceRequest(value)).toThrowError(
      /avatar requires an HTTPS URL/,
    );
  });

  it("rejects a TikHub avatar because its terms do not grant display rights", () => {
    const value = request();
    if (value.reviewed_public_profile) {
      value.reviewed_public_profile.provider_id = "tikhub";
      value.reviewed_public_profile.avatar_url =
        "https://example.com/avatar.jpg";
      value.reviewed_public_profile.avatar_rights_basis =
        "provider_display_license";
      value.reviewed_public_profile.use_avatar = true;
    }

    expect(() => validateResourceRequest(value)).toThrowError(
      /does not grant capri display or storage rights/,
    );
  });

  it("rejects a stored avatar without an explicit rights basis", () => {
    const value = request();
    if (value.reviewed_public_profile) {
      value.reviewed_public_profile.provider_id = "licensed-provider";
      value.reviewed_public_profile.avatar_url =
        "https://example.com/avatar.jpg";
      value.reviewed_public_profile.use_avatar = true;
    }

    expect(() => validateResourceRequest(value)).toThrowError(
      /requires an explicit provider license or profile-owner consent basis/,
    );
  });

  it("accepts an avatar when a non-TikHub provider supplies a rights basis", () => {
    const value = request();
    if (value.reviewed_public_profile) {
      value.reviewed_public_profile.provider_id = "licensed-provider";
      value.reviewed_public_profile.avatar_url =
        "https://example.com/avatar.jpg";
      value.reviewed_public_profile.avatar_rights_basis =
        "provider_display_license";
      value.reviewed_public_profile.use_avatar = true;
    }

    expect(() => validateResourceRequest(value)).not.toThrow();
  });
});

describe("proposed screenshot extraction boundary", () => {
  function screenshotRequest(): ResourceCaptureRequest {
    const value = request();
    value.idempotency_key = "proposed-screenshot-extraction";
    value.purpose = "Process one recruiter-selected screenshot";
    value.person_scope = {
      status: "unresolved",
      display_name_hint: "Zhou Yu",
      handles: [],
      reason: "The Agent has not confirmed who owns this screenshot.",
    };
    value.resource = {
      client_resource_id: "ios-screenshot-1",
      kind: "conversation_screenshot",
      display_name: "conversation.png",
      media_type: "image/png",
      observed_at: "2026-09-02T07:58:00.000Z",
      source_timezone: "Asia/Shanghai",
      retention: {
        requested_mode: "ephemeral",
        source_scope: "proposed_extracted_text",
      },
    };
    delete value.reviewed_public_profile;
    value.fragments = [
      {
        client_resource_id: "ios-screenshot-1",
        kind: "message",
        sequence: 0,
        text: "Machine extracted conversation text.",
        locator: {
          kind: "message",
          source_message_id: "ocr-proposed-1",
          sequence: 0,
          speaker_side: "unknown",
        },
        attribution: { actor_kind: "unknown", status: "proposed" },
        review_status: "proposed",
        parser: { name: "ios-vision-text-recognition", version: "1.0.0" },
      },
    ];
    return value;
  }

  it("accepts proposed text from an intentional screenshot", () => {
    expect(() => validateResourceRequest(screenshotRequest())).not.toThrow();
  });

  it("rejects proposed extraction that claims human review authority", () => {
    const value = screenshotRequest();
    value.fragments[0]!.review_status = "reviewed";

    expect(() => validateResourceRequest(value)).toThrowError(
      /must remain proposed/,
    );
  });
});
