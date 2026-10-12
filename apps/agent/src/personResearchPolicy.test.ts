import { describe, expect, it } from "vitest";

import {
  assertPersonResearchRunInputs,
  AgentPersonResearchPolicyError,
} from "./personResearchPolicy.js";
import { AGENT_BUDGET_CEILING, DEFAULT_AGENT_BUDGET } from "./runner.js";
import type {
  AgentBudget,
  AgentPersonResearchGateway,
  AgentPersonResearchJournal,
  AgentPersonResearchRunRequest,
  AgentPersonResearchScope,
  AgentProvider,
  AgentProviderInputPart,
} from "./types.js";

const imageArtifact = {
  artifactID: "image-1",
  kind: "image" as const,
  mimeType: "image/png",
  byteSize: 128,
  contentHash: "a".repeat(64),
};

const scope: AgentPersonResearchScope = {
  runID: "66666666-6666-4666-8666-666666666666",
  objective: "Find possible public profiles from visible screenshot clues.",
  providerID: "tikhub",
  authorization: {
    purpose: "person_public_profile_research",
    accessMode: "visible_screenshot_identity_clues",
    allowedPlatforms: ["douyin", "tiktok", "weibo", "threads"],
    maximumProviderCalls: 2,
    maximumResultsPerCall: 5,
  },
  inputArtifactManifest: [imageArtifact],
} as const;

const inputParts = [{ ...imageArtifact, dataBase64: "cG5n" }];

function provider(imageUnderstanding = true): AgentProvider {
  return {
    id: "synthetic-vision",
    model: "synthetic-vision-v1",
    sdkVersion: "synthetic.v1",
    inputCapabilities: { text: true, image: true, imageUnderstanding },
    run: async () => {
      throw new Error("A policy assertion never dispatches a provider.");
    },
  };
}

/** Preflight runs before any gateway or journal work; these stay unused. */
const unusedGateway = {} as AgentPersonResearchGateway;
const unusedJournal = {} as AgentPersonResearchJournal;

function request(
  overrides: {
    budget?: AgentBudget;
    scope?: Partial<AgentPersonResearchScope>;
    provider?: AgentProvider;
    providerInputParts?: readonly AgentProviderInputPart[];
  } = {},
): AgentPersonResearchRunRequest {
  return {
    scope: { ...scope, ...overrides.scope },
    budget: overrides.budget ?? { ...DEFAULT_AGENT_BUDGET },
    provider: overrides.provider ?? provider(),
    gateway: unusedGateway,
    journal: unusedJournal,
    providerInputParts: overrides.providerInputParts ?? inputParts,
  };
}

describe("person-research run preflight policy", () => {
  it("accepts the governed screenshot input, budget, and scope as ordered", () => {
    expect(() => assertPersonResearchRunInputs(request())).not.toThrow();
  });

  it("rejects invalid budgets with the fixed budget diagnostic", () => {
    for (const budget of [
      { ...DEFAULT_AGENT_BUDGET, maxTurns: 0 },
      { ...DEFAULT_AGENT_BUDGET, maxToolCalls: -1 },
      { ...DEFAULT_AGENT_BUDGET, maxTaskTokens: Number.NaN },
      {
        ...DEFAULT_AGENT_BUDGET,
        maxDurationMs: AGENT_BUDGET_CEILING.maxDurationMs + 1,
      },
    ]) {
      expect(() => assertPersonResearchRunInputs(request({ budget }))).toThrow(
        AgentPersonResearchPolicyError,
      );
      try {
        assertPersonResearchRunInputs(request({ budget }));
      } catch (error) {
        expect(error).toMatchObject({
          code: "AGENT_BUDGET_INVALID",
          message: expect.stringContaining("must be positive and no greater than the Agent ceiling."),
        });
      }
    }
  });

  it("keeps budget, image, and scope order exactly as the runner enforces it", () => {
    // A bad budget wins over a bad image, and a bad image wins over a bad scope.
    try {
      assertPersonResearchRunInputs(
        request({
          budget: { ...DEFAULT_AGENT_BUDGET, maxTurns: 0 },
          scope: { inputArtifactManifest: [], runID: " " },
          providerInputParts: [],
        }),
      );
      expect.unreachable("preflight must reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "AGENT_BUDGET_INVALID" });
    }
    try {
      assertPersonResearchRunInputs(
        request({
          scope: { inputArtifactManifest: [], runID: " " },
          providerInputParts: [],
        }),
      );
      expect.unreachable("preflight must reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "PERSON_RESEARCH_IMAGE_REQUIRED" });
    }
    try {
      assertPersonResearchRunInputs(
        request({
          providerInputParts: [{ ...inputParts[0]!, contentHash: "c".repeat(64) }],
        }),
      );
      expect.unreachable("preflight must reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "PERSON_RESEARCH_IMAGE_INVALID" });
    }
    try {
      assertPersonResearchRunInputs(
        request({
          provider: provider(false),
          scope: { runID: " " },
        }),
      );
      expect.unreachable("preflight must reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "PERSON_RESEARCH_VISION_PROVIDER_REQUIRED" });
    }
    try {
      assertPersonResearchRunInputs(request({ scope: { runID: " " } }));
      expect.unreachable("preflight must reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "PERSON_RESEARCH_SCOPE_INVALID" });
    }
  });

  it("rejects malformed screenshot artifacts with the fixed image diagnostics", () => {
    const cases: Array<[Parameters<typeof request>[0], string]> = [
      [
        { scope: { inputArtifactManifest: [] }, providerInputParts: [] },
        "PERSON_RESEARCH_IMAGE_REQUIRED",
      ],
      [
        { providerInputParts: [{ ...inputParts[0]!, dataBase64: "" }] },
        "PERSON_RESEARCH_IMAGE_INVALID",
      ],
      [
        {
          scope: {
            inputArtifactManifest: [{ ...imageArtifact, mimeType: "image/gif" }],
          },
          providerInputParts: [{ ...inputParts[0]!, mimeType: "image/gif" }],
        },
        "PERSON_RESEARCH_IMAGE_INVALID",
      ],
      [
        {
          scope: { inputArtifactManifest: [{ ...imageArtifact, byteSize: 0 }] },
          providerInputParts: [{ ...inputParts[0]!, byteSize: 0 }],
        },
        "PERSON_RESEARCH_IMAGE_INVALID",
      ],
      [
        {
          scope: { inputArtifactManifest: [{ ...imageArtifact, contentHash: "A".repeat(64) }] },
          providerInputParts: [{ ...inputParts[0]!, contentHash: "A".repeat(64) }],
        },
        "PERSON_RESEARCH_IMAGE_INVALID",
      ],
      [{ provider: provider(false) }, "PERSON_RESEARCH_VISION_PROVIDER_REQUIRED"],
    ];
    for (const [overrides, code] of cases) {
      try {
        assertPersonResearchRunInputs(request(overrides));
        expect.unreachable("preflight must reject");
      } catch (error) {
        expect(error).toMatchObject({ code });
      }
    }
  });

  it("rejects empty scope identity before any journal or provider work", () => {
    for (const scopePatch of [{ runID: " " }, { objective: "" }, { providerID: " " }]) {
      try {
        assertPersonResearchRunInputs(request({ scope: scopePatch }));
        expect.unreachable("preflight must reject");
      } catch (error) {
        expect(error).toMatchObject({ code: "PERSON_RESEARCH_SCOPE_INVALID" });
      }
    }
  });
});
