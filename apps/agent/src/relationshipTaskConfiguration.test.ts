import { describe, expect, it } from "vitest";
import {
  BASELINE_OPTIMIZATION_CANDIDATE,
  DEEPSEEK_TEXT_TASK_POLICY,
  chatModelReasoningEffort,
  deepSeekLoadedRelationshipTextTaskConfiguration,
  deepSeekRelationshipTextTaskConfiguration,
  loadedRelationshipTaskConfiguration,
  loadedRelationshipTaskPrompt,
  relationshipTaskConfiguration,
} from "./relationshipTaskConfiguration.js";

// Frozen from GET-18 baseline 0ad5d212, then deliberately re-frozen for the
// GET-40 clarification: review-only Memory proposals cannot save accepted state.
// Runtime policy digests are unchanged. Future prompt or policy edits must
// explicitly re-freeze these values in review.
describe("frozen GLM relationship task configuration", () => {
  it("keeps the loaded glm-4.7 baseline configuration unchanged", () => {
    expect(loadedRelationshipTaskConfiguration("glm-4.7")).toEqual({
      configuration: {
        configurationId: "candidate-2763dc072ce561fa1de935be",
        model: "glm-4.7",
        promptRevision: "ce41835e935403c3",
        promptContentDigest: "sha256:ce41835e935403c399665d56c3357765385a8c425f94ae0fa0c61ea95cae8aab",
        runtimePolicyDigest: "sha256:ebc988f63edfaaac2e584880a46242ef7a31c4427d5fecec01ebda499fe3fd6a",
        parameters: { schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: [] },
      },
      taskConfigurationDigest: "sha256:b4a2195eb6fe78baae713f7a33bfd13cec6826388108855e5cefa06ce87a3e8f",
    });
  });

  it("keeps the loaded glm-5.3 and timeout-dependent digests unchanged", () => {
    expect(loadedRelationshipTaskConfiguration("glm-5.3")).toEqual({
      configuration: {
        configurationId: "candidate-2763dc072ce561fa1de935be",
        model: "glm-5.3",
        promptRevision: "ce41835e935403c3",
        promptContentDigest: "sha256:ce41835e935403c399665d56c3357765385a8c425f94ae0fa0c61ea95cae8aab",
        runtimePolicyDigest: "sha256:e072760ad36c2ab2b515731173745819a2875c95cf839403aab93ac855be81af",
        parameters: { schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: [] },
      },
      taskConfigurationDigest: "sha256:9d5224558501bceda5881a6fa84d8fee9f2effb0ea96576a1f999a2556a3600c",
    });
    expect(loadedRelationshipTaskConfiguration("glm-4.7", 30000).taskConfigurationDigest)
      .toBe("sha256:6b75a1c85eac2d6d11e85ad287d889334aba0a9de92b42ccab8169bbbdb709ce");
    expect(loadedRelationshipTaskConfiguration("glm-5.3", 30000).taskConfigurationDigest)
      .toBe("sha256:37c9f227977a50527a906e9b2e4779decd887336296518ea44a863b27f4d109d");
  });

  it("keeps the loaded relationship prompt and the GLM reasoning gate unchanged", () => {
    expect(loadedRelationshipTaskPrompt().revision)
      .toBe("ce41835e935403c399665d56c3357765385a8c425f94ae0fa0c61ea95cae8aab");
    expect(chatModelReasoningEffort("glm-4.7")).toBeNull();
    expect(chatModelReasoningEffort("glm-5.3")).toBe("low");
    expect(chatModelReasoningEffort("deepseek-flash")).toBeNull();
  });
});

describe("DeepSeek relationship text runtime policy", () => {
  it("pins the profile version and an honest mutable-alias identity policy", () => {
    expect(DEEPSEEK_TEXT_TASK_POLICY.policyVersion).toBe("deepseek-relationship-text.v1");
    expect(DEEPSEEK_TEXT_TASK_POLICY.modelIdentityPolicy).toEqual({
      requested: "deepseek-flash",
      identity: "documented-mutable-alias",
      immutableWeightsPinned: false,
      reported: ["deepseek-flash", "DeepSeek-V4.1-Flash-1017"],
    });
    expect(DEEPSEEK_TEXT_TASK_POLICY).toMatchObject({
      adapterId: "deepseek-relationship-text-product-task.v1",
      task: "assistant/relationship",
      toolManifest: [],
      externalEffects: "none",
      thinking: "disabled",
      temperature: 0,
      maxTokens: 1600,
      responseFormat: "json_object",
      stream: false,
      maxDurationMs: 15000,
    });
  });

  it("digests the DeepSeek profile instead of reusing GLM policy digests", () => {
    const loaded = deepSeekLoadedRelationshipTextTaskConfiguration("deepseek-flash");
    expect(loaded.configuration).toEqual({
      configurationId: "candidate-2763dc072ce561fa1de935be",
      model: "deepseek-flash",
      promptRevision: "ce41835e935403c3",
      promptContentDigest: "sha256:ce41835e935403c399665d56c3357765385a8c425f94ae0fa0c61ea95cae8aab",
      runtimePolicyDigest: "sha256:96b432901223c8341d512dc3e8d8d89ebbb62251b610dca0b2a27fc4e467b53e",
      parameters: { schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: [] },
    });
    expect(loaded.taskConfigurationDigest).toBe("sha256:95ecb7af9a9391413e495bf0d2be08fc450fed028b4109a0294dd9de14b500b0");
    expect(loaded.configuration.runtimePolicyDigest)
      .not.toBe(loadedRelationshipTaskConfiguration("glm-4.7").configuration.runtimePolicyDigest);
    expect(loaded.configuration.runtimePolicyDigest)
      .not.toBe(relationshipTaskConfiguration("deepseek-flash", BASELINE_OPTIMIZATION_CANDIDATE).runtimePolicyDigest);
    expect(loaded.taskConfigurationDigest)
      .not.toBe(loadedRelationshipTaskConfiguration("deepseek-flash").taskConfigurationDigest);
  });

  it("rejects a missing or wrong requestable model instead of claiming the alias policy", () => {
    expect(() => deepSeekRelationshipTextTaskConfiguration("deepseek-chat")).toThrow("deepseek-flash");
    expect(() => deepSeekRelationshipTextTaskConfiguration("")).toThrow("deepseek-flash");
    // The documented resolved identity is a tolerated reported identity, not a
    // requestable weight pin.
    expect(() => deepSeekRelationshipTextTaskConfiguration("DeepSeek-V4.1-Flash-1017")).toThrow("deepseek-flash");
    expect(() => deepSeekLoadedRelationshipTextTaskConfiguration("deepseek-flash ")).toThrow("deepseek-flash");
  });

  it("binds an explicit optimizer candidate without changing the loaded baseline", () => {
    const candidate = { ...BASELINE_OPTIMIZATION_CANDIDATE, taskFragmentId: "concise" as const };
    const configured = deepSeekRelationshipTextTaskConfiguration("deepseek-flash", candidate);
    const baseline = deepSeekLoadedRelationshipTextTaskConfiguration("deepseek-flash").configuration;
    expect(configured.parameters).toEqual(candidate);
    expect(configured.configurationId).not.toBe(baseline.configurationId);
    expect(configured.promptContentDigest).toBe(relationshipTaskConfiguration("deepseek-flash", candidate).promptContentDigest);
    expect(configured.runtimePolicyDigest).toBe(baseline.runtimePolicyDigest);
    expect(deepSeekLoadedRelationshipTextTaskConfiguration("deepseek-flash").configuration.parameters)
      .toEqual(BASELINE_OPTIMIZATION_CANDIDATE);
  });

  it("rejects forbidden explicit candidate mutations and unapproved examples", () => {
    expect(() => deepSeekRelationshipTextTaskConfiguration("deepseek-flash", {
      ...BASELINE_OPTIMIZATION_CANDIDATE, tools: ["write"],
    } as typeof BASELINE_OPTIMIZATION_CANDIDATE)).toThrow("OPTIMIZER_FORBIDDEN_MUTATION");
    expect(() => deepSeekRelationshipTextTaskConfiguration("deepseek-flash", {
      ...BASELINE_OPTIMIZATION_CANDIDATE, exampleIds: ["not-approved"],
    })).toThrow("OPTIMIZER_EXAMPLE_NOT_DEV_APPROVED");
  });
});
