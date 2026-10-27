import { describe, expect, it } from "vitest";
import { unavailableMcpResultImages, normalizeMcpResultImages } from "./mcpResultImages.js";

describe("MCP image result coverage", () => {
  it("marks omitted content blocks instead of reporting a complete result", async () => {
    const normalized = await normalizeMcpResultImages({ content: Array.from({ length: 101 }, (_, i) => ({ type: "text", text: `item-${i}` })) });
    expect(normalized.result).toMatchObject({ truncated: true, omitted_content_blocks: 1 });
  });

  it("does not retain a contradictory ready image in a truncated preview after storage failure", () => {
    const image = { type: "image", status: "ready", image_index: 0 };
    const result = unavailableMcpResultImages(JSON.stringify({ truncated: true, content: [image], text_preview: JSON.stringify({ content: [image] }) }));
    expect(result).not.toContain("ready");
    expect(JSON.parse(result!).content[0]).toMatchObject({ status: "unavailable", error_code: "MCP_IMAGE_STORAGE_FAILED" });
  });
});
