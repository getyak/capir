import { createHash } from "node:crypto";
import sharp from "sharp";

export interface McpResultImage {
  image_index: number;
  media_type: "image/png" | "image/jpeg" | "image/webp";
  content_hash: string;
  content: Uint8Array;
}

/** Bound the final serialized value, including escaping/redaction expansion.
 * Image manifests survive truncation; a text-only preview cannot imply that
 * omitted content was received or an unavailable image was stored. */
export function boundedMcpResultJson(value: unknown, limit = 24_000): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= limit) return serialized;
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const blocks = Array.isArray(record.content) ? record.content : [];
  const isImage = (block: unknown) => Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "image");
  const images = blocks.filter(isImage).slice(0, 100);
  const text = record.text_preview_kind === "text_only" && typeof record.text_preview === "string" ? record.text_preview
    : JSON.stringify({ ...record, content: blocks.filter(block => !isImage(block)), ...(typeof value === "string" ? { text: value } : {}) });
  const projection = (size: number) => JSON.stringify({ truncated: true,
    ...(typeof record.omitted_content_blocks === "number" ? { omitted_content_blocks: record.omitted_content_blocks } : {}),
    content: images, text_preview_kind: "text_only", text_preview: text.slice(0, size) });
  let low = 0; let high = Math.min(text.length, limit);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (projection(mid).length <= limit) low = mid; else high = mid - 1;
  }
  return projection(low);
}

/** Remote images remain tool evidence. Never pass their base64 into prose,
 * diagnostics or SDK context, fetch a remote URL, or interpret an SVG. */
export async function normalizeMcpResultImages(result: unknown): Promise<{ result: unknown; images: McpResultImage[] }> {
  const images: McpResultImage[] = [];
  if (!result || typeof result !== "object" || !Array.isArray((result as { content?: unknown }).content)) return { result, images };
  const source = result as { content: unknown[] };
  const content: unknown[] = [];
  for (const block of source.content.slice(0, 100)) {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") { content.push(block); continue; }
    const image = block as { data?: unknown; mimeType?: unknown };
    try {
      if (images.length >= 4 || typeof image.data !== "string" || image.data.length > 1_000_000 ||
          !["image/png", "image/jpeg", "image/webp"].includes(String(image.mimeType))) throw new Error("invalid");
      const bytes = Buffer.from(image.data, "base64");
      if (!bytes.length || bytes.length > 750_000 || bytes.toString("base64") !== image.data) throw new Error("invalid");
      const decoder = sharp(bytes, { limitInputPixels: 4_000_000, failOn: "warning" });
      const meta = await decoder.metadata();
      const expected = image.mimeType === "image/jpeg" ? "jpeg" : String(image.mimeType).slice(6);
      if (meta.format !== expected || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) > 1) throw new Error("invalid");
      await decoder.stats(); // validate decodability, not only a magic header
      const image_index = images.length;
      const media_type = image.mimeType as McpResultImage["media_type"];
      const content_hash = createHash("sha256").update(bytes).digest("hex");
      images.push({ image_index, media_type, content_hash, content: bytes });
      content.push({ type: "image", status: "ready", image_index, media_type, byte_size: bytes.length, content_hash, width: meta.width, height: meta.height });
    } catch {
      content.push({ type: "image", status: "unavailable", error_code: "MCP_IMAGE_INVALID" });
    }
  }
  const omitted = Math.max(0, source.content.length - content.length);
  return { result: { ...source, content, ...(omitted ? { truncated: true, omitted_content_blocks: omitted } : {}) }, images };
}

export function unavailableMcpResultImages(resultText: string | null,
  code: "MCP_IMAGE_STORAGE_FAILED" | "MCP_IMAGE_CONVERSATION_REQUIRED" | "MCP_TOOL_FAILED" = "MCP_IMAGE_STORAGE_FAILED"): string | null {
  if (!resultText) return resultText;
  try {
    const result = JSON.parse(resultText);
    if (Array.isArray(result.content)) result.content = result.content.map((block: { type?: string }) =>
      block?.type === "image" ? { type: "image", status: "unavailable", error_code: code } : block);
    // A partial serialized preview may duplicate a prior ready manifest. It
    // cannot survive a final unavailable status or imply successful storage.
    if (result.truncated && result.text_preview_kind !== "text_only" && typeof result.text_preview === "string" && /"type"\s*:\s*"image"/u.test(result.text_preview)) {
      result.text_preview = "Image preview removed; use the final image status.";
      result.preview_unavailable_reason = code;
    }
    return boundedMcpResultJson(result);
  } catch { return resultText; }
}
