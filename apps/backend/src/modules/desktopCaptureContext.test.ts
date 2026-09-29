import { describe, expect, it } from "vitest";
import { describeDesktopCapturePolicy } from "./desktopCaptureContext.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";

const provider = (providerId: RemoteChatAnswerProviding["providerId"], model: string, supportsImageInput = true) =>
  ({ providerId, model, supportsImageInput } as RemoteChatAnswerProviding);

describe("desktop capture processing disclosure", () => {
  it("names the image processor and existing Session retention without exposing secrets", () => {
    const policy = describeDesktopCapturePolicy(provider("zhipu-chat-completions", "glm-4.6v"), new Map(), false);
    expect(policy).toMatchObject({ available: true, source_retention_days: 30, processor_labels: ["Zhipu · glm-4.6v"] });
    expect(JSON.stringify(policy)).not.toContain("api_key");
  });

  it("blocks automatic upload when the active provider cannot accept images", () => {
    expect(describeDesktopCapturePolicy(provider("claude-agent-sdk", "claude-test", false), new Map(), false).available).toBe(false);
    expect(describeDesktopCapturePolicy(null, new Map(), false).available).toBe(false);
  });

  it("discloses possible Lab processors in a stable order and changes the policy version", () => {
    const current = provider("claude-agent-sdk", "sonnet");
    const plain = describeDesktopCapturePolicy(current, new Map(), false);
    const lab = describeDesktopCapturePolicy(current, new Map([
      ["zeta", provider("zhipu-chat-completions", "zeta")],
      ["alpha", provider("claude-agent-sdk", "alpha")],
    ]), true);
    expect(lab.processor_labels).toEqual(["Claude · alpha", "Claude · sonnet", "Zhipu · zeta"]);
    expect(lab.policy_version).not.toBe(plain.policy_version);
  });
});
