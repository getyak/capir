/**
 * Entry verdict policy over settled run-dataset state: zero counts are only
 * "verified empty" after the dataset settled to ready. Covers the
 * already-settled empty case, delayed verification, mismatched seed counts
 * and the failed-dataset negative case the review called out.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import {
  evaluateEntryVerification,
  evaluateSandboxEntryVerification,
  evaluateTestEntryVerification,
} from "../dist/runner.js";
import { sampleEntryDom } from "../dist/browser-runner.js";

const EXPIRES = "2026-10-01T12:00:00.000Z";

const observation = (overrides = {}) => ({
  banner_state: "active",
  demo_expiry: EXPIRES,
  dataset_state: "ready",
  dataset_counts: { contacts: 0, observations: 0, tasks: 0 },
  ...overrides,
});

describe("settled run-dataset entry verification", () => {
  it("samples hydration state and rendered counts in one browser-side DOM turn", async () => {
    const phases = [
      { state: "loading", counts: { contacts: 0, observations: 0, tasks: 0 } },
      { state: "ready", counts: { contacts: 5, observations: 2, tasks: 1 } },
      { state: "ready", counts: { contacts: 0, observations: 0, tasks: 0 } },
    ];
    let evaluateCalls = 0;
    const page = {
      async evaluate(callback) {
        evaluateCalls++;
        const phase = phases.shift();
        assert.ok(phase);
        const attributes = {
          "data-capir-session-state": "active",
          "data-capir-demo-expiry": EXPIRES,
          "data-capir-dataset-state": phase.state,
          "data-capir-contacts": String(phase.counts.contacts),
          "data-capir-observations": String(phase.counts.observations),
          "data-capir-tasks": String(phase.counts.tasks),
        };
        const document = {
          querySelector(selector) {
            assert.equal(selector, "[data-capir-run-verification]");
            return { getAttribute: (name) => attributes[name] ?? null };
          },
        };
        // Run the same serialized callback Playwright sends into the browser.
        // Verification advances only between evaluate calls; separate awaited
        // reads would mix loading/0 with ready/counts.
        return runInNewContext(`(${callback.toString()})()`, { document });
      },
      getAttribute() { throw new Error("split attribute read is forbidden"); },
      locator() { throw new Error("split count read is forbidden"); },
    };
    const loading = await sampleEntryDom(page);
    assert.equal(evaluateCalls, 1);
    assert.equal(loading.dataset_state, "loading");
    assert.deepEqual({ ...loading.dataset_counts }, { contacts: 0, observations: 0, tasks: 0 });
    assert.equal(evaluateEntryVerification(loading, "empty", EXPIRES).passed, false);
    const hydrated = await sampleEntryDom(page);
    assert.equal(evaluateCalls, 2);
    assert.equal(hydrated.dataset_state, "ready");
    assert.deepEqual({ ...hydrated.dataset_counts }, { contacts: 5, observations: 2, tasks: 1 });
    assert.equal(evaluateEntryVerification(hydrated, "empty", EXPIRES).passed, false);
    const settledEmpty = await sampleEntryDom(page);
    assert.equal(evaluateCalls, 3);
    assert.equal(settledEmpty.dataset_state, "ready");
    assert.deepEqual({ ...settledEmpty.dataset_counts }, { contacts: 0, observations: 0, tasks: 0 });
    assert.equal(evaluateEntryVerification(settledEmpty, "empty", EXPIRES).passed, true);
  });

  it("accepts an already-settled empty dataset as verified empty", () => {
    const verdict = evaluateEntryVerification(observation(), "empty", EXPIRES);
    assert.equal(verdict.passed, true);
    assert.equal(verdict.settled, true);
    assert.equal(verdict.settled_empty, true);
    assert.equal(verdict.reason, "");
  });

  it("never reports delayed verification with zero counts as verified empty", () => {
    const verdict = evaluateEntryVerification(
      observation({ dataset_state: "loading" }),
      "empty",
      EXPIRES,
    );
    assert.equal(verdict.passed, false);
    assert.equal(verdict.settled, false);
    assert.equal(verdict.settled_empty, false);
    assert.match(verdict.reason, /did not settle/);
  });

  it("never reports a missing dataset marker as verified empty", () => {
    const verdict = evaluateEntryVerification(
      observation({ dataset_state: null }),
      "empty",
      EXPIRES,
    );
    assert.equal(verdict.passed, false);
    assert.equal(verdict.settled_empty, false);
  });

  it("fails a settled error dataset instead of passing it as empty", () => {
    const verdict = evaluateEntryVerification(
      observation({ dataset_state: "error" }),
      "empty",
      EXPIRES,
    );
    assert.equal(verdict.passed, false);
    assert.equal(verdict.settled, true);
    assert.equal(verdict.settled_empty, false);
    assert.match(verdict.reason, /failed/);
  });

  it("requires settled ready with the exact daily seed counts", () => {
    const hydrating = evaluateEntryVerification(
      observation({
        dataset_state: "loading",
        dataset_counts: { contacts: 12, observations: 30, tasks: 4 },
      }),
      "daily",
      EXPIRES,
    );
    assert.equal(hydrating.passed, false, "counts alone do not prove a settled dataset");
    const empty = evaluateEntryVerification(observation(), "daily", EXPIRES);
    assert.equal(empty.passed, false);
    assert.match(empty.reason, /do not match/);
    const partial = evaluateEntryVerification(
      observation({ dataset_counts: { contacts: 12, observations: 30, tasks: 3 } }),
      "daily",
      EXPIRES,
    );
    assert.equal(partial.passed, false);
    const ready = evaluateEntryVerification(
      observation({ dataset_counts: { contacts: 12, observations: 30, tasks: 4 } }),
      "daily",
      EXPIRES,
    );
    assert.equal(ready.passed, true);
  });

  it("keeps banner and expiry requirements for every preset", () => {
    assert.equal(
      evaluateEntryVerification(observation({ banner_state: "revoked" }), "empty", EXPIRES).passed,
      false,
    );
    assert.equal(
      evaluateEntryVerification(observation({ demo_expiry: "2026-10-01T11:00:00.000Z" }), "empty", EXPIRES).passed,
      false,
    );
  });
});


describe("test-run canonical identity gate", () => {
  const expected = {
    run_id: "run-1",
    account_id: "account-1",
    user_id: "user-1",
    username: "qa-1",
  };
  const identityObservation = (overrides = {}) => ({
    banner_state: "active",
    demo_expiry: EXPIRES,
    dataset_state: "ready",
    dataset_counts: { contacts: 12, observations: 30, tasks: 4 },
    run_id: "run-1",
    account_id: "account-1",
    user_id: "user-1",
    username: "qa-1",
    ...overrides,
  });

  it("reports ready only when run, account, user and username all match", () => {
    const verdict = evaluateTestEntryVerification(identityObservation(), expected, "daily", EXPIRES);
    assert.equal(verdict.passed, true);
    // Normalized handle comparison follows the backend handle rule.
    assert.equal(
      evaluateTestEntryVerification(identityObservation({ username: " QA-1 " }), expected, "daily", EXPIRES).passed,
      true,
    );
  });

  it("never accepts a foreign run with the same preset and expiry", () => {
    for (const [overrides, pattern] of [
      [{ run_id: "run-2" }, /run id/],
      [{ account_id: "account-2" }, /account/],
      [{ user_id: "user-2" }, /user/],
      [{ username: "someone-else" }, /username/],
      [{ run_id: null }, /run id/],
    ]) {
      const verdict = evaluateTestEntryVerification(
        identityObservation(overrides),
        expected,
        "daily",
        EXPIRES,
      );
      assert.equal(verdict.passed, false, JSON.stringify(overrides));
      assert.match(verdict.reason, pattern);
    }
  });

  it("still requires the dataset contract after the identity gate", () => {
    const partial = evaluateTestEntryVerification(
      identityObservation({ dataset_counts: { contacts: 12, observations: 30, tasks: 3 } }),
      expected,
      "daily",
      EXPIRES,
    );
    assert.equal(partial.passed, false);
    assert.match(partial.reason, /do not match/);
  });
});

describe("legacy sandbox entry verification (frozen semantics)", () => {
  const legacy = (overrides = {}) => ({
    banner_state: "active",
    demo_expiry: EXPIRES,
    directory_state: "ready",
    people_links: 0,
    ...overrides,
  });

  it("accepts a settled empty directory for the empty scenario", () => {
    const verdict = evaluateSandboxEntryVerification(legacy(), "no-people", EXPIRES);
    assert.equal(verdict.passed, true);
    assert.equal(verdict.settled_empty, true);
  });

  it("requires settled ready people links for the daily scenario", () => {
    assert.equal(
      evaluateSandboxEntryVerification(legacy({ directory_state: "loading", people_links: 3 }), "people", EXPIRES).passed,
      false,
    );
    assert.match(
      evaluateSandboxEntryVerification(legacy(), "people", EXPIRES).reason,
      /at least one people link/,
    );
    assert.equal(
      evaluateSandboxEntryVerification(legacy({ people_links: 2 }), "people", EXPIRES).passed,
      true,
    );
  });

  it("keeps the frozen banner, expiry and failed-directory rules", () => {
    assert.equal(evaluateSandboxEntryVerification(legacy({ banner_state: "revoked" }), "no-people", EXPIRES).passed, false);
    assert.equal(evaluateSandboxEntryVerification(legacy({ demo_expiry: "other" }), "no-people", EXPIRES).passed, false);
    assert.match(
      evaluateSandboxEntryVerification(legacy({ directory_state: "error" }), "no-people", EXPIRES).reason,
      /failed to load/,
    );
    assert.match(
      evaluateSandboxEntryVerification(legacy({ directory_state: null }), "no-people", EXPIRES).reason,
      /did not settle/,
    );
  });
});
