import { beforeEach, expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";

const state = vi.hoisted(() => ({ locale: "en" as LocaleTag }));
vi.mock("@/lib/server/marketing-locale", () => ({
  getMarketingLocale: async () => state.locale,
}));

import { metadata as rootMetadata } from "../layout";
import { generateMetadata as workspaceMetadata } from "./page";
import { generateMetadata as personMetadata } from "./people/[id]/page";
import { translate } from "@/lib/i18n";

beforeEach(() => {
  state.locale = "en";
});

it.each([
  ["en", "Workspace", "An account-specific conversation canvas: start with a message and keep it connected to verifiable sources."],
  ["zh-CN", "工作区", "账号专属的对话画布：从一条消息开始，始终关联可核验的来源。"],
  ["zh-TW", "工作區", "帳號專屬的對話畫布：從一則訊息開始，始終連結可查證的來源。"],
  ["ja", "ワークスペース", "アカウント専用の会話スペース：ひとつのメッセージから始め、常に検証可能な出典と結び付けます。"],
  ["ko", "워크스페이스", "계정 전용 대화 공간: 메시지 하나로 시작하고, 항상 검증 가능한 출처와 연결합니다."],
] as [LocaleTag, string, string][])(
  "uses localized workspace and person subjects for %s",
  async (locale, expectedWorkspaceTitle, expectedDescription) => {
    state.locale = locale;

    const workspace = await workspaceMetadata();
    const person = await personMetadata();

    expect(workspace).toMatchObject({
      title: expectedWorkspaceTitle,
      description: expectedDescription,
      robots: { follow: false, index: false },
    });
    expect(person).toMatchObject({
      title: translate(locale, "人物"),
      robots: { follow: false, index: false },
    });
    expect(String(person.title)).not.toContain("capri");
  },
);

it("leaves the single brand suffix to the root title template", async () => {
  const workspace = await workspaceMetadata();
  const person = await personMetadata();
  const template = (rootMetadata.title as { template: string }).template;

  expect(template).toBe("%s | capri");
  expect(`${workspace.title}${template.replace("%s", "")}`).toBe(
    "Workspace | capri",
  );
  expect(`${person.title}${template.replace("%s", "")}`).toBe(
    "Person | capri",
  );
});
