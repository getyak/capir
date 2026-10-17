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

// Frozen values captured from the GET-18 worktree baseline (commit
// 0ad5d212b41dbbb91a2851fa15ce16beccdd5a40) before any seam work. GLM
// optimization must never shift these digests implicitly; a deliberate prompt
// or policy change has to re-freeze them in review.
describe("frozen GLM relationship task configuration", () => {
  it("keeps the loaded glm-4.7 baseline configuration unchanged", () => {
    expect(loadedRelationshipTaskConfiguration("glm-4.7")).toEqual({
      configuration: {
        configurationId: "candidate-2763dc072ce561fa1de935be",
        model: "glm-4.7",
        promptRevision: "dee0ad167e62a756",
        promptContentDigest: "sha256:dee0ad167e62a756e30b6ba5dc1c5754d6d3783f407109af0e06b01927fd4b9d",
        runtimePolicyDigest: "sha256:ebc988f63edfaaac2e584880a46242ef7a31c4427d5fecec01ebda499fe3fd6a",
        parameters: { schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: [] },
      },
      taskConfigurationDigest: "sha256:a293172c64870681fb747294162c694cc0ba1779f833e5306630216b2af698b6",
    });
  });

  it("keeps the loaded glm-5.3 and timeout-dependent digests unchanged", () => {
    expect(loadedRelationshipTaskConfiguration("glm-5.3")).toEqual({
      configuration: {
        configurationId: "candidate-2763dc072ce561fa1de935be",
        model: "glm-5.3",
        promptRevision: "dee0ad167e62a756",
        promptContentDigest: "sha256:dee0ad167e62a756e30b6ba5dc1c5754d6d3783f407109af0e06b01927fd4b9d",
        runtimePolicyDigest: "sha256:e072760ad36c2ab2b515731173745819a2875c95cf839403aab93ac855be81af",
        parameters: { schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: [] },
      },
      taskConfigurationDigest: "sha256:157e1993058d65923f39665d5838fe6b16fe470b5471234a716121457cf376a0",
    });
    expect(loadedRelationshipTaskConfiguration("glm-4.7", 30000).taskConfigurationDigest)
      .toBe("sha256:28d214146e56c6486e2594cdc2d5c8c90040663db5f13fdb89383c021f888eae");
    expect(loadedRelationshipTaskConfiguration("glm-5.3", 30000).taskConfigurationDigest)
      .toBe("sha256:4711de7f181aa85675d9f1a0b7fba0ec751b4a767da7bbd564de29ed829b7d59");
  });

  it("keeps the loaded relationship prompt and the GLM reasoning gate unchanged", () => {
    expect(loadedRelationshipTaskPrompt().revision)
      .toBe("dee0ad167e62a756e30b6ba5dc1c5754d6d3783f407109af0e06b01927fd4b9d");
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
      promptRevision: "dee0ad167e62a756",
      promptContentDigest: "sha256:dee0ad167e62a756e30b6ba5dc1c5754d6d3783f407109af0e06b01927fd4b9d",
      runtimePolicyDigest: "sha256:96b432901223c8341d512dc3e8d8d89ebbb62251b610dca0b2a27fc4e467b53e",
      parameters: { schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: [] },
    });
    expect(loaded.taskConfigurationDigest).toBe("sha256:05b15a42bd9e5ea74162471f1c85ae0e2e8e91f65b72e0bdff238011a571e718");
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
});
