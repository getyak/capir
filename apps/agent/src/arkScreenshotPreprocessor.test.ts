import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ArkScreenshotPreprocessor } from "./arkScreenshotPreprocessor.js";
import { withProductRunCapture, type ProductRunSpan } from "./productRunCapture.js";
import { ARK_SCREENSHOT_PREPROCESS_MODEL } from "./screenshotPreprocess.js";

async function image() {
  const bytes = await sharp({ create: { width: 120, height: 240, channels: 3, background: "white" } }).png().toBuffer();
  return { media_type: "image/png" as const, byte_size: bytes.length,
    content_hash: createHash("sha256").update(bytes).digest("hex"), data_base64: bytes.toString("base64") };
}

const modelOutput = { platform: "WeChat", conversation_kind: "direct", contact_name: "Synthetic Person",
  participants: [{ label: "我", side: "right", role_hint: "account_owner", visible_name: null }],
  messages: [{ sequence: 0, text: "Exact synthetic source", speaker_label: "我", speaker_side: "right", time_text: "09:30" }],
  identity_clues: [{ kind: "name", value: "Synthetic Person", source_excerpt: "Synthetic Person" }],
  uncertainties: [], follow_up_regions: [] };

async function preprocessWith(usage: unknown) {
  const spans: ProductRunSpan[] = [];
  const source = await image();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    id: "ark-usage-1", model: ARK_SCREENSHOT_PREPROCESS_MODEL,
    choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    ...(usage === undefined ? {} : { usage }),
  }))) as typeof fetch;
  const result = await withProductRunCapture({ async append(span) { spans.push(span); } }, () =>
    new ArkScreenshotPreprocessor({ apiKey: "synthetic", fetcher })
      .preprocess(source, 0, new AbortController().signal, async () => {}));
  return { result, spans };
}

describe("screenshot preprocess raw usage diagnostics", () => {
  it.each([
    ["explicit counts", { prompt_tokens: 12, completion_tokens: 8 }, 12, 8],
    ["a provider-reported zero", { prompt_tokens: 0, completion_tokens: 0 }, 0, 0],
  ])("keeps %s observed exactly as raw counters", async (_label, usage, prompt, completion) => {
    const { result, spans } = await preprocessWith(usage);
    expect(result).toMatchObject({ request_id: "ark-usage-1", model: ARK_SCREENSHOT_PREPROCESS_MODEL,
      reported_model: ARK_SCREENSHOT_PREPROCESS_MODEL, raw_usage_known: true,
      raw_prompt_tokens: prompt, raw_completion_tokens: completion,
      input_tokens: prompt, output_tokens: completion });
    // The raw provider usage also stays inside the full-source span output.
    expect(spans[0]?.output).toMatchObject({ status: "complete", value: { usage } });
    expect(JSON.stringify(spans)).not.toContain("Exact synthetic source");
  });

  it.each([
    ["missing usage", undefined],
    ["null usage", null],
    ["negative counts", { prompt_tokens: -1, completion_tokens: 2 }],
    ["fractional counts", { prompt_tokens: 1.5, completion_tokens: 2 }],
    ["string counts", { prompt_tokens: "12", completion_tokens: 8 }],
    ["unsafe integer counts", { prompt_tokens: Number.MAX_SAFE_INTEGER + 2, completion_tokens: 1 }],
    ["one invalid field", { prompt_tokens: 5, completion_tokens: null }],
  ])("keeps %s explicitly unknown instead of reporting zero", async (_label, usage) => {
    const { result } = await preprocessWith(usage);
    expect(result).toMatchObject({ raw_usage_known: false, raw_prompt_tokens: null, raw_completion_tokens: null });
    // The frozen packet contract keeps normalized per-field counters (invalid
    // fields map to zero, valid fields keep their value). They can never carry
    // the known-zero claim; only raw_usage_known/raw_* do.
    expect(Number.isInteger(result.input_tokens)).toBe(true);
    expect(Number.isInteger(result.output_tokens)).toBe(true);
    expect(result.input_tokens).toBeGreaterThanOrEqual(0);
    expect(result.output_tokens).toBeGreaterThanOrEqual(0);
    expect(result.raw_usage_known).toBe(false);
  });

  it("keeps a one-sided raw receipt unknown without dropping the observed field silently", async () => {
    const { result } = await preprocessWith({ prompt_tokens: 7 });
    expect(result.raw_usage_known).toBe(false);
    expect(result.raw_prompt_tokens).toBeNull();
    expect(result.raw_completion_tokens).toBeNull();
    expect(result.reported_model).toBe(ARK_SCREENSHOT_PREPROCESS_MODEL);
  });
});
