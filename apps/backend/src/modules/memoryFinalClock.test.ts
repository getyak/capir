import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as pending from "./memoryProposalSourceEligibility.js";
import * as lab from "./labWorkspaceAccess.js";

const digest = (sql: string) => createHash("sha256").update(sql, "utf8").digest("hex");
function requiredSQL(owner: object, name: string): string {
  const value: unknown = Reflect.get(owner, name);
  expect(typeof value, `Additive server SQL export ${name} must exist`).toBe("string");
  if (typeof value !== "string") throw new Error("Additive Memory clock SQL is unavailable.");
  return value;
}

describe("additive Memory final clock owners", () => {
  // Frozen from immutable6ad's resolved templates, independently of the new
  // builder. These are byte-compatibility goldens, not authorization evidence.
  it.each([
    [pending.MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_SQL, "cb84fcfed343170af4cb884afd08c42677ce3220a04d87b6c3c60ab58e99c130"],
    [lab.labWorkspaceSessionActiveSQL, "6e1b8645651a9b2faa7bd645cc02c31b4f545fd41f0f3393179bd3da0abf2d7a"],
    [lab.operatorLabDeploymentActiveSQL, "e44cbfcf9c4a0c8f4ea1f2ab260038652fdda607c547d1ea8266285d6ccc89b5"],
  ])("keeps a legacy SQL value byte-exact", (sql, expected) => {
    expect(digest(sql)).toBe(expected);
  });

  it("has a fixed six-site pending predicate without accepting a caller clock", () => {
    const sql = requiredSQL(pending, "MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_AT_TICK_SQL");
    expect(sql.match(/tick\.checked_at/g)).toHaveLength(6);
    expect(sql).not.toMatch(/\b(?:now|clock_timestamp)\s*\(/u);
  });

  it("has one fixed six-site Lab clock predicate", () => {
    const sql = requiredSQL(lab, "labWorkspaceSessionActiveAtTickSQL");
    expect(sql.match(/tick\.checked_at/g)).toHaveLength(6);
    expect(sql).not.toMatch(/\b(?:now|clock_timestamp)\s*\(/u);
  });

  it("has closed Memory serving slots7–10 without changing the original2–5 export", () => {
    const sql = requiredSQL(lab, "memoryContentOperatorLabDeploymentActiveSQL");
    expect(sql.match(/\$\d+/g)).toEqual(["$7", "$8", "$9", "$10", "$8", "$9"]);
    expect(sql).not.toMatch(/\$[1-6]\b/u);
  });
});
