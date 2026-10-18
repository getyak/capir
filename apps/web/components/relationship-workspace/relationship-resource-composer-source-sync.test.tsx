// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type RelationshipResourceDetail,
  type RelationshipResourceListItem,
} from "@talent-signal/contracts";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/workspace-session-request", () => ({
  relationshipIntegrationFetch: fetcher,
  workspaceSessionFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));

import { RelationshipResourceSection } from "./relationship-resource-section";

const seedId = "b1000000-0000-4000-8000-000000000001";
const sourceUrl = "https://profile.example/person";
const seed: RelationshipResourceListItem = {
  id: seedId,
  capture_id: "capture-a",
  capture_version: 1,
  kind: "public_url",
  input_channel: "chat",
  display_name: "Synthetic public profile",
  media_type: "text/html",
  source_locator: sourceUrl,
  observed_at: "2026-10-08T08:00:00Z",
  processing_state: "needs_fact_review",
  duplicate_of_resource_id: null,
  discovered_from_resource_id: null,
  fragment_count: 0,
  proposed_fragment_count: 0,
  pending_claim_count: 0,
  conflicted_claim_count: 0,
  source_access_state: "available",
  source_authorization_state: "authorized",
  source_authorization_expires_at: null,
};
const detail: RelationshipResourceDetail = {
  contract_version: CONTRACT_VERSION,
  resource: seed,
  fragments: [],
  claim_proposals: [],
};

let root: Root;
let host: HTMLDivElement;
const props = {
  personId: "person-a",
  relationshipContextId: "context-a",
  scopeLabel: "Owned test relationship",
  onCommitted: vi.fn(),
  onEvidenceChanged: vi.fn(),
  onIdentityCorrected: vi.fn(),
  onReviewCapture: vi.fn(),
  onScreenshot: vi.fn(),
  sessionBinding: "binding",
};

async function render() {
  await act(async () => {
    root.render(createElement(RelationshipResourceSection, { ...props, open: true }));
  });
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/local-integration/resources?resource_id=")) return Response.json(detail);
    if (url.includes("/api/local-integration/research")) return Response.json(null);
    if (url.includes("/api/time/person-source-syncs")) {
      return Response.json({ contract_version: CONTRACT_VERSION, syncs: [], session_version: "binding" });
    }
    return Response.json({ resources: [seed] });
  });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("bound public source periodic observation in the composer", () => {
  it("shows the periodic control beside the one-shot research approval", async () => {
    await render();
    const trigger = host.querySelector<HTMLButtonElement>(
      ".context-resource-ledger__list > button",
    )!;
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("定期公开来源读取");
    expect(host.textContent).toContain("公开研究");
    expect(host.textContent).toContain(sourceUrl);
    // The periodic confirmation is structurally separate from the one-shot
    // research approval checkbox.
    const checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const periodic = checkboxes.find((box) =>
      box.parentElement?.textContent?.includes("我确认定期重新读取这一个公开网址"),
    );
    const oneShot = checkboxes.find((box) =>
      box.parentElement?.textContent?.includes("我批准这次有边界的公开研究"),
    );
    expect(periodic).toBeTruthy();
    expect(oneShot).toBeTruthy();
    expect(periodic).not.toBe(oneShot);
    const boundRequest = fetcher.mock.calls.find(([url]) => String(url).startsWith("/api/time/person-source-syncs?"))!;
    expect(new Headers((boundRequest[1] as RequestInit).headers).get("x-workspace-session")).toBe("binding");
  });

  it("does not run periodic setup while the source is ineligible", async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/local-integration/resources?resource_id=")) {
        return Response.json({
          ...detail,
          resource: { ...seed, source_authorization_state: "revoked" },
        });
      }
      if (url.includes("/api/local-integration/research")) return Response.json(null);
      if (url.startsWith("/api/time/person-source-syncs?")) return Response.json({ contract_version: CONTRACT_VERSION, syncs: [], session_version: "binding" });
      return Response.json({ resources: [seed] });
    });
    await render();
    const trigger = host.querySelector<HTMLButtonElement>(
      ".context-resource-ledger__list > button",
    )!;
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("此来源访问已撤销");
    expect(
      host.querySelector('input[type="checkbox"][checked]'),
    ).toBeNull();
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("开始定期读取"),
      ),
    ).toBe(false);
  });
  it.each([200, 503])("does not transfer source A pending intent into source B with list status %s", async (status) => {
    const second = { ...seed, id: "b1000000-0000-4000-8000-000000000099", display_name: "Synthetic second source", source_locator: "https://profile.example/other" };
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/local-integration/resources?resource_id=")) return Response.json({ ...detail, resource: url.includes(second.id) ? second : seed });
      if (url.startsWith("/api/local-integration/research")) return Response.json(null);
      if (url.startsWith("/api/time/person-source-syncs?")) {
        if (url.includes(second.id) && status === 503) return Response.json({ code: "time_unavailable" }, { status });
        return Response.json({ contract_version: CONTRACT_VERSION, syncs: [], session_version: "binding" });
      }
      if (init?.method === "PUT") return Response.json({ code: "time_unavailable" }, { status: 503 });
      return Response.json({ resources: [seed, second] });
    });
    await render();
    const triggers = [...host.querySelectorAll<HTMLButtonElement>(".context-resource-ledger__list > button")];
    await act(async () => triggers.find((b) => b.textContent?.includes(seed.display_name))!.click());
    const region = () => host.querySelector<HTMLElement>('[aria-label="定期公开来源读取"]')!;
    await act(async () => region().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => [...region().querySelectorAll("button")].find((b) => b.textContent?.includes("开始定期读取"))!.click());
    expect(region().textContent).toContain("核实并重试创建");
    await act(async () => triggers.find((b) => b.textContent?.includes(second.display_name))!.click());
    expect(region().textContent).toContain(second.source_locator);
    expect(region().textContent).not.toContain("核实并重试创建");
    const confirmation = region().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (status === 200) expect(confirmation?.checked).toBe(false);
    else expect(confirmation).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT")).toHaveLength(1);
  });

});
