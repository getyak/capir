import "@/components/workspace-theme.css";

import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { loadAccountSettings } from "@/lib/server/accountBackend";
import { signOutOfWorkspace } from "@/app/login/actions";
import { TalentSignalLabShell } from "@/components/talent-signal-lab/lab-shell";
import {
  WorkspaceMobileSourcesLink,
  WorkspaceShellNav,
} from "@/components/workspace-shell-nav";
import { WorkspaceRecentSessions } from "@/components/workspace-recent-sessions";
import { WorkspaceGlobalSearchDialog } from "@/components/workspace-search";
import { WorkspaceSidebarPeople } from "@/components/workspace-sidebar-people";
import { WorkspacePrivacyEntry, WorkspaceRouteHeader } from "@/components/workspace-route-header";
import { WorkspacePrivacyBoundary } from "@/components/workspace-privacy-boundary";
import { WorkspaceSessionBoundary } from "@/components/workspace-session-boundary";
import styles from "@/components/workspace-shell.module.css";
import {
  readBackendSessionClaims,
  readPrimaryBackendSessionClaims,
} from "@/lib/server/backendAuth";
import { loadCapirTestBanner } from "@/lib/server/capir-test-entry";
import { CapirTestBanner } from "@/components/capir-test-banner";
import {
  TEST_WORKSPACE_COOKIE,
  testWorkspaceSession,
} from "@/lib/server/testWorkspaceSession";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "@/lib/backend-session";
import { leaveTestWorkspace } from "@/app/workspace/settings/testing/actions";
import accountStyles from "@/components/account-settings.module.css";
import { SystemHealthProvider } from "@/components/system-health-provider";
import { AvatarPreferencesProvider } from "@/components/avatar-preferences-provider";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { MeetingDraftSessionBoundary } from "@/components/meeting-draft-session-boundary";
import { WorkspaceDirectoryScope } from "@/components/workspace-directory-cache";
import { SessionDraftSessionBoundary } from "@/components/session-draft-session-boundary";
import { PersonContextPanelProvider } from "@/components/person-context-panel";
import {
  workspaceSessionDraftStorageScope,
  workspaceSessionsBinding,
} from "@/lib/server/workspaceSessions";

function AccountControls({
  accountName,
  workspaceName,
  fixtureWorkspace,
  usageBinding,
}: {
  accountName: string;
  workspaceName: string | null;
  fixtureWorkspace: boolean;
  usageBinding: string | null;
}) {
  return (
    <WorkspaceAccountMenu
      accountName={accountName}
      key={usageBinding}
      usageBinding={usageBinding}
      fixtureWorkspace={fixtureWorkspace}
      signOutAction={signOutOfWorkspace}
      workspaceName={workspaceName}
    />
  );
}

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const session = await auth();

  // Child pages retain the exact callback URL when authentication is missing.
  // Rendering no product chrome here lets their redirect remain authoritative.
  if (!session?.user) {
    return (
      <>
        <MeetingDraftSessionBoundary sessionVersion={null} />
        <SessionDraftSessionBoundary storageScope={null} />
        <WorkspaceDirectoryScope binding={null} />
        {children}
      </>
    );
  }

  let testName: string | null = null;
  try {
    const primary = await readPrimaryBackendSessionClaims();
    if (primary) testName = (await testWorkspaceSession(primary))?.name ?? null;
  } catch {
    testName = "测试会话已过期";
  }
  // The rendered scope must come from the effective backend session, never from
  // account settings: a settings outage must not unbind the rendered workspace.
  let currentDisplayName: string | null = null;
  let scope: string | null = null;
  let pendingBinding: string | null = null;
  let pendingSessionDraftScope: string | null = null;
  let backendAccount: { name: string; slug: string } | null = null;
  try {
    const claims = await readBackendSessionClaims();
    if (claims && !backendSessionIsExpired(claims.backendExpiresAt)) {
      scope = claims.backendAccountId;
      // Identity first: a binding or draft-scope failure must not drop the real
      // account/workspace names from the rendered footer.
      backendAccount = {
        name: claims.backendAccountName,
        slug: claims.backendAccountSlug,
      };
      // Profile labels may change while the signed session remains valid. They
      // never determine the authorization binding or replace its fallback.
      try {
        const profile = await loadAccountSettings();
        if (profile.workspace.id === claims.backendAccountId && profile.user.id === claims.backendUserId) {
          currentDisplayName = profile.user.display_name;
          backendAccount.name = profile.workspace.name;
        }
      } catch (error) {
        // Confirmed revocation is different from a settings/network outage.
        // Do not leave private chrome mounted under an invalid credential.
        if (isBackendSessionExpiredError(error)) throw error;
      }
      pendingBinding = workspaceSessionsBinding(claims);
      pendingSessionDraftScope = workspaceSessionDraftStorageScope(claims);
    }
  } catch {
    /* Scope mismatch or unreadable test session: stay unbound. */
    scope = null;
    pendingBinding = null;
    pendingSessionDraftScope = null;
  }
  const hasTestWorkspace = (await cookies()).has(TEST_WORKSPACE_COOKIE);
  if (!scope) {
    return (
      <>
        <MeetingDraftSessionBoundary sessionVersion={null} />
        <SessionDraftSessionBoundary storageScope={null} />
        <WorkspaceDirectoryScope binding={null} />
        <section className={accountStyles.section} aria-live="polite">
          <h1>需要重新确认登录空间</h1>
          <p className={accountStyles.error}>
            登录空间已变化或会话已过期，暂不能显示工作区内容。
          </p>
          {hasTestWorkspace ? (
            <form action={leaveTestWorkspace}>
              <button type="submit">返回我的空间</button>
            </form>
          ) : (
            <Link href="/login?reason=backend_session_expired">重新登录</Link>
          )}
        </section>
      </>
    );
  }
  const accountName = currentDisplayName ?? session.user.name ?? session.user.email ?? "工作区成员";
  const fixtureFallback =
    !backendAccount && process.env.TALENT_SIGNAL_INTEGRATION_MODE === "true";
  const fixtureWorkspace =
    Boolean(testName) || (backendAccount?.slug.startsWith("fixture-") ?? fixtureFallback);
  const workspaceName = backendAccount?.name ?? null;

  // Canonical operator-run banner: derived from the live run readback for
  // every login method (direct password and private handoff alike), never
  // from a cookie or account name. Expired/revoked/foreign runs fail closed.
  let capirBanner = null;
  try {
    const claims = await readBackendSessionClaims();
    if (claims && !backendSessionIsExpired(claims.backendExpiresAt)) {
      capirBanner = await loadCapirTestBanner(claims);
    }
  } catch {
    capirBanner = null;
  }


  return (
    <WorkspaceSessionBoundary><WorkspacePrivacyBoundary privateContent={children}>
      <AvatarPreferencesProvider scope={pendingSessionDraftScope}>
      <PersonContextPanelProvider binding={pendingBinding}>
      <div lang="zh-CN" className={`ts-workspace-theme quiet-workspace ${styles.shell}`}>
        {pendingBinding ? (
          <MeetingDraftSessionBoundary sessionVersion={pendingBinding} />
        ) : null}
        <SessionDraftSessionBoundary storageScope={pendingSessionDraftScope} />
        <WorkspaceDirectoryScope binding={pendingBinding} />
        <aside aria-label="capri 工作台" className={styles.sidebar}>
          <WorkspaceShellNav binding={pendingBinding} />
          <div className={styles.sidebarScroll}>
            {pendingBinding ? (
              <WorkspaceRecentSessions
                key={pendingBinding}
                binding={pendingBinding}
                storageScope={pendingSessionDraftScope}
              />
            ) : null}
            <WorkspaceSidebarPeople binding={pendingBinding} />
          </div>
          <div className={styles.account}>
            {fixtureWorkspace ? (
              <span className={styles.environmentBadge} title="合成测试工作台——仅含评测数据，不是真实招聘记录">合成测试空间</span>
            ) : null}
            <AccountControls
              accountName={accountName}
              fixtureWorkspace={fixtureWorkspace}
              usageBinding={pendingBinding}
              workspaceName={workspaceName}
            />
          </div>
        </aside>

        <div className={styles.workspace}>
          <header className={styles.mobileHeader}>
            <Link
              aria-label="capri 工作台"
              className={styles.brand}
              href="/workspace"
            >
              <span aria-hidden="true" className={styles.brandMark} />
              <span className={styles.brandName}>capri</span>
            </Link>
            <div className={styles.mobileAccount}>
              <WorkspaceGlobalSearchDialog binding={pendingBinding} />
              <WorkspaceMobileSourcesLink />
              <WorkspacePrivacyEntry mobile />
              <AccountControls
                accountName={accountName}
                fixtureWorkspace={fixtureWorkspace}
                usageBinding={pendingBinding}
                workspaceName={workspaceName}
              />
            </div>
          </header>
          <WorkspaceRouteHeader />
          {/* Lab loads independently after hydration; it must not hold up product HTML. */}
          <TalentSignalLabShell initialManifest={null}>
            <div
              className={styles.stage}
              id="workspace-content"
              data-workspace-scope={scope}
              key={scope}
            >
              <SystemHealthProvider>
                <CapirTestBanner banner={capirBanner} />
                {testName && (
                  <div className={accountStyles.banner} role="status">
                    <span>测试空间 · {testName}</span>
                    <form action={leaveTestWorkspace}>
                      <button type="submit">返回我的空间</button>
                    </form>
                  </div>
                )}
                {children}
              </SystemHealthProvider>
            </div>
          </TalentSignalLabShell>
        </div>
      </div>
      </PersonContextPanelProvider>
      </AvatarPreferencesProvider>
    </WorkspacePrivacyBoundary></WorkspaceSessionBoundary>
  );
}
