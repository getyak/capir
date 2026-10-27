import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { auth } from "@/auth";
import { MemoryReviewCard } from "@/components/memory-review/memory-review-card";
import { safeResearchLink } from "@/components/research-notebook";
import { PersonMemoryContent } from "@/components/person-memory-content";
import { AvatarEditor } from "@/components/avatar-editor";
import { memoryDate } from "@/lib/person-memory-projection";
import { peopleDirectoryHref, personDirectoryEntryId, personMemoryHref, readPeopleDirectoryQuery } from "@/components/people-directory-navigation";
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

import { translate } from "@/lib/i18n";
import { getMarketingLocale } from "@/lib/server/marketing-locale";

import styles from "./person-memory.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  return { robots: { follow: false, index: false }, title: translate(locale, "人物") };
}

const FIELD_LABELS: Record<string, string> = {
  company: "公司", employer: "公司", organization: "机构", current_company: "公司",
  job_title: "职位", title: "职位", role: "角色", current_role: "职位",
  location: "所在地", city: "城市", website: "主页", homepage: "主页", industry: "领域",
  education: "教育", school: "学校", biography: "简介", bio: "简介", summary: "简介",
};
const CONTACT_LABELS: Record<string, string> = {
  email: "邮箱", phone: "电话", wechat: "微信", linkedin_url: "LinkedIn",
  public_profile_url: "公开主页", source_native_id: "来源账号",
};

export default async function PersonMemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string; directory_query?: string | string[] }>;
}) {
  const locale = await getMarketingLocale();
  const t = (key: string) => translate(locale, key);
  const { id } = await params;
  const parameters = await searchParams;
  const returnSessionId = validReturnSessionId(parameters.session);
  const directoryQuery = readPeopleDirectoryQuery(parameters.directory_query);
  const href = personMemoryHref(id, directoryQuery, returnSessionId);
  const directoryHref = peopleDirectoryHref(directoryQuery, returnSessionId);
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(href)}`);
  }
  if (!isIntegrationMode()) {
    redirect("/workspace");
  }
  if (!personDirectoryEntryId(id)) {
    return (
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.state} aria-labelledby="person-invalid">
          <h1 className={styles.stateTitle} id="person-invalid">
            {t("人物不可用")}
          </h1>
          <p className={styles.stateText}>{t("这个人物标识无效。")}</p>
          <Link
            className={styles.backLink}
            href={directoryHref}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {t("返回人物目录")}
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
      ? t("登录已过期，请重新登录后查看这个人物。")
      : t("无法读取这个人物的记忆；系统不会用缓存或示例内容代替。");
  }

  if (!data) {
    return (
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.state} aria-labelledby="person-unavailable">
          <h1 className={styles.stateTitle} id="person-unavailable">
            {t("人物记忆不可用")}
          </h1>
          <p className={styles.stateText} role="alert">
            {error}
          </p>
          <Link
            className={styles.backLink}
            href={directoryHref}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {t("返回人物目录")}
          </Link>
        </section>
      </main>
    );
  }

  const { person, proposals, items, basicFields = [], contactPoints = [], hasMore = false, nextCursor = null } = data;
  // The successful return targets the actual loaded Person entry so the
  // directory resumes at that Person. No canonical Person return (or none
  // loaded) keeps the link ordinary.
  const personEntryHref = peopleDirectoryHref(
    directoryQuery,
    returnSessionId,
    person?.id ?? null,
  );
  const fields = new Map<string, typeof basicFields>();
  for (const field of basicFields) {
    if (["display_name", "name"].includes(field.field)) continue;
    fields.set(field.field, [...(fields.get(field.field) ?? []), field]);
  }
  // A name-only or expired clue must not read as a currently confirmed contact.
  const confirmedIdentity = person?.identity_matches.find(
    (match) => match.kind === "confirmed_handle",
  );

  return (
    <main className={styles.main} id="main-content" tabIndex={-1}>
      <div className={styles.pageNavigation}>
        <Link className={styles.backLink} href={personEntryHref}>
          <ArrowLeft aria-hidden="true" size={15} />{t("返回人物目录")}
        </Link>
      </div>
      <header className={styles.identity}>
        <AvatarEditor
          id={person?.id ?? id}
          size={18}
          shape="circle"
          label={person?.display_label ?? t("人物")}
          url={person?.avatar?.url ?? null}
        />
        <div className={styles.identityText}>
          <h1 title={person?.display_label ?? t("人物")}>{person?.display_label ?? t("人物")}</h1>
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.memoryColumn}>
          {person && person.contexts.length > 0 ? (
            <nav className={styles.contexts} aria-labelledby="person-contexts">
              <h2 className={styles.sectionTitle} id="person-contexts">
                {t("关系情境")}
              </h2>
              <p className={styles.contextHint}>{t("选择已有情境，继续相关对话。")}</p>
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
                        {context.display_label ?? t("关系情境")}
                      </span>
                      <CaretRight aria-hidden="true" size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <p className={`${styles.quiet} ${styles.contextsEmpty}`}>
              {person
                ? t("还没有关系情境，可直接查看人物记忆。")
                : t("人物目录暂时没有这个人的条目。")}
            </p>
          )}
          {proposals.length > 0 ? (
            <section
              className={styles.section}
              aria-labelledby="person-memory-pending"
            >
              <h2 className={styles.sectionTitle} id="person-memory-pending">
                {t("待确认变化")}
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
          ) : null}
          <PersonMemoryContent key={`${binding}:${person?.id ?? id}`} personId={person?.id ?? id} binding={binding} entryCapability={entryCapability}
            initialItems={items} hasMore={hasMore} nextCursor={nextCursor} contexts={person?.contexts ?? []} returnSessionId={returnSessionId} />
        </div>

        <aside className={styles.contextColumn} aria-label={t("人物资料")}>
          {person?.profile?.headline ? (
            <p className={styles.identityNote}>{person.profile.headline}</p>
          ) : confirmedIdentity ? (
            <p className={styles.identityNote}>{t("已确认的联系方式")}</p>
          ) : null}
          <section aria-labelledby="person-basic-fields">
            <h2 className={styles.sectionTitle} id="person-basic-fields">{t("基本信息")}</h2>
            {fields.size || contactPoints.length ? <dl className={styles.basicFields}>
              {Array.from(fields.entries()).map(([field, entries]) => <div className={styles.basicField} key={field}>
                <dt>{FIELD_LABELS[field] ? t(FIELD_LABELS[field]) : field}</dt>
                <dd>{entries.map(entry => {
                  const url = ["website", "homepage"].includes(field) ? safeResearchLink(entry.value) : null;
                  return <div className={styles.fieldValue} key={entry.evidence_fragment_id}>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{entry.value}</a> : <span>{entry.value}</span>}
                    <details className={styles.fieldSource}><summary>{entries.length > 1 ? t("已核对来源 · 多条记录") : t("已核对来源")}</summary>
                      <p>{entry.source_label} · {memoryDate(entry.observed_at, locale)}</p>
                      <Link href={withReturnSession(`/workspace?capture=${encodeURIComponent(entry.capture_id)}`, returnSessionId)}>{t("查看采集来源")} <CaretRight size={12} aria-hidden="true" /></Link>
                      <dl className={styles.sourceMetadata}><dt>{t("证据标识")}</dt><dd>{entry.evidence_fragment_id}</dd><dt>{t("来源标识")}</dt><dd>{entry.source_resource_id}</dd></dl>
                    </details>
                  </div>;
                })}</dd>
              </div>)}
              {contactPoints.map(point => <div className={styles.basicField} key={point.id}><dt>{t(CONTACT_LABELS[point.type] ?? "联系方式")}</dt><dd>
                <span>{point.display_hint}</span>
                <details className={styles.fieldSource}><summary>{t("已确认联系方式")}</summary><p>{point.source_display_name ?? t("已确认身份线索")} · {memoryDate(point.valid_from, locale)}</p>{point.valid_until ? <p>{translate(locale, "有效至 {date}", { date: memoryDate(point.valid_until, locale) })}</p> : null}</details>
              </dd></div>)}
            </dl> : <p className={styles.quiet}>{person ? t("还没有已核对的基础信息。") : t("人物目录暂时没有这个人的条目。")}</p>}
          </section>
          {person?.profile?.summary ? <section className={styles.profileSummary} aria-labelledby="person-profile-summary">
            <h2 className={styles.scopeTitle} id="person-profile-summary">{t("简介")}</h2><p>{person.profile.summary}</p>
            <small>{person.profile.provenance_kind === "user_authored" ? t("你补充的") : t("已复核公开资料")} · {memoryDate(person.profile.updated_at, locale)}</small>
          </section> : null}
        </aside>
      </div>
    </main>
  );
}
