import { describe, expect, it, vi } from "vitest";

import { createRequestRateLimiter } from "./request-rate-limit";

const WINDOW_MS = 60_000;

function controlledClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(milliseconds: number) {
      current += milliseconds;
    },
    set(milliseconds: number) {
      current = milliseconds;
    },
  };
}

function boundedRetryAfter(retryAfterSeconds: number) {
  expect(Number.isInteger(retryAfterSeconds)).toBe(true);
  expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
  expect(retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000);
}

describe("bounded fixed-window request rate limiter", () => {
  it("admits up to the limit, then rejects with a finite bounded Retry-After", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 3,
      windowMs: WINDOW_MS,
      capacity: 8,
      now: clock.now,
    });

    expect(limiter.consume("caller").allowed).toBe(true);
    expect(limiter.consume("caller").allowed).toBe(true);
    expect(limiter.consume("caller").allowed).toBe(true);

    const denied = limiter.consume("caller");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBe(60);
      boundedRetryAfter(denied.retryAfterSeconds);
    }
  });

  it("keeps the exact fixed-window reset boundary", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      capacity: 4,
      now: clock.now,
    });

    expect(limiter.consume("boundary").allowed).toBe(true);
    clock.advance(WINDOW_MS - 1);
    const stillDenied = limiter.consume("boundary");
    expect(stillDenied.allowed).toBe(false);
    if (!stillDenied.allowed) expect(stillDenied.retryAfterSeconds).toBe(1);

    clock.advance(1);
    expect(limiter.consume("boundary").allowed).toBe(true);
  });

  it("never returns the expired key's budget and starts a fresh window", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 2,
      windowMs: WINDOW_MS,
      capacity: 2,
      now: clock.now,
    });

    expect(limiter.consume("first").allowed).toBe(true);
    expect(limiter.consume("first").allowed).toBe(true);
    expect(limiter.consume("first").allowed).toBe(false);

    // Expiry cleanup on consume evicts the expired entry and frees capacity.
    clock.advance(WINDOW_MS);
    expect(limiter.size()).toBe(1);
    expect(limiter.consume("second").allowed).toBe(true);
    expect(limiter.size()).toBe(1);
    // The new key gets exactly the fresh budget, not a returned one.
    expect(limiter.consume("second").allowed).toBe(true);
    expect(limiter.consume("second").allowed).toBe(false);
  });

  it("fails closed at capacity without evicting an active offender", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 5,
      windowMs: WINDOW_MS,
      capacity: 2,
      now: clock.now,
    });

    expect(limiter.consume("active-one").allowed).toBe(true);
    expect(limiter.consume("active-two").allowed).toBe(true);
    expect(limiter.size()).toBe(2);

    for (let index = 0; index < 200; index += 1) {
      const denied = limiter.consume(`churn-${index}`);
      expect(denied.allowed).toBe(false);
      if (!denied.allowed) boundedRetryAfter(denied.retryAfterSeconds);
    }
    expect(limiter.size()).toBe(2);

    // The active offenders keep their exact remaining budget.
    expect(limiter.consume("active-one").allowed).toBe(true);
    expect(limiter.consume("active-one").allowed).toBe(true);
    expect(limiter.consume("active-one").allowed).toBe(true);
    expect(limiter.consume("active-one").allowed).toBe(true);
    const exhausted = limiter.consume("active-one");
    expect(exhausted.allowed).toBe(false);
  });

  it("cannot be bypassed by key churn", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      capacity: 4,
      now: clock.now,
    });

    let admitted = 0;
    for (let index = 0; index < 1_000; index += 1) {
      if (limiter.consume(`churn-key-${index}`).allowed) admitted += 1;
    }
    expect(admitted).toBe(4);
    expect(limiter.size()).toBe(4);
  });

  it("rejects oversized and invalid identifiers without allocating entries", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 2,
      windowMs: WINDOW_MS,
      capacity: 4,
      maxKeyLength: 32,
      now: clock.now,
    });

    const oversized = limiter.consume("x".repeat(1_000_000));
    expect(oversized.allowed).toBe(false);
    if (!oversized.allowed) boundedRetryAfter(oversized.retryAfterSeconds);
    expect(limiter.consume("").allowed).toBe(false);
    expect(limiter.consume(undefined as unknown as string).allowed).toBe(false);
    expect(limiter.size()).toBe(0);

    // Capacity and budget remain fully available for legitimate identifiers.
    expect(limiter.consume("bounded-key").allowed).toBe(true);
    expect(limiter.consume("bounded-key").allowed).toBe(true);
    expect(limiter.consume("bounded-key").allowed).toBe(false);
  });

  it("rejects admission when the map is full of oversized-key attempts", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 10,
      windowMs: WINDOW_MS,
      capacity: 2,
      maxKeyLength: 16,
      now: clock.now,
    });

    for (let index = 0; index < 50; index += 1) {
      expect(limiter.consume(`oversized-key-${index}-${"y".repeat(100)}`).allowed).toBe(false);
    }
    expect(limiter.size()).toBe(0);
  });

  it("keeps Retry-After finite and bounded while the window drains", () => {
    const clock = controlledClock();
    const limiter = createRequestRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      capacity: 1,
      now: clock.now,
    });

    expect(limiter.consume("drain").allowed).toBe(true);
    const start = 1_700_000_000_000;
    const observed: number[] = [];
    for (const elapsed of [0, 15_000, 30_000, 59_999]) {
      clock.set(start + elapsed);
      const denied = limiter.consume("drain");
      expect(denied.allowed).toBe(false);
      if (!denied.allowed) {
        boundedRetryAfter(denied.retryAfterSeconds);
        observed.push(denied.retryAfterSeconds);
      }
    }
    expect(observed[0]).toBe(60);
    expect(observed.at(-1)).toBe(1);
  });

  it("rejects invalid factory options", () => {
    expect(() =>
      createRequestRateLimiter({ limit: 0, windowMs: WINDOW_MS, capacity: 1 }),
    ).toThrow();
    expect(() =>
      createRequestRateLimiter({ limit: 1, windowMs: 0, capacity: 1 }),
    ).toThrow();
    expect(() =>
      createRequestRateLimiter({ limit: 1, windowMs: WINDOW_MS, capacity: 0 }),
    ).toThrow();
    expect(() =>
      createRequestRateLimiter({
        limit: 1,
        windowMs: WINDOW_MS,
        capacity: 1,
        maxKeyLength: 0,
      }),
    ).toThrow();
  });

  it("creates no timers for cleanup", () => {
    const clock = controlledClock();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const limiter = createRequestRateLimiter({
        limit: 2,
        windowMs: WINDOW_MS,
        capacity: 2,
        now: clock.now,
      });
      limiter.consume("timer-free");
      clock.advance(WINDOW_MS * 2);
      limiter.consume("timer-free");
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  });

  it("rejects a nonfinite clock before evicting, counting, or allocating", () => {
    let current = Number.NaN;
    const limiter = createRequestRateLimiter({
      limit: 2,
      windowMs: WINDOW_MS,
      capacity: 2,
      now: () => current,
    });

    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      current = bad;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const denied = limiter.consume("guarded");
        expect(denied.allowed).toBe(false);
        if (!denied.allowed) {
          boundedRetryAfter(denied.retryAfterSeconds);
          expect(denied.retryAfterSeconds).toBe(60);
        }
      }
    }
    expect(limiter.size()).toBe(0);
  });

  it("keeps consumed buckets across a nonfinite clock and never refunds allowance", () => {
    let current = 1_700_000_000_000;
    const limiter = createRequestRateLimiter({
      limit: 2,
      windowMs: WINDOW_MS,
      capacity: 2,
      now: () => current,
    });

    expect(limiter.consume("kept").allowed).toBe(true);
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      current = bad;
      expect(limiter.consume("kept").allowed).toBe(false);
    }
    expect(limiter.size()).toBe(1);

    // Back to a valid clock: the invalid-clock attempts neither refunded nor
    // consumed the bucket's allowance.
    current = 1_700_000_000_000;
    expect(limiter.consume("kept").allowed).toBe(true);
    const exhausted = limiter.consume("kept");
    expect(exhausted.allowed).toBe(false);
    if (!exhausted.allowed) boundedRetryAfter(exhausted.retryAfterSeconds);
  });

  it("rejects a computed resetAt overflow without allocating", () => {
    const limiter = createRequestRateLimiter({
      limit: 2,
      windowMs: Number.MAX_VALUE,
      capacity: 2,
      now: () => Number.MAX_VALUE,
    });

    const denied = limiter.consume("overflow");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(Number.isFinite(denied.retryAfterSeconds)).toBe(true);
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(
        Math.ceil(Number.MAX_VALUE / 1000),
      );
    }
    expect(limiter.size()).toBe(0);
  });

  it("is deterministic under an injected clock", () => {
    const clock = controlledClock();
    const options = {
      limit: 2,
      windowMs: WINDOW_MS,
      capacity: 2,
      now: clock.now,
    };
    const first = createRequestRateLimiter(options);
    const second = createRequestRateLimiter(options);
    const decisions: Array<ReturnType<typeof first.consume>> = [];
    for (const step of [0, 1, 2, 3, 60_000, 60_001]) {
      clock.set(1_700_000_000_000 + step);
      decisions.push(first.consume("same"));
      expect(second.consume("same")).toEqual(decisions.at(-1));
    }
    expect(decisions.map((decision) => decision.allowed)).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
  });
});
