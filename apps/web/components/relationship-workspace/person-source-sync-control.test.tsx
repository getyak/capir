// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type PersonSourceSyncListResponse,
  type PersonSourceSyncRecord,
  type PersonSourceSyncRunsResponse,
} from "@talent-signal/contracts";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/workspace-session-request", () => ({
  relationshipIntegrationFetch: fetcher,
  workspaceSessionFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));

import {
  PersonSourceSyncControl,
  type PersonSourceSyncControlProps,
} from "./person-source-sync-control";

const syncId = "b1000000-0000-4000-8000-000000000001";
const personId = "b1000000-0000-4000-8000-000000000002";
const contextId = "b1000000-0000-4000-8000-000000000003";
const seedId = "b1000000-0000-4000-8000-000000000004";
const sourceUrl = "https://profile.example/person";

/**
 * Frozen grant fields with a NON-default expiry and a zone different from the
 * stubbed browser zone, so a paused/resumed update must echo them exactly.
 */
function syncRecord(
  overrides: Partial<PersonSourceSyncRecord> = {},
): PersonSourceSyncRecord {
  return {
    id: syncId,
    revision: 1,
    last_operation_id: syncId,
    created_at: "2026-12-01T00:00:00.000Z",
    updated_at: "2026-12-01T00:00:00.000Z",
    status: "active",
    effective_state: "active",
    content_available: true,
    person_id: personId,
    person_label: "Synthetic Person",
    relationship_context_id: contextId,
    seed_resource_id: seedId,
    source_url: sourceUrl,
    allowed_domain: "profile.example",
    purpose: "Owner-confirmed periodic re-read of one bound public source for one person.",
    time_zone: "Asia/Shanghai",
    interval_seconds: 86_400,
    // Exact non-default expiry (not today+30 and not a 23:59:59 value).
    expires_at: "2027-02-14T09:30:00.000Z",
    next_due_at: "2026-12-31T00:00:00.000Z",
    authority: "user_authored",
    external_effect: "none",
    ...overrides,
  };
}

const runsResponse: PersonSourceSyncRunsResponse = {
  contract_version: CONTRACT_VERSION,
  grant_id: syncId,
  runs: [{
    id: syncId,
    grant_id: syncId,
    cycle_due_at: "2026-12-30T16:00:00.000Z",
    created_at: "2026-12-30T16:00:00.000Z",
    started_at: null,
    completed_at: null,
    status: "unknown",
    settled: false,
    attempt_count: 1,
    attempt_limit: 3,
    deadline_at: "2026-12-30T16:15:00.000Z",
    task_id: null,
    new_observations: 0,
    content_available: true,
    source_url: sourceUrl,
    observed_canonical_url: null,
    warning_codes: ["PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED"],
    stop_reason: null,
    authority: "unconfirmed",
    external_effect: "none",
  }],
  complete: true,
};

let root: Root;
let host: HTMLDivElement;
const props: PersonSourceSyncControlProps = {
  personId,
  relationshipContextId: contextId,
  seedResourceId: seedId,
  sourceUrl,
  sourceAuthorizationState: "authorized",
  sessionBinding: "binding",
  onChanged: vi.fn(),
};
const listURL = (url: string) => url.startsWith("/api/time/person-source-syncs?");

function bffJson(payload: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  return Response.json(status < 400 ? { ...(payload as object), session_version: "binding" } : payload, init);
}

function listPayload(syncs: PersonSourceSyncRecord[]): PersonSourceSyncListResponse {
  return { contract_version: CONTRACT_VERSION, syncs };
}

/**
 * Mirrors the backend's real invariants for an update: exact expected
 * revision plus equality of the frozen person/context/source/url/zone/expiry
 * fields (personSourceSync.ts putPersonSourceSync). A UI that invents new
 * defaults therefore really fails here, exactly as it would on the server.
 */
function backendUpdate(
  target: PersonSourceSyncRecord,
  body: Record<string, unknown>,
): { status: number; payload: unknown } {
  if (body.expected_revision !== target.revision) {
    return { status: 409, payload: { code: "PERSON_SOURCE_SYNC_REVISION_CONFLICT" } };
  }
  for (const field of [
    "person_id",
    "relationship_context_id",
    "seed_resource_id",
    "source_url",
    "time_zone",
    "expires_at",
  ]) {
    if (body[field] !== (target as unknown as Record<string, unknown>)[field]) {
      return { status: 409, payload: { code: "PERSON_SOURCE_SYNC_INTENT_CONFLICT" } };
    }
  }
  const paused = body.status === "paused";
  return {
    status: 200,
    payload: {
      contract_version: CONTRACT_VERSION,
      sync: {
        ...target,
        revision: target.revision + 1,
        status: paused ? "paused" : "active",
        effective_state: paused ? "paused" : "active",
      },
    },
  };
}

async function render(overrides: Partial<typeof props> = {}) {
  await act(async () => {
    root.render(
      createElement(PersonSourceSyncControl, { ...props, ...overrides }),
    );
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  expect(match).toBeTruthy();
  return match as HTMLButtonElement;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

function putBodies(): Array<Record<string, unknown>> {
  return fetcher.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === "PUT")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
}

function putRawBodies(): string[] {
  return fetcher.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === "PUT")
    .map((call) => String((call[1] as RequestInit).body));
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetcher.mockReset();
  props.onChanged = vi.fn();
  // Deterministic browser zone: the fixture grant zone is Asia/Shanghai, so a
  // UI that mixes the two up is detectable.
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: "UTC",
  } as Intl.ResolvedDateTimeFormatOptions);
  fetcher.mockImplementation(async (url: string) =>
    listURL(url)
      ? bffJson(listPayload([]))
      : url.includes("/runs")
        ? bffJson(runsResponse)
        : bffJson({ contract_version: CONTRACT_VERSION, sync: syncRecord() }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("person source sync control", () => {
  it("looks up any existing grant cross-device by exact person/context/seed with the session binding", async () => {
    await render();
    const [request] = fetcher.mock.calls[0] as unknown[];
    expect(String(request)).toContain(`person_id=${personId}`);
    expect(String(request)).toContain(`relationship_context_id=${contextId}`);
    expect(String(request)).toContain(`seed_resource_id=${seedId}`);
    const init = fetcher.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(new Headers(init.headers).get("x-workspace-session")).toBe("binding");
    // No grant yet: the deliberate confirmation surface is shown.
    expect(host.textContent).toContain("我确认定期重新读取这一个公开网址");
  });

  it("requires the separate periodic confirmation and sends the chosen custom expiry", async () => {
    await render();
    const confirm = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const expiry = host.querySelector<HTMLInputElement>('input[type="date"]')!;
    const expectedDefault = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(expiry.value).toBe(expectedDefault);
    // Owner chooses a custom expiry instead of the 30-day default.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(expiry, "2027-03-05");
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
      expiry.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button("开始定期读取").disabled).toBe(true);
    await act(async () => {
      confirm.click();
    });
    expect(button("开始定期读取").disabled).toBe(false);
    await click("开始定期读取");
    const body = putBodies()[0]!;
    expect(body).toMatchObject({
      person_id: personId,
      relationship_context_id: contextId,
      seed_resource_id: seedId,
      source_url: sourceUrl,
      interval_seconds: 86_400,
      expires_at: "2027-03-05T23:59:59.000Z",
      status: "active",
      confirmation: "periodic_public_source_re_read",
    });
    // The one-shot research checkbox is never this confirmation.
    expect(host.textContent).toContain("与一次性公开研究批准是两次不同的决定");
  });

  it("echoes the grant's exact frozen fields on pause and resume under real fixed-field validation", async () => {
    const target = syncRecord();
    let current = target;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([current]));
      if (url.includes("/runs")) return bffJson(runsResponse);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const result = backendUpdate(current, body);
      if (result.status === 200) {
        current = (result.payload as { sync: PersonSourceSyncRecord }).sync;
      }
      return bffJson(result.payload, { status: result.status });
    });
    await render();
    await click("暂停");
    expect(host.textContent).toContain("已暂停");
    const pauseBody = putBodies()[0]!;
    // Exact frozen values — the custom expiry and non-browser zone included.
    expect(pauseBody).toMatchObject({
      expected_revision: 1,
      person_id: personId,
      relationship_context_id: contextId,
      seed_resource_id: seedId,
      source_url: sourceUrl,
      time_zone: "Asia/Shanghai",
      expires_at: "2027-02-14T09:30:00.000Z",
      interval_seconds: 86_400,
      status: "paused",
      confirmation: "periodic_public_source_re_read",
    });
    await click("恢复");
    expect(host.textContent).toContain("定期读取中");
    const resumeBody = putBodies()[1]!;
    expect(resumeBody).toMatchObject({
      expected_revision: 2,
      expires_at: "2027-02-14T09:30:00.000Z",
      time_zone: "Asia/Shanghai",
      status: "active",
    });
    expect(props.onChanged).toHaveBeenCalled();
  });

  it("resends the exact original request with its original expected revision after a lost response", async () => {
    const target = syncRecord();
    let attempts = 0;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([target]));
      if (url.includes("/runs")) return bffJson(runsResponse);
      attempts += 1;
      if (attempts === 1) {
        // Response loss: the server may or may not have applied it.
        return bffJson({ code: "time_unavailable" }, { status: 503 });
      }
      const result = backendUpdate(
        target,
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      return bffJson(result.payload, { status: result.status });
    });
    await render();
    await click("暂停");
    expect(host.textContent).toContain("请重试");
    await click("核实并重试暂停");
    const bodies = putRawBodies();
    expect(bodies).toHaveLength(2);
    // Byte-identical replay: same idempotency key, same expected revision and
    // the same frozen intent — never a re-derived request.
    expect(bodies[1]).toBe(bodies[0]);
    expect(putBodies()[1]).toMatchObject({
      expected_revision: 1,
      expires_at: "2027-02-14T09:30:00.000Z",
    });
  });

  it("renders instant clocks in the grant's actual IANA zone with a matching label", async () => {
    fetcher.mockImplementation(async (url: string) =>
      listURL(url)
        ? bffJson(listPayload([syncRecord()]))
        : bffJson(runsResponse),
    );
    await render();
    // next_due_at 2026-12-31T00:00Z is 08:00 in Asia/Shanghai and 19:00 on
    // 12/30 in America/New_York; only the grant zone may be shown.
    expect(host.textContent).toContain("Asia/Shanghai");
    expect(host.textContent).not.toContain("时间按 UTC 显示");
    expect(host.textContent).toContain("08:00");
    // The interval stays an exact 86400-second UTC duration.
    expect(host.textContent).toContain("每 24 小时（固定间隔）");
  });

  it("follows a DST grant zone across its clock change", async () => {
    fetcher.mockImplementation(async (url: string) =>
      listURL(url)
        ? bffJson(listPayload([syncRecord({
            time_zone: "America/New_York",
            next_due_at: "2026-07-04T12:00:00.000Z",
          })]))
        : bffJson(runsResponse),
    );
    await render();
    expect(host.textContent).toContain("America/New_York");
    // 2026-07-04T12:00Z is 08:00 EDT.
    expect(host.textContent).toContain("08:00");
  });

  it("keeps the same grant zone label after a DST fall-back", async () => {
    fetcher.mockImplementation(async (url: string) =>
      listURL(url)
        ? bffJson(listPayload([syncRecord({
            time_zone: "America/New_York",
            next_due_at: "2026-01-04T12:00:00.000Z",
          })]))
        : bffJson(runsResponse),
    );
    await render();
    expect(host.textContent).toContain("America/New_York");
    // 2026-01-04T12:00Z is 07:00 EST — the label stays the grant zone.
    expect(host.textContent).toContain("07:00");
  });

  it("reads back the latest real status and next run without fabricating success", async () => {
    fetcher.mockImplementation(async (url: string) =>
      listURL(url)
        ? bffJson(listPayload([syncRecord()]))
        : bffJson(runsResponse),
    );
    await render();
    expect(host.textContent).toContain("定期读取中");
    expect(host.textContent).toContain("下次读取");
    expect(host.textContent).toContain("最近一轮：结果待核实");
    expect(host.textContent).toContain("结果仍未核实");
  });

  it("requires DELETE then a fresh explicit confirmation to replace an expired grant", async () => {
    let current: PersonSourceSyncRecord | null = syncRecord({ effective_state: "expired", expires_at: new Date(Date.now() - 60_000).toISOString() });
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload(current ? [current] : []));
      if (url.endsWith("/runs")) return bffJson(runsResponse);
      if (init?.method === "DELETE") {
        current = null;
        return bffJson({ contract_version: CONTRACT_VERSION, sync: syncRecord({ status: "deleted", effective_state: "deleted" }) });
      }
      const body = JSON.parse(String(init?.body));
      current = syncRecord({ id: String(url.split("/").at(-1)), expires_at: body.expires_at, time_zone: body.time_zone });
      return bffJson({ contract_version: CONTRACT_VERSION, sync: current });
    });
    await render();
    expect(host.textContent).toContain("已到期 · 需重新确认");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("恢复"))).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("暂停"))).toBe(false);
    await click("删除定期观察");
    const confirm = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(confirm.checked).toBe(false);
    expect(button("开始定期读取").disabled).toBe(true);
    expect(putBodies()).toHaveLength(0);
    await act(async () => confirm.click());
    await click("开始定期读取");
    const creation = fetcher.mock.calls.find(([,init]) => (init as RequestInit)?.method === "PUT")!;
    expect(creation[0]).not.toBe(`/api/time/person-source-syncs/${syncId}`);
    expect(putBodies()[0]!.expected_revision).toBe(0);
    expect(host.textContent).toContain("定期读取中");
  });

  it("hides pause/resume when the frozen source content is no longer available", async () => {
    fetcher.mockImplementation(async (url: string) =>
      listURL(url)
        ? bffJson(listPayload([syncRecord({ content_available: false })]))
        : bffJson(runsResponse),
    );
    await render();
    expect(host.textContent).toContain("只能删除");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("暂停"))).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("恢复"))).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("删除定期观察"))).toBe(true);
  });

  it("shows a readable source-ineligible reason and never offers creation", async () => {
    await render({ sourceAuthorizationState: "revoked" });
    expect(host.textContent).toContain("此来源访问已撤销");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("keeps response-loss dirty state on create retries with the same idempotency key", async () => {
    let attempts = 0;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([]));
      if (init?.method === "PUT") {
        attempts += 1;
        return attempts === 1
          ? bffJson({ code: "time_unavailable" }, { status: 503 })
          : bffJson({ contract_version: CONTRACT_VERSION, sync: syncRecord() });
      }
      return bffJson(runsResponse);
    });
    await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("开始定期读取");
    expect(host.textContent).toContain("尚未核实");
    await click("核实并重试创建");
    const bodies = putRawBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(props.onChanged).toHaveBeenCalled();
  });

  it("requires the owner session binding and refuses to mutate without it", async () => {
    await render({ sessionBinding: null });
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain("登录状态已改变");
    expect(host.querySelector("button")).toBeNull();
  });
  it("rejects a mismatched real BFF session envelope before showing or mutating a grant", async () => {
    fetcher.mockResolvedValue(Response.json({ ...listPayload([syncRecord()]), session_version: "other-session" }));
    await render();
    expect(host.textContent).toContain("登录状态已改变");
    expect(putBodies()).toHaveLength(0);
    expect(host.querySelector("button")).toBeNull();
  });

  it("discards an old source confirmation/pending create when the same person opens a different source", async () => {
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([]));
      if (init?.method === "PUT") return bffJson({ code: "time_unavailable" }, { status: 503 });
      return bffJson(runsResponse);
    });
    await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("开始定期读取");
    expect(putBodies()).toHaveLength(1);
    expect(host.textContent).toContain("尚未核实");
    await render({ seedResourceId: "b1000000-0000-4000-8000-000000000099", sourceUrl: "https://profile.example/other" });
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(button("开始定期读取").disabled).toBe(true);
    expect(host.textContent).not.toContain("核实并重试创建");
    await click("开始定期读取");
    expect(putBodies()).toHaveLength(1);
  });

  it("does not resurrect old source state or start runs after its response.json arrives late", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldJson = new Promise<unknown>((resolve) => { resolveOld = resolve; });
    fetcher.mockImplementation(async (url: string) => {
      if (listURL(url) && url.includes(seedId)) return { ok: true, status: 200, json: () => oldJson } as Response;
      return bffJson(listPayload([]));
    });
    await render();
    await render({ seedResourceId: "b1000000-0000-4000-8000-000000000099", sourceUrl: "https://profile.example/other" });
    await act(async () => resolveOld({ ...listPayload([syncRecord()]), session_version: "binding" }));
    expect(host.textContent).toContain("https://profile.example/other");
    expect(host.textContent).not.toContain("定期读取中");
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/runs"))).toBe(false);
  });

  it("does not offer creation when a new source lookup fails and old source state was active", async () => {
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return bffJson({ code: "time_unavailable" }, { status: 503 });
      return listURL(url) ? bffJson(listPayload([syncRecord()])) : bffJson(runsResponse);
    });
    await render();
    await click("暂停");
    expect(host.textContent).toContain("核实并重试暂停");
    fetcher.mockImplementation(async () => bffJson({ code: "time_unavailable" }, { status: 503 }));
    await render({ seedResourceId: "b1000000-0000-4000-8000-000000000099", sourceUrl: "https://profile.example/other" });
    expect(host.textContent).toContain("现有设置尚未核实");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("暂停"))).toBe(false);
    expect(putBodies()).toHaveLength(1);
    expect(host.textContent).not.toContain("核实并重试暂停");
  });

  it("allows a fresh edited intent after a definite validation rejection instead of replaying the rejected body", async () => {
    let attempts = 0;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([]));
      if (init?.method === "PUT") {
        attempts += 1;
        return bffJson({ code: "PERSON_SOURCE_SYNC_EXPIRY_INVALID" }, { status: 422 });
      }
      return bffJson(runsResponse);
    });
    await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("开始定期读取");
    expect(host.textContent).toContain("未来的到期时间");
    expect(host.textContent).not.toContain("核实并重试创建");
    const expiry = host.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(expiry.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(expiry, "2027-03-06");
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
      expiry.dispatchEvent(new Event("change", { bubbles: true }));
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await click("开始定期读取");
    expect(attempts).toBe(2);
    const bodies = putBodies();
    expect(bodies[1]!.expires_at).toBe("2027-03-06T23:59:59.000Z");
    expect(bodies[1]!.idempotency_key).not.toBe(bodies[0]!.idempotency_key);
  });

  it("reads a real CAS conflict before a new owner action can use the current revision", async () => {
    let current = syncRecord();
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([current]));
      if (url.endsWith("/runs")) return bffJson(runsResponse);
      const body = JSON.parse(String(init?.body));
      if (body.expected_revision === 1) {
        current = syncRecord({ revision: 2 });
        return bffJson({ code: "PERSON_SOURCE_SYNC_REVISION_CONFLICT" }, { status: 409 });
      }
      const result = backendUpdate(current, body);
      if (result.status === 200) current = (result.payload as { sync: PersonSourceSyncRecord }).sync;
      return bffJson(result.payload, { status: result.status });
    });
    await render();
    await click("暂停");
    expect(host.textContent).toContain("设置已改变");
    expect(host.textContent).not.toContain("核实并重试暂停");
    await click("暂停");
    expect(putBodies().map((body) => body.expected_revision)).toEqual([1, 2]);
    expect(host.textContent).toContain("已暂停");
  });

  it.each(["revoked", "expired"] as const)("allows owner DELETE without restoring %s source access", async (state) => {
    let deleted = false;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload(deleted ? [] : [syncRecord()]));
      if (init?.method === "DELETE") {
        deleted = true;
        return bffJson({ contract_version: CONTRACT_VERSION, sync: syncRecord({ status: "deleted", effective_state: "deleted" }) });
      }
      return bffJson(runsResponse);
    });
    await render({ sourceAuthorizationState: state });
    expect(button("删除定期观察").disabled).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("恢复"))).toBe(false);
    await click("删除定期观察");
    const request = fetcher.mock.calls.find(([,init]) => (init as RequestInit)?.method === "DELETE")!;
    expect(JSON.parse(String((request[1] as RequestInit).body)).expected_revision).toBe(1);
    expect(putBodies()).toHaveLength(0);
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it.each(["Asia/Shanghai", "America/New_York"])("shows the actual UTC expiry instant before confirmation in %s", async (zone) => {
    vi.mocked(Intl.DateTimeFormat.prototype.resolvedOptions).mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions);
    await render();
    expect(host.textContent).toContain("UTC 到期日");
    const expiry = host.querySelector<HTMLInputElement>('input[type="date"]')!;
    const selectedInstant = new Date(`${expiry.value}T23:59:59.000Z`);
    expect(host.textContent).toContain(selectedInstant.toLocaleString("zh-CN", { timeZone: zone, year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }));
    expect(Date.parse(`${expiry.max}T23:59:59.000Z`)).toBeLessThanOrEqual(Date.now() + 366 * 86_400_000);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("开始定期读取");
    expect(putBodies()[0]!.expires_at).toBe(selectedInstant.toISOString());
    expect(putBodies()[0]!.time_zone).toBe(zone);
  });

  it("ignores a late mutation JSON and callback after the owner changes source/session scope", async () => {
    let resolveMutation!: (value: unknown) => void;
    const mutationJson = new Promise<unknown>((resolve) => { resolveMutation = resolve; });
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { ok: true, status: 200, json: () => mutationJson } as Response;
      return bffJson(listPayload([]));
    });
    await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("开始定期读取");
    // A different session is a distinct scope even for the same Person/source.
    fetcher.mockImplementation(async () => Response.json({ ...listPayload([]), session_version: "new-binding" }));
    await render({ sessionBinding: "new-binding" });
    const callsBefore = fetcher.mock.calls.length;
    await act(async () => resolveMutation({ contract_version: CONTRACT_VERSION, sync: syncRecord(), session_version: "binding" }));
    expect(fetcher.mock.calls).toHaveLength(callsBefore);
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it.each([true, false])("keeps an unknown earlier commit fenced after a later422 unless its exact operation is proven (proof=%s)", async (proven) => {
    let originalKey = "";
    let putAttempts = 0;
    let readback: PersonSourceSyncRecord | null = null;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (listURL(url)) return bffJson(listPayload([readback ?? syncRecord()]));
      if (url.endsWith("/runs")) return bffJson(runsResponse);
      if (init?.method === "PUT") {
        originalKey = JSON.parse(String(init.body)).idempotency_key;
        putAttempts += 1;
        return putAttempts === 1 ? bffJson({ code: "time_unavailable" }, { status: 503 }) : bffJson({ code: "PERSON_SOURCE_SYNC_EXPIRY_INVALID" }, { status: 422 });
      }
      readback = syncRecord({ revision: 2, last_operation_id: proven ? originalKey : syncId, status: "paused", effective_state: "expired", expires_at: new Date(Date.now() - 1_000).toISOString() });
      return bffJson({ contract_version: CONTRACT_VERSION, sync: readback });
    });
    await render();
    await click("暂停");
    await click("核实并重试暂停");
    expect(putRawBodies()[1]).toBe(putRawBodies()[0]);
    expect(fetcher.mock.calls.some(([url, init]) => url === `/api/time/person-source-syncs/${syncId}` && !(init as RequestInit)?.method)).toBe(true);
    if (proven) {
      expect(host.textContent).not.toContain("核实并重试暂停");
      expect(host.textContent).toContain("已到期 · 需重新确认");
      expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    }
    else {
      expect(host.textContent).toContain("上次操作仍未核实");
      expect(host.textContent).toContain("核实并重试暂停");
      expect(button("删除定期观察").disabled).toBe(true);
    }
    expect(putBodies()).toHaveLength(2);
  });

});
