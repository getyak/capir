"use client";
import { workspaceSessionFetch } from "./workspace-session-request";
import { useEffect, useRef, useState } from "react";
import { LOCALE_ENDONYMS, SUPPORTED_LOCALES, type AgentPreferenceMutation, type AgentPreferenceResponse, type LanguagePreference } from "@talent-signal/contracts";
import { useT } from "./marketing/locale-provider";
import styles from "./agent-review-form.module.css";

async function preferenceRequest(sessionVersion: string, input?: AgentPreferenceMutation): Promise<AgentPreferenceResponse> {
  const result = await workspaceSessionFetch("/api/agent-preferences", { method: input ? "PUT" : "GET", cache: "no-store",
    headers: { "x-workspace-session": sessionVersion, ...(input ? { "content-type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}) });
  const body = await result.json();
  if (!result.ok) throw new Error(body.code === "AGENT_PREFERENCES_DISABLED" || /not enabled for this workspace/i.test(body.message ?? "") ? "此工作空间尚未启用回复偏好。" : body.message ?? "暂时无法读取回复偏好。");
  return body;
}
export function AgentResponsePreference({ sessionVersion, embedded = false }: { sessionVersion: string; embedded?: boolean }) {
  const t = useT();
  const [current, setCurrent] = useState<AgentPreferenceResponse["preference"] | null>(null);
  const [style, setStyle] = useState<AgentPreferenceMutation["response_style"]>("default");
  const [promptLanguage, setPromptLanguage] = useState<LanguagePreference>("system");
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(""), [error, setError] = useState("");
  const attempt = useRef<AgentPreferenceMutation | null>(null);
  useEffect(() => {
    let active = true;
    preferenceRequest(sessionVersion).then(result => { if (active) { setCurrent(result.preference); setStyle(result.preference.response_style); setPromptLanguage(result.preference.prompt_output_language ?? "system"); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [sessionVersion]);
  async function reload() {
    setBusy(true); setError(""); setMessage("");
    try { const result = await preferenceRequest(sessionVersion); setCurrent(result.preference); setStyle(result.preference.response_style); setPromptLanguage(result.preference.prompt_output_language ?? "system"); attempt.current = null; }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    if (!current) return;
    setBusy(true); setError(""); setMessage("");
    try {
      attempt.current ??= { idempotency_key: crypto.randomUUID(), expected_revision: current.revision, response_style: style, prompt_output_language: promptLanguage };
      const saved = await preferenceRequest(sessionVersion, attempt.current);
      const readback = await preferenceRequest(sessionVersion);
      if (readback.preference.revision !== saved.preference.revision || readback.preference.response_style !== saved.preference.response_style
        || (readback.preference.prompt_output_language ?? "system") !== (saved.preference.prompt_output_language ?? "system")) throw new Error("偏好已在另一端改变，请重新读取。");
      setCurrent(readback.preference); attempt.current = null; setMessage("已保存，新对话会使用这个偏好。");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const currentPromptLanguage = current ? current.prompt_output_language ?? "system" : "system";
  const dirty = !current || style !== current.response_style || promptLanguage !== currentPromptLanguage;
  return <section className={styles.preference} aria-label={embedded ? "回复偏好" : undefined} aria-labelledby={embedded ? undefined : "reply-preference-title"}>
    {!embedded && <h1 id="reply-preference-title">回复偏好</h1>}
    {!embedded && <p>这是你为自己保存的偏好，会同步到 Web 和 iOS。当前消息中的要求优先。</p>}
    <label className={styles.field} htmlFor="reply-preference-style">回复顺序
    <select id="reply-preference-style" value={style} disabled={busy || !current} onChange={e => { setStyle(e.target.value as typeof style); attempt.current = null; setMessage(""); }}>
      <option value="default">按当前问题安排</option><option value="conclusion_first">先给结论，再展开说明</option>
    </select></label>
    <label className={styles.field} htmlFor="reply-preference-language">{t("language.prompt.label")}
    <select id="reply-preference-language" value={promptLanguage} disabled={busy || !current} data-prompt-language onChange={e => { setPromptLanguage(e.target.value as LanguagePreference); attempt.current = null; setMessage(""); }}>
      <option value="system">{t("language.option.system")}</option>
      {SUPPORTED_LOCALES.map(tag => <option key={tag} value={tag}>{LOCALE_ENDONYMS[tag]}</option>)}
    </select></label>
    <p>{t("language.prompt.hint")} {t("language.prompt.systemHint")}</p>
    <p>只改变回复方式和写作语言，不改变来源判断或操作权限。选择“按当前问题安排”与“{t("language.option.system")}”可以重置。</p>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={busy || !current || !dirty} onClick={save}>{busy ? "正在核对…" : "保存偏好"}</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={reload}>重新读取</button>
    </div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
