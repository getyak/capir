/**
 * Shared bounded fixed-window request rate limiter.
 *
 * - Admits at most `limit` consumes per key per `windowMs` fixed window.
 * - Tracks at most `capacity` keys (hard maximum); expired entries are evicted
 *   lazily on consume, so no permanent timers are created and an active
 *   offender is never evicted to make room for a new key.
 * - At full capacity new keys fail closed with a finite, bounded Retry-After
 *   until some tracked entry expires; churning fresh keys cannot bypass.
 * - Invalid or oversized identifiers are rejected without allocating any map
 *   entry.
 *
 * The limiter is per process only: it holds no shared or distributed state.
 * A multi-process or multi-host deployment needs its own trusted edge control
 * instead of relying on this budget.
 */

export interface RequestRateLimiterOptions {
  /** Maximum admitted consumes per key per window. */
  limit: number;
  /** Fixed window length in milliseconds. */
  windowMs: number;
  /** Hard maximum number of tracked keys. */
  capacity: number;
  /** Maximum accepted identifier length; longer identifiers are rejected. */
  maxKeyLength?: number;
  /** Deterministic clock injection for tests; defaults to Date.now. */
  now?: () => number;
}

export type RequestRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Finite bounded seconds until the next admission may be possible. */
      retryAfterSeconds: number;
    };

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_KEY_LENGTH = 256;

export function createRequestRateLimiter(options: RequestRateLimiterOptions) {
  const { limit, windowMs, capacity } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("request rate limit requires a positive integer limit");
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("request rate limit requires a positive integer windowMs");
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("request rate limit requires a positive integer capacity");
  }
  const maxKeyLength =
    options.maxKeyLength === undefined
      ? DEFAULT_MAX_KEY_LENGTH
      : options.maxKeyLength;
  if (!Number.isInteger(maxKeyLength) || maxKeyLength < 1) {
    throw new Error(
      "request rate limit requires a positive integer maxKeyLength",
    );
  }
  // Resolved at consume time so test clock injection and Date fakes apply.
  const now = options.now ?? (() => Date.now());
  const maximumRetryAfterSeconds = Math.ceil(windowMs / 1000);
  const entries = new Map<string, RateLimitEntry>();

  function boundedRetryAfterSeconds(delayMs: number): number {
    const seconds = Math.ceil(Math.max(0, delayMs) / 1000);
    return Math.min(Math.max(1, seconds), maximumRetryAfterSeconds);
  }

  function deny(delayMs: number): RequestRateLimitDecision {
    return { allowed: false, retryAfterSeconds: boundedRetryAfterSeconds(delayMs) };
  }

  function evictExpired(currentTime: number) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }
  }

  function nextExpiryDelay(currentTime: number): number {
    let delay = windowMs;
    for (const entry of entries.values()) {
      const candidate = entry.resetAt - currentTime;
      if (candidate > 0 && candidate < delay) delay = candidate;
    }
    return delay;
  }

  return {
    consume(key: string): RequestRateLimitDecision {
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > maxKeyLength
      ) {
        // Reject without allocating a map entry for hostile identifiers.
        return deny(windowMs);
      }
      const currentTime = now();
      const nextResetAt = currentTime + windowMs;
      if (!Number.isFinite(currentTime) || !Number.isFinite(nextResetAt)) {
        // A nonfinite clock cannot expire anything deterministically. Fail
        // closed with a finite configured-window retry before evicting,
        // counting, or allocating, so existing consumed buckets stay intact.
        return deny(windowMs);
      }
      evictExpired(currentTime);
      const entry = entries.get(key);
      if (entry !== undefined) {
        if (entry.count >= limit) return deny(entry.resetAt - currentTime);
        entry.count += 1;
        return { allowed: true };
      }
      if (entries.size >= capacity) {
        // Fail closed: never evict an active offender to admit a new key.
        return deny(nextExpiryDelay(currentTime));
      }
      entries.set(key, { count: 1, resetAt: nextResetAt });
      return { allowed: true };
    },
    /** Current tracked key count; bounded by capacity. */
    size(): number {
      return entries.size;
    },
  };
}

export type RequestRateLimiter = ReturnType<typeof createRequestRateLimiter>;
