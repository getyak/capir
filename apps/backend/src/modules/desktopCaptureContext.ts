import { createHash } from "node:crypto";
import { DesktopCapturePolicySchema, type DesktopCapturePolicy } from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";

const processorLabel = (provider: RemoteChatAnswerProviding) =>
  `${provider.providerId === "claude-agent-sdk" ? "Claude" : "Zhipu"} · ${provider.imageModel || provider.model}`;

export function describeDesktopCapturePolicy(
  current: RemoteChatAnswerProviding | null,
  labProviders: ReadonlyMap<string, RemoteChatAnswerProviding>,
  labEnabled: boolean,
): DesktopCapturePolicy {
  const providers = [current, ...(labEnabled ? labProviders.values() : [])]
    .filter((provider): provider is RemoteChatAnswerProviding => provider !== null);
  const processor_labels = [...new Set(providers.map(processorLabel))].sort();
  const available = current?.supportsImageInput === true && providers.every(provider => provider.supportsImageInput);
  const policy_version = createHash("sha256")
    .update(JSON.stringify({ processor_labels, available, source_retention_days: 30 }))
    .digest("hex");
  return { policy_version, available, processor_labels, source_retention_days: 30 };
}

export function registerDesktopCaptureContext(
  app: FastifyInstance,
  authenticate: preHandlerHookHandler,
  current: RemoteChatAnswerProviding | null,
  labProviders: ReadonlyMap<string, RemoteChatAnswerProviding>,
  labEnabled: boolean,
): void {
  app.get("/v1/desktop-capture/policy", {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { security: [{ bearerSession: [] }], response: { 200: DesktopCapturePolicySchema } },
  }, async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
    return describeDesktopCapturePolicy(current, labProviders, labEnabled);
  });
}
