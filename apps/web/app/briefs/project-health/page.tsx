import type { Metadata } from "next";
import Link from "next/link";
import { translate } from "@/lib/i18n";
import { getMarketingLocale } from "@/lib/server/marketing-locale";
import {
  getFindingEvidence,
  getHeadlineFindings,
  projectHealthBrief,
  type BriefFinding,
  type EvidenceReference,
} from "@/lib/projectHealthBrief";
import styles from "./project-health.module.css";

type PageT = (key: string, vars?: Record<string, string | number>) => string;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  return {
    title: translate(locale, "工程决策简报"),
    description: translate(locale, "capri 当前项目健康度、工程风险与下一步决策的分层证据简报。"),
    robots: { index: false, follow: false },
  };
}

const claimLabels = {
  observation: "观察",
  interpretation: "解释",
  recommendation: "建议",
  decision: "决策",
  outcome: "结果",
} as const;

const stateLabels = {
  active: "正在发生",
  needs_evidence: "待补证据",
  resolved: "已解决",
  superseded: "已替代",
} as const;

const attentionLabels = {
  now: "现在",
  next: "下一步",
  watch: "持续观察",
} as const;

function EvidenceLink({ evidence }: { evidence: EvidenceReference }) {
  return (
    <a
      className={styles.evidenceLink}
      href={evidence.href}
      rel="noreferrer"
      target="_blank"
    >
      <span>{evidence.id}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

function FindingDossier({ finding, t }: { finding: BriefFinding; t: PageT }) {
  const evidence = getFindingEvidence(finding);

  return (
    <article className={styles.finding} id={finding.id}>
      <header className={styles.findingHeader}>
        <p className={styles.findingNumber}>{finding.number}</p>
        <div>
          <div className={styles.labels}>
            <span>{t(claimLabels[finding.kind])}</span>
            <span data-state={finding.state}>{t(stateLabels[finding.state])}</span>
            <span>{t(attentionLabels[finding.attention])}</span>
          </div>
          <h3>{finding.title}</h3>
          <p className={styles.findingSummary}>{finding.executiveSummary}</p>
        </div>
      </header>

      <div className={styles.findingBody}>
        <section className={styles.impactBlock}>
          <p className={styles.sectionLabel}>{t("为什么重要")}</p>
          <p>{finding.impact}</p>
        </section>

        <section className={styles.judgementGuard}>
          <div>
            <p className={styles.sectionLabel}>{t("这说明什么")}</p>
            <p>{finding.implication}</p>
          </div>
          <div>
            <p className={styles.sectionLabel}>{t("需要承担的取舍")}</p>
            <ul className={styles.plainList}>
              {finding.tradeoffs.map((tradeoff) => (
                <li key={tradeoff}>{tradeoff}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className={styles.sectionLabel}>{t("反证与约束")}</p>
            <p>{t("这些依据限制了结论的强度，避免把风险信号写成已确认缺陷。")}</p>
            <div>
              {finding.counterevidenceIds.map((evidenceId) => {
                const reference = projectHealthBrief.evidence.find(
                  (candidate) => candidate.id === evidenceId,
                );
                return reference ? (
                  <EvidenceLink evidence={reference} key={reference.id} />
                ) : null;
              })}
            </div>
          </div>
        </section>

        <section>
          <p className={styles.sectionLabel}>{t("因果链")}</p>
          <ol className={styles.causalChain}>
            {finding.causalChain.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className={styles.detailColumns}>
          <section>
            <p className={styles.sectionLabel}>{t("仍然不知道")}</p>
            <ul className={styles.plainList}>
              {finding.unknowns.map((unknown) => (
                <li key={unknown}>{unknown}</li>
              ))}
            </ul>
          </section>
          <section>
            <p className={styles.sectionLabel}>{t("建议")}</p>
            <p>{finding.recommendation}</p>
          </section>
          <section>
            <p className={styles.sectionLabel}>{t("如何算完成")}</p>
            <ul className={styles.checkList}>
              {finding.verification.map((proof) => (
                <li key={proof}>{proof}</li>
              ))}
            </ul>
          </section>
        </div>

        <footer className={styles.findingEvidence}>
          <p className={styles.sectionLabel}>{t("依据")}</p>
          <div>
            {evidence.map((reference) => (
              <EvidenceLink evidence={reference} key={reference.id} />
            ))}
          </div>
        </footer>
      </div>
    </article>
  );
}

export default async function ProjectHealthBriefPage() {
  const locale = await getMarketingLocale();
  const t: PageT = (key, vars) => translate(locale, key, vars);
  const headlineFindings = getHeadlineFindings();
  const commitLabel = projectHealthBrief.snapshot.commit.slice(0, 7);

  return (
    <div className={styles.page} lang="zh-CN">
      <aside className={styles.rail} aria-label={t("简报层级导航")}>
        <Link className={styles.brand} href="/">
          <span aria-hidden="true">TS</span>
          <strong>capri</strong>
        </Link>
        <nav>
          <a href="#brief">
            <span>01</span>{t("一页结论")}</a>
          <a href="#dossier">
            <span>02</span>{t("工程拆解")}</a>
          <a href="#evidence">
            <span>03</span>{t("原始依据")}</a>
        </nav>
        <p className={styles.railMeta}>{t("内部评审 · {date}", { date: projectHealthBrief.snapshot.date })}</p>
      </aside>

      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.brief} id="brief">
          <div className={styles.eyebrowRow}>
            <p>{t("工程决策简报")}</p>
            <span>{t("草案 · 等待决策")}</span>
          </div>

          <header className={styles.hero}>
            <p className={styles.kicker}>{projectHealthBrief.question}</p>
            <h1>
              <span>capri</span>
              <span>{t("工程决策简报")}</span>
            </h1>
            <p className={styles.conclusion}>{projectHealthBrief.conclusion}</p>
          </header>

          <div className={styles.executiveGrid}>
            <section>
              <p className={styles.sectionLabel}>{t("这意味着什么")}</p>
              <p>{projectHealthBrief.significance}</p>
            </section>
            <section>
              <p className={styles.sectionLabel}>{t("建议方向")}</p>
              <p>{projectHealthBrief.recommendation}</p>
            </section>
            <section className={styles.decisionBlock}>
              <p className={styles.sectionLabel}>{t("需要拍板")}</p>
              <p>{projectHealthBrief.decisionRequest}</p>
            </section>
          </div>

          <section className={styles.headlines} aria-labelledby="headline-title">
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>{t("三个判断")}</p>
              <h2 id="headline-title">{t("先看约束，不看功能清单")}</h2>
            </div>
            <div className={styles.headlineList}>
              {headlineFindings.map((finding) => (
                <a href={`#${finding.id}`} key={finding.id}>
                  <span>{finding.number}</span>
                  <strong>{finding.title}</strong>
                  <p>{finding.executiveSummary}</p>
                  <b aria-hidden="true">↓</b>
                </a>
              ))}
            </div>
          </section>

          <footer className={styles.snapshotBar}>
            <span>{t("快照 {date}", { date: projectHealthBrief.snapshot.date })}</span>
            <span>main@{commitLabel}</span>
            <span>{projectHealthBrief.audience}</span>
          </footer>
        </section>

        <section className={styles.dossier} id="dossier">
          <header className={styles.layerHeader}>
            <div>
              <p className={styles.layerNumber}>02</p>
              <p className={styles.sectionLabel}>{t("工程档案")}</p>
            </div>
            <div>
              <h2>{t("问题不是“哪里不好”，而是下一阶段受什么约束。")}</h2>
              <p>{t("以下判断把症状、机制、系统条件、能力缺口和业务后果分开。每项都给出未知数与完成证据。")}</p>
            </div>
          </header>

          <section className={styles.strengths} aria-labelledby="strength-title">
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>{t("先保护已有优势")}</p>
              <h2 id="strength-title">{t("不为了修问题，破坏已经成立的东西")}</h2>
            </div>
            <div className={styles.strengthGrid}>
              {projectHealthBrief.strengths.map((strength) => (
                <article key={strength.title}>
                  <h3>{strength.title}</h3>
                  <p>{strength.detail}</p>
                  <div>
                    {strength.evidenceIds.map((evidenceId) => {
                      const evidence = projectHealthBrief.evidence.find(
                        (candidate) => candidate.id === evidenceId,
                      );
                      return evidence ? (
                        <EvidenceLink evidence={evidence} key={evidence.id} />
                      ) : null;
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className={styles.findings}>
            {projectHealthBrief.findings.map((finding) => (
              <FindingDossier finding={finding} t={t} key={finding.id} />
            ))}
          </div>

          <section className={styles.choiceSection}>
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>{t("选择")}</p>
              <h2>{t("建议不是唯一选项，但需要把代价说清楚")}</h2>
            </div>
            <div className={styles.optionList}>
              {projectHealthBrief.options.map((option) => (
                <article data-stance={option.stance} key={option.name}>
                  <div>
                    <span>
                      {option.stance === "recommended"
                        ? "建议"
                        : option.stance === "reject"
                          ? "不建议"
                          : "可选"}
                    </span>
                    <h3>{option.name}</h3>
                  </div>
                  <p>{option.description}</p>
                  <p>{option.tradeoff}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.actionSection}>
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>{t("行动顺序")}</p>
              <h2>{t("从消除未知开始，而不是从新功能开始")}</h2>
            </div>
            <ol className={styles.actionList}>
              {projectHealthBrief.actions.map((action, index) => (
                <li key={action.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <p>{action.window}</p>
                    <h3>{action.title}</h3>
                  </div>
                  <p>{action.detail}</p>
                  <p>
                    <strong>{t("完成证据")}</strong>
                    {action.proof}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </section>

        <section className={styles.evidence} id="evidence">
          <header className={styles.layerHeader}>
            <div>
              <p className={styles.layerNumber}>03</p>
              <p className={styles.sectionLabel}>{t("依据轨迹")}</p>
            </div>
            <div>
              <h2>{t("每个结论都能下钻，也能看到它不能证明什么。")}</h2>
              <p>{t("这是一份日期化投影，不替代代码、工作流、评估记录或 GitHub 运行。点击编号查看原始依据。")}</p>
            </div>
          </header>

          <div className={styles.evidenceTable} role="list">
            {projectHealthBrief.evidence.map((reference, index) => (
              <article key={reference.id} role="listitem">
                <p className={styles.evidenceIndex}>
                  {String(index + 1).padStart(2, "0")}
                </p>
                <div className={styles.evidenceTitle}>
                  <div className={styles.labels}>
                    <span>{reference.type.replace("_", " ")}</span>
                    <span>{reference.authority === "direct" ? "直接" : "推导"}</span>
                    <span>{reference.freshness === "current" ? t("当前") : t("日期快照")}</span>
                  </div>
                  <h3>{reference.title}</h3>
                  <p>
                    {reference.locator} · {reference.snapshotOrDate}
                  </p>
                </div>
                <div className={styles.evidenceSummary}>
                  <p>{reference.summary}</p>
                  <p>
                    <strong>{t("局限")}</strong>
                    {reference.limitations.join("；")}
                  </p>
                </div>
                <EvidenceLink evidence={reference} />
              </article>
            ))}
          </div>

          <footer className={styles.methodNote}>
            <p className={styles.sectionLabel}>{t("方法")}</p>
            <p>{t("使用仓库 Skill")}<code>engineering-decision-brief</code>{t("：限制最高层判断数量；分离观察、解释、建议与决策；要求每个议题同时包含依据、未知、建议和验证方式。")}</p>
            <p>
              {t("范围：{scope}。编号 {id}。", { scope: projectHealthBrief.snapshot.scope, id: projectHealthBrief.id })}
            </p>
          </footer>
        </section>
      </main>
    </div>
  );
}
