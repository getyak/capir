import { describe, expect, it } from "vitest";

import {
  connectionErrorCopy,
  formatTimestamp,
  grantStatusLabel,
} from "./workspace-extensions-helpers";

describe("extension UI copy", () => {
  it("describes credential unavailability without deployment variable names", () => {
    const copy = connectionErrorCopy("MCP_CREDENTIAL_UNAVAILABLE");
    expect(copy).toContain("凭据存储");
    expect(copy).not.toMatch(/TALENT_SIGNAL|ENCRYPTION|KEY|_/u);
  });

  it("offers credential and OAuth recovery without claiming a completed authorization", () => {
    const copy = connectionErrorCopy("MCP_REQUIRES_AUTH");
    expect(copy).toContain("编辑连接");
    expect(copy).toContain("Bearer 密钥");
    expect(copy).toContain("OAuth");
    expect(copy).not.toMatch(/登录成功|已授权/u);
  });

  it("returns null for an unknown error code", () => {
    expect(connectionErrorCopy("SOMETHING_ELSE")).toBeNull();
    expect(connectionErrorCopy(null)).toBeNull();
  });

  it("labels grant status and timestamps without fabricating a check time", () => {
    expect(
      grantStatusLabel({ status: "revoked" } as never),
    ).toBe("已撤销");
    expect(grantStatusLabel({ status: "expired" } as never)).toBe("已过期");
    expect(grantStatusLabel({ status: "active" } as never)).toBe("有效");
    expect(formatTimestamp(null)).toBe("尚未核验");
    expect(formatTimestamp("not-a-date")).toBe("尚未核验");
  });
});
