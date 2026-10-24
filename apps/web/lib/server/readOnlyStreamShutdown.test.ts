import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readOnlyStreamShutdownSignal } from "./readOnlyStreamShutdown";

describe("read-only Web subscription shutdown", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("aborts on %s without replacing the server's own listener", (event) => {
    const signals = new EventEmitter();
    let serverCleanup = 0;
    signals.on(event, () => { serverCleanup++; });
    const signal = readOnlyStreamShutdownSignal(signals, {});
    expect(signal.aborted).toBe(false);
    signals.emit(event);
    expect(serverCleanup).toBe(1);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe("AbortError");
  });

  it("registers only once across independently loaded routes in one process scope", () => {
    const signals = new EventEmitter(); const scope = {};
    const first = readOnlyStreamShutdownSignal(signals, scope);
    expect(readOnlyStreamShutdownSignal(signals, scope)).toBe(first);
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    expect(signals.listenerCount("SIGINT")).toBe(1);
    signals.emit("SIGTERM");
    expect(readOnlyStreamShutdownSignal(signals, scope).aborted).toBe(true);
    signals.emit("SIGINT");
    expect(first.aborted).toBe(true);
  });

  it("keeps a different process scope live", () => {
    const terminating = new EventEmitter(); const live = new EventEmitter();
    const old = readOnlyStreamShutdownSignal(terminating, {});
    const next = readOnlyStreamShutdownSignal(live, {});
    terminating.emit("SIGTERM");
    expect(old.aborted).toBe(true);
    expect(next.aborted).toBe(false);
  });
});
