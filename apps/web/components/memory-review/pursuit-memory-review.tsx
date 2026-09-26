"use client";

import Link from "next/link";
import type {
  MemoryProposalRecord,
  MemoryPursuitScope,
} from "@talent-signal/contracts";

import { MemoryReviewCard } from "./memory-review-card";

export type PursuitMemoryScopeEntry = MemoryPursuitScope & {
  proposals: MemoryProposalRecord[];
  capability: string;
};

/**
 * Pursuit-scoped Memory review entry. The server resolves the exact, currently
 * authorized role/evidence associations and mints one signed entry capability
 * per scope; this component only renders them. It never derives purpose or
 * target from browser state and never passes broad Chat scope.
 */
export function PursuitMemoryReview({
  binding,
  pursuitId,
  scopes,
}: {
  binding: string | null;
  pursuitId: string;
  scopes: PursuitMemoryScopeEntry[];
}) {
  return (
    <section aria-labelledby="pursuit-memory-heading">
      <header>
        <p>关系记忆</p>
        <h2 id="pursuit-memory-heading">当前目标的待确认变化</h2>
      </header>
      {scopes.length === 0 ? (
        <p>
          尚无可关联的关系记忆。可以回到人物目录查看已保存的关系；
          <Link href="/workspace/people">打开人物</Link>。
        </p>
      ) : (
        scopes.map((scope) => (
          <article key={`${scope.person_id}:${scope.relationship_context_id ?? ""}:${scope.role_evidence_fragment_id ?? ""}`}>
            <h3>
              {scope.person_display_label}
              {scope.relationship_display_label ? ` · ${scope.relationship_display_label}` : ""}
            </h3>
            {scope.proposals.length === 0 ? (
              <p>没有等待确认的变化。</p>
            ) : (
              scope.proposals.map((proposal) => (
                <MemoryReviewCard
                  binding={binding}
                  contextId={scope.relationship_context_id ?? null}
                  entryCapability={scope.capability}
                  key={proposal.proposal_id}
                  personId={scope.person_id}
                  proposal={{ proposal_id: proposal.proposal_id, revision: proposal.revision }}
                  purpose="relationship"
                  pursuit={{
                    pursuitId,
                    roleId: scope.role_id ?? null,
                    evidenceFragmentId: scope.role_evidence_fragment_id ?? null,
                  }}
                />
              ))
            )}
          </article>
        ))
      )}
    </section>
  );
}
