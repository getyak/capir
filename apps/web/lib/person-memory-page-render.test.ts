import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, loadPersonMemory, claims, mint, review } = vi.hoisted(() => ({
  auth: vi.fn(), loadPersonMemory: vi.fn(), claims: vi.fn(),
  mint: vi.fn(), review: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/server/localBackend", () => ({ loadPersonMemory, isIntegrationMode: () => true }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: claims }));
vi.mock("@/lib/server/contact-handoff-session", () => ({ contactHandoffSessionVersion: () => "binding" }));
vi.mock("@/lib/server/memoryEntryCapability", () => ({ mintMemoryEntryCapability: mint }));
vi.mock("@/components/memory-review/memory-review-card", () => ({
  MemoryReviewCard: (props: unknown) => { review(props); return createElement("div", { "data-review": "pending" }, "待审核的内容"); },
}));
import PersonMemoryPage from "@/app/workspace/people/[id]/page";

const personId = "11111111-1111-4111-8111-111111111111";
const contextId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const fixture = () => ({
  person: { id: personId, display_label: "陈知远", avatar: null, identity_matches: [], profile: null,
    contexts: [{ id: contextId, display_label: "读书会认识" }] },
  proposals: [],
  items: [
    { id: "fact", scope: "relationship", display_text: "我们通过读书会认识", statement_kind: "fact", speaker: null },
    { id: "source", scope: "person", display_text: "对方说下个月可能搬家", statement_kind: "source_statement", speaker: "对方" },
    { id: "opinion", scope: "self", display_text: "我觉得这次讨论很有帮助", statement_kind: "user_opinion", speaker: null },
  ],
});
async function render(id = personId, session: string | undefined = sessionId, directory_query?: string | string[]) {
  return renderToStaticMarkup(await PersonMemoryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ session, directory_query }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { name: "Owner" } });
  claims.mockResolvedValue({ backendAccountId: "account" });
  mint.mockReturnValue("scoped-entry");
  loadPersonMemory.mockResolvedValue(fixture());
});

describe("saved Person destination", () => {
  it.each(["loaded", "invalid", "unavailable"])("preserves the directory search through the %s destination without adding it to relationship authority", async (state) => {
    if (state === "unavailable") loadPersonMemory.mockRejectedValue(new Error("unavailable"));
    const html = await render(state === "invalid" ? "bad" : personId, sessionId, "  林 & 陈  ");
    expect(html).toContain(`/workspace/people?query=%E6%9E%97+%26+%E9%99%88&amp;session=${sessionId}`);
    if (state === "loaded") {
      expect(html).toContain(`/workspace?person=${personId}&amp;context=${contextId}&amp;session=${sessionId}`);
      expect(mint).toHaveBeenCalledWith(expect.anything(), { purpose: "people", personId });
    }
  });

  it("keeps the filtered destination through login recovery without reading private data", async () => {
    auth.mockResolvedValue(null);
    const expected = `/workspace/people/${personId}?directory_query=%E6%9E%97&amp;session=${sessionId}`.replace("&amp;", "&");
    await expect(render(personId, sessionId, "林")).rejects.toMatchObject({
      digest: expect.stringContaining(`/login?callbackUrl=${encodeURIComponent(expected)}`),
    });
    expect(loadPersonMemory).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  it("keeps saved scopes and source/opinion distinctions while preserving return navigation", async () => {
    const html = await render();
    for (const text of ["陈知远", "我们之间", "关于对方", "关于我", "我们通过读书会认识", "来源陈述", "用户观点", "已保存事实"]) expect(html).toContain(text);
    expect(html).toContain(`/workspace?person=${personId}&amp;context=${contextId}&amp;session=${sessionId}`);
    expect(html).toContain(`/workspace/people?session=${sessionId}`);
    expect(html).toMatch(/<main[^>]*id="main-content"[^>]*tabindex="-1"/);
    expect(review).not.toHaveBeenCalled();
  });

  it.each(["name", "expired_handle", "confirmed_handle"])("does not promote a %s identity clue beyond its authority", async (kind) => {
    const data = fixture();
    loadPersonMemory.mockResolvedValue({ ...data, person: { ...data.person, identity_matches: [{ kind }] } });
    const html = await render();
    expect(html.includes("已确认的联系方式")).toBe(kind === "confirmed_handle");
  });

  it("passes exact authority and revision to pending review, without rendering it as a saved fact", async () => {
    loadPersonMemory.mockResolvedValue({ ...fixture(), items: [], proposals: [{ proposal_id: "pending-id", revision: 7, relationship_context_id: contextId }] });
    const html = await render();
    expect(html).toContain("待审核的内容");
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ binding: "binding", entryCapability: "scoped-entry", personId, contextId, purpose: "people", proposal: { proposal_id: "pending-id", revision: 7 } }));
    expect(html).not.toContain("我们通过读书会认识");
  });

  it("keeps a contextless person reachable without forcing relationship selection", async () => {
    const data = fixture();
    data.person.contexts = [];
    data.items = [];
    loadPersonMemory.mockResolvedValue(data);
    const html = await render();
    expect(html).toContain("陈知远");
    expect(html).toContain("还没有");
    expect(html).not.toContain("context=");
  });

  it("does not invent a profile when the directory entry is missing", async () => {
    loadPersonMemory.mockResolvedValue({ person: null, proposals: [], items: [] });
    const html = await render();
    expect(html).toContain("暂时没有");
    expect(html).not.toContain("陈知远");
  });

  it("shows unavailable state instead of presenting a failed load as empty saved memory", async () => {
    loadPersonMemory.mockRejectedValue(new Error("unavailable"));
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("无法读取");
    expect(html).not.toContain("没有等待确认的变化");
    expect(html).toContain(`/workspace/people?session=${sessionId}`);
  });

  it("rejects invalid identifiers without a backend read or leaked return value", async () => {
    const html = await render("bad", "unsafe-return");
    expect(html).toContain("人物不可用");
    expect(loadPersonMemory).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
    expect(html).not.toContain("unsafe-return");
  });
});
