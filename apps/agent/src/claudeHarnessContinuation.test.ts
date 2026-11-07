import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runClaudeHarness, type ClaudeHarnessRequest } from "./claudeHarness.js";
import { harnessContinuationFingerprint, type HarnessContinuation } from "./claudeHarnessContinuation.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";

const configuration = claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic-key", TALENT_SIGNAL_AGENT_MODEL: "synthetic-model" });
const request: ClaudeHarnessRequest = { objective: "Synthetic follow-up", systemPrompt: "Synthetic system", tools: [],
  assertCurrent: async () => {}, budget: { maxTurns: 3, maxToolCalls: 3, maxDurationMs: 5000, maxTaskTokens: 1000, maxEstimatedUsd: 1 } };
function lease(resume = false): HarnessContinuation {
  return { sessionID: randomUUID(), resume, store: { append: vi.fn(), load: vi.fn(), delete: vi.fn(), listSubkeys: vi.fn() },
    assertCurrent: vi.fn(async () => {}), finish: vi.fn(async () => {}) };
}
function sdk(session: HarnessContinuation, before?: (options: any) => Promise<void>, mirrorFailure = false) {
  return vi.fn(({ options }) => ({ close: vi.fn(), async *[Symbol.asyncIterator]() {
    await before?.(options);
    if (mirrorFailure) yield { type: "system", subtype: "mirror_error", error: "Synthetic failure" };
    else yield { type: "result", subtype: "success", result: "Synthetic answer", is_error: false,
      modelUsage: { synthetic: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
      total_cost_usd: 0.001, num_turns: 1, session_id: session.sessionID, permission_denials: [] };
  } }));
}

describe("host-issued SDK continuation", () => {
  it("uses the exact leased identity and removes local copies before releasing it", async () => {
    for (const resume of [false, true]) {
      const session = lease(resume);
      let directory = "";
      session.finish = vi.fn(async completed => { expect(completed).toBe(true); await expect(access(directory)).rejects.toThrow(); });
      const query = sdk(session, async options => {
        directory = options.cwd; await access(directory);
        expect(options.persistSession).toBe(true);
        const key = { projectKey: "synthetic-project", sessionId: session.sessionID };
        await options.sessionStore.load(key);
        expect(session.store.load).toHaveBeenCalledWith(key);
        expect(options.resume).toBe(resume ? session.sessionID : undefined);
        expect(options.sessionId).toBe(resume ? undefined : session.sessionID);
        expect(options.env.CLAUDE_CONFIG_DIR.startsWith(directory)).toBe(true);
      });
      await runClaudeHarness(configuration, { ...request, continuation: async () => session }, new AbortController().signal, query as any);
      expect(session.finish).toHaveBeenCalledOnce();
    }
  });
  it("fails mirroring and revoked generations without reporting a completed continuation", async () => {
    const session = lease();
    const query = sdk(session, undefined, true);
    await expect(runClaudeHarness(configuration, { ...request, continuation: async () => session }, new AbortController().signal, query as any)).rejects.toThrow("SESSION_MIRROR_FAILED");
    expect(session.finish).toHaveBeenCalledWith(false);
    const revoked = lease();
    revoked.assertCurrent = vi.fn(async () => { throw new Error("GENERATION_REVOKED"); });
    const never = sdk(revoked);
    await expect(runClaudeHarness(configuration, { ...request, continuation: async () => revoked }, new AbortController().signal, never as any)).rejects.toThrow("GENERATION_REVOKED");
    expect(never).not.toHaveBeenCalled();
    expect(revoked.finish).toHaveBeenCalledWith(false);
  });
  it("never turns a failed store finalization into a successful product reply", async () => {
    const session = lease();
    session.finish = vi.fn(async () => { throw new Error("SESSION_STORE_UNAVAILABLE"); });
    await expect(runClaudeHarness(configuration, { ...request, continuation: async () => session }, new AbortController().signal, sdk(session) as any)).rejects.toThrow("SESSION_STORE_UNAVAILABLE");
  });
  it("binds continuation to prompt, model endpoint and credential rotation", () => {
    const fingerprint = harnessContinuationFingerprint(configuration, request);
    expect(harnessContinuationFingerprint({ ...configuration, httpsProxy: "http://127.0.0.1:18080/" }, request)).not.toBe(fingerprint);
    expect(harnessContinuationFingerprint(configuration, { ...request, objective: "Next turn" })).toBe(fingerprint);
    expect(harnessContinuationFingerprint(configuration, { ...request, systemPrompt: "Changed policy" })).not.toBe(fingerprint);
    expect(harnessContinuationFingerprint(configuration, { ...request, effort: "medium" })).not.toBe(fingerprint);
    expect(harnessContinuationFingerprint(configuration, { ...request, effort: "high" })).not.toBe(fingerprint);
    expect(harnessContinuationFingerprint({ ...configuration, credential: { ...configuration.credential, value: "rotated-synthetic-key" } }, request)).not.toBe(fingerprint);
    expect(fingerprint).not.toContain("synthetic-key");
  });
});
