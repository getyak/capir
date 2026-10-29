import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), search: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/localBackend", () => ({ isIntegrationMode: () => true, loadPeopleDirectory: mocks.list, searchPeopleDirectory: mocks.search }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => "zh-CN" }));
import PeoplePage from "./page";
const session = "33333333-3333-4333-8333-333333333333";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.list.mockResolvedValue({ people: [] }); mocks.search.mockResolvedValue({ people: [] }); });

it.each([{ query: ["Lin", "Chen"] }, { query: 42 }, { query: { query: "Lin" } }])("rejects an ambiguous or non-string query without collecting the full directory: %j", async ({ query }) => {
  const page = await PeoplePage({ searchParams: Promise.resolve({ query, session }) as never });
  expect(page.props.queryInvalid).toBe(true);
  expect(page.props.error).toContain("搜索条件无效");
  expect(page.props.people).toEqual([]);
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
  expect(page.props.returnSessionId).toBe(session);
});
it("normalizes one literal search while preserving the separate return locator", async () => {
  const page = await PeoplePage({ searchParams: Promise.resolve({ query: "  Ｌｉｎ & 陈  ", session }) });
  expect(mocks.search).toHaveBeenCalledExactlyOnceWith("Lin & 陈");
  expect(mocks.list).not.toHaveBeenCalled();
  expect(page.props.query).toBe("Lin & 陈"); expect(page.props.returnSessionId).toBe(session);
});
it("keeps an explicitly empty query as a normal directory read", async () => {
  const page = await PeoplePage({ searchParams: Promise.resolve({ query: "  " }) });
  expect(mocks.list).toHaveBeenCalledOnce(); expect(mocks.search).not.toHaveBeenCalled();
  expect(page.props.error).toBeNull();
});
