import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

function read(relativePath: string) {
  return readFileSync(resolve(webRoot, relativePath), "utf8");
}

describe("persistent workspace shell", () => {
  it("owns account chrome and route-aware product navigation in one layout", () => {
    const layout = read("app/workspace/layout.tsx");
    const navigation =
      read("components/workspace-shell-nav.tsx") +
      read("lib/workspace-navigation.ts");
    const accountMenu = read("components/workspace-account-menu.tsx");
    const sessionBoundary = read("components/session-draft-session-boundary.tsx");
    const standaloneWorkspace = read("components/workspace-app.tsx");
    const routeHeader = read("components/workspace-route-header.tsx");
    const sidebarPeople = read("components/workspace-sidebar-people.tsx");

    expect(layout).toContain("<WorkspaceShellNav binding={pendingBinding} />");
    expect(layout).toContain('id="workspace-content"');
    expect(layout).toContain("<AccountControls");
    expect(layout).toContain("<MeetingDraftSessionBoundary");
    expect(layout).toContain("<SessionDraftSessionBoundary");
    expect(layout).toContain("storageScope={null}");
    expect(layout).toContain("pendingBinding = workspaceSessionsBinding(claims)");
    expect(layout).toContain(
      "pendingSessionDraftScope = workspaceSessionDraftStorageScope(claims)",
    );
    expect(sessionBoundary).toContain(
      "if (storageScope) prunePendingSessionDrafts(storageScope)",
    );
    expect(sessionBoundary).toContain("clearAllPendingSessionDrafts()");
    expect(sessionBoundary).toContain("clearAllSessionOrganization()");
    expect(layout).toContain("fixtureWorkspace");
    expect(layout).toContain(
      "合成测试工作台——仅含评测数据，不是真实招聘记录",
    );
    expect(navigation).toContain('aria-label="工作台导航"');
    expect(navigation).toContain('aria-current={current ? "page" : undefined}');
    expect(navigation).toContain('href: "/workspace"');
    expect(navigation).toContain('href: "/workspace/today"');
    expect(navigation).toContain('href: "/workspace/sessions"');
    expect(navigation).toContain('href: "/workspace/people"');
    expect(navigation).toContain('href: "/workspace/meetings"');
    expect(navigation).toContain('href: "/workspace/captures"');
    expect(navigation).toContain('href: "/workspace/extensions"');
    expect(navigation).toContain("WorkspaceMobileSourcesLink");
    expect(navigation).toContain('aria-label="打开扩展"');
    // The generic More disclosure is gone, and Sources is a direct primary row.
    expect(navigation).not.toContain("WorkspaceMoreDestinations");
    expect(navigation).not.toContain("更多目的地");
    // Sessions keeps one collapsed-rail icon link, never a duplicate expanded row.
    expect(navigation).toContain("collapsedUtility");
    expect(navigation).toContain('data-collapsed-only="true"');
    expect(navigation).toContain("aria-label={collapsed ? route.label : undefined}");
    // Account utilities align language with the shared icon column.
    expect(accountMenu).toContain("Globe");
    expect(accountMenu).not.toContain("/workspace/plugs");
    // A Session detail supplies its own context; the shell header yields to it.
    expect(routeHeader).toContain("if (SESSION_DETAIL.test(pathname)) return null;");
    // A successfully empty people projection hides the auxiliary group without
    // suppressing actionable read errors or a populated projection.
    expect(sidebarPeople).toContain(
      'if (state === "ready" && people.length === 0) return null;',
    );
    expect(sidebarPeople).toContain("人物目录暂时无法读取");
    expect(layout).toContain("<WorkspaceMobileSourcesLink />");
    const shellStyles = read("components/workspace-shell.module.css");
    expect(shellStyles).toContain(".mobileSources");
    expect(shellStyles).toContain("min-height: 44px");
    expect(shellStyles).toContain("min-width: 44px");
    expect(navigation).not.toContain('href: "/workspace/monitor"');
    expect(navigation).toContain("COLLAPSED_KEY");
    expect(navigation).toContain('data-mobile={route.mobile ? "true" : "false"}');
    expect(accountMenu).toContain("onClick={() => close()}");
    expect(accountMenu).toContain('event.key === "Escape"');
    expect(accountMenu).toContain("current === -1");
    expect(accountMenu).toContain('key === "ArrowUp" ? items.length - 1 : 0');
    expect(accountMenu).toContain("close(true)");
    expect(accountMenu).toContain("trigger.current?.focus()");
    expect(accountMenu).toContain('document.addEventListener("pointerdown"');
    expect(accountMenu).toContain('document.addEventListener("focusin"');
    expect(accountMenu).toContain('"ArrowDown", "ArrowUp", "Home", "End"');
    expect(accountMenu).toContain("moveFocus(event.key");
    expect(accountMenu).toContain("signOutAction");
    expect(accountMenu).toContain("onSubmit={clearPendingLocalIntents}");
    expect(accountMenu).toContain("clearAllPendingMeetingDraftIntents()");
    expect(accountMenu).toContain("clearAllPendingSessionDrafts()");
    expect(accountMenu).toContain("退出登录");
    expect(accountMenu).toContain("<ThemeToggle");
    expect(accountMenu).toContain("accountMenuLabel(identity)");
    expect(accountMenu).toContain("<CaretDown");
    expect(standaloneWorkspace).toContain(
      "onSubmit={clearPendingLocalIntents}",
    );
    expect(standaloneWorkspace).toContain(
      "clearAllPendingMeetingDraftIntents()",
    );
    expect(standaloneWorkspace).toContain("clearAllPendingSessionDrafts()");
  });

  it("keeps the ordinary chrome free of the Lab/FAT overlay", () => {
    const layout = read("app/workspace/layout.tsx");
    const labShell = read("components/talent-signal-lab/lab-shell.tsx");
    const settings = read("components/settings-workspace.tsx");

    expect(layout).not.toContain("capsuleVisible");
    expect(labShell).toContain("capsuleVisible = false");
    expect(labShell).toContain("enabled && capsuleVisible");
    expect(settings).toContain('href="/workspace/lab"');
    expect(settings).toContain('href="/workspace/settings/testing"');
  });

  it("leaves global account and navigation controls out of product surfaces", () => {
    for (const relativePath of [
      "components/pursuit-today-page.tsx",
      "components/people-directory-app.tsx",
      "components/relationship-workspace-app.tsx",
    ]) {
      const source = read(relativePath);
      expect(source).not.toContain("signOutOfWorkspace");
      expect(source).not.toContain("<ThemeToggle");
      expect(source).not.toContain('aria-label="Workspace navigation"');
    }
  });

  it("uses a route-neutral local loading state inside the persistent shell", () => {
    const loading = read("app/workspace/loading.tsx");

    expect(loading).toContain("正在打开当前工作台");
    expect(loading).toContain("你仍可使用侧栏切换页面");
    expect(loading).not.toContain("正在打开依据审阅");
    expect(loading).not.toContain("review-loading__rail");
  });

  it("visually exempts the standalone boundary evaluator from product chrome", () => {
    const shellStyles = read("components/workspace-shell.module.css");
    const boundaryPage = read("app/workspace/boundaries/page.tsx");

    expect(boundaryPage).toContain("<WorkspaceApp");
    expect(shellStyles).toContain(
      ".shell:has(.stage > :global(.review-workspace)) > .sidebar",
    );
    expect(shellStyles).toContain(
      ".shell:has(.stage > :global(.review-workspace))",
    );
    expect(shellStyles).toContain(
      ".shell:has(.stage > :global(.context-workspace)) > .workspace > .routeHeader",
    );
  });

  it("defaults the authenticated workspace to a durable quiet conversation canvas", () => {
    const page = read("app/workspace/page.tsx");
    const canvas = read("components/new-conversation.tsx");
    const shellStyles = read("components/workspace-shell.module.css");

    expect(page).toContain("<WorkspaceNewConversation");
    expect(page).not.toContain('redirect("/workspace/today")');
    expect(page).toContain("contactHandoffSessionVersion(current)");
    expect(page).toContain("workspaceSessionsBinding(current)");
    expect(page).toContain("workspaceSessionDraftStorageScope(current)");
    // Create the canonical Session, persist the intent, then submit governed.
    expect(canvas).toContain('workspaceSessionFetch("/api/workspace-sessions"');
    expect(canvas).toContain("writePendingSessionDraft");
    expect(canvas).toContain("clearPendingSessionDraft");
    expect(canvas).toContain("useWorkspaceChat(");
    expect(canvas).toContain("<AgentTurnThread");
    expect(canvas).toContain("<CapturePanel");
    expect(canvas).not.toContain("window.localStorage");
    expect(canvas).toContain("今天想推进什么？");
    expect(canvas).toContain("new-conversation-objective");
    // The rail width is a Motion-animated variable on the sidebar; the shell
    // column tracks it without ever swapping the DOM between row and column.
    expect(shellStyles).toContain("grid-template-columns: auto minmax(0, 1fr)");
    expect(shellStyles).toContain("width: var(--sidebar-rail-width, 236px)");
    expect(shellStyles).toContain("height: 58px");
  });

  it("focuses the Agent composer from a same-route shell transition and clears the intent", () => {
    const navigation =
      read("components/workspace-shell-nav.tsx") +
      read("lib/workspace-navigation.ts");
    const workspace = read("components/relationship-workspace-app.tsx");

    expect(navigation).toContain(
      'window.dispatchEvent(new Event(WORKSPACE_FOCUS_AGENT_EVENT))',
    );
    expect(workspace).toContain(
      'window.addEventListener("talent-signal:focus-agent", focusAgent)',
    );
    expect(workspace).toContain('location.searchParams.delete("intent")');
    expect(navigation).toContain("/workspace?surface=desk&intent=compose");
  });

  it("routes disconnected workspace pages to explicit safe fallback surfaces", () => {
    const today = read("components/pursuit-today-page.tsx");
    const people = read("components/people-directory-app.tsx");
    const evals = read("app/workspace/evals/page.tsx");
    const disconnected = read("components/workspace-disconnected-state.tsx");

    expect(disconnected).toContain("连接暂时中断");
    expect(today).toContain("<WorkspaceDisconnectedState");
    expect(today).toContain('primaryHref="/workspace/today"');
    expect(today).not.toContain("进入冻结边界案例");
    expect(people).toContain("<WorkspaceDisconnectedState");
    expect(people).toContain('secondaryHref="/workspace"');
    expect(evals).toContain("<WorkspaceDisconnectedState");
    expect(evals).toContain("不要把表单失败误当成评测结果");
  });

  it("does not let an unreachable backend block local sign-out", () => {
    const actions = read("app/login/actions.ts");

    expect(actions).toContain("BACKEND_LOGOUT_TIMEOUT_MS");
    expect(actions).toContain("logoutBackendWithinDeadline");
    expect(actions).toContain('await signOut({ redirectTo: "/" })');
  });
});

describe("settings composition", () => {
  it("keeps account authority in the existing panel and exposes tools as links", () => {
    const settings = read("components/settings-workspace.tsx");
    const panel = read("components/account-settings.tsx");
    const page = read("app/workspace/settings/page.tsx");

    expect(settings).toContain("<AccountSettingsPanel");
    expect(settings).toContain('href="/workspace/extensions"');
    expect(settings).toContain('href="/workspace/captures"');
    expect(settings).toContain('href="/workspace/settings/diagnostics"');
    // Reply preference has one edit owner: the settings surface links to the
    // existing page instead of mounting a second editor.
    expect(settings).toContain('href="/workspace/preferences"');
    expect(settings).not.toContain("<AgentResponsePreference");
    expect(settings).not.toContain("localStorage.setItem(\"talent-signal-account");
    expect(panel).toContain("embedded");
    expect(panel).toContain("saveAccountSettings");
    expect(page).toContain("loadAccountSettings");
    // The login callback and the rendered pane resolve the section through the
    // single tested helper, never by reflecting the raw query value.
    expect(page).toContain("settingsReturnPath(requested)");
    expect(page).toContain("settingsSectionFrom(requested)");
    expect(page).not.toContain("?section=${requested}");
  });
});

describe("relationship workspace initial read", () => {
  it("owns primary reads once and settles independent readbacks concurrently", () => {
    const source = read("lib/server/localBackend.ts");
    const start = source.indexOf(
      "export async function loadRelationshipWorkspaceInitialRead",
    );
    const end = source.indexOf(
      "export type IdentityResolutionWorkflowResult",
      start,
    );
    const loader = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(loader.match(/authenticatedClient\(/g)).toHaveLength(1);
    expect(loader).toContain("await Promise.all([");
    expect(loader).toContain("await Promise.allSettled([");
    expect(loader).toContain("client.getRelationshipAgentHistory(");
    expect(loader).toContain("client.getKnowledge(");
    expect(loader).toContain("accountId: session.account.id");
    expect(loader).toContain("warnings");
  });

  it("passes the signed account boundary even when no review is open", () => {
    const page = read("app/workspace/page.tsx");
    const workspace = read("components/relationship-workspace-app.tsx");

    expect(page).toContain(
      "initialAccountId={initialRead?.accountId ?? null}",
    );
    expect(workspace).toContain("initialAccountId ??");
    expect(workspace).not.toContain("setAccountId(");
  });

  it("routes an expired backend session to a returnable sign-in state", () => {
    const login = read("app/login/page.tsx");
    const today = read("app/workspace/today/page.tsx");
    const people = read("app/workspace/people/page.tsx");
    const workspace = read("app/workspace/page.tsx");

    for (const source of [today, people, workspace]) {
      expect(source).toContain("isBackendSessionExpiredError");
      expect(source).toContain("backendSessionRecoveryHref");
    }
    expect(login).toContain(
      'parameters.reason === "backend_session_expired"',
    );
    expect(login).toContain("登录已过期。重新登录后，可以继续刚才的工作。");
    expect(login).toContain("session?.user && !sessionExpired && !parameters.error");
  });

  it("funnels relationship feature requests through one expiry boundary", () => {
    const root = read("components/relationship-workspace-app.tsx");
    const request = read(
      "components/workspace-session-request.ts",
    );
    const recovery = read(
      "components/use-workspace-session-recovery.ts",
    );
    const status = read(
      "components/relationship-workspace/relationship-workspace-status.tsx",
    );

    expect(root).toContain("beginSessionRecovery");
    expect(root).not.toContain("await fetch(");
    expect(root).toContain("workspaceSessionFetch(");
    expect(recovery).toContain("WORKSPACE_SESSION_EXPIRED_EVENT");
    expect(request).toContain('response.clone().json()');
    expect(request).toContain(
      'responseCode(payload) === "backend_session_expired"',
    );
    expect(status).toContain("登录后继续处理这段关系");
    expect(status).toContain("上一次核验的关系仍保持可见");
    expect(status).toContain("系统没有替换任何关系状态");
    expect(status).toContain("busy && !sessionRecoveryHref");
  });

  it("opens a related capture review without a same-route hard reload", () => {
    const root = read("components/relationship-workspace-app.tsx");
    const resources = read(
      "components/relationship-workspace/relationship-resource-composer.tsx",
    );
    const readback = read(
      "components/relationship-workspace/use-relationship-workspace-readback.ts",
    );

    expect(resources).toContain("onReviewCapture(");
    expect(resources).not.toContain("href={`/workspace?capture=");
    expect(root).toContain("openWorkspaceReview(captureId)");
    expect(root).toContain("所选采集内容审阅已打开，无需重新加载关系工作台");
    expect(readback).toContain("expectedCaptureId: captureId");
    expect(readback).toContain("payload.subject.id");
    expect(readback).toContain("activeScopeKeyRef.current");
  });

  it("moves a corrected source only after target relationship readback", () => {
    const root = read("components/relationship-workspace-app.tsx");
    const resources = read(
      "components/relationship-workspace/relationship-resource-composer.tsx",
    );
    const readback = read(
      "components/relationship-workspace/use-relationship-workspace-readback.ts",
    );

    expect(resources).toContain("await onIdentityCorrected({");
    expect(resources).not.toContain("router.push(");
    expect(resources).toContain("身份更正已记录");
    expect(root).toContain("openWorkspaceReview(input.captureId");
    expect(root).toContain("setRelationshipScope(correctedScope)");
    expect(root).toContain("现在无需重新加载即可打开");
    expect(readback).toContain("expectedScope.relationshipContextId");
    expect(readback).toContain("targetScopeKey");
    expect(readback).toContain("originScopeKey");
  });

  it("pauses Pursuit writes without hiding the last verified projection", () => {
    const today = read("components/pursuit-today-page.tsx");
    const proposal = read("components/pursuit-proposal-review.tsx");

    for (const source of [today, proposal]) {
      expect(source).toContain("workspaceSessionFetch(");
      expect(source).toContain("workspaceSessionExpired(");
      expect(source).toContain("useWorkspaceSessionRecovery(");
      expect(source).toContain("Boolean(sessionRecoveryHref)");
      expect(source).toContain("重新登录");
    }
    expect(today).toContain("上一次核验的今日视图仍保持可见");
    expect(today).toContain("新的智能助理");
    expect(proposal).toContain("你的决定会继续显示在本页");
    expect(proposal).toContain("不会尝试任何规范写入");
  });

  it("binds refreshed Pursuit state to its canonical object identity", () => {
    const today = read("components/pursuit-today-page.tsx");
    const reviewGate = read("components/pursuit-review-gate.tsx");
    const room = read("app/workspace/pursuits/[id]/page.tsx");

    expect(today).toContain("key={focus.pursuitId}");
    expect(room).toContain("key={pursuit.id}");
    expect(reviewGate).toContain("reviewedProposalIds");
    expect(reviewGate).toContain("key={pending.id}");
    expect(reviewGate).toContain("审阅下一项提案");
  });
});
