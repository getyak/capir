"use client";

import type { AgentTaskProjection, PursuitProposal } from "@talent-signal/contracts";
import { CheckCircle, ShieldCheck } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  PursuitProposalReview,
  type PursuitReviewReceipt,
} from "./pursuit-proposal-review";
import styles from "./pursuit-room.module.css";

export function PursuitReviewGate({
  decisionBundle,
  proposals,
}: {
  decisionBundle?: NonNullable<AgentTaskProjection["decision_bundle"]>;
  proposals: PursuitProposal[];
}) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<PursuitReviewReceipt | null>(null);
  const [reviewedProposalIds, setReviewedProposalIds] = useState<string[]>([]);
  const visible = proposals.filter(
    (proposal) => !reviewedProposalIds.includes(proposal.id),
  );
  const pending = visible.find((proposal) => proposal.status === "needs_review");
  const recovery = visible.filter((proposal) => proposal.id !== pending?.id);

  function recordReceipt(canonicalReceipt: PursuitReviewReceipt) {
    setReviewedProposalIds((current) =>
      current.includes(canonicalReceipt.proposalId)
        ? current
        : [...current, canonicalReceipt.proposalId],
    );
    setReceipt(canonicalReceipt);
    router.refresh();
  }

  return (
    <div className={styles.reviewGate}>
      <aside className={styles.section}>
        <header>
          <div>
            <p>待你决定</p>
            <h2>审阅队列</h2>
          </div>
          <span>{visible.length} 项等待处理</span>
        </header>
        {visible.length ? (
          <div className={styles.history}>
            {visible.map((proposal) => (
              <article key={proposal.id}>
                <span>{proposal.status.replaceAll("_", " ")}</span>
                <strong>{proposal.summary}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.quiet}>当前没有提案需要处理。</p>
        )}
      </aside>

      {receipt ? (
        <div className={styles.receipt} role="status" aria-live="polite">
          <CheckCircle aria-hidden="true" size={24} weight="fill" />
          <div>
            <p>规范回执</p>
            <h3>{receipt.summary}</h3>
            <span>
              {receipt.changedFields.length} 个字段已改变 · {receipt.externalEffects} 项外部效果
            </span>
          </div>
          {pending ? (
            <button onClick={() => setReceipt(null)} type="button">
              审阅下一项提案
            </button>
          ) : null}
        </div>
      ) : pending ? (
        <PursuitProposalReview
          decisionBundle={
            decisionBundle?.proposal_id === pending.id
              ? decisionBundle
              : undefined
          }
          key={pending.id}
          onReviewed={recordReceipt}
          proposal={pending}
        />
      ) : recovery.length > 0 ? (
        <div className={styles.receipt}>
          <ShieldCheck aria-hidden="true" size={24} weight="fill" />
          <div>
            <p>审阅状态</p>
            <h3>当前没有提案需要决定。</h3>
            <span>冲突或失败恢复仍在上方保持可见。</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
