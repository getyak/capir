"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowCounterClockwise, Check, LinkSimple, Pause, Play, Trash, Image as ImageIcon, CaretLeft, DotsThree } from "@phosphor-icons/react";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { siteConfig } from "@/lib/site";
import { useReducedMotionPreference } from "@/lib/use-reduced-motion";
import type { PersonalAgentDemoState, PersonalAgentDemoEvent } from "@/lib/personal-agent-demo";
import s from "./personal-agent.module.css";

export function PersonalAgentDemo({ locale, state, dispatch }: { locale: MarketingLocale; state: PersonalAgentDemoState; dispatch: Dispatch<PersonalAgentDemoEvent> }) {
  const en = locale === "en";
  const t = (zh: string, english: string) => en ? english : zh;
  const [sourceOpen, setSourceOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const reduced = useReducedMotionPreference();
  const introduced = useRef(false);
  useEffect(() => {
    if (introduced.current || document.hidden) return;
    introduced.current = true;
    const frame = requestAnimationFrame(() => { if (!document.hidden) dispatch({ type: "play", reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches }); });
    return () => { cancelAnimationFrame(frame); introduced.current = false; };
  }, [dispatch]);
  useEffect(() => {
    if (!state.playing) return;
    if (reduced) {
      const frame = requestAnimationFrame(() => dispatch({ type: "complete-introduction" }));
      return () => cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => dispatch({ type: "tick", run: state.run, phase: state.phase }), 800);
    return () => window.clearTimeout(timer);
  }, [state.playing, state.run, state.phase, reduced, dispatch]);
  useEffect(() => {
    const hide = () => { if (document.hidden) dispatch({ type: "pause" }); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [dispatch]);
  const stale = !state.sourceAvailable;
  const stage = stale ? t("来源已移除", "Source removed") : !state.identityResolved ? t("先确认人物", "Resolve identity first") : state.updateConfirmed ? t("已更新 · 演示内", "Updated · in this demo") : state.newReply ? t("新变化 · 待确认", "New change · for review") : state.saved ? t("已记下 · 演示内", "Kept · in this demo") : t("理解草稿 · 待确认", "Understanding · for review");
  const title = stale ? t("这份回顾，已失去来源支持。", "This recap has lost its source support.") : state.updateConfirmed ? t("介绍已发，等陈夏看完。", "Overview sent. Waiting for Chen Xia to review.") : state.newReply ? t("新回复，接回原来这件事。", "A new reply continues the same thing.") : t("你答应先发一份介绍。", "You promised to send an overview.");
  const steps = [t("你分享的截图", "Your shared screenshot"), t("理解说话人和时间", "Understand speaker & time"), t("由你决定留下什么", "You choose what to keep"), t("分层保留背景", "Keep distinct layers"), t("新回复，继续同一件事", "New reply, same work")];
  const complete = state.phase === 3;
  return <section id="personal-agent-demo" className={s.demoSection} aria-label={t("截图接续合成演示", "Synthetic screenshot continuity demo")}>
    <div className={s.demoGrid} data-playing={state.playing}>
      <div className={s.sourceColumn}>
        <div className={s.columnLabel}><span>01</span>{t("一段以后还用得上的话", "Words that will matter again")}</div>
        <div className={s.mobileCapture}>{stale ? <p>{t("来源已移除，原话不再显示。", "Source removed; original words are unavailable.")}</p> : <><span>{t("陈夏 · 9 月 28 日 · 合成截图片段", "Chen Xia · Sep 28 · synthetic capture excerpt")}</span><p>“你先发个介绍给我？”</p><p className={s.mobilePromise}>{t("你回复：", "You replied: ")}“好，我整理一下发你。”</p></>}</div>
        <button className={s.expandChat} onClick={()=>setChatExpanded(!chatExpanded)} aria-expanded={chatExpanded} aria-controls="synthetic-wechat-capture">{chatExpanded ? t("收起完整微信风格截图", "Collapse full WeChat-style capture") : t("展开完整微信风格截图", "Expand full WeChat-style capture")}</button>
        <div id="synthetic-wechat-capture" data-expanded={chatExpanded} className={s.phone} aria-label={t("微信风格合成聊天，陈夏与你", "WeChat-style synthetic chat, Chen Xia and you")}>
          <div className={s.phoneStatus}><span>14:36</span><span aria-hidden="true">▮▮▮　▰</span></div>
          <div className={s.chatHeader}><CaretLeft size={19} aria-hidden="true"/><strong>陈夏</strong><DotsThree size={24} aria-hidden="true"/></div>
          <div className={s.chatBody}>
            {stale ? <div className={s.removed}><ImageIcon size={28}/><p>{t("合成来源已移除", "Synthetic source removed")}</p><small>{t("原话与依赖背景不再显示。", "Source words and dependent context are no longer shown.")}</small></div> : <>
              <p className={s.chatTime}>2026/9/28 14:36 · UTC+08:00</p>
              <div className={s.chatRow}><span className={s.avatar} aria-hidden="true">夏</span><div><small>陈夏</small><p className={s.bubble}>下周可以看看你的产品，你先发个介绍给我？</p></div></div>
              <div className={`${s.chatRow} ${s.outgoing}`}><span className={`${s.avatar} ${s.you}`} aria-hidden="true">我</span><div><small>{t("你", "You")}</small><p className={s.bubble}>好，我整理一下发你。</p></div></div>
              <div className={s.chatRow}><span className={s.avatar} aria-hidden="true">夏</span><div><small>陈夏</small><p className={s.bubble}>好，时间我们到时再约。</p></div></div>
              {state.newReply && <motion.div className={s.laterReply} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><p className={s.chatTime}>2026/9/30 16:20 · UTC+08:00</p><div className={`${s.chatRow} ${s.outgoing}`}><span className={`${s.avatar} ${s.you}`} aria-hidden="true">我</span><div><small>{t("你", "You")}</small><p className={s.bubble}>介绍已经发你了。</p></div></div><div className={s.chatRow}><span className={s.avatar} aria-hidden="true">夏</span><div><small>陈夏</small><p className={s.bubble}>收到，我周末看看。</p></div></div></motion.div>}
            </>}
          </div>
          <div className={s.chatBottom}><ImageIcon size={16} aria-hidden="true"/>{t("合成微信截图 · 无微信连接", "Synthetic WeChat-style capture · no connection")}</div>
        </div>
      </div>
      <div className={s.causalColumn}>
        <div className={s.columnLabel}><span>02</span>{t("先理解，再由你确认", "Understand, then review")}</div>
        <ol className={s.causalGraph} aria-label={t("来源到接续的处理链路", "Source-to-continuation path")}>
          {steps.map((label, index) => {
            const active = !stale && (index < 2 ? state.phase >= index : index === 2 ? complete : index === 3 ? state.saved : state.updateConfirmed);
            return <li key={label} data-active={active} data-gate={index === 2} data-stale={stale}>
              {index < 4 && <svg className={s.graphEdge} viewBox="0 0 12 30" aria-hidden="true"><path d="M6 0V24M2 20l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray={active ? undefined : "2 3"}/><motion.path d="M6 0V24" fill="none" stroke="currentColor" strokeWidth="1.8" initial={false} animate={{pathLength:active?1:0}} transition={{duration:reduced?0:.55}}/></svg>}<span className={s.nodeDot}>{index === 2 ? <Check size={13} aria-hidden="true"/> : index+1}</span>
              <div><strong>{label}</strong>{index === 0 && <small>{t("仅这份合成来源", "Only this synthetic source")}</small>}{index === 1 && <small>{t("原话 ≠ 已确认背景", "Words ≠ confirmed context")}</small>}{index === 2 && <small>{state.saved ? t("你已在演示中确认", "Reviewed in this demo") : t("尚未保存，等待你的选择", "Not saved; your choice next")}</small>}{index === 3 && <div className={s.layers}><span>{t("人物", "Person")}</span><span>{t("背景", "Context")}</span><span>{t("未完事项", "Work")}</span></div>}{index === 4 && <small>{state.updateConfirmed ? t("事项 01 · 已审阅更新", "Item 01 · reviewed update") : t("事项 01 · 不重复创建", "Item 01 · no duplicate")}</small>}</div>
            </li>;
          })}
        </ol>
        <p className={s.graphFootnote}>{t("本页模拟链路 · 不代表后台执行", "Simulated page flow · not a backend execution")}</p>
      </div>
      <div className={s.resultColumn}>
        <div className={s.columnLabel}><span>03</span>{t("一件能接着走的事", "One thing you can continue")}</div>
        <div className={s.agentSheet} data-stale={stale}>
          <div className={s.agentIdentity}><span className={s.agentMark} aria-hidden="true"/><strong>{siteConfig.name}</strong><span>{stage}</span></div>
          <AnimatePresence mode="wait"><motion.div key={stale ? "stale" : state.updateConfirmed ? "updated" : state.newReply ? "reply" : "original"} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reduced ? 0 : .2}}>
            <h2>{title}</h2>
            <p className={s.agentUnderstanding}>{stale ? t("依赖截图的当前背景与建议已失效。此前的演示确认不能替代来源。", "Dependent context and suggestions are stale. An earlier demo confirmation cannot replace its source.") : state.updateConfirmed ? t("同一事项从“准备介绍”变成“等对方看完”。原话说周末会看，没有承诺回复日期。", "The same item changed from preparing an overview to waiting for review. The reply mentions reviewing over the weekend, not a promised reply date.") : state.newReply ? t("你表示介绍已发；陈夏说周末会看。可以更新已有事项，仍需你审阅。", "You said the overview was sent; Chen Xia said they would review it over the weekend. This proposes an update to the existing item, for your review.") : t("陈夏说，下周可以看看你的产品。你答应先发一份介绍，目前还没有确定见面时间。", "Chen Xia said they could look at your product next week. You agreed to send an overview. A meeting time has not been agreed.")}</p>
          </motion.div></AnimatePresence>
          {!stale && <>
            <button className={s.sourceLink} onClick={()=>setSourceOpen(!sourceOpen)} aria-expanded={sourceOpen} aria-controls="personal-demo-source"><LinkSimple size={15} aria-hidden="true"/>{sourceOpen ? t("收起原话", "Hide source words") : t("查看原话与时间", "Inspect words & time")}</button>
            {sourceOpen && <div id="personal-demo-source" className={s.sourceDetail}><p>{t("仅用户分享的合成截图 · 说话人已标注", "Only user-shared synthetic captures · speakers labelled")}</p><blockquote>你 · 2026/9/28 14:36：好，我整理一下发你。</blockquote>{state.newReply && <blockquote>陈夏 · 2026/9/30 16:20：收到，我周末看看。</blockquote>}<small>{t("“下周”“周末”保留相对表述，不创建日程。原话保持中文。", "Relative dates stay relative; no calendar event is created. Original words remain in Chinese.")}</small></div>}
            {!state.identityResolved ? <div className={s.identityQuestion}><strong>{state.identityDeferred ? t("已留作未绑定线索 · 仅演示", "Kept as an unbound clue · demo only") : t("哪一位陈夏？", "Which Chen Xia?")}</strong><p>{t("当前只比较身份线索；不读取任何人物的私有背景。", "Compare identity clues only; no private relationship context is read.")}</p><button onClick={()=>dispatch({type:"resolve-identity"})}>{t("活动后认识的陈夏 · 与当前截图有关", "Chen Xia met at the event · linked to this capture")}</button><button onClick={()=>dispatch({type:"defer-identity"})} disabled={state.identityDeferred}>{t("先保留为未绑定线索", "Keep as an unbound clue for now")}</button></div> : <>
              <div className={s.workItem}><div><span>{t("未完事项", "Unfinished thing")} · 01</span><span>{state.updateConfirmed ? t("等对方", "Waiting on them") : state.saved ? t("等你整理", "Waiting on you") : t("待确认", "For review")}</span></div><strong>{state.updateConfirmed ? t("等陈夏看完产品介绍", "Wait for Chen Xia to review the overview") : t("整理并发送产品介绍", "Prepare and send the product overview")}</strong><p>{t("没有约定截止日期", "No agreed deadline")}{state.remindersPaused && ` · ${t("提醒已暂停", "Reminders paused")}`}</p></div>
              {!state.saved ? <button className={s.primary} disabled={!complete} onClick={()=>dispatch({type:"save"})}>{t("记下这件事 · 仅演示", "Keep this thing · demo only")}<ArrowRight size={16}/></button> : state.newReply && !state.updateConfirmed ? <button className={s.primary} onClick={()=>dispatch({type:"confirm-update"})}>{t("确认更新同一事项", "Confirm update to the same item")}<Check size={16}/></button> : <div className={s.savedResult}><Check size={16}/>{t("已留在当前演示里", "Kept in this page demo")}</div>}
            </>}
            {!state.saved && state.identityResolved && <button className={s.quietAction} onClick={()=>dispatch({type:"ambiguous"})}>{t("试试遇到同名人物", "Try same-name ambiguity")}</button>}
          </>}
          {stale && <button className={s.primary} onClick={()=>{setSourceOpen(false);dispatch({type:"new-demo"});}}>{t("开始新的合成演示", "Start a new synthetic demo")}<ArrowRight size={16}/></button>}
          <p className={s.scope}>{t("合成演示 · 不连接微信，不保存真实资料，不发送外部消息。", "Synthetic demo · no WeChat connection, real records, or external messages.")}</p>
        </div>
      </div>
    </div>
    <div className={s.demoControls}>
      <div className={s.playback}><button disabled={stale} onClick={()=>dispatch(state.playing ? {type:"pause"} : {type:"play",reducedMotion:reduced})}>{state.playing ? <Pause size={16}/> : <Play size={16}/>} {state.playing ? t("暂停动效", "Pause motion") : t("重播理解过程", "Replay understanding")}</button><span>{t("动效停在结果 · 确认由你完成", "Motion settles · confirmation stays with you")}</span></div>
      <div className={s.controlActions}><button disabled={!state.saved||stale||state.newReply} onClick={()=>dispatch({type:"new-reply"})}><ImageIcon size={16}/>{t("加入下一张截图", "Add the next screenshot")}</button><button disabled={!state.saved||stale} aria-pressed={state.remindersPaused} onClick={()=>dispatch({type:"toggle-reminders"})}><Pause size={16}/>{state.remindersPaused ? t("允许提醒 · 演示", "Allow reminders · demo") : t("先别提醒我", "Pause reminders")}</button><button disabled={stale} onClick={()=>{setSourceOpen(false);dispatch({type:"remove-source"});}}><Trash size={16}/>{t("移除来源", "Remove sources")}</button><button onClick={()=>{setSourceOpen(false);dispatch({type:"new-demo"});}}><ArrowCounterClockwise size={16}/>{t("新演示", "New demo")}</button></div>
    </div>
    <p className={s.demoStatus} role="status">{stale ? t("来源已移除。依赖答案不再可用，重播不会恢复来源。", "Sources removed. Dependent answers are unavailable; replay cannot restore them.") : state.remindersPaused ? t("提醒已暂停，背景保留。这不表示对方不感兴趣。", "Reminders paused, context retained. This does not mean disinterest.") : state.updateConfirmed ? t("事项 01 已更新为等待对方，未创建重复事项、日程或发送消息。", "Item 01 now waits on them. No duplicate item, event, or message was created.") : state.saved ? t("事项 01 已在本页演示中记下，可加入新截图继续。", "Item 01 is kept in this page demo; add a new screenshot to continue.") : t("先看理解，再选择留下什么。所有交互只影响本页合成演示。", "See the understanding before choosing what to keep. All interactions affect this synthetic page demo only.")}</p>
  </section>;
}
