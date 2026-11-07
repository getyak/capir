import { fingerprint } from "./fingerprint.js";
import type { ProviderRunConfiguration } from "./providerRunConfiguration.js";
import type { AgentFingerprints, AgentRunRequest } from "./types.js";

/** Fingerprints bind the already captured host configuration; this helper
 * never reads a mutable provider descriptor or environment again. */
export function buildRunFingerprints(request: AgentRunRequest, providerConfiguration: ProviderRunConfiguration): AgentFingerprints {
  return {
    definition: fingerprint({
      name: request.definition.name,
      version: request.definition.version,
      policyVersion: request.definition.policyVersion,
      contractVersion: request.definition.contractVersion,
    }),
    systemPrompt: fingerprint(request.definition.systemPrompt),
    toolManifest: fingerprint(request.definition.toolManifest),
    sdk: fingerprint({
      provider: request.provider.id,
      sdkVersion: request.provider.sdkVersion,
      providerConfiguration,
    }),
    model: fingerprint(request.provider.model),
    policy: fingerprint(request.definition.policyVersion),
    contract: fingerprint(request.definition.contractVersion),
    context: fingerprint({
      workspaceID: request.scope.workspaceID,
      userID: request.scope.userID,
      pursuitID: request.scope.pursuitID,
      pursuitRevision: request.scope.pursuitRevision,
      captureID: request.scope.captureID,
      objective: request.scope.objective,
      evidenceManifest: request.scope.evidenceManifest,
      inputArtifactManifest: request.scope.inputArtifactManifest ?? [],
    }),
  };
}
