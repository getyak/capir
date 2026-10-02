"use client";

import {
  ArrowCounterClockwise,
  ArrowRight,
  Check,
  CheckCircle,
  Flask,
  GitDiff,
  LockKey,
  MagnifyingGlass,
  Receipt,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";

import {
  LabInspectable,
  useTalentSignalLab,
} from "./lab-shell";
import { LabBatchWorkspace } from "./lab-batch-workspace";
import styles from "./talent-signal-lab.module.css";

const categoryLabels = {
  momentum: "关系变化",
  identity: "身份",
  evidence: "证据",
  authorization: "权限",
  action: "动作",
} as const;

const lifecycleLabels = {
  hypothesis: "Hypothesis",
  abstained: "已克制判断",
  blocked: "已阻止",
  unavailable: "依据不可用",
  needs_review: "需要审阅",
} as const;

export function TalentSignalLabWorkspace() {
  const {
    compare,
    comparison,
    error,
    evalCase,
    manifest,
    openLens,
    pending,
    promote,
    receipt,
    replay,
    run,
    session,
    start,
  } = useTalentSignalLab();
  if (!manifest) {
    return (
      <main className={styles.page} id="main-content" tabIndex={-1}>
        <section className={styles.unavailable}>
          {error ? (
            <WarningCircle aria-hidden="true" size={26} />
          ) : (
            <SpinnerGap aria-hidden="true" className={styles.spin} size={26} />
          )}
          <p className={styles.eyebrow}>capri Lab</p>
          <h1>{error ? "Lab 控制面暂时不可用" : "正在连接 Lab 控制面"}</h1>
          <p>
            {error ??
              "普通工作台仍然可用；在隔离能力被服务端确认前，不会展示场景或创建测试状态。"}
          </p>
          {error ? (
            <button
              className={styles.retryLink}
              onClick={() => window.location.reload()}
              type="button"
            >
              重新连接
            </button>
          ) : null}
          <Link href="/workspace/today">返回今日</Link>
        </section>
      </main>
    );
  }

  if (!manifest.capability.enabled) {
    return (
      <main className={styles.page} id="main-content" tabIndex={-1}>
        <section className={styles.unavailable}>
          <LockKey aria-hidden="true" size={26} />
          <p className={styles.eyebrow}>capri Lab</p>
          <h1>这个构建没有 Lab 权限</h1>
          <p>
            Lab 只在服务端显式启用的内部构建中出现。普通构建不会返回场景、Trace 或版本信息。
          </p>
          <Link href="/workspace/today">返回今日</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>内部产品实验系统</p>
          <h1>capri Lab</h1>
          <p>
            进入一个隔离世界，理解结果来源，稳定复现差异，并把一次感受沉淀为可运行的质量证据。
          </p>
        </div>
        <div className={styles.isolationSeal}>
          <ShieldCheck aria-hidden="true" size={21} weight="duotone" />
          <span><strong>Production isolated</strong><small>0 canonical writes · 0 external effects</small></span>
        </div>
      </header>

      <LabBatchWorkspace />

      <section aria-labelledby="lab-scenarios-title" className={styles.scenarioSection}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>版本化世界</p>
            <h2 id="lab-scenarios-title">选择一个真实产品场景</h2>
          </div>
          <span>{manifest.scenarios.length} 个冻结场景</span>
        </header>
        <div className={styles.scenarioGrid}>
          {manifest.scenarios.map((scenario, index) => {
            const current = session?.scenario.id === scenario.id;
            return (
              <button
                aria-current={current ? "true" : undefined}
                className={styles.scenarioCard}
                data-risk={scenario.risk_tier}
                disabled={pending !== null}
                key={scenario.id}
                onClick={() => void start(scenario.id)}
                type="button"
              >
                <span className={styles.scenarioIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.scenarioCategory}>{categoryLabels[scenario.category]}</span>
                <strong>{scenario.title}</strong>
                <small>{scenario.summary}</small>
                <span className={styles.scenarioFooter}>
                  <code>{scenario.revision}</code>
                  {current ? <span><Check aria-hidden="true" size={14} /> 当前世界</span> : <ArrowRight aria-hidden="true" size={16} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {session ? (
        <section aria-labelledby="active-world-title" className={styles.activeWorld}>
          <div className={styles.worldBar}>
            <div><span>环境</span><strong>{session.environment}</strong></div>
            <div><span>测试身份</span><strong>{session.tester_identity}</strong></div>
            <div><span>场景</span><strong>{session.scenario.title}</strong></div>
            <div><span>版本</span><strong>Agent {session.active_envelope.agent_version} · Prompt {session.active_envelope.prompt_version}</strong></div>
            <div><span>隔离</span><strong><LockKey aria-hidden="true" size={14} /> {session.workspace_ref}</strong></div>
          </div>

          <div className={styles.worldHeading}>
            <div>
              <p className={styles.eyebrow}>当前世界</p>
              <h2 id="active-world-title">{session.scenario.title}</h2>
              <p>{session.scenario.expected_behavior}</p>
            </div>
            <div className={styles.worldActions}>
              <button className={styles.secondaryButton} disabled={pending !== null} onClick={() => void replay("candidate")} type="button">
                {pending === "run" ? <SpinnerGap aria-hidden="true" className={styles.spin} size={17} /> : <ArrowCounterClockwise aria-hidden="true" size={17} />}
                {run ? "重新重放" : "运行 Candidate"}
              </button>
              <button className={styles.secondaryButton} disabled={pending !== null} onClick={() => void compare()} type="button">
                {pending === "comparison" ? <SpinnerGap aria-hidden="true" className={styles.spin} size={17} /> : <GitDiff aria-hidden="true" size={17} />}
                与基线比较
              </button>
            </div>
          </div>

          {run ? (
            <div className={styles.experienceGrid}>
              <LabInspectable className={styles.insightCard}>
                <header>
                  <span className={styles.statePill} data-state={run.output.lifecycle}>{lifecycleLabels[run.output.lifecycle]}</span>
                  <code>{run.variant}</code>
                </header>
                <p className={styles.insightQuestion}>这段关系发生了什么变化？</p>
                <h3>{run.output.headline}</h3>
                <p>{run.output.interpretation}</p>
                {run.output.uncertainty ? (
                  <div className={styles.uncertainty}>
                    <WarningCircle aria-hidden="true" size={18} />
                    <span>{run.output.uncertainty}</span>
                  </div>
                ) : null}
                {run.output.required_question ? (
                  <div className={styles.humanQuestion}>
                    <span>需要人的决定</span>
                    <strong>{run.output.required_question}</strong>
                  </div>
                ) : null}
                <button className={styles.lensButton} onClick={openLens} type="button">
                  <MagnifyingGlass aria-hidden="true" size={17} /> 检查为什么
                </button>
              </LabInspectable>

              <aside className={styles.evidenceRail}>
                <header>
                  <div><p className={styles.eyebrow}>证据状态</p><h3>观察先于解释</h3></div>
                  <span>{run.output.evidence.length} 条</span>
                </header>
                <div className={styles.evidenceCounts}>
                  <span><strong>{run.output.evidence_summary.confirmed}</strong> 已确认</span>
                  <span><strong>{run.output.evidence_summary.observations}</strong> Observation</span>
                  <span><strong>{run.output.evidence_summary.conflicts}</strong> 冲突</span>
                  <span><strong>{run.output.evidence_summary.unavailable}</strong> 不可用</span>
                </div>
                <ol>
                  {run.output.evidence.map((item) => (
                    <li data-status={item.status} key={item.id}>
                      <span aria-hidden="true" />
                      <div><strong>{item.label}</strong><p>{item.excerpt}</p><small>{item.source_label}</small></div>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
          ) : (
            <div className={styles.runEmpty}>
              <Flask aria-hidden="true" size={24} />
              <div><strong>世界已就绪，尚未运行</strong><p>Candidate 与 baseline 会读取完全相同的 evidence snapshot。</p></div>
              <button className={styles.primaryButton} disabled={pending !== null} onClick={() => void replay("candidate")} type="button">运行 Candidate</button>
            </div>
          )}

          {run ? (
            <div className={styles.runReceipt}>
              <div><span>Evidence snapshot</span><code>{run.snapshot_hash.slice(0, 16)}</code></div>
              <div><span>运行版本</span><code>{run.envelope.web_build} / {run.envelope.backend_revision} / Agent {run.envelope.agent_version} / Prompt {run.envelope.prompt_version}</code></div>
              <div><span>Trace</span><Link href={`/workspace/evals/${run.trace_id}`}>{run.trace_id.slice(0, 12)}</Link></div>
              <div><span>边界</span><strong>{run.output.canonical_mutation_count} canonical · {run.output.external_effect_count} external</strong></div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className={styles.noWorld}>
          <Flask aria-hidden="true" size={28} />
          <h2>选择一个场景，进入测试世界</h2>
          <p>Lab 会创建隔离 workspace、冻结证据快照与版本组合。真实联系人不会被读取或修改。</p>
        </section>
      )}

      {comparison ? (
        <section aria-labelledby="comparison-title" className={styles.comparisonSection}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Compare with baseline</p>
              <h2 id="comparison-title">同一快照，两个产品结果</h2>
            </div>
            <span className={styles.snapshotMatch}><CheckCircle aria-hidden="true" size={16} weight="fill" /> evidence snapshot 一致</span>
          </header>
          <div className={styles.versionPair}>
            <div><span>Baseline</span><strong>Agent {comparison.baseline_run.envelope.agent_version} / Prompt {comparison.baseline_run.envelope.prompt_version}</strong><small>{comparison.baseline_run.envelope.backend_revision}</small></div>
            <ArrowRight aria-hidden="true" size={20} />
            <div><span>Candidate</span><strong>Agent {comparison.candidate_run.envelope.agent_version} / Prompt {comparison.candidate_run.envelope.prompt_version}</strong><small>{comparison.candidate_run.envelope.backend_revision}</small></div>
          </div>
          <div className={styles.differenceList}>
            {comparison.differences.map((difference) => (
              <article data-impact={difference.impact} key={difference.kind}>
                <header><strong>{difference.label}</strong><span>{difference.impact === "improved" ? "更安全 / 更清楚" : difference.impact === "unchanged" ? "未变化" : difference.impact === "regressed" ? "退化" : "已变化"}</span></header>
                <div><span>Baseline</span><p>{difference.baseline}</p></div>
                <div><span>Candidate</span><p>{difference.candidate}</p></div>
              </article>
            ))}
          </div>
          <footer className={styles.comparisonFooter}>
            <span>{comparison.improved_count} 项改善 · {comparison.regressed_count} 项退化 · {comparison.changed_count} 项变化</span>
            <strong>{comparison.canonical_mutation_count} canonical writes · {comparison.external_effect_count} external effects</strong>
          </footer>
        </section>
      ) : null}

      {receipt ? (
        <section aria-labelledby="receipt-title" className={styles.receiptSection}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Reality Receipt</p>
              <h2 id="receipt-title">{receipt.display_ref}</h2>
            </div>
            <span className={styles.snapshotMatch}><Receipt aria-hidden="true" size={16} /> {receipt.reproduced ? "已稳定复现" : "需要复核"}</span>
          </header>
          <div className={styles.receiptGrid}>
            <div><span>Scenario</span><strong>{receipt.scenario_id}@{receipt.scenario_revision}</strong></div>
            <div><span>Expected</span><p>{receipt.expected}</p></div>
            <div><span>Actual</span><p>{receipt.actual}</p></div>
            <div><span>Versions</span><p>{receipt.envelope.web_build} / {receipt.envelope.backend_revision} / Agent {receipt.envelope.agent_version} / Prompt {receipt.envelope.prompt_version} / {receipt.envelope.policy_version}</p></div>
            <div><span>Trace</span><Link href={`/workspace/evals/${receipt.trace_id}`}>{receipt.trace_id}</Link></div>
            <div><span>Canonical revision</span><strong>r{receipt.canonical_revision} · Lab isolated</strong></div>
            <div><span>Screenshot</span><strong>Redacted surface snapshot</strong></div>
          </div>
          {evalCase ? (
            <div className={styles.promotionSuccess}>
              <CheckCircle aria-hidden="true" size={21} weight="fill" />
              <div><strong>{evalCase.case_ref} 已成为 Eval Case v{evalCase.version}</strong><p>human gold · dev partition · candidate release gate</p></div>
              <Link href="/workspace/evals">查看评测证据</Link>
            </div>
          ) : (
            <form
              className={styles.promotionForm}
              onSubmit={(event) => {
                event.preventDefault();
                void promote();
              }}
            >
              <div><strong>晋升为 Eval Case</strong><p>这是明确的人工质量决定；系统只保存版本化场景依据，不接收候选人自由文本。晋升后会成为 candidate release gate，不会执行产品动作。</p></div>
              <button className={styles.primaryButton} disabled={pending !== null} type="submit">
                {pending === "promotion" ? <SpinnerGap aria-hidden="true" className={styles.spin} size={17} /> : <Check aria-hidden="true" size={17} />}
                人工确认并晋升
              </button>
            </form>
          )}
        </section>
      ) : null}

      {run && !receipt ? (
        <section className={styles.receiptPrompt}>
          <div><Receipt aria-hidden="true" size={22} /><span><strong>把这次观察变成质量证据</strong><small>自动冻结场景、版本、Trace 与脱敏表面快照</small></span></div>
          <LabRecordButton />
        </section>
      ) : null}

      <div aria-live="polite" className={styles.srOnly}>
        {pending ? `Lab 操作进行中：${pending}` : error ?? (run ? `场景已运行：${run.output.headline}` : "")}
      </div>
      {error ? <p className={styles.pageError} role="alert">{error}</p> : null}
    </main>
  );
}

function LabRecordButton() {
  const { pending, record } = useTalentSignalLab();
  return (
    <button className={styles.primaryButton} disabled={pending !== null} onClick={() => void record()} type="button">
      {pending === "receipt" ? <SpinnerGap aria-hidden="true" className={styles.spin} size={17} /> : <Receipt aria-hidden="true" size={17} />}
      记录问题
    </button>
  );
}
