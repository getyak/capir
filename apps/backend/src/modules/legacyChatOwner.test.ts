import { describe, expect, it } from "vitest";
import { createLegacyChatOwnerGate, runLegacyChatAnswerWindow } from "./legacyChatOwner.js";

function barrier<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("answer-only owner scheduling", () => {
  it("serializes database work without keeping the gate while the answer waits", async () => {
    const gate = createLegacyChatOwnerGate(), entered = barrier(), release = barrier();
    const first = gate(async () => { entered.resolve(); await release.promise; return "first"; });
    await entered.promise;
    let secondEntered = false;
    const second = gate(async () => { secondEntered = true; return "second"; });
    await Promise.resolve();
    expect(secondEntered).toBe(false);
    release.resolve();
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    const answer = barrier<string>(), answering = barrier();
    const result = runLegacyChatAnswerWindow({
      answer: () => { answering.resolve(); return answer.promise; },
      poll: () => gate(async () => {}), signal: new AbortController().signal, intervalMs: 60_000,
    });
    await answering.promise;
    expect(await gate(async () => "heartbeat")).toBe("heartbeat");
    answer.resolve("answer");
    expect(await result).toBe("answer");
  });

  it.each(["resolve", "reject", "abort"] as const)("drains a borrowed poll before %s reaches provider postchecks", async how => {
    const pollEntered = barrier(), pollRelease = barrier(), answer = barrier<string>();
    const controller = new AbortController();
    let drained = false, returned = false, calls = 0;
    const result = runLegacyChatAnswerWindow({
      answer: async () => { calls++; const value = await answer.promise; if (how === "reject") throw new Error("synthetic answer failed"); return value; },
      poll: async () => { pollEntered.resolve(); await pollRelease.promise; drained = true; },
      signal: controller.signal, intervalMs: 1,
    }).finally(() => { returned = true; });
    // Consume every rejection before releasing controlled work.
    const observed = result.then(value => ({ value }), error => ({ error }));
    await pollEntered.promise;
    if (how === "abort") controller.abort(new Error("synthetic owner stopped"));
    else answer.resolve("synthetic answer");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(returned).toBe(false);
    pollRelease.resolve();
    const settled = await observed;
    expect(drained).toBe(true);
    expect(calls).toBe(1);
    if (how === "resolve") expect(settled).toEqual({ value: "synthetic answer" });
    else expect(settled).toHaveProperty("error");
    // A provider that ignored cancellation cannot return a later value.
    if (how === "abort") answer.resolve("too late");
  });

  it("does not overlap polls or start one after the answer settles", async () => {
    const entered = barrier(), release = barrier(), answer = barrier<string>();
    let active = 0, maxActive = 0, count = 0;
    const result = runLegacyChatAnswerWindow({ answer: () => answer.promise,
      poll: async () => { count++; maxActive = Math.max(maxActive, ++active); entered.resolve(); await release.promise; active--; },
      signal: new AbortController().signal, intervalMs: 1 });
    await entered.promise;
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(count).toBe(1);
    answer.resolve("done"); release.resolve();
    expect(await result).toBe("done");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(maxActive).toBe(1); expect(count).toBe(1);
  });

  it("fails the answer window on a poll failure, without replaying the answer", async () => {
    const answer = barrier<string>(); let calls = 0;
    const failure = new Error("synthetic owner fence failed");
    await expect(runLegacyChatAnswerWindow({ answer: () => { calls++; return answer.promise; },
      poll: async () => { throw failure; }, signal: new AbortController().signal, intervalMs: 1 })).rejects.toBe(failure);
    expect(calls).toBe(1); answer.resolve("too late");
  });

  it("never starts the delegate for an already stopped owner", async () => {
    const controller = new AbortController(); controller.abort(new Error("synthetic stop")); let calls = 0;
    await expect(runLegacyChatAnswerWindow({ answer: async () => { calls++; return "wrong"; },
      poll: async () => {}, signal: controller.signal, intervalMs: 1 })).rejects.toBe(controller.signal.reason);
    expect(calls).toBe(0);
  });
});
