"use client";

import "@/components/workspace-theme.css";
import Link from "next/link";
import { useMemo, useState } from "react";
import { WorkspaceSelectionScope, WorkspaceSelectionHighlight } from "@/components/workspace-selection-highlight";
import { WorkspaceListRow } from "@/components/workspace-list-motion";
import { AnswerBlockFrame } from "@/components/conversation/session-message-parts";
import { createAnswerSeamRegistry } from "@/components/conversation/answer-seam";

import { WorkspaceShellNav } from "@/components/workspace-shell-nav";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { SessionDirectory, type SessionSummary } from "@/components/session-workbench/session-directory";
import styles from "@/components/workspace-shell.module.css";

const SESSIONS: SessionSummary[] = [
  { session_id: "11111111-1111-4111-8111-111111111111", title: "核对试点排期", revision: 1, updated_at: "2026-10-01T08:00:00.000Z", expires_at: "2027-10-01T08:00:00.000Z", state: "active", turn_count: 3, is_unread: true, scope_kind: "unresolved_intent", person_label: "", context_label: "", scope: { kind: "unresolved_intent" } },
  { session_id: "22222222-2222-4222-8222-222222222222", title: "整理协作会议", revision: 1, updated_at: "2026-10-01T07:00:00.000Z", expires_at: "2027-10-01T08:00:00.000Z", state: "active", turn_count: 2, is_unread: false, scope_kind: "unresolved_intent", person_label: "", context_label: "", scope: { kind: "unresolved_intent" } },
  { session_id: "33333333-3333-4333-8333-333333333333", title: "准备下一次沟通", revision: 1, updated_at: "2026-10-01T06:00:00.000Z", expires_at: "2027-10-01T08:00:00.000Z", state: "active", turn_count: 1, is_unread: false, scope_kind: "unresolved_intent", person_label: "", context_label: "", scope: { kind: "unresolved_intent" } },
];

const ANSWER = [
  "这是一段合成演练文本，用于验证阅读和交互，不代表真实关系记录。",
  "先核对试点排期，再确认下一次沟通的时间。正文、出处和需要人决定的事项应保持清晰的层级，不能因为视觉动效而获得新的执行权限。",
  "长回复收起时，只提取原文的开头，不生成额外判断。展开后，应看到与收起前一致的全文。选择文字、横向阅读表格和操作代码区域时，阅读控件不会抢走这些操作。",
  "会话归档仅整理这个设备上的列表，会话本身继续保留。归档后可以进入本机归档视图并恢复；置顶只改变列表顺序。这里不访问真实账号，也不会发送消息或启动 Agent。",
  "侧栏折叠与展开沿用工作台既定的紧凑轨道，折叠偏好保存在本机。动画只解释位置变化，不改变任何内容的含义。",
  "动画帮助理解位置变化，但阅读内容不应整列跳动。减少动态效果开启后，应直接显示目标状态，同时保留所有按钮与键盘操作。",
].join("\n\n");

/** Synthetic, development-only fixture rendering the production UI components. */
export function MaterialMotionPreview({ view }: { view: "first" | "second" }) {
  const [rows, setRows] = useState(["first", "second"]);
  const [completion, setCompletion] = useState(0);
  const attention = useMemo(() => createAnswerSeamRegistry(), []);

  return (
    <div lang="zh-CN" className={`ts-workspace-theme quiet-workspace ${styles.shell}`}>
      <aside aria-label="capri 工作台" className={styles.sidebar}>
        <WorkspaceShellNav binding={null} />
        <div className={styles.sidebarScroll}>
          <span className={styles.groupTitle}>合成导航演练</span>
          <WorkspaceSelectionScope><ul className={styles.rowList}>
            {rows.map(id => <WorkspaceListRow key={id} arrival={id !== "first" && id !== "second"}>
              <Link className={styles.sessionRow} aria-current={view === id ? "page" : undefined} href={`/dev/material-motion?view=${id}`}>
                <span>{id === "first" ? "演练会话一" : id === "second" ? "演练会话二" : "新增演练会话"}</span>
                <WorkspaceSelectionHighlight selected={view === id}/>
              </Link>
            </WorkspaceListRow>)}
          </ul></WorkspaceSelectionScope>
        </div>
        <div className={styles.account}>
          <WorkspaceAccountMenu accountName="演练账号" workspaceName="合成演练" signOutAction={() => {}} />
        </div>
      </aside>
      <div className={styles.workspace}>
        <div style={{ padding: "20px 32px 0", color: "var(--muted)", fontSize: 13 }}>合成演练 · 不连接账号</div>
        <SessionDirectory storageScope={"a".repeat(64)} renderedAt="2026-10-01T08:00:00.000Z" initialSessions={SESSIONS} initialComplete initialNextCursor={null} sessionVersion={null} initialError={null} sessionRecoveryHref={null} />
        <section aria-label="长回复演练" style={{ maxWidth: 760, padding: "0 32px 40px", margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
            <button type="button" onClick={() => setRows(current => [String(current.length), ...current])}>插入合成会话</button>
            <button type="button" onClick={() => { attention.observe(`synthetic-${completion + 1}`); setCompletion(current => current + 1); }}>演练完成光晕</button>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>阅读一段长回复</h2>
          <AnswerBlockFrame key={completion} attention={attention} sessionId="synthetic" messageId={`synthetic-${completion}`} block={{ id: "answer", title: null, body: ANSWER, status: "informational", kind: "answer", requires_user_decision: false }}/>
          <p style={{ marginTop: 24, color: "var(--muted)", fontSize: 13 }}>待确认事项在正文之外保持可见。本演练不会执行任何操作。</p>
        </section>
      </div>
    </div>
  );
}
