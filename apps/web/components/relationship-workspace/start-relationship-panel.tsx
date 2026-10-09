"use client";

import {
  parseIdentityHandleQuery,
  type PersonDirectoryItem,
  type RelationshipScope,
  type ResourceCaptureResponse,
} from "@talent-signal/contracts";
import {
  ArrowRight,
  ChatCircleDots,
  CircleNotch,
  FileImage,
  LinkSimple,
  PencilSimple,
  Plus,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import type { ConversationTranscriptMessage } from "@/lib/conversation-transcript";
import { ConversationTranscriptComposer } from "./conversation-transcript-composer";
import { relationshipIntegrationFetch } from "@/components/workspace-session-request";
import { initials, personContextSummary } from "./relationship-display";

type ResourceMode = "conversation" | "note" | "document" | "url";

export function StartRelationshipPanel({
  onCommitted,
  onScreenshot,
}: {
  onCommitted: (
    scope: RelationshipScope,
    receipts: ResourceCaptureResponse[],
    outcome:
      | "created_person"
      | "created_relationship_context"
      | "reused_relationship",
  ) => void;
  onScreenshot: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const requestCapturedAtRef = useRef<string | null>(null);
  const peopleRequestIdRef = useRef(0);
  const [people, setPeople] = useState<PersonDirectoryItem[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleLookupFailed, setPeopleLookupFailed] = useState(false);
  const [mode, setMode] = useState<ResourceMode>("note");
  const [contactName, setContactName] = useState("");
  const [contextLabel, setContextLabel] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(
    null,
  );
  const [selectedContextId, setSelectedContextId] = useState<string | null>(
    null,
  );
  const [createNewPerson, setCreateNewPerson] = useState(false);
  const [createNewContext, setCreateNewContext] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [transcriptMessages, setTranscriptMessages] = useState<
    ConversationTranscriptMessage[]
  >([]);
  const [transcriptAttributionReviewed, setTranscriptAttributionReviewed] =
    useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentKind, setDocumentKind] = useState<
    "resume" | "document"
  >("resume");
  const [saveDiscoveredLinks, setSaveDiscoveredLinks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = contactName.normalize("NFKC").trim();
    const requestId = ++peopleRequestIdRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setPeopleLoading(true);
        setPeopleLookupFailed(false);
        void relationshipIntegrationFetch(
          query
            ? "/api/local-integration/people/search"
            : "/api/local-integration/people",
          query
            ? {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query }),
                signal: controller.signal,
              }
            : { cache: "no-store", signal: controller.signal },
        )
          .then(async (response) => {
            const payload = (await response.json()) as
              | { people: PersonDirectoryItem[] }
              | { message?: string };
            if (!response.ok || !("people" in payload)) {
              throw new Error(
                "message" in payload && payload.message
                  ? payload.message
                  : "无法加载现有人才。",
              );
            }
            if (requestId !== peopleRequestIdRef.current) {
              return;
            }
            setPeople(payload.people);
            setPeopleLookupFailed(false);
          })
          .catch((caught: unknown) => {
            if (
              requestId !== peopleRequestIdRef.current ||
              caught instanceof DOMException &&
              caught.name === "AbortError"
            ) {
              return;
            }
            setPeople([]);
            setPeopleLookupFailed(true);
            setError(
              caught instanceof Error
                ? caught.message
                : "无法加载现有人才。",
            );
          })
          .finally(() => {
            if (requestId === peopleRequestIdRef.current) {
              setPeopleLoading(false);
            }
          });
      },
      query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      if (requestId === peopleRequestIdRef.current) {
        peopleRequestIdRef.current += 1;
      }
      controller.abort();
    };
  }, [contactName]);

  const selectedPerson =
    people.find((person) => person.id === selectedPersonId) ?? null;
  const selectedContext =
    selectedPerson?.contexts.find(
      (context) => context.id === selectedContextId,
    ) ?? null;
  const matchingPeople = people.slice(0, 4);
  const contactQueryIsHandle = parseIdentityHandleQuery(contactName) !== null;
  const identityReady =
    (createNewPerson &&
      !peopleLoading &&
      !peopleLookupFailed &&
      !contactQueryIsHandle &&
      contactName.trim() &&
      contextLabel.trim()) ||
    (selectedPerson &&
      (selectedContext || (createNewContext && contextLabel.trim())));
  const sourceReady =
    mode === "document"
      ? file !== null
      : mode === "conversation"
        ? transcriptMessages.length > 0 && transcriptAttributionReviewed
        : value.trim().length > 0;

  function resetRequest() {
    requestIdRef.current = null;
    requestCapturedAtRef.current = null;
    setError("");
  }

  async function submit() {
    if (!identityReady || !sourceReady) {
      setError(
        "请选择现有人物及关系背景，或明确新建人物，然后添加一个来源。",
      );
      return;
    }
    if (!requestIdRef.current) {
      requestIdRef.current = crypto.randomUUID();
      requestCapturedAtRef.current = new Date().toISOString();
    }
    const requestId = requestIdRef.current;
    const capturedAt = requestCapturedAtRef.current;
    if (!capturedAt) {
      setError("无法保留来源观察时间。")
      return;
    }
    const scopeMode = createNewPerson
      ? "new_person"
      : createNewContext
        ? "existing_person_new_context"
        : "existing";
    setBusy(true);
    setError("");
    try {
      let response: Response;
      if (mode === "document" && file) {
        const form = new FormData();
        form.set("request_id", requestId);
        form.set("captured_at", capturedAt);
        form.set("scope_mode", scopeMode);
        form.set("contact_name", contactName.trim());
        form.set("relationship_context_label", contextLabel.trim());
        if (selectedPersonId) {
          form.set("person_id", selectedPersonId);
        }
        if (selectedContextId) {
          form.set("relationship_context_id", selectedContextId);
        }
        form.set("document_kind", documentKind);
        form.set(
          "save_discovered_links",
          saveDiscoveredLinks ? "true" : "false",
        );
        form.set("file", file);
        response = await relationshipIntegrationFetch(
          "/api/local-integration/resources",
          {
            method: "POST",
            body: form,
            cache: "no-store",
          },
        );
      } else {
        response = await relationshipIntegrationFetch(
          "/api/local-integration/resources",
          {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            request_id: requestId,
            captured_at: capturedAt,
            scope_mode: scopeMode,
            contact_name: contactName.trim(),
            relationship_context_label: contextLabel.trim(),
            person_id: selectedPersonId ?? undefined,
            relationship_context_id: selectedContextId ?? undefined,
            type: mode,
            title: title.trim() || undefined,
            value: value.trim(),
            ...(mode === "conversation"
              ? {
                  transcript_messages: transcriptMessages,
                  attribution_reviewed: transcriptAttributionReviewed,
                }
              : {}),
            }),
          },
        );
      }
      const payload = (await response.json()) as
        | { receipts: ResourceCaptureResponse[] }
        | { message?: string };
      if (!response.ok || !("receipts" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法提交首个来源。",
        );
      }
      const first = payload.receipts[0];
      const personId = first?.identity.person_id;
      const relationshipContextId =
        first?.identity.relationship_context_id;
      if (!first || !personId || !relationshipContextId) {
        throw new Error(
          "首个来源正在等待身份审阅，暂时无法打开人物页面。",
        );
      }
      onCommitted(
        {
          contract_version: first.contract_version,
          person: {
            id: personId,
            display_label:
              selectedPerson?.display_label ?? contactName.trim(),
          },
          relationship_context: {
            id: relationshipContextId,
            display_label:
              selectedContext?.display_label ?? contextLabel.trim(),
          },
        },
        payload.receipts,
        !selectedPerson
          ? "created_person"
          : selectedContext
            ? "reused_relationship"
            : "created_relationship_context",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法提交首个来源。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="context-start">
      <div className="context-start__intro">
        <p className="eyebrow">添加第一份背景资料</p>
        <h2>选择人物、关系与来源。</h2>
        <p>
          先确认是谁，再添加资料。提取的内容会留给你核对。
        </p>
      </div>

      <div className="context-start__identity">
        <label>
          <span>人物</span>
          <input
            autoComplete="off"
            maxLength={200}
            onChange={(event) => {
              setPeopleLoading(true);
              setPeopleLookupFailed(false);
              setContactName(event.target.value);
              setSelectedPersonId(null);
              setSelectedContextId(null);
              setCreateNewPerson(false);
              setCreateNewContext(false);
              resetRequest();
            }}
            placeholder="搜索或输入姓名"
            value={contactName}
          />
        </label>
        <div className="context-start__choices">
          {peopleLoading ? (
            <span>正在加载人才……</span>
          ) : (
            matchingPeople.map((person) => (
              <button
                data-selected={selectedPersonId === person.id}
                key={person.id}
                onClick={() => {
                  setSelectedPersonId(person.id);
                  setContactName(person.display_label);
                  setCreateNewPerson(false);
                  setCreateNewContext(false);
                  setSelectedContextId(null);
                  setContextLabel("");
                  resetRequest();
                }}
                type="button"
              >
                <span>{initials(person.display_label)}</span>
                <p>
                  <strong>{person.display_label}</strong>
                  <small>
                    {personContextSummary(person)} · {person.capture_count}{" "}
                    个来源
                  </small>
                </p>
              </button>
            ))
          )}
          {!peopleLoading &&
          !peopleLookupFailed &&
          contactName.trim() &&
          !contactQueryIsHandle ? (
            <button
              data-selected={createNewPerson}
              onClick={() => {
                setCreateNewPerson(true);
                setSelectedPersonId(null);
                setSelectedContextId(null);
                setCreateNewContext(false);
                resetRequest();
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              <p>
                <strong>创建“{contactName.trim()}”</strong>
                <small>这是一次明确的新人物创建决定。</small>
              </p>
            </button>
          ) : null}
        </div>
        {contactQueryIsHandle &&
        matchingPeople.length === 0 &&
        !peopleLoading &&
        !peopleLookupFailed ? (
          <p className="context-start__lookup-note">
            当前或历史归属中均未匹配到这条已遮蔽的身份线索。创建新身份前，请先输入姓名。
          </p>
        ) : null}

        {selectedPerson ? (
          <div className="context-start__contexts">
            <span>选择关系背景</span>
            {selectedPerson.contexts.map((context) => (
              <button
                data-selected={selectedContextId === context.id}
                key={context.id}
                onClick={() => {
                  setSelectedContextId(context.id);
                  setContextLabel(context.display_label);
                  setCreateNewContext(false);
                  resetRequest();
                }}
                type="button"
              >
                {context.display_label}
              </button>
            ))}
            <button
              data-selected={createNewContext}
              onClick={() => {
                setSelectedContextId(null);
                setCreateNewContext(true);
                setContextLabel("");
                resetRequest();
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              新建关系背景
            </button>
          </div>
        ) : null}
        {createNewPerson || createNewContext ? (
          <label>
            <span>关系背景</span>
            <input
              maxLength={200}
              onChange={(event) => {
                setContextLabel(event.target.value);
                resetRequest();
              }}
              placeholder="例如：产品副总裁 · Northstar 寻访"
              value={contextLabel}
            />
          </label>
        ) : null}
      </div>

      <div className="context-start__source">
        <div aria-label="首个来源类型" role="tablist">
          {(["note", "conversation", "document", "url"] as const).map((sourceMode) => (
            <button
              aria-selected={mode === sourceMode}
              key={sourceMode}
              onClick={() => {
                setMode(sourceMode);
                resetRequest();
              }}
              role="tab"
              type="button"
            >
              {sourceMode === "note" ? (
                <PencilSimple aria-hidden="true" size={16} />
              ) : sourceMode === "conversation" ? (
                <ChatCircleDots aria-hidden="true" size={16} />
              ) : sourceMode === "document" ? (
                <UploadSimple aria-hidden="true" size={16} />
              ) : (
                <LinkSimple aria-hidden="true" size={16} />
              )}
              {sourceMode === "document"
                ? "文件"
                : sourceMode === "conversation"
                  ? "对话转写"
                  : sourceMode === "note" ? "备注" : "链接"}
            </button>
          ))}
          <button onClick={onScreenshot} type="button">
            <FileImage aria-hidden="true" size={16} />
            截图
          </button>
        </div>

        {mode === "conversation" ? (
          <ConversationTranscriptComposer
            attributionReviewed={transcriptAttributionReviewed}
            messages={transcriptMessages}
            onAttributionReviewedChange={(reviewed) => {
              setTranscriptAttributionReviewed(reviewed);
              resetRequest();
            }}
            onMessagesChange={(messages) => {
              setTranscriptMessages(messages);
              resetRequest();
            }}
            onTitleChange={(nextTitle) => {
              setTitle(nextTitle);
              resetRequest();
            }}
            onValueChange={(nextValue) => {
              setValue(nextValue);
              resetRequest();
            }}
            title={title}
            value={value}
          />
        ) : mode === "document" ? (
          <div className="context-resource-composer__document">
            <input
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                resetRequest();
              }}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="context-resource-file"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <UploadSimple aria-hidden="true" size={20} />
              <span>
                <strong>{file?.name ?? "选择简历或文档"}</strong>
                <small>原始文件仅临时解析，不会保留。</small>
              </span>
            </button>
            <label>
              <span>文档用途</span>
              <select
                onChange={(event) =>
                  setDocumentKind(
                    event.target.value as "resume" | "document",
                  )
                }
                value={documentKind}
              >
                <option value="resume">简历</option>
                <option value="document">补充文档</option>
              </select>
            </label>
            <label className="context-resource-checkbox">
              <input
                checked={saveDiscoveredLinks}
                onChange={(event) =>
                  setSaveDiscoveredLinks(event.target.checked)
                }
                type="checkbox"
              />
              <span>
                将可见网址保存为研究种子
                <small>不会抓取页面，也不会授权研究。</small>
              </span>
            </label>
          </div>
        ) : (
          <div className="context-resource-composer__text">
            <label>
              <span>{mode === "note" ? "备注标题" : "链接名称"}</span>
              <input
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  mode === "note"
                    ? "例如：首次通话背景"
                    : "例如：公开资料页"
                }
                value={title}
              />
            </label>
            <label>
              <span>{mode === "note" ? "你的备注" : "公开网址"}</span>
              {mode === "note" ? (
                <textarea
                  maxLength={40_000}
                  onChange={(event) => {
                    setValue(event.target.value);
                    resetRequest();
                  }}
                  rows={4}
                  value={value}
                />
              ) : (
                <input
                  maxLength={2_000}
                  onChange={(event) => {
                    setValue(event.target.value);
                    resetRequest();
                  }}
                  placeholder="https://"
                  type="url"
                  value={value}
                />
              )}
            </label>
          </div>
        )}
      </div>

      {error ? (
        <p className="context-resource-composer__error" role="alert">
          <Warning aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      <footer>
        <p>
          来源与已确认事实保持分离；在你审阅提取结果前，文件内容始终是提议状态。
        </p>
        <button
          className="context-primary-button"
          disabled={busy || !identityReady || !sourceReady}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? (
            <CircleNotch aria-hidden="true" className="spin" size={17} />
          ) : (
            <ArrowRight aria-hidden="true" size={17} />
          )}
          {busy ? "正在创建人物页面" : "打开持续更新的人物页面"}
        </button>
      </footer>
    </section>
  );
}
