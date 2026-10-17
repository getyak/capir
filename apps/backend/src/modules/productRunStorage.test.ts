import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { captureObservationContent, type ProductRunSpan } from "@talent-signal/agent";
import { metadataOnlyProductSpan, productRunSink } from "./productRunStorage.js";

// Bounded SDK usage diagnostics: failed or source-less receipts keep flat
// primitive counts and a hashed message identity, never bodies or raw IDs.
function span(metadata: Record<string, unknown>): ProductRunSpan {
  return { id: "00000000-0000-4000-8000-000000000010", parent_id: null, name: "harness.sdk.assistant", kind: "llm",
    started_at: "2026-10-18T00:00:00.000Z", finished_at: "2026-10-18T00:00:01.000Z", status: "failed",
    input: captureObservationContent({ objective: "synthetic private body" }, 2000),
    output: captureObservationContent({ content: [{ text: "synthetic private answer" }] }, 2000),
    metadata, error: "Operation failed" };
}
const diagnostics = {
  sdk_message_id_sha256: "a".repeat(64), sdk_input_tokens: 12, sdk_output_tokens: 4,
  sdk_cache_read_input_tokens: 7, sdk_cache_creation_input_tokens: 2, sdk_total_input_tokens: 21,
  sdk_usage_basis: "per_message_provider_reported_input_excludes_cache", sdk_stop_reason: "end_turn",
};
const fullMetadata = {
  model: "claude-sonnet-5", provider: "claude-agent-sdk", input_tokens: 12, output_tokens: 4, duration_ms: 33_020,
  sdk_message_id: "synthetic-raw-sdk-id",
  usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 2, source: "provider" },
  ...diagnostics,
  sdk_cache_read_delta: 3, synthetic_nested: { secret: "synthetic nested secret" },
  synthetic_unrecognized: "synthetic unrecognized key",
};

describe("bounded product run span retention", () => {
  it("keeps flat SDK usage primitives while removing bodies, nested metadata and unrecognized keys", () => {
    const safe = metadataOnlyProductSpan(span(fullMetadata));
    expect(safe.input).toEqual({ status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null });
    expect(safe.output).toEqual({ status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null });
    expect(safe.error).toBe("Operation failed");
    expect(safe.metadata).toEqual({ model: "claude-sonnet-5", provider: "claude-agent-sdk",
      input_tokens: 12, output_tokens: 4, duration_ms: 33_020, ...diagnostics });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("synthetic private body");
    expect(serialized).not.toContain("synthetic private answer");
    expect(serialized).not.toContain("synthetic nested secret");
    expect(serialized).not.toContain("synthetic-raw-sdk-id");
  });

  it("keeps a genuine zero count and explicit null without inventing values", () => {
    const safe = metadataOnlyProductSpan(span({ ...diagnostics, sdk_input_tokens: 4, sdk_total_input_tokens: 4,
      sdk_cache_read_input_tokens: 0, sdk_cache_creation_input_tokens: 0, sdk_stop_reason: null }));
    expect(safe.metadata).toEqual({ ...diagnostics, sdk_input_tokens: 4, sdk_total_input_tokens: 4,
      sdk_cache_read_input_tokens: 0, sdk_cache_creation_input_tokens: 0, sdk_stop_reason: null });
    expect(metadataOnlyProductSpan({ ...span(diagnostics), error: null }).error).toBeNull();
  });

  it("persists the same shared metadata policy through the sink placeholder", async () => {
    const statements: { text: string; values: unknown[] }[] = [];
    const pool = { query: vi.fn(async (text: string, values: unknown[]) => {
      statements.push({ text, values }); return { rows: [] };
    }) } as unknown as Pool;
    const sink = productRunSink(pool, "00000000-0000-4000-8000-000000000011", error => { throw error; });
    await sink.append(span(fullMetadata));
    await vi.waitFor(() => expect(statements).toHaveLength(1));
    const placeholder = JSON.parse(statements[0]!.values[2] as string);
    // The sink placeholder and the read-side projection share one key list.
    expect(placeholder).toEqual(metadataOnlyProductSpan(span(fullMetadata)));
    expect(JSON.stringify(placeholder)).not.toContain("synthetic private body");
    expect(JSON.stringify(placeholder)).not.toContain("synthetic-raw-sdk-id");
    expect(JSON.stringify(placeholder)).not.toContain("synthetic nested secret");
  });
});
