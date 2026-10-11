// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    const { children, ...rest } = props;
    return <a {...rest}>{children as never}</a>;
  },
}));

import { LoginConnectContinuity } from "./login-connect-continuity";

function hrefFor(html: string, marker: string): string {
  const at = html.indexOf(marker);
  const tag = html.slice(html.lastIndexOf("<a", at), html.indexOf(">", at));
  return (/href="([^"]+)"/.exec(tag)?.[1] ?? "").replace(/&amp;/g, "&");
}

describe("login connect continuity panel", () => {
  it("keeps the copy concise: title, one paragraph, one supporting line, explicit action", () => {
    const html = renderToStaticMarkup(
      <LoginConnectContinuity
        provider="google"
        callbackUrl="/desktop-auth/authorize?attempt=a&state=b"
      />,
    );
    expect(html).toContain("继续使用已有账号");
    expect(html).toContain("先用原来的方式登录，再连接 Google。联系人和会话会保留在同一个账号中。");
    expect(html).toContain("连接前会再次验证身份，由你确认后生效。");
    expect(html).toContain("登录并连接 Google");
    expect(html).toContain("先直接登录");
    // The original CLI/Mac callback travels with both explicit actions.
    expect(hrefFor(html, "data-connect-continuity-primary")).toBe(
      "/login?connect=google&callbackUrl=%2Fdesktop-auth%2Fauthorize%3Fattempt%3Da%26state%3Db",
    );
    expect(hrefFor(html, "data-connect-continuity-escape")).toBe(
      "/login?callbackUrl=%2Fdesktop-auth%2Fauthorize%3Fattempt%3Da%26state%3Db",
    );
  });

  it("never echoes an email, account name or method inventory", () => {
    const html = renderToStaticMarkup(
      <LoginConnectContinuity provider="apple" callbackUrl="/workspace" />,
    );
    expect(html).toContain("再连接 Apple。");
    // Purpose-bound guidance only: no address, hint or provider list.
    expect(html).not.toContain("@");
    expect(html).not.toContain("已绑定");
    expect(html).not.toContain("未绑定");
    expect(html).not.toContain("密码");
  });

  it("collapses a forged callback instead of emitting an external link", () => {
    const html = renderToStaticMarkup(
      <LoginConnectContinuity provider="google" callbackUrl="https://evil.example/steal" />,
    );
    for (const marker of ["data-connect-continuity-primary", "data-connect-continuity-escape"]) {
      expect(hrefFor(html, marker)).toContain("callbackUrl=%2Fworkspace");
      expect(hrefFor(html, marker)).not.toContain("evil.example");
    }
  });
});
