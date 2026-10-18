/**
 * Policy tests for .github/workflows/security.yml (PH-07).
 *
 * The full production dependency audit is a mandatory gate: it runs on every
 * security event, audits the complete production graph without suppression,
 * runs the local dependency-patch regression tests after a frozen install,
 * and the aggregate required job demands its success (never a skip).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const securityWorkflow = readFileSync(
  new URL("../../.github/workflows/security.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

function jobBlock(workflow, job) {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `job ${job} must exist`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n  [a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

const auditJob = jobBlock(securityWorkflow, "production-dependency-audit");
const requiredJob = jobBlock(securityWorkflow, "required");

function pinnedActionSha(workflow, action) {
  const match = workflow.match(new RegExp(`${action}@([0-9a-f]{40})`));
  assert.ok(match, `${action} must be pinned to a full commit SHA`);
  return match[1];
}

test("the production dependency audit runs on every existing security event", () => {
  const triggers = securityWorkflow.split(/\n on:\n|\non:\n/)[1].split(/\n\w|\npermissions:/)[0];
  assert.match(triggers, /\bpull_request:/);
  assert.match(triggers, /\bpush:/);
  assert.match(triggers, /\bschedule:/);
  assert.match(triggers, /\bworkflow_dispatch:/);
  // No job-level `if`: schedule and manual runs cannot skip this job.
  assert.doesNotMatch(auditJob, /\n {4}if:/);
});

test("the audit job checks out, installs frozen, audits the full production graph, and runs patch regressions", () => {
  const install = auditJob.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
  const audit = auditJob.indexOf("pnpm audit --prod --audit-level moderate");
  const regressions = auditJob.indexOf("node --test scripts/dependency-security.test.mjs");
  assert.notEqual(install, -1, "frozen install must run first");
  assert.ok(audit > install, "audit must run after the frozen install");
  assert.ok(regressions > audit, "local patch regression tests must run in this job");
});

test("the production audit cannot be suppressed and service errors fail", () => {
  assert.doesNotMatch(auditJob, /continue-on-error/);
  assert.doesNotMatch(auditJob, /\|\|\s*true/);
  assert.doesNotMatch(auditJob, /audit\.ignore|--ignore-registry-errors/);
  // The audit step must be the plain pnpm audit command.
  assert.match(auditJob, /\n {8}run: pnpm audit --prod --audit-level moderate\n/);
});

test("the required gate demands audit success and never accepts a skip", () => {
  assert.match(requiredJob, /needs: \[[^\]]*production-dependency-audit[^\]]*\]/);
  assert.match(
    requiredJob,
    /PRODUCTION_AUDIT_RESULT: \$\{\{ needs\.production-dependency-audit\.result \}\}/,
  );
  assert.match(requiredJob, /test "\$PRODUCTION_AUDIT_RESULT" = "success"/);
  assert.doesNotMatch(requiredJob, /PRODUCTION_AUDIT_RESULT" = "skipped"/);
});

test("existing security checks and protections are preserved", () => {
  for (const line of [
    'test "$CHANGES_RESULT" = "success"',
    'test "$DEPENDENCY_RESULT" = "success" || test "$DEPENDENCY_RESULT" = "skipped"',
    'test "$SECRET_RESULT" = "success"',
    'test "$SWIFT_RESULT" = "success" || test "$SWIFT_RESULT" = "skipped"',
  ]) {
    assert.ok(requiredJob.includes(line), `required gate must keep: ${line}`);
  }
  assert.match(requiredJob, /test "\$CODEQL_RESULT" = "success"/);
  const dependencyReview = jobBlock(securityWorkflow, "dependency-review");
  assert.match(dependencyReview, /fail-on-severity: high/);
  const changes = jobBlock(securityWorkflow, "changes");
  assert.match(changes, /has-runtime-changes\.sh/);
});

test("the audit job reuses the repository's pinned action SHAs and configured versions", () => {
  assert.ok(
    auditJob.includes(`actions/checkout@${pinnedActionSha(securityWorkflow, "actions/checkout")}`),
  );
  assert.ok(
    auditJob.includes(`pnpm/action-setup@${pinnedActionSha(ciWorkflow, "pnpm/action-setup")}`),
  );
  assert.ok(
    auditJob.includes(`actions/setup-node@${pinnedActionSha(ciWorkflow, "actions/setup-node")}`),
  );
  assert.match(auditJob, /node-version: 22/);
  assert.match(auditJob, /cache: pnpm/);
});
