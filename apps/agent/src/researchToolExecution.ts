/**
 * Narrow per-invocation FIFO execution for one research Run's tool pipeline.
 *
 * The actual SDK adapter passes tool execute callbacks independently, so two
 * callbacks can be live at once. Every tool execution in one Run runs through
 * this chain: authorization-counter pre-save, gateway dispatch, result
 * checkpoint, and journal append stay strictly ordered and cannot interleave
 * with a concurrent sibling execution or with terminal settlement after the
 * queue is drained. Different Runs use different chains and stay independent.
 *
 * A rejected execution is fatal: it poisons the chain so every later queued
 * execution is blocked without running (and therefore without any gateway or
 * provider dispatch). Returned denial results are ordinary policy outcomes and
 * never poison the chain. This is a small local helper, not a scheduler or a
 * generic reservation framework.
 */

/** A local journal write failed. Never surfaced as a model-visible denial. */
export class ResearchToolWriteError extends Error {
  readonly writeFailure: unknown;

  constructor(writeFailure: unknown) {
    super("A local research journal write failed.");
    this.name = "ResearchToolWriteError";
    this.writeFailure = writeFailure;
  }
}

/** A prior execution failed fatally; this queued execution never ran. */
export class ResearchToolBlockedError extends Error {
  readonly fatalCause: unknown;

  constructor(fatalCause: unknown) {
    super(
      "A prior research tool execution failed fatally; this queued execution was blocked.",
    );
    this.name = "ResearchToolBlockedError";
    this.fatalCause = fatalCause;
  }
}

/** Marks one journal write as fatal when it fails, instead of a denial. */
export async function writeResearchToolState(
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    throw new ResearchToolWriteError(error);
  }
}

export interface ResearchToolExecution {
  /**
   * Runs one tool execution after every previously enqueued execution has
   * settled. Once any execution rejects, later work is blocked without running.
   */
  enqueue<T>(execute: () => Promise<T>): Promise<T>;
  /** Waits until every enqueued execution has settled. Never throws. */
  drain(): Promise<void>;
  /** The first fatal rejected execution, or null while none has failed. */
  failure(): unknown;
}

export function createResearchToolExecution(): ResearchToolExecution {
  let tail: Promise<unknown> = Promise.resolve();
  let fatal: unknown = null;
  let hasFatalFailure = false;
  let pending = 0;

  const enqueue = <T>(execute: () => Promise<T>): Promise<T> => {
    if (hasFatalFailure) {
      const blocked: Promise<T> = Promise.reject(
        new ResearchToolBlockedError(fatal),
      );
      // Callers may ignore a queued execution; keep rejections handled here.
      blocked.catch(() => {});
      return blocked;
    }
    pending += 1;
    const settled = tail.then(() => {
      if (hasFatalFailure) throw new ResearchToolBlockedError(fatal);
      return execute();
    });
    const outcome = settled.then(
      (value) => {
        pending -= 1;
        return value;
      },
      (error) => {
        pending -= 1;
        if (!hasFatalFailure) {
          hasFatalFailure = true;
          fatal = error ?? new Error("A research tool execution failed.");
        }
        throw error;
      },
    );
    tail = outcome.catch(() => {});
    outcome.catch(() => {});
    return outcome;
  };

  const drain = async () => {
    while (pending > 0) {
      await tail;
    }
  };

  return { enqueue, drain, failure: () => fatal };
}
