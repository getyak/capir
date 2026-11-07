"use client";

import { useT } from "@/components/locale-provider";
import Link from "next/link";
import type {
  MemoryProposalRecord,
  MemoryProposalListResponse,
  MemoryPursuitScope,
} from "@talent-signal/contracts";

import { MemoryProposalPages } from "./memory-proposal-pages";

export type PursuitMemoryScopeEntry = MemoryPursuitScope & {
  proposals: MemoryProposalRecord[];
  proposalPage?: MemoryProposalListResponse;
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
  const t = useT();
  return (
    <section aria-labelledby="pursuit-memory-heading">
      <header>
        <p>{t("关系记忆")}</p>
        <h2 id="pursuit-memory-heading">{t("当前目标的待确认变化")}</h2>
      </header>
      {scopes.length === 0 ? (
        <p>{t("尚无可关联的关系记忆。可以回到人物目录查看已保存的关系；")}<Link href="/workspace/people">{t("打开人物")}</Link>。
        </p>
      ) : (
        scopes.map((scope) => (
          <article key={`${scope.person_id}:${scope.relationship_context_id ?? ""}:${scope.role_evidence_fragment_id ?? ""}`}>
            <h3>
              {scope.person_display_label}
              {scope.relationship_display_label ? ` · ${scope.relationship_display_label}` : ""}
            </h3>
            <MemoryProposalPages binding={binding} contextId={scope.relationship_context_id ?? null}
              entryCapability={scope.capability} personId={scope.person_id} purpose="relationship"
              initialPage={scope.proposalPage ?? { proposals: scope.proposals }}
              pursuit={{ pursuitId, roleId: scope.role_id ?? null,
                evidenceFragmentId: scope.role_evidence_fragment_id ?? null }} />
          </article>
        ))
      )}
    </section>
  );
}
