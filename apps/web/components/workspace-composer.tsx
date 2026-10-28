"use client";

import { ArrowRight } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import {
  dataTransferHasFileEntries,
  imageFilesFromClipboard,
  validateAttachmentBatch,
} from "@/components/contact-agent/capture-intake";
import {
  COMPOSER_DISCOVERY_HINT,
  COMPOSER_DRAFT_LIMIT,
  WORKSPACE_SLASH_COMMANDS,
  COMPOSER_SEND_LIMIT,
  composerDescribedBy,
  composerLengthState,
  composerMentionInsertion,
  composerMenuA11y,
  detectComposerTrigger,
  filterSlashCommands,
  insertComposerText,
  resolveComposerKey,
  type SlashCommand,
} from "@/lib/workspace-composer";
import {
  composerMenuClipBounds,
  composerMenuClippingAncestors,
  composerMenuPlacement,
} from "@/lib/composer-menu-layout";
import {
  COMPOSER_DOCUMENT_SEPARATOR,
  composerFileIntakePlan,
  type ComposerDocumentType,
} from "@/lib/composer-document";
import {
  ComposerDocumentPreview,
  extractComposerDocumentText,
  type ComposerDocumentReview,
} from "./composer-document";
import { ComposerAddMenu } from "./new-conversation-add-menu";
import {
  searchSidebarPeople,
  type SidebarPerson,
} from "@/lib/workspace-sidebar";
import { useWorkspaceDirectory } from "./workspace-search";
import { reconcileComposerMentions, type ComposerMention } from "@/lib/composer-mentions";
import { ComposerPersonReference } from "./composer-person-reference";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { useLocale, useT } from "./locale-provider";
import { useWorkspaceComposerViewMemory } from "./workspace-navigation-continuity";
import styles from "./workspace-composer.module.css";

type MenuItem = {
  id: string;
  title: string;
  detail: string;
  kind: "starter" | "navigate" | "capture" | "mention";
  command?: SlashCommand;
  person?: SidebarPerson;
};

export type WorkspaceComposerProps = {
  id: string;
  /** Canonical draft/Session identity, only for in-scope editor presentation. */
  viewKey?: string | null;
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  /** `home` bounds at the send limit; `session` keeps the larger draft limit. */
  variant: "home" | "session";
  /** Inline controls for the IM canvas; draft limits stay owned by `variant`. */
  layout?: "stacked" | "inline";
  /** Submission is actually possible right now. */
  canSubmit: boolean;
  /** Suggestions are offered only while the surface can still act. */
  suggestionsEnabled?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  rows?: number;
  /** Extra id appended to `aria-describedby` (e.g. a status line). */
  describedBy?: string;
  /** Workspace Sessions binding used for the `@` directory, only while open. */
  binding: string | null;
  onValueChange: (value: string) => void;
  /** Explicit current-message draft scope; ordinary @ remains a text reference. */
  onPrepareMemoryDraft?: (target: import("@/lib/conversation-memory-draft-target").ComposerMemoryDraftTarget) => void;
  onSubmit: () => void;
  /** Marked text remains provisional until the input method commits it. */
  onComposingChange?: (composing: boolean) => void;
  onNavigate: (href: string) => void;
  onCapture?: () => void;
  /**
   * Direct image intake. When present the composer accepts dropped or pasted
   * image files and hands the validated batch to the caller without submitting
   * anything or inserting into the draft. Plain text paste, URL drag and the
   * `/`/`@` menus are untouched.
   */
  onFiles?: (files: File[]) => void;
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
};

/**
 * The one composer shared by the conversation canvas and the Session workbench.
 *
 * It owns caret-aware `/` and `@` suggestions, bounded auto-growth, the
 * discovery hint and the length meter. Parent surfaces keep their own stores,
 * send rules and footer actions; this component never submits by itself.
 */
export function WorkspaceComposer({
  id,
  viewKey = null,
  label,
  value,
  maxLength,
  placeholder,
  variant,
  layout = "stacked",
  canSubmit,
  suggestionsEnabled = true,
  disabled = false,
  readOnly = false,
  rows = 2,
  describedBy,
  binding,
  onValueChange,
  onPrepareMemoryDraft,
  onSubmit,
  onComposingChange,
  onNavigate,
  onCapture,
  onFiles,
  footerStart,
  footerEnd,
}: WorkspaceComposerProps) {
  const t = useT();
  const locale = useLocale();
  const base = useId();
  const menuId = `${base}-menu`;
  const hintId = `${base}-hint`;
  const meterId = `${base}-meter`;
  const mentionNoteId = `${base}-mention`;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composerRoot = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickerContext = useRef<{ binding: string | null } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const composition = useRef<{ binding: string | null; notify: WorkspaceComposerProps["onComposingChange"] } | null>(null);
  const viewMemory = useWorkspaceComposerViewMemory();
  const viewOwner = useRef({ memory: viewMemory, key: viewKey, edited: false, restored: false, previousValue: value });
  // A scope change or unmount releases only the callback that began this
  // composition. It must never clear a newer parent scope's marked-text state.
  useLayoutEffect(() => () => {
    const previous = composition.current;
    composition.current = null;
    previous?.notify?.(false);
  }, [binding, disabled, readOnly]);
  const documentRun = useRef<{
    key: number;
    controller: AbortController;
    binding: string | null;
  } | null>(null);
  const documentKey = useRef(0);
  const pendingDocumentInsert = useRef<{ value: string; binding: string | null; excerpt: string } | null>(null);
  const afterDocumentClose = useRef<() => void>(() => {});
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [documentReview, setDocumentReview] = useState<ComposerDocumentReview | null>(null);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [overflowSignature, setOverflowSignature] = useState<string | null>(null);
  const [mentionState, setMentionState] = useState<{ binding: string | null; value: string; records: ComposerMention[] }>({ binding, value, records: [] });
  // Render-time scope fence: no previous account's label survives a binding
  // change. Edits preserve only untouched explicitly selected spans.
  const selectedMentions = mentionState.binding === binding
    ? reconcileComposerMentions(mentionState.value, value, mentionState.records) : [];
  if (mentionState.binding !== binding || mentionState.value !== value) {
    setMentionState({ binding, value, records: selectedMentions });
  }

  const active = suggestionsEnabled && !disabled && !readOnly;
  const fileIntake = Boolean(onFiles) && !disabled && !readOnly;
  const trigger = useMemo(
    () => (active && caret >= 0 ? detectComposerTrigger(value, caret) : null),
    [active, caret, value],
  );
  const signature = trigger ? `${trigger.kind}\u0000${value}` : null;
  const mentionOpen = trigger?.kind === "mention" && dismissed !== signature;
  const directory = useWorkspaceDirectory(binding, mentionOpen || selectedMentions.length > 0);
  const referencePeople = directory.failed || directory.loading || !directory.data ? []
    : searchSidebarPeople(directory.data.people, "", Number.MAX_SAFE_INTEGER);
  const visibleMentions = selectedMentions.filter(mention => referencePeople.some(person => person.id === mention.person.id));

  const commands =
    trigger?.kind === "slash" ? filterSlashCommands(trigger.query, { commands: WORKSPACE_SLASH_COMMANDS.map(command => ({
      ...command, title: t(command.title), description: t(command.description),
      insert: command.insert ? t(command.insert) : undefined,
    })) }) : [];
  const people =
    trigger?.kind === "mention" && directory.data
      ? searchSidebarPeople(directory.data.people, trigger.query, 8)
      : [];

  const items: MenuItem[] =
    trigger?.kind === "slash"
      ? commands.map((command) => ({
          id: `slash-${command.id}`,
          title: command.title,
          detail: command.description,
          kind: command.kind,
          command,
        }))
      : people.map((person) => ({
          id: `person-${person.id}`,
          title: person.label,
          detail: person.detail,
          kind: "mention" as const,
          person,
        }));

  const menuOpen = Boolean(
    active &&
      trigger &&
      dismissed !== signature &&
      (trigger.kind === "mention" || items.length > 0),
  );
  const activeItem = items.length
    ? items[Math.min(activeIndex, items.length - 1)]
    : undefined;
  const highlighted = items.length
    ? Math.min(activeIndex, items.length - 1)
    : 0;
  // Overflow is tied to the exact token that could not be inserted. Editing the
  // value changes the signature, so the notice clears without an effect.
  const overflowNotice =
    overflowSignature !== null && overflowSignature === signature;
  const lengthState = composerLengthState(value, {
    // Session keeps the 12,000-character draft limit; every surface sends at 1,000.
    sendLimit:
      variant === "home" && maxLength < 1_000 ? maxLength : undefined,
  });

  // Document imports must land inside the send bound on every variant:
  // Session drafts type to their full manual limit, but an import can never
  // create an unsendable draft.
  const sendLimit =
    variant === "home" && maxLength < COMPOSER_SEND_LIMIT
      ? maxLength
      : COMPOSER_SEND_LIMIT;
  const stageBound = Math.min(maxLength, sendLimit);

  // Cancel any in-flight extraction when the surface context changes or the
  // composer unmounts: a late result must never touch the draft.
  useEffect(() => {
    return () => {
      documentRun.current?.controller.abort();
      documentRun.current = null;
      pickerContext.current = null;
      pendingDocumentInsert.current = null;
    };
  }, []);
  useEffect(() => {
    pickerContext.current = null;
    pendingDocumentInsert.current = null;
  }, [binding, disabled, readOnly]);
  useEffect(() => {
    documentRun.current?.controller.abort();
    documentRun.current = null;
    // Intentional synchronous discard: a document preview must never outlive
    // the binding, disabled or read-only context that authorized it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDocumentReview(null);
  }, [binding, disabled, readOnly]);

  // One height cap shared with CSS; resize also covers a mobile keyboard.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    function resize() {
      if (!element) return;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const minimum = layout === "inline" ? 22 : variant === "session" ? 64 : 82;
      const limit = Math.max(minimum, Math.min(layout === "inline" ? 176 : variant === "session" ? 240 : 320,
        Math.floor(height * (layout === "inline" ? 0.25 : variant === "session" ? 0.3 : 0.4))));
      element.style.height = "auto";
      element.style.height = `${Math.max(minimum, Math.min(element.scrollHeight, limit))}px`;
      element.style.overflowY = element.scrollHeight > limit ? "auto" : "hidden";
      if (mirror.current) {
        mirror.current.style.width = `${element.clientWidth}px`;
        mirror.current.scrollTop = element.scrollTop;
      }
    }
    resize();
    let observedWidth = element.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (element.clientWidth !== observedWidth) { observedWidth = element.clientWidth; resize(); }
    });
    observer?.observe(element);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [value, variant, layout]);

  // Fit the popup into the region a reader can actually see: the visual
  // viewport intersected with every clipping ancestor's scrollport, anchored
  // to the outer composer the popup's `calc(100% + 8px)` gap is measured from.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const popup = menu.current;
    const anchor = composerRoot.current;
    if (!popup || !anchor) return;
    // The popup and its list never clip themselves; the walk starts at the
    // composer's parent so scrolling ancestors alone bound the placement.
    const clips = composerMenuClippingAncestors(anchor.parentElement, popup);
    function position() {
      if (!popup || !anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const placement = composerMenuPlacement({
        outer: { top: rect.top, bottom: rect.bottom },
        viewport: {
          top: viewport?.offsetTop ?? 0,
          height: viewport?.height ?? window.innerHeight,
        },
        clip: composerMenuClipBounds(clips),
        mobile: window.innerWidth <= 760,
      });
      popup.dataset.side = placement.side;
      popup.style.maxHeight = `${placement.maxHeight}px`;
    }
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    // A QA/health banner or window chrome change moves the clip bounds without
    // resizing the composer, so the clipping ancestors are observed too.
    observer?.observe(anchor);
    for (const clip of clips) observer?.observe(clip);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [menuOpen, value]);

  useEffect(() => {
    if (menuOpen) menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [menuOpen, highlighted]);

  // Keep DOM focus and the caret inside the textarea after a suggestion edit.
  useLayoutEffect(() => {
    const element = textarea.current;
    const next = pendingCaret.current;
    if (element && next !== null) {
      pendingCaret.current = null;
      element.focus({ preventScroll: true });
      element.setSelectionRange(next, next);
      setCaret(next);
    }
  }, [value]);

  const syncCaret = useCallback(
    (event: { currentTarget: HTMLTextAreaElement }) => {
      const element = event.currentTarget;
      if (typeof element.selectionStart === "number") {
        setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : -1);
        if (viewMemory && viewKey && !composition.current) {
          viewMemory.rememberComposerView(viewKey, element.value, {
            start: element.selectionStart, end: element.selectionEnd,
            direction: element.selectionDirection, scrollTop: element.scrollTop,
          });
        }
      }
    },
    [viewMemory, viewKey],
  );

  useLayoutEffect(() => {
    if (viewOwner.current.memory !== viewMemory || viewOwner.current.key !== viewKey) {
      viewOwner.current = { memory: viewMemory, key: viewKey, edited: false, restored: false, previousValue: value };
    }
    const owner = viewOwner.current;
    const element = textarea.current;
    if (!viewMemory || !viewKey || !element) return;
    if (owner.previousValue && !value) viewMemory.forgetComposerView(viewKey);
    owner.previousValue = value;
    if (owner.edited || owner.restored || composition.current) return;
    const remembered = viewMemory.readComposerView(viewKey, value);
    if (!remembered) return;
    element.setSelectionRange(remembered.start, remembered.end, remembered.direction);
    element.scrollTop = remembered.scrollTop;
    owner.restored = true;
    // Suggestion state follows the next native selection/input event; restoring
    // presentation must not manufacture an edit or take DOM focus.
  }, [value, viewKey, viewMemory]);


  function close() {
    if (trigger) setDismissed(`${trigger.kind}\u0000${value}`);
  }

  function choose(item: MenuItem | undefined) {
    if (!trigger || !item) return;
    if (item.kind === "navigate" && item.command?.href) {
      close();
      onNavigate(item.command.href);
      return;
    }
    if (item.kind === "capture") {
      close();
      if (onCapture) onCapture();
      else if (item.command?.href) onNavigate(item.command.href);
      return;
    }
    const insert =
      item.kind === "mention" && item.person
        ? composerMentionInsertion(item.person)
        : item.command?.insert;
    if (!insert) return;
    const result = insertComposerText({
      value,
      start: trigger.start,
      end: trigger.end,
      insert,
      maxLength,
    });
    if (!result.inserted) {
      setOverflowSignature(signature);
      return;
    }
    setOverflowSignature(null);
    pendingCaret.current = result.caret;
    setCaret(result.caret);
    const element = textarea.current;
    if (element) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(trigger.start, trigger.end);
      // insertText preserves native undo in Chromium and WebKit. It is used
      // only for plain text, never HTML; controlled value is the safe fallback.
      try { document.execCommand("insertText", false, insert); } catch { /* unsupported host */ }
    }
    setDismissed(`${trigger.kind}\u0000${result.value}`);
    if (item.kind === "mention" && item.person) {
      const text = insert.trimEnd();
      setMentionState({ binding, value: result.value, records: [
        ...reconcileComposerMentions(value, result.value, selectedMentions.filter(
          mention => mention.end <= trigger.start || mention.start >= trigger.end,
        )),
        { start: trigger.start, end: trigger.start + text.length, text, person: item.person },
      ].sort((a, b) => a.start - b.start) });
    }
    onValueChange(result.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = resolveComposerKey({
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing || composition.current !== null,
      keyCode: event.nativeEvent.keyCode,
      menuOpen,
      canSubmit,
    });
    if (action === "next") {
      event.preventDefault();
      if (items.length) setActiveIndex((index) => (index + 1) % items.length);
    } else if (action === "previous") {
      event.preventDefault();
      if (items.length) {
        setActiveIndex((index) => (index - 1 + items.length) % items.length);
      }
    } else if (action === "choose") {
      // Selecting a suggestion never submits the draft.
      event.preventDefault();
      choose(activeItem);
    } else if (action === "dismiss") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (action === "submit") {
      event.preventDefault();
      onSubmit();
    }
  }

  function acceptsFiles(files: File[]) {
    if (!onFiles || disabled || readOnly || !files.length) return;
    // One atomic decision for picker, drop and paste: images stay the real
    // attachment path, documents open an explicit text preview, everything
    // else is rejected locally before any upload.
    const plan = composerFileIntakePlan(files, locale);
    if (plan.kind === "reject") {
      setFileError(t(plan.message));
      return;
    }
    if (plan.kind === "document") {
      setFileError(null);
      openDocument(plan.file, plan.documentType);
      return;
    }
    const result = validateAttachmentBatch([], plan.files);
    if (!result.ok) {
      setFileError(t(result.error));
      return;
    }
    setFileError(null);
    onFiles([...result.accepted]);
  }

  function openDocument(file: File, documentType: ComposerDocumentType) {
    documentRun.current?.controller.abort();
    const key = documentKey.current + 1;
    documentKey.current = key;
    const controller = new AbortController();
    documentRun.current = { key, controller, binding };
    setDocumentReview({
      key,
      name: file.name,
      documentType,
      text: null,
      warnings: [],
      error: null,
    });
    void extractComposerDocumentText({
      file,
      documentType,
      binding,
      locale,
      signal: controller.signal,
    })
      .then((result) => {
        // A cancelled, superseded or unmounted attempt is dropped whole.
        if (documentRun.current?.key !== key) return;
        setDocumentReview(
          result.ok
            ? { key, name: file.name, documentType, text: result.text, warnings: result.warnings, error: null }
            : { key, name: file.name, documentType, text: null, warnings: [], error: result.message },
        );
      })
      .catch(() => {
        if (documentRun.current?.key !== key) return;
        setDocumentReview((current) =>
          current && current.key === key
            ? { ...current, error: t("文档预览未能完成；现有草稿未被修改。") }
            : current,
        );
      });
  }

  function cancelDocument() {
    documentRun.current?.controller.abort();
    documentRun.current = null;
    setDocumentReview(null);
  }

  /** Insert staged text at the caret; overflow is reported, never truncated. */
  function applyStagedText(
    insert: string,
    start: number,
    end: number,
    overflowMessage: string,
  ): boolean {
    const result = insertComposerText({
      value,
      start,
      end,
      insert,
      maxLength,
    });
    if (!result.inserted) {
      setFileError(overflowMessage);
      return false;
    }
    setFileError(null);
    pendingCaret.current = result.caret;
    setCaret(result.caret);
    const element = textarea.current;
    if (element) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(start, end);
      // insertText preserves native undo in Chromium and WebKit; the
      // controlled value below is the safe fallback.
      try { document.execCommand("insertText", false, insert); } catch { /* unsupported host */ }
    }
    onValueChange(result.value);
    return true;
  }

  function stageText(insert: string, overflowMessage: string): boolean {
    const element = textarea.current;
    const focused =
      element && document.activeElement === element ? element : null;
    const start =
      focused && typeof focused.selectionStart === "number"
        ? focused.selectionStart
        : value.length;
    const end =
      focused && typeof focused.selectionEnd === "number"
        ? focused.selectionEnd
        : value.length;
    return applyStagedText(insert, start, end, overflowMessage);
  }

  /**
   * Append an imported excerpt after the untouched draft with an explicit
   * separator. The live surface is revalidated first: a stale preview can
   * never trim, truncate or replace what the user typed.
   */
  function stageDocumentExcerpt(excerpt: string) {
    if (disabled || readOnly || !excerpt.trim()) return;
    if (documentRun.current && documentRun.current.binding !== binding) return;
    const separator = value.length > 0 ? COMPOSER_DOCUMENT_SEPARATOR : "";
    const insert = separator + excerpt;
    const overflowMessage = t("composer.addOverflow", { limit: stageBound });
    if (value.length + insert.length > stageBound) {
      // The draft changed under the preview. Keep the preview and the draft
      // intact; the count line explains the bound.
      setFileError(overflowMessage);
      return;
    }
    // A modal focus trap owns the excerpt until it unmounts. Stage only the
    // intent here; insert after its close autofocus event so native undo is
    // recorded in the composer rather than the preview textarea.
    pendingDocumentInsert.current = { value, binding, excerpt };
    cancelDocument();
  }

  useLayoutEffect(() => {
    afterDocumentClose.current = () => {
      const pending = pendingDocumentInsert.current;
      pendingDocumentInsert.current = null;
      textarea.current?.focus({ preventScroll: true });
      if (!pending || !textarea.current || disabled || readOnly || pending.binding !== binding || pending.value !== value) return;
      const insert = (value.length > 0 ? COMPOSER_DOCUMENT_SEPARATOR : "") + pending.excerpt;
      if (value.length + insert.length > stageBound) return;
      applyStagedText(insert, value.length, value.length, t("composer.addOverflow", { limit: stageBound }));
    };
  });

  function transferHasFiles(transfer: DataTransfer | null): boolean {
    if (!transfer) return false;
    if (Array.from(transfer.types ?? []).includes("Files")) return true;
    if ((transfer.files?.length ?? 0) > 0) return true;
    return dataTransferHasFileEntries(Array.from(transfer.items ?? []));
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!fileIntake || !transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!fileIntake || !transferHasFiles(event.dataTransfer)) return;
    // Cancel the browser default for files only; plain text and URL drags keep
    // their native behaviour (e.g. dropping a link inserts its text).
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave() {
    if (!fileIntake) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!fileIntake || !transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      if (
        dataTransferHasFileEntries(Array.from(event.dataTransfer?.items ?? []))
      ) {
        setFileError(t("暂不支持文件夹。请拖入 PNG、JPEG 或 WebP 图片，或一个 PDF、DOCX、TXT、MD、CSV、JSON 或代码文本文件。"));
      }
      return;
    }
    acceptsFiles(files);
  }

  function renderItem(item: MenuItem, index: number) {
    const selected = menuOpen && index === highlighted;
    return (
      <div
        aria-selected={selected}
        className={styles.item}
        data-kind={item.kind}
        data-selected={selected ? "true" : undefined}
        id={`${menuId}-option-${index}`}
        key={item.id}
        onClick={() => choose(item)}
        onPointerDown={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          // Layout can move an option under a stationary pointer. Only real
          // hover movement may replace the keyboard selection; touch pans do not.
          if (event.pointerType !== "touch") setActiveIndex(index);
        }}
        role="option"
      >
        {item.person ? <PersonDirectoryAvatar id={item.person.id} label={item.person.label} url={item.person.avatarUrl} size={28} /> : null}
        <span className={styles.itemText}>
          <strong>{item.title}</strong>
          <small>{item.detail}</small>
        </span>
        {item.kind === "mention" ? (
          <span className={styles.tag}>{t("引用")}</span>
        ) : item.kind === "starter" ? (
          <span className={styles.tag}>{t("草稿")}</span>
        ) : (
          <ArrowRight aria-hidden="true" size={14} />
        )}
      </div>
    );
  }

  const describedByIds = composerDescribedBy([
    describedBy,
    hintId,
    meterId,
    menuOpen && trigger?.kind === "mention" ? mentionNoteId : null,
  ]);

  // Surfaces with real file intake get one managed add menu and one hidden,
  // unrestricted picker here; parents never own another copy. The control
  // stays visible on disabled surfaces and becomes inert instead of vanishing.
  const addMenu = onFiles ? (
    <ComposerAddMenu
      binding={binding}
      disabled={disabled || readOnly}
      onAttachFiles={() => {
        if (!fileIntake) return;
        pickerContext.current = { binding };
        picker.current?.click();
      }}
      onInsertText={(insert) =>
        stageText(insert, t("composer.insertOverflow", { limit: maxLength }))
      }
      onNavigate={onNavigate}
    />
  ) : null;

  return (
    <div className={styles.composer} data-dragging={dragging ? "true" : undefined} data-variant={variant} data-layout={layout}
      ref={composerRoot}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onDragEnter={fileIntake ? handleDragEnter : undefined}
      onDragLeave={fileIntake ? handleDragLeave : undefined}
      onDragOver={fileIntake ? handleDragOver : undefined}
      onDrop={fileIntake ? handleDrop : undefined}
    >
      {dragging && fileIntake ? (
        <div className={styles.dropHint} role="status">
          {t("松开后添加图片或文档；图片随消息发送，文档先预览文本")}
        </div>
      ) : null}
      {menuOpen && trigger ? (
        <div className={styles.menu} ref={menu}>
          <div
            aria-label={t(composerMenuA11y(trigger.kind).listboxLabel)}
            className={styles.list}
            id={menuId}
            role={items.length && !directory.loading && !directory.failed || trigger.kind === "slash" ? "listbox" : undefined}
          >
            {trigger.kind === "slash" ? (
              items.map((item, index) => renderItem(item, index))
            ) : directory.loading ? (
              <p className={styles.state} role="status">
                {t("正在读取账号目录…")}
              </p>
            ) : directory.failed ? (
              <div className={styles.state} role="status">
                <p>{t("暂时无法读取人物目录。请重新载入。")}</p>
                <button
                  className={styles.retry}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={directory.retry}
                  type="button"
                >
                  {t("重试")}
                </button>
              </div>
            ) : items.length ? (
              items.map((item, index) => renderItem(item, index))
            ) : (
              <p className={styles.state} role="status">
                {t(trigger.query ? "没有匹配的人物" : "还没有人物")}
              </p>
            )}
          </div>
          {composerMenuA11y(trigger.kind).disclosure ? (
            <p className={styles.disclosure} id={mentionNoteId}>
              {t(composerMenuA11y(trigger.kind).disclosure!)}
            </p>
          ) : null}
          {overflowNotice ? (
            <p className={styles.overflow} role="status">
              {t("composer.insertOverflow", { limit: maxLength })}
            </p>
          ) : null}
        </div>
      ) : null}

      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      {layout === "inline" ? <div className={styles.inlineLeading}>{addMenu}{footerStart}</div> : null}
      <div className={styles.editor}>
      <div className={styles.mirror} ref={mirror} aria-hidden="true" data-composer-mention-mirror>
        {(() => {
          const parts: ReactNode[] = [];
          let end = 0;
          for (const mention of visibleMentions) {
            parts.push(value.slice(end, mention.start));
            parts.push(<mark key={`${mention.start}:${mention.person.id}`} className={styles.mentionMark}>{mention.text}</mark>);
            end = mention.end;
          }
          parts.push(value.slice(end), "\u200b");
          return parts;
        })()}
      </div>
      <textarea
        aria-activedescendant={
          menuOpen && items.length ? `${menuId}-option-${highlighted}` : undefined
        }
        aria-autocomplete="list"
        aria-controls={menuOpen ? menuId : undefined}
        aria-describedby={describedByIds || undefined}
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        onChange={(event) => {
          viewOwner.current.edited = true;
          setDismissed(null);
          setPasteError(null);
          setFileError(null);
          syncCaret(event);
          // A new edit restarts the highlighted suggestion from the top.
          setActiveIndex(0);
          onValueChange(event.target.value);
        }}
        onPaste={(event) => {
          if (fileIntake) {
            const images = imageFilesFromClipboard(
              Array.from(event.clipboardData?.items ?? []),
            );
            if (images.length) {
              // Image paste is intake, never draft text. Text-only paste keeps
              // the ordinary length guard below.
              event.preventDefault();
              acceptsFiles(images);
              return;
            }
          }
          const element = event.currentTarget;
          const text = event.clipboardData.getData("text/plain");
          if (value.length - (element.selectionEnd - element.selectionStart) + text.length > maxLength) {
            event.preventDefault();
            setPasteError(t("composer.pasteOverflow", { limit: maxLength }));
          }
        }}
        onCompositionStart={() => {
          if (disabled || readOnly || composition.current) return;
          composition.current = { binding, notify: onComposingChange };
          onComposingChange?.(true);
        }}
        onCompositionEnd={(event) => {
          const previous = composition.current;
          if (!previous || previous.binding !== binding) return;
          composition.current = null;
          syncCaret(event);
          previous.notify?.(false);
        }}
        onClick={syncCaret}
        onFocus={syncCaret}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onSelect={syncCaret}
        onScroll={event => { syncCaret(event); if (mirror.current) { mirror.current.scrollTop = event.currentTarget.scrollTop; mirror.current.scrollLeft = event.currentTarget.scrollLeft; } }}
        placeholder={placeholder}
        readOnly={readOnly}
        ref={textarea}
        rows={layout === "inline" ? 1 : rows}
        value={value}
      />
      </div>
      {layout === "inline" ? <div className={styles.inlineTrailing}>{footerEnd}</div> : null}
      {visibleMentions.length > 0 ? <div className={styles.selectedReferences} role="group" aria-label={t("已选择的文字引用")}>
        {[...new Map(visibleMentions.map(mention => [mention.person.id, mention])).values()].map(mention => {
          const person = referencePeople.find(person => person.id === mention.person.id)!;
          return <ComposerPersonReference key={person.id} person={person} disabled={disabled || readOnly}
            onPrepareMemoryDraft={onPrepareMemoryDraft ? () => { onPrepareMemoryDraft({ person_id: person.id, label: person.label, start: mention.start, end: mention.end, text: mention.text }); textarea.current?.focus({ preventScroll: true }); } : undefined} />;
        })}
      </div> : null}

      {pasteError ? <p className={styles.overflow} role="alert">{pasteError}</p> : null}
      {fileError ? <p className={styles.overflow} role="alert">{fileError}</p> : null}
      <div className={styles.footer} data-inline={layout === "inline" ? "true" : undefined}>
        <div className={styles.footerStart}>
          {layout === "stacked" ? (
            <>
              {addMenu}
              {footerStart}
            </>
          ) : null}
          <span className={layout === "inline" ? "sr-only" : styles.hint} id={hintId}>
            {t(COMPOSER_DISCOVERY_HINT)}
          </span>
          {lengthState.message ? (
            <span
              className={styles.meter}
              data-level={lengthState.level}
              id={meterId}
              role="status"
            >
              {t(lengthState.level === "near" ? "composer.length.near" : lengthState.level === "over-send" ? "composer.length.over" : "composer.length.draftLimit", {
                remaining: lengthState.remainingToSend, sendLimit, draftLimit: COMPOSER_DRAFT_LIMIT,
              })}
            </span>
          ) : (
            <span className="sr-only" id={meterId}>
              {t("composer.length.remaining", { remaining: lengthState.remainingToSend })}
            </span>
          )}
        </div>
        {layout === "stacked" ? <div className={styles.footerEnd}>{footerEnd}</div> : null}
      </div>
      {onFiles ? (
        <input
          aria-hidden="true"
          disabled={disabled || readOnly}
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            const context = pickerContext.current;
            pickerContext.current = null;
            if (context?.binding === binding && files.length) acceptsFiles(files);
          }}
          ref={picker}
          tabIndex={-1}
          type="file"
        />
      ) : null}
      {documentReview ? (
        <ComposerDocumentPreview
          draftLength={value.length}
          disabled={disabled || readOnly}
          maxLength={maxLength}
          onAdd={stageDocumentExcerpt}
          onCancel={cancelDocument}
          record={documentReview}
          restoreFocus={() => afterDocumentClose.current()}
          sendLimit={sendLimit}
        />
      ) : null}
    </div>
  );
}
