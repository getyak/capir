import { describe, expect, it } from "vitest";

import {
  boundedDiagnosticCode,
  BROWSER_EXECUTOR_ERROR_CODE_SET,
  CONTACT_TOOLS_ERROR_CODE_SET,
  recognizedDiagnosticCode,
  SOCKET_TRANSIENT_ERROR_CODES,
} from "./diagnosticCodes.js";

describe("agent-host diagnostic code allowlists", () => {
  it("preserves supported browser and contact diagnostics across the boundary", () => {
    for (const code of [
      "BROWSER_HTTP_LIMIT",
      "BROWSER_RESPONSE_BYTE_LIMIT",
      "BROWSER_EXECUTOR_UNAUTHORIZED",
      "BROWSER_REQUEST_TOO_LARGE",
      "BROWSER_RESPONSE_TOO_LARGE",
      "BROWSER_DEADLINE_EXCEEDED",
      "BROWSER_CLEANUP_UNVERIFIED",
      "CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE",
      "CONTACT_RESEARCH_PRIVATE_LOOKUP_PROHIBITED",
      "CONTACT_RESEARCH_SOURCE_ID_MISMATCH",
      "CONTACT_RESEARCH_CAPACITY_EXHAUSTED",
      "CONTACT_RESEARCH_CALL_ID_CONFLICT",
      "CONTACT_RESEARCH_CLIENT_CLOSED",
    ]) {
      expect(CONTACT_TOOLS_ERROR_CODE_SET.has(code)).toBe(true);
      expect(recognizedDiagnosticCode(new Error(code), CONTACT_TOOLS_ERROR_CODE_SET)).toBe(code);
    }
    for (const code of ["BROWSER_HTTP_LIMIT", "BROWSER_RESPONSE_BYTE_LIMIT", "BROWSER_DEADLINE_EXCEEDED"]) {
      expect(BROWSER_EXECUTOR_ERROR_CODE_SET.has(code)).toBe(true);
    }
  });

  it("keeps real socket transient codes recognized on both boundaries", () => {
    for (const code of SOCKET_TRANSIENT_ERROR_CODES) {
      const error = Object.assign(new Error("socket failed"), { code });
      expect(recognizedDiagnosticCode(error, CONTACT_TOOLS_ERROR_CODE_SET)).toBe(code);
      expect(recognizedDiagnosticCode(error, BROWSER_EXECUTOR_ERROR_CODE_SET)).toBe(code);
    }
  });

  it("refuses arbitrary error.code and code-shaped error.message content", () => {
    for (const error of [
      Object.assign(new Error("boom"), { code: "SECRET_CODE_CANARY" }),
      Object.assign(new Error("inner"), { code: "CONTACT_RESEARCH_ARBITRARY_SECRET" }),
      new Error("BROWSER_ARBITRARY_SECRET_CANARY"),
      new Error("CONTACT_RESEARCH_ARBITRARY_SECRET_CANARY"),
      Object.assign(new Error("SECRET_MESSAGE_CANARY"), { name: "BROWSER_SECRET_NAME_CANARY" }),
    ]) {
      expect(recognizedDiagnosticCode(error, CONTACT_TOOLS_ERROR_CODE_SET)).toBe(undefined);
      expect(recognizedDiagnosticCode(error, BROWSER_EXECUTOR_ERROR_CODE_SET)).toBe(undefined);
    }
  });

  it("maps unrecognized exceptions to the fixed boundary fallback", () => {
    expect(boundedDiagnosticCode(
      Object.assign(new Error("boom"), { code: "SECRET_CODE_CANARY" }),
      CONTACT_TOOLS_ERROR_CODE_SET,
      "CONTACT_RESEARCH_UNAVAILABLE",
    )).toBe("CONTACT_RESEARCH_UNAVAILABLE");
    expect(boundedDiagnosticCode(
      new Error("BROWSER_ARBITRARY_SECRET_CANARY"),
      BROWSER_EXECUTOR_ERROR_CODE_SET,
      "BROWSER_EXECUTOR_FAILED",
    )).toBe("BROWSER_EXECUTOR_FAILED");
  });
});
