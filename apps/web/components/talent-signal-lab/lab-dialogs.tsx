"use client";

import type { LabRun } from "@talent-signal/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowCounterClockwise, ArrowRight, Bug, CheckCircle, GitDiff, LockKey, MagnifyingGlass, Receipt, ShieldCheck, SpinnerGap, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useTalentSignalLab } from "./lab-context";
import styles from "./talent-signal-lab.module.css";

export function LabPanel({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const { error, openLens, pending, record, run, session } = useTalentSignalLab();
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          <header className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>capri Lab</p>
              <Dialog.Title>当前测试世界</Dialog.Title>
              <Dialog.Description>
                先理解产品状态，再进入版本、Trace 与评测依据。
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="关闭 Lab" className={styles.closeButton}>
              <X aria-hidden="true" size={18} />
            </Dialog.Close>
          </header>

          <section className={styles.worldSummary}>
            {session ? (
              <>
                <div>
                  <span>环境</span>
                  <strong>{session.environment}</strong>
                </div>
                <div>
                  <span>测试身份</span>
                  <strong>{session.tester_identity}</strong>
                </div>
                <div>
                  <span>场景</span>
                  <strong>{session.scenario.title}</strong>
                </div>
                <div>
                  <span>隔离</span>
                  <strong><LockKey aria-hidden="true" size={15} /> 不接触生产数据</strong>
                </div>
              </>
            ) : (
              <p>还没有活动会话。先选择一个版本化场景。</p>
            )}
          </section>

          <nav aria-label="Lab 任务" className={styles.taskList}>
            <div className={styles.taskRow}>
              <ShieldCheck aria-hidden="true" size={22} />
              <span><strong>当前世界</strong><small>确认环境、身份、场景与隔离边界</small></span>
              <CheckCircle aria-hidden="true" size={18} weight="fill" />
            </div>
            <Dialog.Close asChild>
              <Link className={styles.taskRow} href="/workspace/lab">
                <ArrowCounterClockwise aria-hidden="true" size={22} />
                <span><strong>复现一个场景</strong><small>从冻结证据运行 baseline 或 candidate</small></span>
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
            </Dialog.Close>
            <button className={styles.taskRow} disabled={!run} onClick={openLens} type="button">
              <MagnifyingGlass aria-hidden="true" size={22} />
              <span><strong>检查为什么</strong><small>{run ? "观察 → 解释 → 不确定性 → 依据" : "重放后可用"}</small></span>
              <ArrowRight aria-hidden="true" size={18} />
            </button>
            <button className={styles.taskRow} disabled={!run || pending !== null} onClick={() => void record()} type="button">
              <Receipt aria-hidden="true" size={22} />
              <span><strong>记录问题</strong><small>生成脱敏、可复现的 Reality Receipt</small></span>
              {pending === "receipt" ? <SpinnerGap aria-hidden="true" className={styles.spin} size={18} /> : <ArrowRight aria-hidden="true" size={18} />}
            </button>
          </nav>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <p className={styles.boundaryNote}>
            Lab 运行只能写入质量控制面；canonical relationship state 与外部系统始终为零写入。
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EvidenceStatus({ status }: { status: LabRun["output"]["evidence"][number]["status"] }) {
  const labels = {
    confirmed: "已确认",
    observation: "Observation",
    conflict: "冲突",
    unavailable: "不可用",
  } as const;
  return <span className={styles.evidenceStatus} data-status={status}>{labels[status]}</span>;
}

export function SignalLens({ open, setOpen }: { open: boolean; setOpen: (value: boolean) => void }) {
  const { compare, pending, record, run } = useTalentSignalLab();
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={`${styles.dialog} ${styles.lens}`}>
          <header className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>Signal Lens</p>
              <Dialog.Title>{run?.output.headline ?? "还没有可检查的结果"}</Dialog.Title>
              <Dialog.Description>
                解释来自可检查的产品状态，不是隐藏思维链。
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="关闭 Signal Lens" className={styles.closeButton}>
              <X aria-hidden="true" size={18} />
            </Dialog.Close>
          </header>
          {run ? (
            <>
              <div className={styles.lensFlow}>
                <section>
                  <span>观察</span>
                  <p>{run.output.observation}</p>
                </section>
                <section className={styles.causalStep}>
                  <span>系统解释 · {run.output.lifecycle}</span>
                  <p>{run.output.interpretation}</p>
                </section>
                <section>
                  <span>不确定性</span>
                  <p>{run.output.uncertainty ?? "没有额外不确定性说明。"}</p>
                </section>
                {run.output.required_question ? (
                  <section>
                    <span>需要人的决定</span>
                    <p>{run.output.required_question}</p>
                  </section>
                ) : null}
              </div>
              <div className={styles.evidenceReceipt}>
                <header>
                  <span>证据状态</span>
                  <strong>
                    {run.output.evidence_summary.confirmed} 已确认 · {run.output.evidence_summary.observations} Observation · {run.output.evidence_summary.conflicts} 冲突 · {run.output.evidence_summary.unavailable} 不可用
                  </strong>
                </header>
                <div className={styles.evidenceList}>
                  {run.output.evidence.map((item) => (
                    <article key={item.id}>
                      <div><strong>{item.label}</strong><EvidenceStatus status={item.status} /></div>
                      <p>“{item.excerpt}”</p>
                      <small>{item.source_label} · {new Date(item.observed_at).toLocaleDateString("zh-CN")}</small>
                    </article>
                  ))}
                </div>
              </div>
              <dl className={styles.runtimeStrip}>
                <div><dt>运行版本</dt><dd>{run.envelope.web_build} · Backend {run.envelope.backend_revision} · Agent {run.envelope.agent_version} · Prompt {run.envelope.prompt_version}</dd></div>
                <div><dt>Evidence snapshot</dt><dd>{run.snapshot_hash.slice(0, 12)} · frozen</dd></div>
                <div><dt>Canonical state</dt><dd>r{run.canonical_revision_after} · isolated · 0 writes</dd></div>
              </dl>
              <footer className={styles.dialogActions}>
                <Dialog.Close asChild><Link className={styles.secondaryButton} href="/workspace/lab">重放这个场景</Link></Dialog.Close>
                <button className={styles.secondaryButton} disabled={pending !== null} onClick={() => void compare()} type="button"><GitDiff aria-hidden="true" size={17} /> 与基线比较</button>
                <button className={styles.primaryButton} disabled={pending !== null} onClick={() => void record()} type="button"><Bug aria-hidden="true" size={17} /> 记录问题</button>
              </footer>
            </>
          ) : (
            <p className={styles.empty}>先在 Lab 中重放一个场景，Signal Lens 才能绑定到确切运行回执。</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

