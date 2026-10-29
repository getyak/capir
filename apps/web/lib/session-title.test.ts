import { expect, it } from "vitest";
import { normalizeSessionTitle } from "./session-title";
it("normalizes a title without truncation or splitting compound characters", () => {
  expect(normalizeSessionTitle("  Topic\n  for tomorrow ")).toBe("Topic for tomorrow");
  expect(normalizeSessionTitle(" \u0000\n ")).toBeNull();
  expect(normalizeSessionTitle("x".repeat(33))).toBeNull();
  expect(normalizeSessionTitle("👨‍👩‍👧".repeat(32))).toBe("👨‍👩‍👧".repeat(32));
});
