import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { auth } from "@/auth";
import { MemoryReviewCard } from "@/components/memory-review/memory-review-card";
import { AvatarEditor } from "@/components/avatar-editor";
import {
  validReturnSessionId,
  withReturnSession,
} from "@/components/session-return-navigation";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import { isIntegrationMode, loadPersonMemory } from "@/lib/server/localBackend";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { mintMemoryEntryCapability } from "@/lib/server/memoryEntryCapability";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";

import styles from "./person-memory.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "人物 · capri",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SCOPE_LABELS: Record<string, string> = {
  self: "关于我",
  person: "关于对方",
  relationship: "我们之间",
};

export default async function PersonMemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { id } = await params;
  const returnSessionId = validReturnSessionId((await searchParams).session);
  const href = withReturnSession(`/workspace/people/${id}`, returnSessionId);
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(href)}`);
  }
  if (!isIntegrationMode()) {
    redirect("/workspace");
  }
  if (!UUID.test(id)) {
    return (
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.state} aria-labelledby="person-invalid">
          <h1 className={styles.stateTitle} id="person-invalid">
            人物不可用
          </h1>
          <p className={styles.stateText}>这个人物标识无效。</p>
          <Link
            className={styles.backLink}
            href={withReturnSession("/workspace/people", returnSessionId)}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            返回人物目录
          </Link>
        </section>
      </main>
    );
  }

  const claims = await readBackendSessionClaims();
  if (!claims) {
    redirect(backendSessionRecoveryHref(href));
  }
  const binding = contactHandoffSessionVersion(claims);
  const entryCapability = mintMemoryEntryCapability(claims, {
    purpose: "people",
    personId: id,
  });

  let data: Awaited<ReturnType<typeof loadPersonMemory>> | null = null;
  let error: string | null = null;
  try {
    data = await loadPersonMemory(id);
  } catch (caught) {
    error = isBackendSessionExpiredError(caught)
      ? "登录已过期，请重新登录后查看这个人物。"
      : "无法读取这个人物的记忆；系统不会用缓存或示例内容代替。";
  }

  if (!data) {
    return (
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.state} aria-labelledby="person-unavailable">
          <h1 className={styles.stateTitle} id="person-unavailable">
            人物记忆不可用
          </h1>
          <p className={styles.stateText} role="alert">
            {error}
          </p>
          <Link
            className={styles.backLink}
            href={withReturnSession("/workspace/people", returnSessionId)}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            返回人物目录
          </Link>
        </section>
      </main>
    );
  }

  const { person, proposals, items } = data;
  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const list = grouped.get(item.scope) ?? [];
    list.push(item);
    grouped.set(item.scope, list);
  }
  // A name-only or expired clue must not read as a currently confirmed contact.
  const confirmedIdentity = person?.identity_matches.find(
    (match) => match.kind === "confirmed_handle",
  );

  return (
    <main className={styles.main} id="main-content" tabIndex={-1}>
      <header className={styles.identity}>
        <AvatarEditor
          id={person?.id ?? id}
          size={64}
          shape="squircle"
          label={person?.display_label ?? "人物"}
          url={person?.avatar?.url ?? null}
        />
        <div className={styles.identityText}>
          <p className={styles.eyebrow}>人物记忆</p>
          <h1>{person?.display_label ?? "人物"}</h1>
          {person?.profile?.headline ? (
            <p className={styles.identityNote}>{person.profile.headline}</p>
          ) : confirmedIdentity ? (
            <p className={styles.identityNote}>已确认的联系方式</p>
          ) : null}
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.contextColumn}>
          {person && person.contexts.length > 0 ? (
            <nav className={styles.contexts} aria-labelledby="person-contexts">
              <h2 className={styles.sectionTitle} id="person-contexts">
                关系情境
              </h2>
              <ul className={styles.contextList}>
                {person.contexts.map((context) => (
                  <li key={context.id}>
                    <Link
                      className={styles.contextRow}
                      href={withReturnSession(
                        `/workspace?person=${encodeURIComponent(person.id)}&context=${encodeURIComponent(context.id)}`,
                        returnSessionId,
                      )}
                    >
                      <span className={styles.contextLabel}>
                        {context.display_label ?? "关系情境"}
                      </span>
                      <CaretRight aria-hidden="true" size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className={styles.contextHelper}>
                进入对应关系继续查看资料与对话。
              </p>
            </nav>
          ) : (
            <p className={`${styles.quiet} ${styles.contextsEmpty}`}>
              {person
                ? "这个人还没有关系情境；先从这里查看人物记忆，或在对话中建立关系。"
                : "人物目录暂时没有这个人的条目。"}
            </p>
          )}
          <Link
            className={styles.backLink}
            href={withReturnSession("/workspace/people", returnSessionId)}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            返回人物目录
          </Link>
        </div>

        <div className={styles.memoryColumn}>
          {proposals.length === 0 ? (
            <p className={styles.pendingEmpty}>暂无待确认变化</p>
          ) : (
            <section
              className={styles.section}
              aria-labelledby="person-memory-pending"
            >
              <h2 className={styles.sectionTitle} id="person-memory-pending">
                待确认变化
              </h2>
              <ul className={styles.pendingList}>
                {proposals.map((proposal) => (
                  <li key={proposal.proposal_id}>
                    <MemoryReviewCard
                      binding={binding}
                      contextId={proposal.relationship_context_id ?? null}
                      entryCapability={entryCapability}
                      personId={person?.id ?? id}
                      proposal={{
                        proposal_id: proposal.proposal_id,
                        revision: proposal.revision,
                      }}
                      purpose="people"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            className={styles.section}
            aria-labelledby="person-memory-accepted"
          >
            <h2 className={styles.memoryTitle} id="person-memory-accepted">
              已保存的记忆
            </h2>
            {items.length === 0 ? (
              <p className={styles.quiet}>还没有在这个人物上保存记忆。</p>
            ) : (
              Array.from(grouped.entries()).map(([scope, scopeItems]) => (
                <article className={styles.scopeGroup} key={scope}>
                  <h3 className={styles.scopeTitle}>
                    {SCOPE_LABELS[scope] ?? scope}
                  </h3>
                  <ul className={styles.memoryList}>
                    {scopeItems.map((item) => (
                      <li className={styles.memoryItem} key={item.id}>
                        <p className={styles.memoryText}>{item.display_text}</p>
                        <small className={styles.memoryKind}>
                          {item.statement_kind === "source_statement"
                            ? `来源陈述${item.speaker ? ` · ${item.speaker}` : ""}`
                            : item.statement_kind === "user_opinion"
                              ? "用户观点"
                              : "已保存事实"}
                        </small>
                      </li>
                    ))}
                  </ul>
                </article>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
