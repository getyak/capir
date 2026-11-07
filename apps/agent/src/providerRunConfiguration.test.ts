import { describe, expect, it } from "vitest";
import { snapshotProviderRunConfiguration } from "./providerRunConfiguration.js";

describe("provider reasoning snapshot", () => {
  it.each(["explicit", "omitted"] as const)("captures and validates nested accessor values exactly once: %s", mode => {
    const reads = { version: 0, reasoning: 0, mode: 0, effort: 0 };
    const reasoning = {
      get mode() { reads.mode += 1; return reads.mode === 1 ? mode : "invalid-later-value"; },
    };
    if (mode === "explicit") Object.defineProperty(reasoning, "effort", { enumerable: true,
      get() { reads.effort += 1; return reads.effort === 1 ? "low" : "invalid-later-value"; } });
    const input = { get version() { reads.version += 1; return "agent-run-reasoning.v1"; },
      get reasoning() { reads.reasoning += 1; return reasoning; } };
    const captured = snapshotProviderRunConfiguration(input);
    expect(captured).toEqual({ version: "agent-run-reasoning.v1", reasoning: mode === "explicit" ? { mode: "explicit", effort: "low" } : { mode: "omitted" } });
    expect(reads).toEqual({ version: 1, reasoning: 1, mode: 1, effort: mode === "explicit" ? 1 : 0 });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.reasoning)).toBe(true);
  });

  it("does not echo a nested accessor failure", () => {
    const input = { version: "agent-run-reasoning.v1", get reasoning() { throw new Error("private accessor error"); } };
    expect(() => snapshotProviderRunConfiguration(input)).toThrow("AGENT_PROVIDER_RUN_CONFIGURATION_INVALID");
  });
});
