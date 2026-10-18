import { z } from "zod";
import { captureProductStep } from "./productRunCapture.js";
import { bundledPrompt } from "./promptRegistry.js";
import { prepareScreenshotViews, type PreparedScreenshotViews, type PreparedView } from "./screenshotPreparedViews.js";
import {
  ARK_SCREENSHOT_PREPROCESS_ENDPOINT, ARK_SCREENSHOT_PREPROCESS_MODEL,
  SCREENSHOT_PREPROCESS_CONTRACT,
  ScreenshotPreprocessFollowUpTargetSchema, ScreenshotPreprocessSourceSchema,
  type ScreenshotPreprocessImage, type ScreenshotPreprocessResult, type ScreenshotPreprocessor,
} from "./screenshotPreprocess.js";

/** Bounded provider response. Anything larger is not a valid packet. */
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_VIEWS_PER_REQUEST = 65;

/** Strict model output. We re-derive identity fields; only evidence is accepted. */
const ModelOutputSchema = z.strictObject({
  platform: z.string().max(80).nullable(),
  conversation_kind: z.enum(["profile", "direct", "group", "forwarded", "comments", "unknown", "not_chat"]),
  contact_name: z.string().max(200).nullable(),
  participants: z.array(z.strictObject({
    label: z.string().max(120).nullable(),
    side: z.enum(["left", "right", "unknown"]),
    role_hint: z.enum(["account_owner", "counterpart", "third_party", "unknown"]),
    visible_name: z.string().max(200).nullable(),
  })).max(20),
  messages: z.array(z.strictObject({
    sequence: z.number().int().min(0),
    text: z.string().min(1).max(4_000),
    speaker_label: z.string().max(120).nullable(),
    speaker_side: z.enum(["left", "right", "unknown"]),
    time_text: z.string().max(120).nullable(),
  })).max(100),
  identity_clues: z.array(z.strictObject({
    kind: z.enum(["name", "handle", "profile_url", "company", "job_title"]),
    value: z.string().min(1).max(300),
    source_excerpt: z.string().min(1).max(600),
  })).max(12),
  uncertainties: z.array(z.string().min(1).max(500)).max(15),
  follow_up_regions: z.array(z.strictObject({
    reason: z.enum(["illegible_text", "ambiguous_speaker", "ambiguous_time", "ambiguous_identity", "cropped_boundary", "layout_overlap"]),
    field: z.enum(["text", "speaker", "time", "identity"]),
    uncertainty_index: z.number().int().min(0).max(14),
    target: ScreenshotPreprocessFollowUpTargetSchema,
    baseline_text: z.string().min(1).max(4_000).nullable(),
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    width: z.number().int().min(1).max(1_400),
    height: z.number().int().min(1).max(1_400),
  })).max(20),
});

interface ArkPayload {
  id?: string; model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

const tokens = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

const rawCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Explicitly observed, safely validated raw provider usage. Missing, invalid
 * or half-observed raw usage is unknown, never a normalized zero. */
export interface ArkScreenshotUsageDiagnostics {
  /** Provider-reported model identity, null when it was not observed. */
  reported_model: string | null;
  raw_usage_known: boolean;
  raw_prompt_tokens: number | null;
  raw_completion_tokens: number | null;
}

export interface ArkScreenshotPreprocessResult extends ScreenshotPreprocessResult, ArkScreenshotUsageDiagnostics {}

function rawUsage(usage: ArkPayload["usage"]): Pick<ArkScreenshotUsageDiagnostics,
  "raw_usage_known" | "raw_prompt_tokens" | "raw_completion_tokens"> {
  const prompt = rawCount(usage?.prompt_tokens), completion = rawCount(usage?.completion_tokens);
  const known = prompt !== null && completion !== null;
  return { raw_usage_known: known, raw_prompt_tokens: known ? prompt : null, raw_completion_tokens: known ? completion : null };
}

function parseJSON(value: string): unknown {
  const content = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(content); } catch { throw new Error("SCREENSHOT_PREPROCESS_OUTPUT_INVALID"); }
}

/**
 * Provider-pinned Volcano Ark Doubao-Seed-2.0-lite preprocessor.
 *
 * One stateless Chat API request per original source image, direct image
 * understanding without OCR, thinking disabled, strict JSON, and a bounded
 * response. Derived prepared views exist only for the duration of the request.
 */
export class ArkScreenshotPreprocessor implements ScreenshotPreprocessor {
  readonly provider = "volcano_ark" as const;
  readonly model = ARK_SCREENSHOT_PREPROCESS_MODEL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: { apiKey: string; fetcher?: typeof fetch }) {
    if (!options.apiKey.trim()) throw new Error("SCREENSHOT_PREPROCESS_CREDENTIAL_REQUIRED");
    this.fetcher = options.fetcher ?? fetch;
  }

  async preprocess(image: ScreenshotPreprocessImage, imageIndex: number, signal: AbortSignal,
    authorizeDispatch:()=>Promise<void>): Promise<ArkScreenshotPreprocessResult> {
    signal.throwIfAborted();
    const views = await prepareScreenshotViews(image, imageIndex);
    assertPreprocessViewBudget(views);
    signal.throwIfAborted();
    const instruction = [bundledPrompt("capture/screenshot-preprocess").text,
      "Required JSON Schema:",JSON.stringify(z.toJSONSchema(ModelOutputSchema))].join("\n\n");
    const content: Array<Record<string, unknown>> = [{ type: "text", text: instruction }];
    if (!views.native_clarity) {
      appendView(content,"OVERVIEW",views.overview);
      for (const [index,tile] of views.tiles.entries()) appendView(content,`TILE ${index + 1}`,tile);
    } else {
      appendView(content,"NATIVE FULL VIEW",views.overview);
    }
    let source: ScreenshotPreprocessResult["source"] | undefined;
    const receipt = await captureProductStep("contact.screenshot.preprocess", "llm",
      { model: this.model, source_image_index: imageIndex, source_hash: image.content_hash,
        native_clarity: views.native_clarity, tile_count: views.tiles.length,
        prepared_view_hash: views.overview.content_hash,
        coordinate_space: "EXIF-oriented original pixels" },
      async () => {
        // Rendering can be expensive. Revalidate the task after it finishes
        // and immediately before the first remote byte is dispatched.
        await authorizeDispatch();
        signal.throwIfAborted();
        const payload = await this.request(content, signal);
        const raw = ModelOutputSchema.parse(parseJSON(payload.choices![0]!.message!.content ?? ""));
        const validated = ScreenshotPreprocessSourceSchema.parse({
          source_image_index: imageIndex, source_hash: image.content_hash,
          platform: raw.platform, conversation_kind: raw.conversation_kind, contact_name: raw.contact_name,
          participants: raw.participants, messages: raw.messages.map((message, index) => ({ ...message, sequence: index })),
          identity_clues: raw.identity_clues, uncertainties: raw.uncertainties,
          follow_up_required: raw.follow_up_regions.length > 0,
          follow_up_regions: raw.follow_up_regions.map(region => ({ reason: region.reason, field: region.field,
            uncertainty_index: region.uncertainty_index, target: region.target, baseline_text:region.baseline_text,
            region: { left: region.left, top: region.top, width: region.width, height: region.height } })),
          width: views.width, height: views.height,
          prepared_view: { transform: views.overview.transform, content_hash: views.overview.content_hash, tile_count: views.tiles.length },
        });
        if (validated.follow_up_regions.some(region => region.region.left + region.region.width > views.width ||
          region.region.top + region.region.height > views.height)) {
          throw new Error("SCREENSHOT_PREPROCESS_REGION_OUT_OF_BOUNDS");
        }
        source = validated;
        return {
          request_id: payload.id!, model: payload.model!, usage: payload.usage,
        };
      },
      { provider: "volcano_ark", model: this.model, contract: SCREENSHOT_PREPROCESS_CONTRACT });
    if (!source) throw new Error("SCREENSHOT_PREPROCESS_OUTPUT_INVALID");
    return { source, request_id: receipt.request_id, model: receipt.model,
      input_tokens: tokens(receipt.usage?.prompt_tokens), output_tokens: tokens(receipt.usage?.completion_tokens),
      reported_model: receipt.model, ...rawUsage(receipt.usage) };
  }

  private async request(content: Array<Record<string, unknown>>, signal: AbortSignal): Promise<ArkPayload> {
    const response = await this.fetcher(ARK_SCREENSHOT_PREPROCESS_ENDPOINT, {
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        store: false,
        stream: false, temperature: 0,
        max_tokens: 8_000,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`SCREENSHOT_PREPROCESS_PROVIDER_HTTP_${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SCREENSHOT_PREPROCESS_PROVIDER_EMPTY_RESPONSE");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error("SCREENSHOT_PREPROCESS_RESPONSE_TOO_LARGE");
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let payload: ArkPayload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ArkPayload; }
    catch { throw new Error("SCREENSHOT_PREPROCESS_PROVIDER_INVALID_JSON"); }
    if (payload.model !== this.model || !payload.id || !payload.choices?.[0]?.message) {
      throw new Error("SCREENSHOT_PREPROCESS_PROVIDER_IDENTITY_MISMATCH");
    }
    return payload;
  }
}

function viewBlock(view: PreparedView): Record<string, unknown> {
  return { type: "image_url" as const, image_url: { url: `data:${view.media_type};base64,${view.data_base64}` } };
}

function appendView(content:Array<Record<string,unknown>>,label:string,view:PreparedView):void{
  content.push({type:"text",text:`${label}; original-pixel region ${JSON.stringify(view.region)}; transform ${view.transform}.`});
  content.push(viewBlock(view));
}

export function assertPreprocessViewBudget(views: PreparedScreenshotViews): void {
  if (1 + views.tiles.length > MAX_VIEWS_PER_REQUEST) throw new Error("SCREENSHOT_PREPROCESS_VIEW_BUDGET");
}
