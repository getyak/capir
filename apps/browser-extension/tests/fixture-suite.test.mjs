import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXTURE_SUITE_URL,
  initializeFixtureMode,
  isFixtureSuiteShape,
  loadOptionalFixtureSuite,
  resolveFixtureMode,
} from "../load-unpacked/lib/fixture-suite.js";

/**
 * Small independent synthetic unit fixture. It exercises the optional-corpus
 * startup contract only; it is not a copy of the private evaluation corpus.
 */
function syntheticSuite() {
  return {
    suite_id: "synthetic-unit-suite",
    version: "1",
    cases: [
      {
        id: "SYNTH-1",
        title: "Synthetic unit case",
        context: { captured_at: "2026-01-01T09:00:00+08:00" },
        messages: [{ id: "m1", speaker: "candidate", text: "Synthetic." }],
        expected: { disposition: "no_action", assertions: [], action: null, must_not: [] },
      },
    ],
  };
}

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => value,
  };
}

test("ordinary live startup without a corpus stays live and silent", async () => {
  const startup = await initializeFixtureMode({
    requestedMode: null,
    fetcher: async () => jsonResponse(null, { ok: false, status: 404 }),
  });

  assert.equal(startup.mode, "live");
  assert.equal(startup.fixtureSuite, null);
  assert.equal(startup.fixtureOptionEnabled, false);
  assert.equal(startup.notice, null);
});

test("a fixture-mode request without a corpus degrades clearly to live", async () => {
  const startup = await initializeFixtureMode({
    requestedMode: "fixture",
    fetcher: async () => {
      throw new TypeError("corpus absent");
    },
  });

  assert.equal(startup.mode, "live");
  assert.equal(startup.fixtureSuite, null);
  assert.equal(startup.fixtureOptionEnabled, false);
  assert.match(startup.notice, /fixture mode is unavailable/i);
});

test("an injected corpus enables fixture mode and the fixture option", async () => {
  const suite = syntheticSuite();
  const startup = await initializeFixtureMode({
    requestedMode: "fixture",
    fetcher: async (url) => {
      assert.equal(url, FIXTURE_SUITE_URL);
      return jsonResponse(suite);
    },
  });

  assert.equal(startup.mode, "fixture");
  assert.deepEqual(startup.fixtureSuite, suite);
  assert.equal(startup.fixtureOptionEnabled, true);
  assert.equal(startup.notice, null);
});

test("an injected corpus leaves ordinary live startup live but selectable", async () => {
  const startup = await initializeFixtureMode({
    requestedMode: null,
    fetcher: async () => jsonResponse(syntheticSuite()),
  });

  assert.equal(startup.mode, "live");
  assert.equal(startup.fixtureOptionEnabled, true);
  assert.equal(startup.notice, null);
});

test("malformed local fixture payloads never enable fixture mode", async () => {
  const malformed = syntheticSuite();
  malformed.cases[0].expected = {};
  const startup = await initializeFixtureMode({requestedMode:"fixture",fetcher:async()=>jsonResponse(malformed)});
  assert.equal(startup.mode, "live");
  assert.equal(startup.fixtureOptionEnabled, false);
  assert.equal(
    await loadOptionalFixtureSuite(async () =>
      jsonResponse({ suite_id: "x", cases: [] }),
    ),
    null,
  );
  assert.equal(
    await loadOptionalFixtureSuite(async () =>
      jsonResponse({ cases: [{ id: "only-an-id" }] }),
    ),
    null,
  );
  assert.equal(
    await loadOptionalFixtureSuite(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("not json");
      },
    })),
    null,
  );
  assert.equal(
    await loadOptionalFixtureSuite(async () => {
      throw new TypeError("offline");
    }),
    null,
  );
});

test("invalid message references and duplicate case identities stay unavailable", () => {
  const suite = syntheticSuite();
  suite.cases[0].expected.assertions = [{field:"availability",status:"proposed",value:"synthetic",evidence_message_id:"missing",evidence_quote:"Synthetic"}];
  assert.equal(isFixtureSuiteShape(suite), false);
  const duplicated = syntheticSuite();
  duplicated.cases.push(structuredClone(duplicated.cases[0]));
  assert.equal(isFixtureSuiteShape(duplicated), false);
});

test("suite shape validation keeps generic fixture rendering open", () => {
  assert.equal(isFixtureSuiteShape(syntheticSuite()), true);
  assert.equal(isFixtureSuiteShape(null), false);
  assert.equal(isFixtureSuiteShape({ suite_id: "x", cases: [null] }), false);
});

test("resolveFixtureMode never returns fixture mode without a suite", () => {
  for (const requestedMode of ["fixture", "live", null, undefined]) {
    const result = resolveFixtureMode({
      requestedMode,
      fixtureSuite: null,
    });
    assert.equal(result.mode, "live");
    assert.equal(result.fixtureOptionEnabled, false);
  }
});
