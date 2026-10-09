"use client";

import { ArrowDown, ArrowUp, ArrowClockwise, Ghost, Info, Stop, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { privateConversationMessages, readPrivateConversation, type PrivateTurn } from "@/lib/private-conversation";
import { ConversationResponse } from "../conversation-response";
import styles from "./private-conversation.module.css";

export function PrivateConversation({ binding, accountId }: { binding: string; accountId: string }) {
  return <PrivateConversationRoom key={`${accountId}:${binding}`} binding={binding} accountId={accountId} />;
}

function PrivateConversationRoom({ binding, accountId }: { binding: string; accountId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<PrivateTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [away, setAway] = useState(false);
  const mounted = useRef(false);
  const active = useRef<AbortController | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follows = useRef(true);
  const turnRef = useRef(turns);
  useLayoutEffect(() => { turnRef.current = turns; }, [turns]);
  const composingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    function clear() {
      active.current?.abort(); active.current = null;
      turnRef.current = []; setTurns([]); setDraft(""); setBusy(false); setError("");
    }
    // A page restored from the back/forward cache must also start empty.
    window.addEventListener("pagehide", clear);
    return () => {
      mounted.current = false;
      active.current?.abort(); active.current = null; turnRef.current = [];
      window.removeEventListener("pagehide", clear);
    };
  }, [binding]);

  useLayoutEffect(() => {
    const node = editor.current;
    if (!node) return;
    const resize = () => {
      node.style.height = "auto";
      node.style.height = `${Math.max(88, Math.min(node.scrollHeight, 240, (window.visualViewport?.height ?? window.innerHeight) * .35))}px`;
    };
    resize(); window.visualViewport?.addEventListener("resize", resize);
    return () => window.visualViewport?.removeEventListener("resize", resize);
  }, [draft]);

  useEffect(() => {
    if (follows.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns]);

  function patch(id: string, update: Partial<PrivateTurn>) {
    setTurns(current => current.map(turn => turn.id === id ? { ...turn, ...update } : turn));
  }
  function stop() {
    active.current?.abort();
  }
  function exit() {
    stop(); active.current = null; turnRef.current = [];
    setTurns([]); setDraft(""); setError(""); setBusy(false);
    router.replace("/workspace");
  }
  async function send(retry?: PrivateTurn) {
    if (retry && turnRef.current.at(-1)?.id !== retry.id) return;
    const prompt = retry?.prompt ?? draft.trim();
    if (active.current || expired || composingRef.current || !prompt || prompt.length > 4_000) return;
    const controller = new AbortController(); active.current = controller;
    const history = retry ? turnRef.current.slice(0, turnRef.current.findIndex(turn => turn.id === retry.id)) : turnRef.current;
    const id = retry?.id ?? crypto.randomUUID();
    const turn: PrivateTurn = { id, prompt, answer: "", status: "pending" };
    follows.current = true; setAway(false); setBusy(true); setError("");
    if (retry) setTurns(current => current.map(item => item.id === id ? turn : item));
    else { setTurns(current => [...current, turn]); setDraft(""); }
    const current = () => mounted.current && active.current === controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 65_000);
    try {
      const response = await fetch("/api/private-conversation", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json", "x-workspace-session": binding, "x-talent-signal-workspace": accountId },
        body: JSON.stringify({ messages: privateConversationMessages(history, prompt) }),
      });
      if (!response.ok || !response.body) {
        if ([401, 403, 409].includes(response.status) && current()) {
          controller.abort(); active.current = null; turnRef.current = [];
          setTurns([]); setDraft(""); setBusy(false); setExpired(true);
          setError("登录状态已变化。退出后重新进入隐私对话。");
        } else if (current()) setError(response.status === 429 ? "请求有些频繁，稍后可以重试这条消息。" : "这次未能完成回复，可以重试。");
        throw new Error("PRIVATE_REQUEST_FAILED");
      }
      const answer = await readPrivateConversation(response.body, text => {
        if (current()) patch(id, { answer: text });
      }, controller.signal);
      if (current()) patch(id, { answer, status: "complete" });
    } catch {
      if (current()) {
        const stopped = controller.signal.aborted && controller.signal.reason !== "timeout";
        patch(id, { status: stopped ? "stopped" : "failed" });
        if (!stopped) setError(previous => previous || "回复没有完整收到，可以重试这条消息。");
      }
    } finally {
      clearTimeout(timeout);
      if (current()) { active.current = null; setBusy(false); editor.current?.focus(); }
    }
  }

  const canSend = Boolean(draft.trim()) && draft.trim().length <= 4_000 && !busy && !expired && !composing;
  return <main id="main-content" tabIndex={-1} className={styles.room} data-private-conversation data-empty={turns.length === 0}>
    <header className={styles.header}>
      <span className={styles.roomName}><Ghost size={18} weight="fill" aria-hidden="true"/>隐私对话</span>
      <div className={styles.headerEnd}><span>不留历史，不进入人物记忆</span><button onClick={exit} className={styles.exit}><X size={16} aria-hidden="true"/>退出并清空</button></div>
    </header>
    <div className={styles.body}>
      {turns.length === 0 ? <div className={styles.welcome}>
        <span className={styles.orbit}><Ghost size={23} weight="fill" aria-hidden="true"/></span>
        <h1>只属于此刻的对话</h1>
        <p>留一点空间，把想法慢慢理清。<br/>退出后，这里的内容随即清空。</p>
      </div> : <div className={styles.transcript} ref={transcript} tabIndex={0} role="region" aria-label="本次隐私对话" onScroll={() => {
        const node = transcript.current; if (!node) return;
        follows.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; setAway(!follows.current);
      }}><div className={styles.messages}>{turns.map(turn => <article key={turn.id} className={styles.turn}>
        <div className={styles.user}><span className={styles.srOnly}>你：</span>{turn.prompt}</div>
        <div className={styles.answer}><div className={styles.answerName}><Ghost size={15} weight="fill" aria-hidden="true"/>capri</div>
          {turn.answer ? <ConversationResponse foldable={turn.status === "complete"}>{turn.answer}</ConversationResponse> : turn.status === "pending" ? <span className={styles.waiting} role="status">正在思考<span aria-hidden="true">···</span></span> : null}
          {turn.status === "pending" && turn.answer && <span className={styles.cursor} aria-hidden="true"/>}
          {turn.status === "stopped" && <p className={styles.turnStatus}>已停止，以上内容尚未完成。</p>}
          {turn.status === "failed" && <p className={styles.turnStatus}>这条回复未完成。{!expired && turns.at(-1)?.id === turn.id && <button disabled={busy} onClick={() => void send(turn)}><ArrowClockwise size={14} aria-hidden="true"/>重试这条</button>}</p>}
        </div>
      </article>)}</div></div>}
      <div className={styles.dock}>
        {away && <button className={styles.latest} onClick={() => { follows.current = true; setAway(false); transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }}><ArrowDown size={15}/>回到最新</button>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(); }}>
          <label className={styles.srOnly} htmlFor="private-conversation-input">隐私消息</label>
          <textarea id="private-conversation-input" ref={editor} autoFocus autoComplete="off" value={draft} maxLength={4_000} disabled={expired}
            placeholder="有什么想在这里聊聊的？" rows={3} onChange={event => setDraft(event.target.value)}
            onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
            onCompositionEnd={() => { composingRef.current = false; setComposing(false); }}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composingRef.current) { event.preventDefault(); if (canSend) void send(); } }}/>
          <div className={styles.composerFooter}><span><Ghost size={14} aria-hidden="true"/>仅本次对话</span>{draft.length > 3_500 && <small>{draft.length} / 4,000</small>}
            {busy ? <button className={styles.send} type="button" onClick={stop} aria-label="停止回复"><Stop size={18} weight="fill"/></button>
              : <button className={styles.send} type="submit" disabled={!canSend} aria-label="发送隐私消息"><ArrowUp size={20} weight="bold"/></button>}
          </div>
        </form>
        <details className={styles.privacyDetails}><summary><Info size={14} aria-hidden="true"/>隐私对话如何处理内容</summary>
          <p>内容只在当前页面临时显示，不保存到 capri 会话历史、人物记忆或内容评测日志。关闭、刷新或离开后无法恢复，普通对话的草稿会保留。</p>
          <p>发送后，内容与本次最近的部分对话会交给已配置的模型服务处理；该服务的保留规则仍然适用。此处只讨论文字，不读取人物资料，也不执行资料、日程或外部操作。</p>
        </details>
      </div>
    </div>
  </main>;
}
