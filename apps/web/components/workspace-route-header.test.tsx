import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRouteHeader } from "./workspace-route-header";

const route = vi.hoisted(() => ({ pathname: "/workspace/people" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

beforeEach(() => { route.pathname = "/workspace/people"; });

it.each(["/workspace/people", "/workspace/people/person-a"])("lets %s own its visible title while preserving native chrome space", pathname => {
  route.pathname = pathname;
  const html = renderToStaticMarkup(<WorkspaceRouteHeader />);
  expect(html).toContain("<header");
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain("<strong");
  expect(html).not.toContain("人物");
});

it("retains a visible route identity on other workspace destinations", () => {
  route.pathname = "/workspace/today";
  const html = renderToStaticMarkup(<WorkspaceRouteHeader />);
  expect(html).toContain("今日");
  expect(html).not.toContain('aria-hidden="true"');
});

it("keeps the Session-owned header free of a second shell header", () => {
  route.pathname = "/workspace/sessions/session-a";
  expect(renderToStaticMarkup(<WorkspaceRouteHeader />)).toBe("");
});
