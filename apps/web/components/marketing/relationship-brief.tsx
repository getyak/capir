"use client";

import {
  ArrowCounterClockwise,
  ArrowUpRight,
  Check,
  Quotes,
  Trash,
} from "@phosphor-icons/react";
import Image from "next/image";
import { useId, useReducer, useRef, useState } from "react";
import {
  briefReducer,
  initialBriefState,
  type BriefEvent,
} from "@/lib/marketing-demo";
import { marketingCopy } from "@/lib/marketing-copy";
import { useMarketingLocale } from "./locale-provider";
import styles from "./marketing.module.css";

export function RelationshipBrief() {
  const locale = useMarketingLocale();
  const c = marketingCopy(locale).brief;
  const [state, dispatch] = useReducer(briefReducer, initialBriefState);
  const [sourceOpen, setSourceOpen] = useState(false);
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  function decide(event: BriefEvent) {
    dispatch(event);
    if (event === "remove" || event === "restart") setSourceOpen(false);
    if (event === "review")
      requestAnimationFrame(() => confirmRef.current?.focus());
    if (event === "confirm" || event === "cancel")
      requestAnimationFrame(() => reviewRef.current?.focus());
  }
  const status = !state.sourceAvailable
    ? c.withdrawn
    : state.confirmed
      ? c.reviewed
      : c.proposed;
  return (
    <article
      className={styles.brief}
      aria-label={c.title}
      data-source={state.sourceAvailable ? "available" : "removed"}
    >
      <header className={styles.briefTop}>
        <span>{c.title}</span>
        <span>{c.synthetic}</span>
      </header>
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {c.initial}
        </span>
        <div>
          <h2>{c.name}</h2>
          <p>{c.role}</p>
        </div>
      </div>
      <div className={styles.question}>
        <div className={styles.labelRow}>
          <span>{c.question}</span>
          <span className={styles.status}>{status}</span>
        </div>
        <h3>{state.sourceAvailable ? c.blocker : c.missing}</h3>
      </div>
      {state.sourceAvailable && (
        <div className={styles.evidence}>
          <span className={styles.evidenceLabel}>
            <Quotes aria-hidden="true" size={17} />
            {c.quoteLabel}
          </span>
          <blockquote lang="zh-CN">{c.quote}</blockquote>
          {!locale.startsWith("zh") && (
            <p className={styles.translation}>
              <span>{c.translation}: </span>I need to decide before Wednesday.
              The arrangement for working remotely from Singapore has not been
              confirmed.
            </p>
          )}
          <p className={styles.attribution}>{c.attribution}</p>
          <p className={styles.uncertain}>{c.uncertain}</p>
          <button
            className={styles.textButton}
            aria-expanded={sourceOpen}
            aria-controls={`${id}-source`}
            onClick={() => setSourceOpen(!sourceOpen)}
          >
            {sourceOpen ? c.sourceClose : c.source}
            <ArrowUpRight aria-hidden="true" size={15} />
          </button>
          <div
            id={`${id}-source`}
            hidden={!sourceOpen}
            className={styles.source}
          >
            {sourceOpen && (
              <>
                <Image
                  src="/marketing/signal-journey/wechat-synthetic.webp"
                  alt={c.sourceAlt}
                  width={941}
                  height={1672}
                  sizes="(max-width: 600px) 80vw, 360px"
                />
                <p>{c.sourceNote}</p>
              </>
            )}
          </div>
        </div>
      )}
      <div className={styles.nextStep}>
        <span>{c.next}</span>
        <p>{state.sourceAvailable ? c.nextDetail : c.noAction}</p>
      </div>
      {state.reviewing && (
        <section
          className={styles.reviewPanel}
          aria-labelledby={`${id}-review`}
        >
          <h3 id={`${id}-review`}>{c.reviewTitle}</h3>
          <p>{c.reviewDetail}</p>
          <div className={styles.briefActions}>
            <button
              ref={confirmRef}
              className={styles.smallPrimary}
              onClick={() => decide("confirm")}
            >
              <Check size={16} aria-hidden="true" />
              {c.confirm}
            </button>
            <button
              className={styles.textButton}
              onClick={() => decide("cancel")}
            >
              {c.cancel}
            </button>
          </div>
        </section>
      )}
      <div className={styles.briefActions}>
        {state.sourceAvailable && !state.reviewing && (
          <button
            ref={reviewRef}
            className={styles.smallPrimary}
            onClick={() => decide(state.confirmed ? "undo" : "review")}
          >
            {state.confirmed ? (
              <ArrowCounterClockwise size={16} aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            {state.confirmed ? c.undo : c.review}
          </button>
        )}
        <button
          className={styles.textButton}
          onClick={() => decide(state.sourceAvailable ? "remove" : "restart")}
        >
          {state.sourceAvailable ? (
            <Trash size={16} aria-hidden="true" />
          ) : (
            <ArrowCounterClockwise size={16} aria-hidden="true" />
          )}
          {state.sourceAvailable ? c.remove : c.restore}
        </button>
      </div>
      <p role="status" aria-atomic="true" className={styles.notice}>
        {state.notice === "confirmed"
          ? c.confirmedNote
          : state.notice === "removed"
            ? c.removedNote
            : state.notice === "reset"
              ? c.resetNote
              : c.retraction}
      </p>
      {state.historicalConfirmation && (
        <p className={styles.history}>{c.history}</p>
      )}
    </article>
  );
}
