/**
 * Optional evaluation-fixture loading for the review panel.
 *
 * The eight-case evaluation corpus is not shipped in this package (GET-134).
 * A private harness may inject the canonical
 * `fixtures/candidate-momentum-v1.json` into the unpacked package; until a
 * suite loads successfully, fixture mode stays unavailable and the panel runs
 * in live mode. Corpus absence is a normal live-mode state, never an error,
 * and no remote resource is ever fetched.
 */

export const FIXTURE_SUITE_URL = "./fixtures/candidate-momentum-v1.json";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
const optionalText = value => value == null || typeof value === "string";

function validCase(item) {
  if (!record(item) || !text(item.id) || !text(item.title) || !record(item.context)
    || !text(item.context.captured_at) || !Array.isArray(item.messages) || !item.messages.length
    || !record(item.expected)) return false;
  const context = item.context;
  if (![context.candidate, context.assignment, context.source_timezone, context.notes, context.requested_output].every(optionalText)
    || (context.candidate_options != null && (!Array.isArray(context.candidate_options) || !context.candidate_options.every(text)))
    || (context.prior_state != null && (!record(context.prior_state) || !Object.values(context.prior_state).every(text)))) return false;
  if (!item.messages.every(message => record(message) && text(message.id) && text(message.text)
    && ["candidate", "recruiter", "hiring_manager", "unknown"].includes(message.speaker))) return false;
  const messages = new Map(item.messages.map(message => [message.id, message.text]));
  if (messages.size !== item.messages.length) return false;
  const expected = item.expected;
  if (!["propose_action", "no_action", "clarify", "block"].includes(expected.disposition)
    || !Array.isArray(expected.assertions) || !Array.isArray(expected.must_not) || !expected.must_not.every(text)) return false;
  if (!expected.assertions.every(assertion => record(assertion) && text(assertion.field) && text(assertion.value)
    && ["proposed", "ambiguous", "superseded"].includes(assertion.status)
    && text(assertion.evidence_quote) && messages.get(assertion.evidence_message_id)?.includes(assertion.evidence_quote))) return false;
  const action = expected.action;
  if ((action != null) !== (expected.disposition === "propose_action")) return false;
  if (action != null && (!record(action) || ![action.type, action.owner, action.target, action.reason, action.due].every(text)
    || !Array.isArray(action.evidence_message_ids) || !action.evidence_message_ids.length
    || !action.evidence_message_ids.every(id => messages.has(id)))) return false;
  return expected.disposition !== "block" || expected.assertions.length === 0;
}

export function isFixtureSuiteShape(value) {
  return record(value) && text(value.suite_id) && text(value.version)
    && Array.isArray(value.cases) && value.cases.length > 0
    && value.cases.every(validCase)
    && new Set(value.cases.map(item => item.id)).size === value.cases.length;
}

/**
 * Loads the optional local fixture suite. Absence (404), a malformed payload,
 * or any fetch failure yields null: the suite is optional and its absence is
 * never surfaced as a fixture-package error.
 */
export async function loadOptionalFixtureSuite(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(FIXTURE_SUITE_URL);
    if (!response || !response.ok) {
      return null;
    }
    const suite = await response.json();
    return isFixtureSuiteShape(suite) ? suite : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the startup mode. Fixture mode is possible only after a successful
 * suite load; a fixture-mode request without a corpus degrades clearly to live
 * mode with a status notice, while ordinary live startup stays silent.
 */
export function resolveFixtureMode({ requestedMode, fixtureSuite }) {
  const available = isFixtureSuiteShape(fixtureSuite);
  if (requestedMode === "fixture" && available) {
    return {
      mode: "fixture",
      fixtureSuite,
      fixtureOptionEnabled: true,
      notice: null,
    };
  }
  if (requestedMode === "fixture") {
    return {
      mode: "live",
      fixtureSuite: null,
      fixtureOptionEnabled: false,
      notice:
        "No synthetic fixture suite is available in this package, so fixture mode is unavailable. Live capture review continues instead.",
    };
  }
  return {
    mode: "live",
    fixtureSuite: available ? fixtureSuite : null,
    fixtureOptionEnabled: available,
    notice: null,
  };
}

export async function initializeFixtureMode({
  requestedMode,
  fetcher = globalThis.fetch,
} = {}) {
  const fixtureSuite = await loadOptionalFixtureSuite(fetcher);
  return resolveFixtureMode({
    requestedMode: requestedMode === "fixture" ? "fixture" : "live",
    fixtureSuite,
  });
}
