import { describe, expect, it } from "vitest";

import {
  createResearchToolExecution,
  ResearchToolBlockedError,
  ResearchToolWriteError,
  writeResearchToolState,
} from "./researchToolExecution.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("research tool execution FIFO chain", () => {
  it("runs one execution at a time in enqueue order", async () => {
    const execution = createResearchToolExecution();
    const order: string[] = [];
    const started = deferred();
    const release = deferred();
    const first = execution.enqueue(async () => {
      order.push("first-start");
      started.resolve();
      await release.promise;
      order.push("first-end");
      return 1;
    });
    const second = execution.enqueue(async () => {
      order.push("second");
      return 2;
    });
    await started.promise;
    expect(order).toEqual(["first-start"]);
    release.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(execution.failure()).toBeNull();
  });

  it("blocks queued and later executions after a fatal rejection", async () => {
    const execution = createResearchToolExecution();
    const started = deferred();
    const release = deferred();
    const fatal = new Error("Synthetic journal write failure.");
    let queuedRan = false;
    let lateRan = false;
    const first = execution.enqueue(async () => {
      started.resolve();
      await release.promise;
      throw fatal;
    });
    const queued = execution.enqueue(async () => {
      queuedRan = true;
      return "queued";
    });
    await started.promise;
    const late = execution.enqueue(async () => {
      lateRan = true;
      return "late";
    });
    release.resolve();
    await expect(first).rejects.toBe(fatal);
    await expect(queued).rejects.toBeInstanceOf(ResearchToolBlockedError);
    await expect(late).rejects.toBeInstanceOf(ResearchToolBlockedError);
    expect(queuedRan).toBe(false);
    expect(lateRan).toBe(false);
    expect(execution.failure()).toBe(fatal);
  });

  it("keeps returned denial results from blocking later executions", async () => {
    const execution = createResearchToolExecution();
    const first = execution.enqueue(async () => ({ ok: false }));
    const second = execution.enqueue(async () => "ran");
    await expect(first).resolves.toEqual({ ok: false });
    await expect(second).resolves.toBe("ran");
    expect(execution.failure()).toBeNull();
  });

  it.each([null, undefined])(
    "blocks queued and later work after a nullish rejection (%s)",
    async (rejection) => {
      const execution = createResearchToolExecution();
      const release = deferred();
      let laterCalls = 0;
      const first = execution.enqueue(async () => {
        await release.promise;
        throw rejection;
      });
      const queued = execution.enqueue(async () => { laterCalls += 1; });
      release.resolve();
      await expect(first).rejects.toBe(rejection);
      await expect(queued).rejects.toBeInstanceOf(ResearchToolBlockedError);
      await execution.drain();
      const firstFailure = execution.failure();
      expect(firstFailure).toBeInstanceOf(Error);
      await expect(execution.enqueue(async () => { laterCalls += 1; }))
        .rejects.toBeInstanceOf(ResearchToolBlockedError);
      await execution.drain();
      expect(execution.failure()).toBe(firstFailure);
      expect(laterCalls).toBe(0);
    },
  );

  it.each([null, undefined])(
    "records a nullish rejection without queued siblings (%s)",
    async (rejection) => {
      const execution = createResearchToolExecution();
      await expect(execution.enqueue(async () => { throw rejection; }))
        .rejects.toBe(rejection);
      await execution.drain();
      expect(execution.failure()).toBeInstanceOf(Error);
      let ran = false;
      await expect(execution.enqueue(async () => { ran = true; }))
        .rejects.toBeInstanceOf(ResearchToolBlockedError);
      expect(ran).toBe(false);
    },
  );

  it("drains in-flight and queued work before settling", async () => {
    const execution = createResearchToolExecution();
    const started = deferred();
    const release = deferred();
    void execution.enqueue(async () => {
      started.resolve();
      await release.promise;
    });
    const queued = execution.enqueue(async () => "second");
    await started.promise;
    let drained = false;
    const draining = execution.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    release.resolve();
    await draining;
    expect(drained).toBe(true);
    await expect(queued).resolves.toBe("second");
  });

  it("drains settled failures and accepts later blocked enqueues", async () => {
    const execution = createResearchToolExecution();
    const fatal = new Error("Synthetic journal write failure.");
    await expect(execution.enqueue(async () => {
      throw fatal;
    })).rejects.toBe(fatal);
    await execution.drain();
    expect(execution.failure()).toBe(fatal);
    await expect(execution.enqueue(async () => "late")).rejects.toBeInstanceOf(
      ResearchToolBlockedError,
    );
  });

  it("marks failed journal writes fatal instead of denials", async () => {
    await expect(
      writeResearchToolState(async () => {
        throw new Error("Synthetic checkpoint write failure.");
      }),
    ).rejects.toBeInstanceOf(ResearchToolWriteError);
    await expect(writeResearchToolState(async () => {})).resolves.toBeUndefined();
  });
});
