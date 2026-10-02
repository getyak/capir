import type { Metadata } from "next";
import Link from "next/link";
import {
  getFindingEvidence,
  getHeadlineFindings,
  projectHealthBrief,
  type BriefFinding,
  type EvidenceReference,
} from "@/lib/projectHealthBrief";
import styles from "./project-health.module.css";

export const metadata: Metadata = {
  title: "工程决策简报",
  description: "capri 当前项目健康度、工程风险与下一步决策的分层证据简报。",
  robots: {
    index: false,
    follow: false,
  },
};

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

function FindingDossier({ finding }: { finding: BriefFinding }) {
  const evidence = getFindingEvidence(finding);

  return (
    <article className={styles.finding} id={finding.id}>
      <header className={styles.findingHeader}>
        <p className={styles.findingNumber}>{finding.number}</p>
        <div>
          <div className={styles.labels}>
            <span>{claimLabels[finding.kind]}</span>
            <span data-state={finding.state}>{stateLabels[finding.state]}</span>
            <span>{attentionLabels[finding.attention]}</span>
          </div>
          <h3>{finding.title}</h3>
          <p className={styles.findingSummary}>{finding.executiveSummary}</p>
        </div>
      </header>

      <div className={styles.findingBody}>
        <section className={styles.impactBlock}>
          <p className={styles.sectionLabel}>为什么重要</p>
          <p>{finding.impact}</p>
        </section>

        <section className={styles.judgementGuard}>
          <div>
            <p className={styles.sectionLabel}>这说明什么</p>
            <p>{finding.implication}</p>
          </div>
          <div>
            <p className={styles.sectionLabel}>需要承担的取舍</p>
            <ul className={styles.plainList}>
              {finding.tradeoffs.map((tradeoff) => (
                <li key={tradeoff}>{tradeoff}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className={styles.sectionLabel}>反证与约束</p>
            <p>这些依据限制了结论的强度，避免把风险信号写成已确认缺陷。</p>
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
          <p className={styles.sectionLabel}>因果链</p>
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
            <p className={styles.sectionLabel}>仍然不知道</p>
            <ul className={styles.plainList}>
              {finding.unknowns.map((unknown) => (
                <li key={unknown}>{unknown}</li>
              ))}
            </ul>
          </section>
          <section>
            <p className={styles.sectionLabel}>建议</p>
            <p>{finding.recommendation}</p>
          </section>
          <section>
            <p className={styles.sectionLabel}>如何算完成</p>
            <ul className={styles.checkList}>
              {finding.verification.map((proof) => (
                <li key={proof}>{proof}</li>
              ))}
            </ul>
          </section>
        </div>

        <footer className={styles.findingEvidence}>
          <p className={styles.sectionLabel}>依据</p>
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

export default function ProjectHealthBriefPage() {
  const headlineFindings = getHeadlineFindings();
  const commitLabel = projectHealthBrief.snapshot.commit.slice(0, 7);

  return (
    <div className={styles.page} lang="zh-CN">
      <aside className={styles.rail} aria-label="简报层级导航">
        <Link className={styles.brand} href="/">
          <span aria-hidden="true">TS</span>
          <strong>capri</strong>
        </Link>
        <nav>
          <a href="#brief">
            <span>01</span>
            一页结论
          </a>
          <a href="#dossier">
            <span>02</span>
            工程拆解
          </a>
          <a href="#evidence">
            <span>03</span>
            原始依据
          </a>
        </nav>
        <p className={styles.railMeta}>内部评审 · {projectHealthBrief.snapshot.date}</p>
      </aside>

      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.brief} id="brief">
          <div className={styles.eyebrowRow}>
            <p>工程决策简报</p>
            <span>草案 · 等待决策</span>
          </div>

          <header className={styles.hero}>
            <p className={styles.kicker}>{projectHealthBrief.question}</p>
            <h1>
              <span>capri</span>
              <span>工程决策简报</span>
            </h1>
            <p className={styles.conclusion}>{projectHealthBrief.conclusion}</p>
          </header>

          <div className={styles.executiveGrid}>
            <section>
              <p className={styles.sectionLabel}>这意味着什么</p>
              <p>{projectHealthBrief.significance}</p>
            </section>
            <section>
              <p className={styles.sectionLabel}>建议方向</p>
              <p>{projectHealthBrief.recommendation}</p>
            </section>
            <section className={styles.decisionBlock}>
              <p className={styles.sectionLabel}>需要拍板</p>
              <p>{projectHealthBrief.decisionRequest}</p>
            </section>
          </div>

          <section className={styles.headlines} aria-labelledby="headline-title">
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>三个判断</p>
              <h2 id="headline-title">先看约束，不看功能清单</h2>
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
            <span>快照 {projectHealthBrief.snapshot.date}</span>
            <span>main@{commitLabel}</span>
            <span>{projectHealthBrief.audience}</span>
          </footer>
        </section>

        <section className={styles.dossier} id="dossier">
          <header className={styles.layerHeader}>
            <div>
              <p className={styles.layerNumber}>02</p>
              <p className={styles.sectionLabel}>工程档案</p>
            </div>
            <div>
              <h2>问题不是“哪里不好”，而是下一阶段受什么约束。</h2>
              <p>
                以下判断把症状、机制、系统条件、能力缺口和业务后果分开。每项都给出未知数与完成证据。
              </p>
            </div>
          </header>

          <section className={styles.strengths} aria-labelledby="strength-title">
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>先保护已有优势</p>
              <h2 id="strength-title">不为了修问题，破坏已经成立的东西</h2>
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
              <FindingDossier finding={finding} key={finding.id} />
            ))}
          </div>

          <section className={styles.choiceSection}>
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>选择</p>
              <h2>建议不是唯一选项，但需要把代价说清楚</h2>
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
              <p className={styles.sectionLabel}>行动顺序</p>
              <h2>从消除未知开始，而不是从新功能开始</h2>
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
                    <strong>完成证据</strong>
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
              <p className={styles.sectionLabel}>依据轨迹</p>
            </div>
            <div>
              <h2>每个结论都能下钻，也能看到它不能证明什么。</h2>
              <p>
                这是一份日期化投影，不替代代码、工作流、评估记录或 GitHub 运行。点击编号查看原始依据。
              </p>
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
                    <span>{reference.freshness === "current" ? "当前" : "日期快照"}</span>
                  </div>
                  <h3>{reference.title}</h3>
                  <p>
                    {reference.locator} · {reference.snapshotOrDate}
                  </p>
                </div>
                <div className={styles.evidenceSummary}>
                  <p>{reference.summary}</p>
                  <p>
                    <strong>局限</strong>
                    {reference.limitations.join("；")}
                  </p>
                </div>
                <EvidenceLink evidence={reference} />
              </article>
            ))}
          </div>

          <footer className={styles.methodNote}>
            <p className={styles.sectionLabel}>方法</p>
            <p>
              使用仓库 Skill <code>engineering-decision-brief</code>：限制最高层判断数量；分离观察、解释、建议与决策；要求每个议题同时包含依据、未知、建议和验证方式。
            </p>
            <p>
              范围：{projectHealthBrief.snapshot.scope}。编号 {projectHealthBrief.id}。
            </p>
          </footer>
        </section>
      </main>
    </div>
  );
}
