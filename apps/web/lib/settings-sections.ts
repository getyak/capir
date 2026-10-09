/**
 * Settings section schema and search index.
 *
 * Kept free of React and `"use client"` so the server route can validate its
 * query parameter and the client frame can render the same navigation. A pure
 * predicate imported from a client component would throw at runtime when a
 * Server Component calls it, which typecheck alone cannot catch.
 *
 * `overview` remains the stable default route and opens personal profile
 * editing. The search index is a static inventory of setting owners: it never
 * reads people, sessions, or any other private relationship data.
 */

export const SETTINGS_SECTIONS = [
  { id: "overview", label: "个人资料", href: "/workspace/settings" },
  { id: "account", label: "账号与安全", href: "/workspace/settings?section=account" },
  { id: "workspace", label: "工作空间", href: "/workspace/settings?section=workspace" },
  { id: "appearance", label: "外观与偏好", href: "/workspace/settings?section=appearance" },
  { id: "connections", label: "连接与权限", href: "/workspace/settings?section=connections" },
  { id: "versions", label: "版本与状态", href: "/workspace/settings?section=versions" },
  { id: "advanced", label: "帮助与诊断", href: "/workspace/settings?section=advanced" },
  { id: "testing", label: "测试与诊断", href: "/workspace/settings?section=testing" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function isSettingsSection(
  value: string | undefined | null,
): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/**
 * Sections shown in the drilldown row. The overview is reachable through its
 * back link, and internal testing stays conditional on the build or workspace.
 */
export function settingsDrilldownSections(labEnabled: boolean) {
  return SETTINGS_SECTIONS.filter(
    (section) =>
      section.id !== "overview" &&
      (section.id !== "testing" || labEnabled),
  );
}

/**
 * One searchable destination. `destination` is the visible owner the result
 * routes to, and `scope` is where the preference or authorization applies.
 * Results are static declarations, so an unknown term can never surface a
 * person, conversation, or relationship record.
 */
export type SettingsSearchEntry = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly destination: string;
  readonly scope: string;
  /** Chinese and English aliases; matching is substring, case-insensitive. */
  readonly keywords: readonly string[];
};

const SECTION_SEARCH: Record<
  SettingsSection,
  Pick<SettingsSearchEntry, "description" | "destination" | "scope" | "keywords">
> = {
  overview: {
    description: "头像、显示名称与个人介绍。",
    destination: "设置 · 个人资料",
    scope: "账号",
    keywords: ["个人资料", "头像", "名字", "显示名称", "个人介绍", "身份", "profile"],
  },
  account: {
    description: "登录方式、邮箱验证与已登录设备。",
    destination: "设置 · 账号与安全",
    scope: "账号",
    keywords: ["账号", "安全", "登录", "密码", "邮箱", "设备", "会话", "退出", "第三方登录"],
  },
  workspace: {
    description: "空间名称、成员与所有权。",
    destination: "设置 · 工作空间",
    scope: "当前空间",
    keywords: ["空间", "工作区", "成员", "所有权", "角色", "权限"],
  },
  appearance: {
    description: "界面主题与本机头像默认风格。",
    destination: "设置 · 外观与偏好",
    scope: "仅此浏览器",
    keywords: ["外观", "主题", "深色", "浅色", "跟随系统", "夜间", "头像风格", "语言", "时区"],
  },
  connections: {
    description: "资料从哪里来，助手能做到哪一步。",
    destination: "设置 · 连接与权限",
    scope: "当前空间",
    keywords: ["连接", "权限", "来源", "授权", "资料", "数据", "外部服务", "边界"],
  },
  versions: {
    description: "查看 Web、后端与各设备的实际版本、来源和检查时间。",
    destination: "设置 · 版本与状态",
    scope: "各组件分别显示",
    keywords: ["版本", "状态", "构建", "revision", "build", "更新", "升级", "release"],
  },
  advanced: {
    description: "连接诊断、运行记录与数据边界。",
    destination: "设置 · 帮助与诊断",
    scope: "当前空间",
    keywords: ["帮助", "诊断", "问题", "排查", "运行记录", "边界", "权限"],
  },
  testing: {
    description: "隔离测试空间与功能实验室。",
    destination: "设置 · 测试与诊断",
    scope: "测试空间",
    keywords: ["测试", "实验室", "诊断", "合成资料"],
  },
};

/** Destinations that are settings-adjacent but owned by another workspace page. */
const DESTINATION_SEARCH: readonly SettingsSearchEntry[] = [
  {
    id: "captures",
    title: "截图与文档",
    description: "导入截图、文档并核对来源与归属。",
    href: "/workspace/captures",
    destination: "资料 · 截图与文档",
    scope: "当前空间",
    keywords: ["截图", "截屏", "屏幕快照", "屏幕截图", "screenshot", "capture", "文档", "导入", "资料"],
  },
  {
    id: "screen-recording-permission",
    title: "屏幕录制权限",
    description: "由这台 Mac 的 capri 应用与 macOS 系统设置管理，Web 设置不能授予。",
    href: "/workspace/settings?section=advanced#device-permissions",
    destination: "设置 · 帮助与诊断 · 设备权限",
    scope: "macOS 设备",
    keywords: ["屏幕录制", "录屏", "屏幕录制权限", "录屏权限", "系统权限", "系统设置", "macos", "screen recording", "permission"],
  },
  {
    id: "extensions",
    title: "连接服务",
    description: "查看可用扩展与真实连接状态。",
    href: "/workspace/extensions",
    destination: "资料 · 连接服务",
    scope: "当前空间",
    keywords: ["连接", "扩展", "外部服务", "集成", "浏览器收集", "浏览器扩展"],
  },
  {
    id: "preferences",
    title: "回复偏好",
    description: "在单独页面管理助手的回复方式。",
    href: "/workspace/preferences",
    destination: "Agent · 回复偏好",
    scope: "账号",
    keywords: ["回复", "偏好", "回答", "回复方式", "回复顺序"],
  },
];

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  ...SETTINGS_SECTIONS.map((section) => {
    const meta = SECTION_SEARCH[section.id];
    return {
      id: section.id,
      title: section.label,
      description: meta.description,
      href: section.href,
      destination: meta.destination,
      scope: meta.scope,
      keywords: meta.keywords,
    };
  }),
  ...DESTINATION_SEARCH,
];

/** NFKC + lowercase + whitespace-free so Chinese and spacing variants match. */
export function normalizeSettingsQuery(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

/**
 * Fast, synchronous substring search over the static index. `testing` stays
 * hidden unless the workspace enables the Lab, matching the rendered nav.
 */
export function searchSettings(
  query: string,
  labEnabled: boolean,
): SettingsSearchEntry[] {
  const normalized = normalizeSettingsQuery(query);
  if (!normalized) return [];
  return SETTINGS_SEARCH_ENTRIES.filter(
    (entry) =>
      (entry.id !== "testing" || labEnabled) &&
      [entry.title, entry.description, ...entry.keywords].some((value) =>
        normalizeSettingsQuery(value).includes(normalized),
      ),
  );
}
