"use client";

import { FileText, X } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";

import {
  COMPOSER_DOCUMENT_DISCLOSURE,
  COMPOSER_DOCUMENT_SEPARATOR,
  composerDocumentExcerptNotice,
  composerDocumentStageState,
  decodeComposerTextDocument,
  type ComposerDocumentType,
} from "@/lib/composer-document";
import { workspaceSessionFetch } from "./workspace-session-request";
import styles from "./composer-document.module.css";

/**
 * Document intake for the shared composer.
 *
 * A document is never attached. Its text is extracted once, shown in full in
 * an explicit preview, and the user chooses an editable excerpt to stage into
 * the draft. Images stay on the real attachment path and never come here.
 */

export type ComposerDocumentReview = {
  /** Identity of this preview attempt; stale results are dropped by it. */
  key: number;
  name: string;
  documentType: ComposerDocumentType;
  /** Extracted text, or null while extraction is still running. */
  text: string | null;
  warnings: readonly string[];
  /** Honest, generic failure copy. */
  error: string | null;
};

export type ComposerDocumentExtraction =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; message: string };

const WEB_EXTRACTION_UNAVAILABLE =
  "登录状态不可用，无法提取这份文档的文本。可改用 TXT、MD、CSV、JSON 或代码文本。";

function failureMessage(status: number, code: unknown): string {
  if (status === 413) {
    return "文档超过大小上限，未做任何处理。请拆分文档后重试。";
  }
  if (status === 415) {
    return "这份文档的类型暂不支持提取文本；原文未保存。";
  }
  if (status === 401 || status === 409 || code === "session_stale" || code === "workspace_scope_stale") {
    return "登录或工作区已改变，文档未处理。请重新打开工作台后再试。";
  }
  return "无法从这份文档提取可读文本；原文未保存。";
}

/**
 * Extract preview text for one document: text files decode locally, PDF and
 * DOCX go through the bounded, non-committing preview endpoint. Cancellation
 * surfaces as a rejected `AbortError`, never as a silent success.
 */
export async function extractComposerDocumentText(input: {
  file: File;
  documentType: ComposerDocumentType;
  binding: string | null;
  signal: AbortSignal;
  request?: typeof workspaceSessionFetch;
}): Promise<ComposerDocumentExtraction> {
  if (input.documentType === "text") {
    const decoded = decodeComposerTextDocument(
      new Uint8Array(await input.file.arrayBuffer()),
    );
    return decoded.ok
      ? { ok: true, text: decoded.text, warnings: [] }
      : { ok: false, message: decoded.message };
  }
  if (!input.binding) {
    return { ok: false, message: WEB_EXTRACTION_UNAVAILABLE };
  }
  const request = input.request ?? workspaceSessionFetch;
  let response: Response;
  try {
    response = await request("/api/local-integration/document-preview", {
      method: "POST",
      body: input.file,
      signal: input.signal,
      headers: {
        "content-type":
          input.documentType === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-document-name": encodeURIComponent(input.file.name),
        "x-workspace-session": input.binding,
      },
    });
  } catch (error) {
    if (input.signal.aborted) throw error;
    return { ok: false, message: WEB_EXTRACTION_UNAVAILABLE };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && "code" in payload
        ? (payload as { code: unknown }).code
        : null;
    return { ok: false, message: failureMessage(response.status, code) };
  }
  const text =
    payload && typeof payload === "object" && "text" in payload
      ? (payload as { text: unknown }).text
      : null;
  if (typeof text !== "string") {
    return { ok: false, message: failureMessage(500, null) };
  }
  const warnings =
    payload && typeof payload === "object" && "warnings" in payload &&
    Array.isArray((payload as { warnings: unknown }).warnings)
      ? ((payload as { warnings: unknown[] }).warnings.filter(
          (warning): warning is string => typeof warning === "string",
        ))
      : [];
  return { ok: true, text, warnings };
}

/**
 * The explicit document review dialog: full extracted text, an editable
 * excerpt and an exact count against the untouched draft. Adding is the only
 * way anything reaches the draft, and nothing is ever sent from here.
 */
export function ComposerDocumentPreview({
  record,
  draftLength,
  maxLength,
  sendLimit,
  disabled = false,
  onAdd,
  onCancel,
  restoreFocus,
}: {
  record: ComposerDocumentReview;
  draftLength: number;
  maxLength: number;
  sendLimit: number;
  disabled?: boolean;
  onAdd: (excerpt: string) => void;
  onCancel: () => void;
  /** Typing focus target; the opener control may already be gone. */
  restoreFocus?: () => void;
}) {
  const base = useId();
  const excerptId = `${base}-excerpt`;
  const textId = `${base}-full-text`;
  const [excerpt, setExcerpt] = useState("");
  const seeded = useRef<number | null>(null);
  const excerptField = useRef<HTMLTextAreaElement>(null);

  // An import lands inside the send bound on every surface. The separator
  // between an existing draft and the excerpt counts like any other text.
  const separatorLength = draftLength > 0 ? COMPOSER_DOCUMENT_SEPARATOR.length : 0;
  const stage = composerDocumentStageState({
    excerptLength: excerpt.length,
    draftLength,
    separatorLength,
    maxLength,
    sendLimit,
  });
  const text = record.text;
  const fitsWhole =
    text !== null &&
    composerDocumentStageState({
      excerptLength: text.length,
      draftLength,
      separatorLength,
      maxLength,
      sendLimit,
    }).fits;

  // A document small enough to fit is preselected in full. A long document
  // starts with an empty excerpt: the user explicitly picks what enters.
  useEffect(() => {
    if (!text || seeded.current === record.key) return;
    seeded.current = record.key;
    setExcerpt(fitsWhole ? text : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, record.key]);

  const canAdd =
    !disabled &&
    text !== null &&
    excerpt.trim().length > 0 &&
    stage.fits;

  return (
    <Dialog.Root
      onOpenChange={(value) => {
        if (!value) onCancel();
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={`${styles.dialog} ts-workspace-theme quiet-workspace`}
          data-composer-document
          onEscapeKeyDown={(event) => {
            // Escape closes this dialog only; it never reaches run controls.
            event.stopPropagation();
          }}
          onCloseAutoFocus={(event) => {
            // The opener (a menu row) may be unmounted; typing focus goes
            // back to the composer itself.
            event.preventDefault();
            restoreFocus?.();
          }}
        >
          <Dialog.Title className={styles.title}>
            <FileText aria-hidden="true" size={17} weight="duotone" />
            <span className={styles.fileName}>{record.name}</span>
          </Dialog.Title>
          <Dialog.Close aria-label="关闭文档预览" className={styles.close}>
            <X aria-hidden="true" size={17} weight="bold" />
          </Dialog.Close>
          <Dialog.Description className={styles.description}>
            {COMPOSER_DOCUMENT_DISCLOSURE}
          </Dialog.Description>

          {record.error ? (
            <p className={styles.error} role="alert">
              {record.error}
            </p>
          ) : null}
          {!record.error && text === null ? (
            <p className={styles.loading} role="status">
              正在提取文档文本…
            </p>
          ) : null}

          {text !== null ? (
            <>
              {!fitsWhole ? (
                <p className={styles.notice} role="status">
                  {composerDocumentExcerptNotice(
                    stage.budget,
                    text.length + draftLength + separatorLength,
                  )}
                </p>
              ) : null}
              <section aria-labelledby={textId} className={styles.textSection}>
                <h3 className={styles.sectionLabel} id={textId}>
                  完整文本
                </h3>
                <pre className={styles.fullText}>{text}</pre>
              </section>
              <label className={styles.sectionLabel} htmlFor={excerptId}>
                要加入草稿的片段
              </label>
              {!fitsWhole && excerpt.length === 0 && stage.budget > draftLength + separatorLength ? (
                <button
                  className={styles.fill}
                  onClick={() => {
                    setExcerpt(
                      text.slice(
                        0,
                        Math.max(0, stage.budget - draftLength - separatorLength),
                      ),
                    );
                    excerptField.current?.focus();
                  }}
                  type="button"
                >
                  填入开头可加入的片段
                </button>
              ) : null}
              <textarea
                className={styles.excerpt}
                disabled={disabled}
                id={excerptId}
                onChange={(event) => setExcerpt(event.target.value)}
                onKeyDown={(event) => {
                  // Enter here only edits the excerpt; it never sends a
                  // conversation message.
                  event.stopPropagation();
                }}
                placeholder="选择或编辑要加入输入框的文本…"
                ref={excerptField}
                rows={5}
                value={excerpt}
              />
              <p
                className={stage.fits ? styles.count : styles.countOver}
                data-composer-document-count
                role="status"
              >
                片段 {excerpt.length} 字{separatorLength ? " · 分隔空行 2 字" : ""} · 现有草稿 {draftLength} 字 · 合计 {stage.total} / {stage.budget} 字
              </p>
              {!stage.fits ? (
                <p className={styles.error} role="status">
                  合计超过 {stage.budget} 字，无法加入。请缩短片段；现有草稿未被修改。
                </p>
              ) : null}
              {record.warnings.length ? (
                <p className={styles.warning}>
                  提取提示：{record.warnings.slice(0, 3).join("；")}
                </p>
              ) : null}
            </>
          ) : null}

          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button className={styles.secondary} type="button">
                取消
              </button>
            </Dialog.Close>
            <button
              className={styles.primary}
              data-composer-document-add
              disabled={!canAdd}
              onClick={() => onAdd(excerpt)}
              type="button"
            >
              加入草稿
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
