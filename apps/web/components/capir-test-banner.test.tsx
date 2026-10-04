/**
 * Canonical capir test banner: rendered only from the live canonical
 * operator-owned run readback (state ready + exact live account/user), never
 * from a cookie or account name. It carries the DOM contract the owned
 * browser runner verifies (session state, run identity, run expiry, dataset
 * state/counts) as hidden attributes with quiet human copy.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CapirTestBanner,
  formatDeadline,
  type CapirTestBannerData,
} from "@/components/capir-test-banner";

const run = {
  id: "11111111-1111-4111-8111-111111111111",
  request_id: "44444444-4444-4444-8444-444444444444",
  account_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  username: "qa-1",
  email: "qa-1@lab.invalid",
  preset: "daily" as const,
  preset_version: "1",
  preset_digest: "a".repeat(64),
  counts: { contacts: 12, observations: 30, tasks: 4 },
  state: "ready" as const,
  expires_at: "2099-01-01T00:00:00Z",
  cleanup_error: null,
  login_url: "https://web.example.test/capir/test-entry?run=x",
};

const banner: CapirTestBannerData = {
  run,
  sessionState: "active",
  datasetState: "ready",
  counts: { contacts: 12, observations: 30, tasks: 4 },
  expectedCounts: { contacts: 12, observations: 30, tasks: 4 },
  expiresAt: "2099-01-01T00:00:00Z",
};

describe("capir test banner", () => {
  it("renders the verified canonical run with the runner DOM contract", () => {
    const html = renderToStaticMarkup(<CapirTestBanner banner={banner} />);
    expect(html).toContain('data-capir-run-verification="true"');
    expect(html).toContain('data-capir-session-state="active"');
    expect(html).toContain('data-capir-demo-expiry="2099-01-01T00:00:00Z"');
    expect(html).toContain('data-capir-dataset-state="ready"');
    expect(html).toContain('data-capir-contacts="12"');
    expect(html).toContain('data-capir-observations="30"');
    expect(html).toContain('data-capir-tasks="4"');
    // Canonical identity is compared against the CLI-expected values.
    expect(html).toContain('data-capir-run-id="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('data-capir-account-id="22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('data-capir-user-id="33333333-3333-4333-8333-333333333333"');
    expect(html).toContain('data-capir-username="qa-1"');
  });

  it("shows quiet human copy with a concise deadline", () => {
    const html = renderToStaticMarkup(<CapirTestBanner banner={banner} />);
    expect(html).toContain("测试空间");
    expect(html).toContain(formatDeadline("2099-01-01T00:00:00Z"));
    expect(html).toContain("2099年1月1日 00:00 (UTC)");
    expect(html).toContain("合成数据已就绪");
  });

  it("reports a dataset error instead of a false empty dataset", () => {
    const html = renderToStaticMarkup(
      <CapirTestBanner
        banner={{ ...banner, datasetState: "error", counts: { contacts: 12, observations: 30, tasks: 3 } }}
      />,
    );
    expect(html).toContain('data-capir-dataset-state="error"');
    expect(html).toContain('data-capir-tasks="3"');
    expect(html).toContain("合成数据校验未通过");
  });

  it("renders nothing without a verified canonical run", () => {
    expect(renderToStaticMarkup(<CapirTestBanner banner={null} />)).toBe("");
  });
});
