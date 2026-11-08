/** One request owner serializes database work, never its provider await. A
 * rejected operation cannot poison the tail or leave later cleanup blocked. */
export function createLegacyChatOwnerGate() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

/** Called from the frozen answer method, after the outer provider prechecks.
 * A poll must fully drain before this resolves/rejects to those postchecks:
 * LegacyChatAuthority has one active-client slot, not async-local reentrancy.
 * Neither polling nor a lost HTTP connection authorizes another model call. */
export async function runLegacyChatAnswerWindow<T>(input: {
  answer: () => Promise<T>;
  poll: () => Promise<void>;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<T> {
  input.signal.throwIfAborted();
  const interval = input.intervalMs ?? 5_000;
  if (!Number.isFinite(interval) || interval <= 0) throw new Error("LEGACY_CHAT_POLL_INTERVAL_INVALID");
  let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let rejectFailure!: (reason: unknown) => void;
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  const abort = () => rejectFailure(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  // The listener and the first delegate call have no intervening await.
  if (input.signal.aborted) { input.signal.removeEventListener("abort", abort); throw input.signal.reason; }
  const schedule = () => {
    if (closed) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      active = Promise.resolve().then(input.poll).then(() => {
        active = undefined;
        schedule(); // Delay after completion: there is never a second poll in flight.
      }, error => {
        active = undefined;
        closed = true;
        rejectFailure(error);
      });
    }, interval);
    timer.unref?.();
  };
  try {
    // Promise.race attaches rejection handlers even if an ignored cancellation
    // makes the provider settle much later. Its late value is never delivered.
    const answer = Promise.resolve().then(() => {
      input.signal.throwIfAborted();
      return input.answer();
    });
    schedule();
    return await Promise.race([answer, failed]);
  } finally {
    closed = true;
    if (timer) clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
    await active;
  }
}
