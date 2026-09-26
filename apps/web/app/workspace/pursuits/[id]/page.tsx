import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { PursuitMemoryReview } from "@/components/memory-review/pursuit-memory-review";
import { PursuitReviewGate } from "@/components/pursuit-review-gate";
import { PursuitAgentRail } from "@/components/pursuit-agent-rail";
import styles from "@/components/pursuit-room.module.css";
import { PursuitDeadline } from "@/components/pursuit-deadline";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  isPursuitIntegrationMode,
  loadPursuitRoom,
} from "@/lib/server/pursuitBackend";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { mintMemoryEntryCapability } from "@/lib/server/memoryEntryCapability";
import { loadPursuitMemoryScopes } from "@/lib/server/localBackend";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "规范的目标目标、有证据支撑的缺口、行动与审阅。",
  robots: { follow: false, index: false },
  title: "目标工作区",
};

function formatDate(value: string | null): string {
  if (!value) return "尚未安排";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

const pursuitValueLabels: Record<string, string> = {
  accepted_offer: "接受录用意向",
  active: "进行中",
  cancelled: "已取消",
  completed: "已完成",
  evidence_review: "证据审阅",
  final_conversation: "最终沟通",
  interviewing: "面试中",
  mutual_final_decision: "双方最终决定",
  offer_review: "录用意向审阅",
  recruiting: "招聘",
  sales: "客户合作",
  partnership: "伙伴协作",
  collaboration: "合作",
  draft: "草稿",
  paused: "已暂停",
  drafted: "待推进",
  awaiting_confirmation: "待确认",
  scheduled: "已安排",
  in_progress: "进行中",
  available: "证据可用",
  partial: "部分证据可用",
  unavailable: "证据不可用",
  not_required: "由你记录",
  shortlist_review: "候选名单审阅",
};

function displayPursuitValue(value: string): string {
  return pursuitValueLabels[value] ?? value.replaceAll("_", " ");
}

export default async function PursuitRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/workspace/pursuits/${id}`)}`,
    );
  }
  if (!isPursuitIntegrationMode()) redirect("/workspace");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let room: Awaited<ReturnType<typeof loadPursuitRoom>>;
  try {
    room = await loadPursuitRoom(id);
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      redirect(
        backendSessionRecoveryHref(`/workspace/pursuits/${id}`),
      );
    }
    notFound();
  }
  const { pursuit, proposals, agentContext, agentTasks } = room;
  const pursuitClaims = await readBackendSessionClaims();
  const pursuitMemoryBinding = pursuitClaims
    ? contactHandoffSessionVersion(pursuitClaims)
    : null;
  const pursuitMemoryScopes = pursuitClaims
    ? (await loadPursuitMemoryScopes(pursuit.id).catch(() => [])).map((scope) => ({
        ...scope,
        capability: mintMemoryEntryCapability(pursuitClaims, {
          purpose: "relationship",
          personId: scope.person_id,
          contextId: scope.relationship_context_id ?? null,
          pursuitId: pursuit.id,
          pursuitRoleId: scope.role_id ?? null,
          pursuitEvidenceFragmentId: scope.role_evidence_fragment_id ?? null,
          pursuitCaptureId: scope.capture_id ?? null,
          pursuitCaptureVersion: scope.capture_version ?? null,
        }),
      }))
    : [];
  const openGaps = pursuit.gaps.filter((gap) => gap.status === "open");
  const openActions = pursuit.actions.filter(
    (action) => !["completed", "cancelled", "failed"].includes(action.status),
  );

  return (
    <div className={styles.page}>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>{displayPursuitValue(pursuit.type)}目标</p>
          <h1>{pursuit.title}</h1>
          <p>{displayPursuitValue(pursuit.target_outcome)}</p>
          <dl>
            <div>
              <dt>目标日期</dt>
              <dd>{formatDate(pursuit.target_date)}</dd>
            </div>
            <div>
              <dt>里程碑</dt>
              <dd>{displayPursuitValue(pursuit.milestone)}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{displayPursuitValue(pursuit.status)}</dd>
            </div>
            <div>
              <dt>修订版本</dt>
              <dd>{pursuit.revision}</dd>
            </div>
          </dl>
        </section>

        <div className={styles.contentGrid}>
          <div>
            <section className={styles.section}>
              <header>
                <div>
                  <p>依赖项</p>
                  <h2>待解决缺口</h2>
                </div>
                <span>{openGaps.length} 项待解决</span>
              </header>
              {openGaps.length ? (
                <div className={styles.rows}>
                  {openGaps.map((gap) => (
                    <article className={styles.row} key={gap.id}>
                      <div>
                        <strong>{gap.title}</strong>
                        <span>{displayPursuitValue(gap.basis.evidence_state.availability)}</span>
                      </div>
                      <p>{gap.close_condition}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.quiet}>没有记录待解决缺口。</p>
              )}
            </section>

            <section className={styles.section}>
              <header>
                <div>
                  <p>已分配工作</p>
                  <h2>内部行动</h2>
                </div>
                <span>{openActions.length} 项进行中</span>
              </header>
              {openActions.length ? (
                <div className={styles.rows}>
                  {openActions.map((action) => (
                    <article className={styles.row} key={action.id}>
                      <div>
                        <strong>{action.title}</strong>
                        <span>{displayPursuitValue(action.status)}</span>
                      </div>
                      <p>
                        {action.owner_display_name} · <PursuitDeadline value={action.due_at} /> · 仅记录在工作区
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.quiet}>没有进行中的已分配行动。</p>
              )}
            </section>
          </div>

          <PursuitAgentRail
            agentContext={agentContext}
            evidenceHref={proposals.length > 0 ? "#proposal" : null}
            initialTask={agentTasks[0] ?? null}
            pursuit={{
              id: pursuit.id,
              milestone: pursuit.milestone,
              revision: pursuit.revision,
              title: pursuit.title,
            }}
          />

          <PursuitReviewGate
            decisionBundle={agentTasks[0]?.decision_bundle ?? undefined}
            key={pursuit.id}
            proposals={proposals}
          />

          <PursuitMemoryReview
            binding={pursuitMemoryBinding}
            pursuitId={pursuit.id}
            scopes={pursuitMemoryScopes}
          />
        </div>
      </main>
    </div>
  );
}
