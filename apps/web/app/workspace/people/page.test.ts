import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), list: vi.fn(), memory: vi.fn(), claims: vi.fn(), mint: vi.fn() }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "synthetic-owner" } }) }));
vi.mock("@/lib/server/localBackend", () => ({
  isIntegrationMode: () => true, searchPeopleDirectory: mocks.search, loadPeopleDirectory: mocks.list,
  loadPersonMemory: mocks.memory,
}));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mocks.claims }));
vi.mock("@/lib/server/contact-handoff-session", () => ({ contactHandoffSessionVersion: () => "binding" }));
vi.mock("@/lib/server/memoryEntryCapability", () => ({ mintMemoryEntryCapability: mocks.mint }));
vi.mock("@/components/memory-review/memory-review-card", () => ({ MemoryReviewCard: () => null }));
vi.mock("@/components/people-directory-app", () => ({ PeopleDirectoryApp: () => null }));
import PersonMemoryPage from "./[id]/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claims.mockResolvedValue({ backendAccountId: "account" });
  mocks.mint.mockReturnValue("scoped-entry");
});


const loadedId = "7258d22f-42e3-4d40-ba4d-683a0cc76f7d";
const contextId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const loadedPerson = {
  id: loadedId, display_label: "陈知远", avatar: null, identity_matches: [], profile: null,
  contexts: [{ id: contextId, display_label: "读书会认识" }],
};
const memory = (person: unknown) => ({ person, proposals: [], items: [] });

async function renderDetail(id: string, directoryQuery?: string) {
  return renderToStaticMarkup(
    await PersonMemoryPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({ session: sessionId, directory_query: directoryQuery }),
    }),
  );
}

it("returns to the actual loaded Person entry after a successful load", async () => {
  mocks.memory.mockResolvedValue(memory(loadedPerson));
  // The URL id differs in case from the canonical loaded id; the fragment uses
  // the same lowercase normalization as the directory entry IDs.
  const html = await renderDetail(loadedId.toUpperCase(), "  林 & 陈  ");
  expect(html).toContain(`href="/workspace/people?query=%E6%9E%97+%26+%E9%99%88&amp;session=${sessionId}#person-${loadedId}"`);
  // Relationship hrefs and their purpose/scope stay free of return fragments.
  expect(html).toContain(`href="/workspace?person=${loadedId}&amp;context=${contextId}&amp;session=${sessionId}"`);
  expect(html).not.toContain(`context=${contextId}&amp;session=${sessionId}#`);
});

it("keeps invalid, unavailable and absent Person returns ordinary while preserving query/session", async () => {
  mocks.memory.mockRejectedValue(new Error("unavailable"));
  const ordinary = `href="/workspace/people?query=%E6%9E%97&amp;session=${sessionId}"`;

  const invalid = await renderDetail("bad", "林");
  expect(invalid).toContain("这个人物标识无效。");
  expect(invalid).toContain(ordinary);
  expect(invalid).not.toContain("#person-");

  const unavailable = await renderDetail(loadedId, "林");
  expect(unavailable).toContain("无法读取这个人物的记忆");
  expect(unavailable).toContain(ordinary);
  expect(unavailable).not.toContain("#person-");

  mocks.memory.mockResolvedValue(memory(null));
  const absent = await renderDetail(loadedId, "林");
  expect(absent).toContain(ordinary);
  expect(absent).not.toContain("#person-");
});

it("never mints a return fragment from an arbitrary id or URL", async () => {
  mocks.memory.mockClear();
  const html = await renderDetail("person/injection?x=1#evil", "林");
  expect(html).toContain("这个人物标识无效。");
  expect(html).not.toContain("#person-");
  expect(mocks.memory).not.toHaveBeenCalled();
});
