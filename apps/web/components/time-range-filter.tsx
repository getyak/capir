"use client";

import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { addDays } from "@/lib/time-workspace";
import { useT } from "./locale-provider";
import styles from "./time-workspace.module.css";

export function TimeRangeFilter({ from, to, onFromChange, onToChange, onApply }: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: (patch: Record<string, string | null>) => void;
}) {
  const t = useT();
  const errorId = useId();
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const serial = useRef(0);
  const focusIntent = useRef<{ attempt: number; origin: Element | null; form: HTMLFormElement; owned: boolean } | null>(null);
  const [feedback, setFeedback] = useState<{ attempt: number; message: string } | null>(null);

  useLayoutEffect(() => {
    const intent = focusIntent.current;
    if (!feedback || intent?.attempt !== feedback.attempt) return;
    focusIntent.current = null;
    const node = feedbackRef.current;
    if (!node || !intent.owned || !intent.form.isConnected || document.activeElement !== intent.origin) return;
    // Explicit synchronous validation owns this feedback; a moved focus does not.
    node.focus({ preventScroll: true });
    const filters = intent.form.closest<HTMLElement>("[data-time-filters]");
    if (!filters) return;
    const bounds = node.getBoundingClientRect();
    const margin = 6;
    if (bounds.height <= 0 || bounds.height + margin * 2 > filters.clientHeight) return;
    const top = filters.getBoundingClientRect().top + filters.clientTop;
    const bottom = top + filters.clientHeight;
    if (bounds.top < top + margin) filters.scrollTop -= top + margin - bounds.top;
    else if (bounds.bottom > bottom - margin) filters.scrollTop += bounds.bottom - bottom + margin;
  }, [feedback]);

  function clearFeedback() { focusIntent.current = null; setFeedback(null); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const end = Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) ? addDays(to, 1) : null;
    if (end && from <= to && Date.parse(end) - Date.parse(from) <= 93 * 86400000) {
      clearFeedback();
      onApply({ view: "timeline", range: "custom", from, to: end, day: from });
      return;
    }
    const form = event.currentTarget;
    const origin = document.activeElement;
    const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
    const attempt = ++serial.current;
    focusIntent.current = { attempt, origin, form, owned: form.contains(origin) || origin === document.body && submitter instanceof HTMLElement && form.contains(submitter) };
    setFeedback({ attempt, message: t("请选择连续的 1–93 天。") });
  }

  return <form className={styles.customRange} data-invalid={feedback ? "true" : undefined} onSubmit={submit}>
    {feedback ? <p className={styles.rangeError} id={errorId} ref={feedbackRef} role="alert" tabIndex={-1}>{feedback.message}</p> : null}
    <label>{t("从")}<input required type="date" value={from} aria-invalid={feedback ? true : undefined} aria-describedby={feedback ? errorId : undefined} onChange={event => { clearFeedback(); onFromChange(event.target.value); }} /></label>
    <label>{t("到（含当天）")}<input required type="date" value={to} aria-invalid={feedback ? true : undefined} aria-describedby={feedback ? errorId : undefined} onChange={event => { clearFeedback(); onToChange(event.target.value); }} /></label>
    <button type="submit">{t("查看范围")}</button>
  </form>;
}
