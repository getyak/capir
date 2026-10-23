import { beforeEach, expect, it, vi } from "vitest";
import type { AccountSettings } from "@talent-signal/contracts";
import { settingsAccount } from "@/lib/test/settings-account";

const request = vi.hoisted(() => ({ settings: vi.fn(), cookie: vi.fn(), header: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: request.cookie }),
  headers: async () => ({ get: request.header }),
}));
vi.mock("@/lib/server/accountBackend", () => ({ loadAccountSettings: request.settings }));
import { getMarketingLocale } from "./marketing-locale";

beforeEach(() => {
  vi.clearAllMocks();
  request.cookie.mockReturnValue({ value: "ja" });
  request.header.mockReturnValue("ko-KR,en;q=0.8");
});

it("follows the browser for a signed-in system preference despite an old public-site cookie", async () => {
  request.settings.mockResolvedValue({ ...settingsAccount, preferences: { display_language: "system" } } satisfies AccountSettings);
  expect(await getMarketingLocale()).toBe("ko");
});

it("treats an absent account preference as system", async () => {
  request.settings.mockResolvedValue({ ...settingsAccount, preferences: undefined } satisfies AccountSettings);
  expect(await getMarketingLocale()).toBe("ko");
});

it("honors an explicitly pinned account language", async () => {
  request.settings.mockResolvedValue({ ...settingsAccount, preferences: { display_language: "zh-TW" } } satisfies AccountSettings);
  expect(await getMarketingLocale()).toBe("zh-TW");
});

it("retains public cookie negotiation when there is no readable account", async () => {
  request.settings.mockRejectedValue(new Error("no account session"));
  expect(await getMarketingLocale()).toBe("ja");
});

it("falls back to the browser when neither an account nor public cookie is available", async () => {
  request.settings.mockRejectedValue(new Error("no account session"));
  request.cookie.mockReturnValue(undefined);
  expect(await getMarketingLocale()).toBe("ko");
});
