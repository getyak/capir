import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
import { LocaleProvider } from "@/components/locale-provider";
import { BackendSessionExpiredError } from "@/lib/backend-session";
const state = vi.hoisted(() => ({ locale: "en" as LocaleTag, auth: vi.fn(), list: vi.fn(), search: vi.fn() }));
vi.mock("@/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => state.locale }));
vi.mock("@/lib/server/localBackend", () => ({ isIntegrationMode: () => true, loadPeopleDirectory: state.list, searchPeopleDirectory: state.search }));
vi.mock("next/navigation", async () => ({ ...await vi.importActual("next/navigation"), usePathname: () => "/workspace/people" }));
import * as PeopleModule from "./page";
const session = "33333333-3333-4333-8333-333333333333";
async function render(query?: string) {
  const page = await PeopleModule.default({ searchParams: Promise.resolve({ query, session }) });
  return renderToStaticMarkup(<LocaleProvider locale={state.locale}>{page}</LocaleProvider>);
}
beforeEach(() => { state.locale = "en"; vi.clearAllMocks(); state.auth.mockResolvedValue({ user: { id: "synthetic-owner" } }); state.list.mockResolvedValue({ people: [] }); state.search.mockResolvedValue({ people: [] }); });
it("localizes full People route metadata without changing no-index behavior", async () => {
  const metadata = await PeopleModule.generateMetadata();
  expect(metadata).toMatchObject({ title: "Person", description: "An account-specific directory of people, relationship contexts and governed sources.", robots: { follow: false, index: false } });
  expect(state.list).not.toHaveBeenCalled(); expect(state.search).not.toHaveBeenCalled();
});
it("localizes backend-unavailable copy and preserves normalized query and conversation return scope", async () => {
  state.search.mockRejectedValue(new Error("unavailable")); const html = await render("  ＡＢＣ  ");
  expect(state.search).toHaveBeenCalledExactlyOnceWith("ABC"); expect(state.list).not.toHaveBeenCalled();
  expect(html).toContain("Cannot connect to the account backend; relationship state will not be inferred from stale data.");
  expect(html).toContain(`/workspace/people?query=ABC&amp;session=${session}`); expect(html).not.toContain("People: 0");
});
it("keeps expired credentials distinct and preserves the exact recovery callback", async () => {
  state.search.mockRejectedValue(new BackendSessionExpiredError()); const html = await render("林");
  expect(html).toContain("Your session is no longer valid. Sign in again to continue.");
  const callback = `/workspace/people?query=${encodeURIComponent("林")}&session=${session}`;
  expect(html).toContain(`/login?callbackUrl=${encodeURIComponent(callback)}&amp;reason=backend_session_expired`);
  expect(html).not.toContain("目录暂时不可用");
});
it("preserves login recovery without reading the directory", async () => {
  state.auth.mockResolvedValue(null);
  await expect(render("林")).rejects.toMatchObject({ digest: expect.stringContaining("/login?callbackUrl=") });
  expect(state.list).not.toHaveBeenCalled(); expect(state.search).not.toHaveBeenCalled();
});
