// @vitest-environment happy-dom
//
// EXP-01 regression: the three create-contact resource POSTs (first source,
// confirmed identity clue, deferred identity) must each carry a stable request
// identity — request ID plus client-attested `captured_at` observation time —
// that survives same-intent retry after partial success and resets together
// when the intent changes. A retry after primary success / clue failure must
// reuse the same identities so the backend idempotency keys cannot create
// duplicate people or notes, and no request may ever omit `captured_at`.
// Also covers EXP-03's announced, focusable recoverable error that keeps the
// submitted content.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PersonDirectoryItem,
  ResourceCaptureResponse,
} from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { AgentContactDraft } from "@/lib/agent-contact-intake";

const mock = vi.hoisted(() => ({
  committed: vi.fn(),
  deferred: vi.fn(),
  cancelled: vi.fn(),
}));
const fetcher = vi.hoisted(() => vi.fn());
// The wrapper records the live request init so fixtures can bind receipts to
// the actual request identity (client_resource_id = web-resource:<id>).
const current = vi.hoisted(() => ({ init: undefined as unknown }));
vi.mock("@/components/workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: (url: string, init?: RequestInit) => {
    current.init = init;
    return fetcher(url, init);
  },
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: (url: string, init?: RequestInit) => {
    current.init = init;
    return fetcher(url, init);
  },
  relationshipIntegrationSessionExpired: () => false,
}));

import { AgentCreatePersonCard } from "./agent-create-person-card";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "@/components/workspace-session-request";

const NAME = "Synthetic Contact";
const CLUE = "synthetic.contact@example.org";
const CONTEXT = "Synthetic retained search";
const NOTE = "Recruiter-provided first source note.";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const RELATIONSHIP_CONTEXT_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PERSON_ID = "55555555-5555-4555-8555-555555555555";
const CAPTURE_ID = "09999999-9999-4999-8999-999999999999";
const RESOURCE_ID = "66666666-6666-6666-8666-666666666666";
const SYNTHETIC_WORKSPACE = "synthetic-lab-workspace";

type ResourcePost = {
  request_id: string;
  captured_at: string;
  type: string;
  [key: string]: unknown;
};
type ResourceRequestBody = {
  request_id: string;
  captured_at: string;
  type: string;
  person_id?: string;
  relationship_context_id?: string;
  candidate_person_ids?: string[];
  scope_mode?: string;
};

let host: HTMLDivElement;
let root: Root;
let scopeContainer: HTMLDivElement;
let rootMounted = false;

function bodyOf(init: unknown): ResourceRequestBody {
  return JSON.parse(
    String((init as RequestInit | undefined)?.body),
  ) as ResourceRequestBody;
}

// Full-contract receipt (ResourceCaptureResponseSchema) bound to the actual
// request identity: client_resource_id = web-resource:<request_id>, with the
// person/context/candidate association echoing the request body. Truncated
// fixtures are intentionally no longer accepted by the component validator.
function receipt(
  personId: string = PERSON_ID,
  extra: { resolution_case_id?: string | null } = {},
  clientResourceId?: string,
): ResourceCaptureResponse {
  const body = bodyOf(current.init);
  const isDefer = body.scope_mode === "identity_candidates";
  return {
    contract_version: CONTRACT_VERSION,
    capture_id: CAPTURE_ID,
    identity: {
      status: "bound",
      person_id: personId,
      relationship_context_id:
        body.relationship_context_id ?? RELATIONSHIP_CONTEXT_ID,
      resolution_case_id:
        extra.resolution_case_id !== undefined
          ? extra.resolution_case_id
          : isDefer
            ? CASE_ID
            : null,
      candidate_person_ids: body.candidate_person_ids ?? [],
    },
    resource: {
      id: RESOURCE_ID,
      client_resource_id:
        clientResourceId ?? `web-resource:${body.request_id}`,
      kind: body.type === "contact" ? "contact_record" : "personal_note",
      processing_state: "ready",
      duplicate_of_resource_id: null,
      fragment_count: 1,
    },
    created_at: "2026-09-24T00:00:00.000Z",
  };
}

function person(id: string, label: string): PersonDirectoryItem {
  return {
    id,
    display_label: label,
    context_count: 1,
    capture_count: 1,
    confirmed_identity_count: 0,
    last_activity_at: "2026-09-20T00:00:00.000Z",
    profile: null,
    avatar: null,
    contexts: [
      {
        id: RELATIONSHIP_CONTEXT_ID,
        display_label: CONTEXT,
        last_activity_at: "2026-09-20T00:00:00.000Z",
      },
    ],
    identity_matches: [{ kind: "name" }],
  };
}

function resourcePosts(): ResourcePost[] {
  return fetcher.mock.calls
    .filter((call) =>
      String(call[0]).endsWith("/api/local-integration/resources"),
    )
    .map((call) =>
      JSON.parse(String((call[1] as RequestInit | undefined)?.body)),
    );
}

async function flush(ms = 320) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function type(selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  expect(field).toBeTruthy();
  const target = field!;
  const prototype =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
    target,
    value,
  );
  await act(async () => {
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

async function toggleConfirmClue() {
  await setConfirmClue(true);
}

async function setConfirmClue(checked: boolean) {
  const checkbox = host.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(checkbox).toBeTruthy();
  if (checkbox!.checked !== checked) {
    await act(async () => {
      checkbox!.click();
      checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  expect(checkbox!.checked).toBe(checked);
}

async function clickPrimary() {
  const button = host.querySelector<HTMLButtonElement>(
    "button.context-primary-button",
  );
  expect(button).toBeTruthy();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}

async function fillCreateDraft() {
  await type('input[placeholder="例如：陈雅宁"]', NAME);
  await type('input[placeholder="邮箱、电话、LinkedIn 网址或 wechat:ID"]', CLUE);
  await type('input[placeholder="例如：合作项目 · 首次沟通"]', CONTEXT);
  await type(
    'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
    NOTE,
  );
  await flush();
}

async function render(initialDraft?: AgentContactDraft) {
  await act(async () => {
    root.render(
      createElement(AgentCreatePersonCard, {
        ...(initialDraft ? { initialDraft } : {}),
        onCancel: mock.cancelled,
        onCommitted: mock.committed,
        onDeferred: mock.deferred,
      }),
    );
  });
  rootMounted = true;
}

async function unmountNow() {
  await act(async () => root.unmount());
  rootMounted = false;
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  current.init = undefined;
  fetcher.mockImplementation((url: string) => {
    if (String(url).includes("/people/search")) {
      return Promise.resolve(Response.json({ people: [] }));
    }
    return Promise.resolve(Response.json({ receipts: [receipt()] }));
  });
  scopeContainer = document.createElement("div");
  scopeContainer.dataset.workspaceScope = SYNTHETIC_WORKSPACE;
  document.body.append(scopeContainer);
  host = document.createElement("div");
  scopeContainer.append(host);
  root = createRoot(host);
  rootMounted = false;
});

afterEach(async () => {
  if (rootMounted) {
    await unmountNow();
  }
  scopeContainer.remove();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("create-contact resource request identity", () => {
  it("binds a captured_at observation time to the first source and the confirmed clue", async () => {
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickButton("创建新人物");
    await flush(50);

    const posts = resourcePosts();
    expect(posts).toHaveLength(2);
    const [source, clue] = posts;
    for (const post of posts) {
      // A real, canonical ISO observation time, never missing or invented.
      expect(post.captured_at).toBeTruthy();
      expect(new Date(post.captured_at).toISOString()).toBe(post.captured_at);
      expect(post.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
    // Each request identity carries its own observation time.
    expect(source.request_id).not.toBe(clue.request_id);
    expect(source.type).toBe("note");
    expect(source.scope_mode).toBe("new_person");
    expect(source.value).toBe(NOTE);
    expect(clue.type).toBe("contact");
    expect(clue.identity_clue_confirmed).toBe(true);
    expect(clue.person_id).toBe(PERSON_ID);
    expect(clue.relationship_context_id).toBe(RELATIONSHIP_CONTEXT_ID);
    expect(mock.committed).toHaveBeenCalledWith(
      expect.objectContaining({
        person: expect.objectContaining({ id: PERSON_ID }),
      }),
      expect.any(Array),
      "created_person",
    );
  });

  it("keeps the clue request identity on same-intent retry and never rewrites the saved first source", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 2) {
        return Promise.resolve(
          Response.json({ message: "clue rejected" }, { status: 422 }),
        );
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(50);

    // Partial success: the note committed, the clue failed. The error is an
    // announced, focusable recovery message and the draft is untouched.
    const error = host.querySelector<HTMLParagraphElement>(
      ".context-agent-create__error",
    );
    expect(error).toBeTruthy();
    expect(error!.getAttribute("role")).toBe("alert");
    expect(error!.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(error);
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .value,
    ).toBe(NAME);
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      )!.value,
    ).toBe(NOTE);
    expect(mock.committed).not.toHaveBeenCalled();

    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await clickPrimary();
    await flush(50);

    const posts = resourcePosts();
    // The same-intent retry writes only the missing clue. The saved first
    // source is never posted again under any identity, so no retry can
    // duplicate a person or note.
    expect(posts).toHaveLength(3);
    expect(posts.filter((post) => post.type === "note")).toHaveLength(1);
    const contacts = posts.filter((post) => post.type === "contact");
    expect(contacts).toHaveLength(2);
    // The retried clue keeps its exact request identity and observation time,
    // so the backend idempotency key replays instead of writing twice.
    expect(contacts[1].request_id).toBe(contacts[0].request_id);
    expect(contacts[1].captured_at).toBe(contacts[0].captured_at);
    expect(mock.committed).toHaveBeenCalledTimes(1);
  });

  it("resets request ID and observation time together when the intent changes", async () => {
    let fail = true;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      if (fail) {
        return Promise.resolve(
          Response.json({ message: "source rejected" }, { status: 422 }),
        );
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await clickButton("创建新人物");
    await flush(50);
    expect(
      host.querySelector(".context-agent-create__error"),
    ).toBeTruthy();

    // The recruiter edits the note: a changed intent gets a fresh identity and
    // a fresh observation time (never a reused or invented one).
    await type(
      'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      `${NOTE} Edited.`,
    );
    await flush(30);
    fail = false;
    await clickButton("创建新人物");
    await flush(50);

    const posts = resourcePosts();
    expect(posts).toHaveLength(2);
    expect(posts[1].request_id).not.toBe(posts[0].request_id);
    expect(posts[1].captured_at).not.toBe(posts[0].captured_at);
    expect(new Date(posts[1].captured_at).toISOString()).toBe(
      posts[1].captured_at,
    );
    expect(mock.committed).toHaveBeenCalledTimes(1);
  });

  it("does not offer an impossible deferred review for one confirmed owner", async () => {
    const owner = person(PERSON_ID, "Synthetic Current Owner");
    owner.identity_matches = [{ kind: "confirmed_handle", handle_type: "email",
      display_hint: CLUE, source_resource_id: RESOURCE_ID }];
    fetcher.mockImplementation(() => Promise.resolve(Response.json({ people: [owner] })));
    await render();
    await fillCreateDraft();
    expect(host.textContent).toContain("当前归属");
    expect(host.textContent).toContain("移除线索");
    expect(host.textContent).not.toContain("保留为未解决");
    expect(Array.from(host.querySelectorAll("button"))
      .some((button) => button.textContent?.includes("保存待身份审阅"))).toBe(false);
    expect(resourcePosts()).toHaveLength(0);
  });

  it.each([20, 21])("respects the deferred-review maximum after merging name and clue searches (%s people)", async (count) => {
    const namedPeople = Array.from({ length: 20 }, (_, index) => person(
      `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      `Synthetic Candidate ${index + 1}`,
    ));
    const owner = person(count === 20 ? namedPeople[0]!.id : OTHER_PERSON_ID, "Synthetic Current Owner");
    owner.identity_matches = [{ kind: "confirmed_handle", handle_type: "email",
      display_hint: CLUE, source_resource_id: RESOURCE_ID }];
    fetcher.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/people/search")) {
        const { query } = JSON.parse(String(init?.body));
        return Promise.resolve(Response.json({ people: query === CLUE ? [owner] : namedPeople }));
      }
      return Promise.resolve(Response.json({
        receipts: [receipt(namedPeople[0]!.id, { resolution_case_id: CASE_ID })],
      }));
    });
    await render();
    await fillCreateDraft();
    const reviewButton = [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "保存待身份审阅");
    if (count === 20) {
      expect(reviewButton).toBeTruthy();
      await clickButton("保存待身份审阅");
      await flush(50);
      expect(resourcePosts()).toHaveLength(1);
      expect(resourcePosts()[0].candidate_person_ids).toHaveLength(20);
      expect(mock.deferred).toHaveBeenCalledTimes(1);
    } else {
      expect(reviewButton).toBeUndefined();
      expect(host.textContent).toContain("匹配到 21 个人物");
      expect(host.textContent).toContain("缩小范围");
      expect(host.textContent).not.toContain("保留为未解决");
      expect(resourcePosts()).toHaveLength(0);
    }
  });

  it("saves an ambiguous identity for review with its own stable request identity", async () => {
    let fail = true;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(
          Response.json({
            people: [
              person(PERSON_ID, "Synthetic Person One"),
              person(OTHER_PERSON_ID, "Synthetic Person Two"),
            ],
          }),
        );
      }
      if (fail) {
        return Promise.resolve(
          Response.json({ message: "defer rejected" }, { status: 422 }),
        );
      }
      return Promise.resolve(
        Response.json({
          receipts: [receipt(PERSON_ID, { resolution_case_id: CASE_ID })],
        }),
      );
    });
    await render();
    await type('input[placeholder="例如：陈雅宁"]', NAME);
    await type('input[placeholder="例如：合作项目 · 首次沟通"]', CONTEXT);
    await type(
      'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      NOTE,
    );
    await flush();

    await clickButton("保存待身份审阅");
    await flush(50);
    expect(
      host.querySelector(".context-agent-create__error"),
    ).toBeTruthy();
    expect(mock.deferred).not.toHaveBeenCalled();

    fail = false;
    await clickButton("保存待身份审阅");
    await flush(50);

    const posts = resourcePosts();
    expect(posts).toHaveLength(2);
    const [first, second] = posts;
    expect(first.captured_at).toBeTruthy();
    expect(new Date(first.captured_at).toISOString()).toBe(first.captured_at);
    expect(first.scope_mode).toBe("identity_candidates");
    expect(first.candidate_person_ids).toEqual([
      PERSON_ID,
      OTHER_PERSON_ID,
    ]);
    expect(first.title).toBe("你提供的、等待确认身份的来源");
    // Same-intent retry after failure keeps the identity and observation time.
    expect(second.request_id).toBe(first.request_id);
    expect(second.captured_at).toBe(first.captured_at);
    expect(mock.deferred).toHaveBeenCalledWith(CASE_ID);
    expect(mock.committed).not.toHaveBeenCalled();
  });
});

describe("partial-success clue recovery", () => {
  const CLUE_2 = "corrected.clue@example.org";

  it("retries only the corrected clue against the saved person and never writes a second source", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        // After the clue correction a fresh directory search surfaces another
        // person; the committed person must not be silently retargeted.
        return Promise.resolve(
          resourceCall >= 2
            ? Response.json({ people: [person(OTHER_PERSON_ID, "Synthetic Person Two")] })
            : Response.json({ people: [] }),
        );
      }
      resourceCall += 1;
      if (resourceCall === 2) {
        return Promise.resolve(
          Response.json({ message: "clue rejected" }, { status: 422 }),
        );
      }
      // A hypothetical second first-source write would surface a different
      // person; any such write is exactly the regression under test.
      const body = bodyOf(current.init);
      return Promise.resolve(
        Response.json({
          receipts: [
            receipt(
              body.type === "note" && resourceCall > 1
                ? OTHER_PERSON_ID
                : PERSON_ID,
            ),
          ],
        }),
      );
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(50);

    // Partial success: first source/person saved, clue rejected. The message
    // asks the recruiter to review the clue and retry.
    const error = host.querySelector<HTMLParagraphElement>(
      ".context-agent-create__error",
    );
    expect(error).toBeTruthy();
    expect(error!.textContent).toContain("关系来源已保存");

    // Committed source and scope are frozen; the clue stays editable.
    expect(
      host.querySelector<HTMLInputElement>(
        'input[placeholder="例如：陈雅宁"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>(
        'input[placeholder="例如：合作项目 · 首次沟通"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>(
        'input[placeholder="邮箱、电话、LinkedIn 网址或 wechat:ID"]',
      )!.disabled,
    ).toBe(false);

    // The instructed correction: edit the clue, confirm, retry.
    await type(
      'input[placeholder="邮箱、电话、LinkedIn 网址或 wechat:ID"]',
      CLUE_2,
    );
    await flush();
    await setConfirmClue(true);
    await clickPrimary();
    await flush(50);

    const posts = resourcePosts();
    // Exactly one first-source / new_person write, ever.
    expect(
      posts.filter(
        (post) => post.type === "note" || post.scope_mode === "new_person",
      ),
    ).toHaveLength(1);
    expect(posts).toHaveLength(3);
    const contacts = posts.filter((post) => post.type === "contact");
    expect(contacts).toHaveLength(2);
    for (const contact of contacts) {
      // Every clue write binds the same saved person and relationship
      // context, never a person invented by a later search.
      expect(contact.person_id).toBe(PERSON_ID);
      expect(contact.relationship_context_id).toBe(
        RELATIONSHIP_CONTEXT_ID,
      );
      expect(contact.identity_clue_confirmed).toBe(true);
    }
    expect(contacts[1].value).toBe(CLUE_2);
    expect(mock.committed).toHaveBeenCalledTimes(1);
    expect(mock.committed).toHaveBeenCalledWith(
      expect.objectContaining({
        person: expect.objectContaining({
          id: PERSON_ID,
          display_label: NAME,
        }),
        relationship_context: expect.objectContaining({
          id: RELATIONSHIP_CONTEXT_ID,
          display_label: CONTEXT,
        }),
      }),
      expect.any(Array),
      "created_person",
    );
  });

  it("completes the saved person without another source write when the clue is omitted", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 2) {
        return Promise.resolve(
          Response.json({ message: "clue rejected" }, { status: 422 }),
        );
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(50);
    expect(
      host.querySelector(".context-agent-create__error"),
    ).toBeTruthy();

    // Omission path: the recruiter withdraws the unsaved clue and completes.
    await setConfirmClue(false);
    await clickPrimary();
    await flush(50);

    // No further resource write of any kind.
    expect(resourcePosts()).toHaveLength(2);
    expect(mock.committed).toHaveBeenCalledTimes(1);
    const call = mock.committed.mock.calls[0] as unknown as [
      { person: { id: string } },
      unknown[],
      string,
    ];
    expect(call[0].person.id).toBe(PERSON_ID);
    expect(call[1]).toHaveLength(1);
    expect(call[2]).toBe("created_person");
  });
});

// Outcome classification under test: a definitive client/validation rejection
// is a real 4xx answer with a parseable body (the fixtures use 422) and is the
// only outcome that permits correction; transport failures, malformed bodies
// and 5xx answers are uncertain and require exact replay. There is no 503
// fixture anywhere in this file — 503 is asserted to be uncertain below.
describe("lost-response recovery", () => {
  it("replays the exact frozen source request after a lost response and commits once", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        // The server committed personA, but the transport failed before the
        // caller received the response.
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    // Unknown outcome: no unsaved claim, no raw transport error, edits locked.
    expect(host.textContent).toContain("提交结果未知");
    expect(host.textContent).not.toContain("无法保存");
    expect(host.textContent).not.toContain("未保存");
    expect(host.querySelector(".context-agent-create__error")).toBeNull();
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>(
        'input[placeholder="例如：合作项目 · 首次沟通"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>(
        'input[placeholder="邮箱、电话、LinkedIn 网址或 wechat:ID"]',
      )!.disabled,
    ).toBe(true);
    expect(mock.committed).not.toHaveBeenCalled();

    const searchesBeforeRetry = fetcher.mock.calls.filter((call) =>
      String(call[0]).includes("/people/search"),
    ).length;
    await clickButton("用相同内容重试核实");
    await flush(50);

    const posts = resourcePosts();
    expect(posts).toHaveLength(2);
    // The retry is the exact frozen request: same body, ID, observation time.
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[1].request_id).toBe(posts[0].request_id);
    expect(posts[1].captured_at).toBe(posts[0].captured_at);
    // The replay never re-consults the directory lookup or new_person
    // permission: its own committed identity may now appear in search.
    expect(
      fetcher.mock.calls.filter((call) =>
        String(call[0]).includes("/people/search"),
      ).length,
    ).toBe(searchesBeforeRetry);
    // Commits exactly once, with the receipt returned by the replay.
    expect(mock.committed).toHaveBeenCalledTimes(1);
    const call = mock.committed.mock.calls[0] as unknown as [
      unknown,
      Array<{ identity: { person_id: string } }>,
      string,
    ];
    expect(call[1]).toHaveLength(1);
    expect(call[1][0].identity.person_id).toBe(PERSON_ID);
  });

  it("locks source fields in flight and admits one submission for rapid clicks", async () => {
    let resolveSource!: (value: Response) => void;
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      return new Promise<Response>((resolve) => {
        resolveSource = resolve;
      });
    });
    await render();
    await fillCreateDraft();
    const button = host.querySelector<HTMLButtonElement>(
      "button.context-primary-button",
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.click();
      button.click(); // rapid second click in the same tick
    });

    expect(resourceCall).toBe(1);
    expect(host.textContent).toContain("正在提交");
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      )!.disabled,
    ).toBe(true);

    await act(async () => {
      resolveSource(Response.json({ receipts: [receipt()] }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(resourceCall).toBe(1);
    expect(mock.committed).toHaveBeenCalledTimes(1);
  });

  it("replays an unknown clue with the same scope and body without replaying the note", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        return Promise.resolve(Response.json({ receipts: [receipt()] }));
      }
      if (resourceCall === 2) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(50);

    expect(host.textContent).toContain("提交结果未知");
    // An unknown clue must be resolved before any other clue attempt.
    expect(
      host.querySelector<HTMLInputElement>(
        'input[placeholder="邮箱、电话、LinkedIn 网址或 wechat:ID"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled,
    ).toBe(true);

    await clickButton("用相同内容重试核实");
    await flush(50);

    const posts = resourcePosts();
    // The saved first source is never posted again.
    expect(posts.filter((post) => post.type === "note")).toHaveLength(1);
    const contacts = posts.filter((post) => post.type === "contact");
    expect(contacts).toHaveLength(2);
    expect(contacts[1]).toEqual(contacts[0]);
    expect(contacts[1].person_id).toBe(PERSON_ID);
    expect(contacts[1].relationship_context_id).toBe(
      RELATIONSHIP_CONTEXT_ID,
    );
    expect(mock.committed).toHaveBeenCalledTimes(1);
    const call = mock.committed.mock.calls[0] as unknown as [
      unknown,
      unknown[],
      string,
    ];
    expect(call[1]).toHaveLength(2);
  });

  it("preserves the original candidate scope when the defer outcome is unknown", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(
          Response.json({
            people: [
              person(PERSON_ID, "Synthetic Person One"),
              person(OTHER_PERSON_ID, "Synthetic Person Two"),
            ],
          }),
        );
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(
        Response.json({
          receipts: [receipt(PERSON_ID, { resolution_case_id: CASE_ID })],
        }),
      );
    });
    await render();
    await type('input[placeholder="例如：陈雅宁"]', NAME);
    await type('input[placeholder="例如：合作项目 · 首次沟通"]', CONTEXT);
    await type(
      'textarea[placeholder="粘贴由你提供、可说明为何创建此关系的备注。"]',
      NOTE,
    );
    await flush();

    await clickButton("保存待身份审阅");
    await flush(50);
    expect(host.textContent).toContain("提交结果未知");
    expect(mock.deferred).not.toHaveBeenCalled();

    await clickButton("用相同内容重试核实");
    await flush(50);

    const posts = resourcePosts();
    expect(posts).toHaveLength(2);
    // The frozen candidate payload replays exactly.
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[1].candidate_person_ids).toEqual([
      PERSON_ID,
      OTHER_PERSON_ID,
    ]);
    expect(mock.deferred).toHaveBeenCalledWith(CASE_ID);
  });

  it("treats malformed responses as unknown and never claims unsaved or leaks raw errors", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        // Contract-violating success body: proof of nothing.
        return Promise.resolve(Response.json({ unexpected: true }));
      }
      return Promise.resolve(
        new Response("<html>gateway</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    expect(host.textContent).toContain("提交结果未知");
    expect(host.querySelector(".context-agent-create__error")).toBeNull();
    expect(host.textContent).not.toContain("无法保存");
    expect(host.textContent).not.toContain("未保存");
    expect(mock.committed).not.toHaveBeenCalled();

    await clickButton("用相同内容重试核实");
    await flush(50);
    expect(host.textContent).toContain("提交结果未知");
    expect(host.textContent).not.toMatch(/Unexpected|SyntaxError|JSON/i);
    expect(resourcePosts()).toHaveLength(2);
    expect(mock.committed).not.toHaveBeenCalled();
  });

  it("treats a 5xx answer as uncertain rather than a definitive no-effect rejection", async () => {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.resolve(
        Response.json({ message: "upstream unavailable" }, { status: 503 }),
      );
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    expect(host.textContent).toContain("提交结果未知");
    expect(host.querySelector(".context-agent-create__error")).toBeNull();
    // The correction path stays locked; only the exact replay is offered.
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(host.textContent).toContain("用相同内容重试核实");
  });

  it("fails closed on account/session transitions without blind retries", async () => {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.resolve(
        Response.json(
          { code: "authentication_required" },
          { status: 401 },
        ),
      );
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    expect(host.textContent).toContain("登录状态已变化");
    expect(host.querySelector(".context-agent-create__error")).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>("button.context-primary-button")!
        .disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(host.textContent).not.toContain("用相同内容重试核实");
  });
});

describe("receipt validation", () => {
  it("rejects extra receipts for a single-resource request", async () => {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.resolve(Response.json({ receipts: [receipt(), receipt(OTHER_PERSON_ID)] }));
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);
    expect(host.textContent).toContain("提交结果未知");
    expect(mock.committed).not.toHaveBeenCalled();
    expect(resourcePosts()).toHaveLength(1);
  });

  it("treats a truncated receipt as unknown and keeps the exact request replayable", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        return Promise.resolve(Response.json({ receipts: [{}] }));
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    // Neither committed nor "unsaved": unknown, edits locked, exact request kept.
    expect(host.textContent).toContain("提交结果未知");
    expect(host.querySelector(".context-agent-create__error")).toBeNull();
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(mock.committed).not.toHaveBeenCalled();

    await clickButton("用相同内容重试核实");
    await flush(50);
    const posts = resourcePosts();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(mock.committed).toHaveBeenCalledTimes(1);
    const call = mock.committed.mock.calls[0] as unknown as [
      unknown,
      Array<{ identity: { person_id: string } }>,
      string,
    ];
    expect(call[1][0].identity.person_id).toBe(PERSON_ID);
  });

  it("treats a receipt bound to a different existing person as unknown", async () => {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        return Promise.resolve(Response.json({ receipts: [receipt()] }));
      }
      // Wrong existing identity association for the clue request.
      return Promise.resolve(
        Response.json({ receipts: [receipt(OTHER_PERSON_ID)] }),
      );
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(50);

    expect(host.textContent).toContain("提交结果未知");
    expect(host.textContent).toContain("可能已保存");
    // The committed copy must not claim the clue is known-unsaved and editable.
    expect(host.textContent).not.toContain("尚未保存的已确认身份线索");
    expect(mock.committed).not.toHaveBeenCalled();
  });

  it("treats a receipt bound to another request identity as unknown", async () => {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.resolve(
        Response.json({
          receipts: [
            receipt(
              PERSON_ID,
              {},
              "web-resource:11111111-1111-4111-8111-111111111111",
            ),
          ],
        }),
      );
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    expect(host.textContent).toContain("提交结果未知");
    expect(host.querySelector(".context-agent-create__error")).toBeNull();
    expect(mock.committed).not.toHaveBeenCalled();
  });
});

describe("admission and workspace guards", () => {
  it("does not continue after unmount: no clue POST and no host callback", async () => {
    let resolveSource!: (value: Response) => void;
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      return new Promise<Response>((resolve) => {
        resolveSource = resolve;
      });
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(20);
    expect(resourceCall).toBe(1);

    await unmountNow();
    resolveSource(Response.json({ receipts: [receipt()] }));
    await flush(50);

    expect(resourceCall).toBe(1);
    expect(mock.committed).not.toHaveBeenCalled();
  });

  it("stops before the clue POST and host callback when the workspace scope changes", async () => {
    let resolveSource!: (value: Response) => void;
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      return new Promise<Response>((resolve) => {
        resolveSource = resolve;
      });
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(20);

    scopeContainer.dataset.workspaceScope = "other-workspace";
    resolveSource(Response.json({ receipts: [receipt()] }));
    await flush(50);

    expect(resourceCall).toBe(1);
    expect(mock.committed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("已停止提交");
    expect(
      host.querySelector<HTMLButtonElement>("button.context-primary-button")!
        .disabled,
    ).toBe(true);
  });

  it("fails closed when the session expires during the request", async () => {
    let resolveSource!: (value: Response) => void;
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      return new Promise<Response>((resolve) => {
        resolveSource = resolve;
      });
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    await flush(20);

    window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
    resolveSource(Response.json({ receipts: [receipt()] }));
    await flush(50);

    expect(resourceCall).toBe(1);
    expect(mock.committed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("已停止提交");
  });

  it("fails closed when the workspace scope is missing", async () => {
    scopeContainer.remove();
    await render();

    expect(host.textContent).toContain("未找到工作台上下文");
    expect(host.querySelector(".context-agent-create__error")).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>("button.context-primary-button")!
        .disabled,
    ).toBe(true);
    expect(resourcePosts()).toHaveLength(0);
  });
});

describe("replay uncertainty", () => {
  async function reachUnknown(failure: Promise<Response>) {
    let resourceCall = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      resourceCall += 1;
      if (resourceCall === 1) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return failure;
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);
    expect(host.textContent).toContain("提交结果未知");
    await clickButton("用相同内容重试核实");
    await flush(50);
  }

  it("keeps the uncertainty when the replay is answered with a 409 conflict", async () => {
    await reachUnknown(
      Promise.resolve(
        Response.json({ message: "idempotency conflict" }, { status: 409 }),
      ),
    );

    // A 409 on the replay is no proof the first write never committed.
    expect(host.textContent).toContain("提交结果未知");
    expect(host.textContent).not.toContain("未保存");
    expect(host.querySelector(".context-agent-create__error")).toBeNull();
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "用相同内容重试核实",
      ),
    ).toBe(true);
    expect(resourcePosts()).toHaveLength(2);
    expect(mock.committed).not.toHaveBeenCalled();
  });

  it("keeps the uncertainty when the replay is answered with a 404", async () => {
    await reachUnknown(
      Promise.resolve(
        Response.json({ message: "resource withdrawn" }, { status: 404 }),
      ),
    );

    expect(host.textContent).toContain("提交结果未知");
    expect(host.textContent).not.toContain("未保存");
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);
    expect(resourcePosts()).toHaveLength(2);
    expect(mock.committed).not.toHaveBeenCalled();
  });

  it("blocks further writes on session expiry after an unknown outcome while keeping the uncertainty", async () => {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);
    expect(host.textContent).toContain("提交结果未知");

    window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
    await flush(10);

    // The uncertainty warning stays and nothing implies a rollback.
    expect(host.textContent).toContain("提交结果未知");
    expect(host.textContent).toContain("登录状态已变化");
    expect(host.textContent).not.toContain("未保存");
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "用相同内容重试核实",
    );
    expect(retry).toBeTruthy();
    expect(retry!.disabled).toBe(true);
    expect(resourcePosts()).toHaveLength(1);
  });
});

describe("navigation warnings", () => {
  async function reachUnknown() {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);
    expect(host.textContent).toContain("提交结果未知");
  }

  function clickLink(href = "/workspace/people"): MouseEvent {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = "去人物列表";
    scopeContainer.append(link);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(event);
    link.remove();
    return event;
  }

function stubConfirm(accepted: boolean): ReturnType<typeof vi.fn> {
  const confirmSpy = vi.fn(() => accepted);
  vi.stubGlobal("confirm", confirmSpy);
  return confirmSpy;
}

  it("declines client-side link navigation without unmount or any POST", async () => {
    await reachUnknown();
    const confirmSpy = stubConfirm(false);

    const event = clickLink();

    expect(confirmSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("提交结果未知");
    expect(resourcePosts()).toHaveLength(1);
  });

  it("accepts client-side link navigation explicitly while unknown", async () => {
    await reachUnknown();
    const confirmSpy = stubConfirm(true);

    const event = clickLink();

    expect(confirmSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(resourcePosts()).toHaveLength(1);
  });

  it("revokes continuation as soon as navigation is accepted, before unmount", async () => {
    let resolveSource!: (value: Response) => void;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      if (resourcePosts().length === 1) {
        return new Promise<Response>((resolve) => { resolveSource = resolve; });
      }
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    const confirmSpy = stubConfirm(true);
    const event = clickLink();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);

    // A Next transition may retain the old page while it loads its destination.
    // Do not unmount the card before delivering the late successful receipt.
    resolveSource(Response.json({ receipts: [receipt()] }));
    await flush(50);
    expect(resourcePosts()).toHaveLength(1);
    expect(mock.committed).not.toHaveBeenCalled();
  });

  it("keeps same-document skip links available without discarding recovery", async () => {
    await reachUnknown();
    const confirmSpy = stubConfirm(false);
    const event = clickLink(`${window.location.href.split("#")[0]}#main-content`);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    fetcher.mockImplementation(() => Promise.resolve(Response.json({ receipts: [receipt()] })));
    await clickButton("用相同内容重试核实");
    await flush(50);
    expect(mock.committed).toHaveBeenCalledOnce();
  });

  it("stops late continuation on history traversal before the card unmounts", async () => {
    let resolveSource!: (value: Response) => void;
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) return Promise.resolve(Response.json({ people: [] }));
      if (resourcePosts().length === 1) return new Promise<Response>((resolve) => { resolveSource = resolve; });
      return Promise.resolve(Response.json({ receipts: [receipt()] }));
    });
    const originalURL = window.location.href;
    await render();
    await fillCreateDraft();
    await toggleConfirmClue();
    await clickPrimary();
    expect(host.textContent).toContain("浏览器后退会失去本页的核实入口");
    try {
      await act(async () => {
        window.history.pushState({}, "", "/workspace/sessions?history=audit");
        expect(window.location.pathname + window.location.search).toBe("/workspace/sessions?history=audit");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      resolveSource(Response.json({ receipts: [receipt()] }));
      await flush(50);
      expect(resourcePosts()).toHaveLength(1);
      expect(mock.committed).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, "", originalURL);
    }
  });

  it("asks before closing and honours both answers", async () => {
    await reachUnknown();
    const confirmSpy = stubConfirm(false);
    const closeButton = host.querySelector<HTMLButtonElement>(
      "button.context-icon-button",
    )!;

    await act(async () => closeButton.click());
    expect(confirmSpy).toHaveBeenCalled();
    expect(mock.cancelled).not.toHaveBeenCalled();
    expect(host.textContent).toContain("提交结果未知");

    confirmSpy.mockReturnValue(true);
    await act(async () => closeButton.click());
    expect(mock.cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("truthful copy and focus", () => {
  it("renders unknown-outcome copy in the initialDraft summary and focuses the recovery notice", async () => {
    fetcher.mockImplementation((url: string) => {
      if (String(url).includes("/people/search")) {
        return Promise.resolve(Response.json({ people: [] }));
      }
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    await render({
      name: NAME,
      identityClue: "",
      relationshipContext: CONTEXT,
      sourceNote: NOTE,
      trigger: "explicit_add",
    });
    await flush();
    await clickPrimary();
    await flush(50);

    const summary = host.querySelector(
      ".context-agent-create__draft-summary",
    );
    expect(summary).toBeTruthy();
    expect(summary!.textContent).toContain("提交结果未知");
    expect(summary!.textContent).toContain("可能已保存");
    expect(summary!.textContent).not.toContain("尚未发生任何变化");

    const notice = host.querySelector<HTMLDivElement>(
      ".context-agent-create__pending",
    );
    expect(notice).toBeTruthy();
    expect(notice!.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(notice);
  });
});

describe("sealed completion", () => {
  it("seals before the host callback and offers a safe re-open when it throws", async () => {
    mock.committed.mockImplementationOnce(() => {
      throw new Error("host navigation failed");
    });
    await render();
    await fillCreateDraft();
    await clickPrimary();
    await flush(50);

    expect(mock.committed).toHaveBeenCalledTimes(1);
    // Truthful sealed state: acknowledged write, explicit failure, no
    // apparently normal editable form.
    expect(host.textContent).toContain("已保存");
    expect(host.textContent).toContain("打开目标页面未成功");
    expect(
      host.querySelector<HTMLButtonElement>("button.context-primary-button")!
        .disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="例如：陈雅宁"]')!
        .disabled,
    ).toBe(true);

    const reopen = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "重试打开",
    );
    expect(reopen).toBeTruthy();
    await act(async () => reopen!.click());
    expect(mock.committed).toHaveBeenCalledTimes(2);
    const first = mock.committed.mock.calls[0] as unknown as [
      unknown,
      unknown[],
      string,
    ];
    const second = mock.committed.mock.calls[1] as unknown as [
      unknown,
      unknown[],
      string,
    ];
    expect(second[1]).toEqual(first[1]);
    expect(second[2]).toBe(first[2]);

    // Safe exit: closing leaves without any further write.
    const closeButton = host.querySelector<HTMLButtonElement>(
      "button.context-icon-button",
    )!;
    await act(async () => closeButton.click());
    expect(mock.cancelled).toHaveBeenCalledTimes(1);
  });
});
