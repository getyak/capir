/** Refusals constrain proposed effects; they never grant execution authority. */
export interface ProposalDeclines {
  global: boolean;
  contact: boolean;
  memory: boolean;
  calendar: boolean;
  mcp: boolean;
}
type Effect = Exclude<keyof ProposalDeclines, "global">;

export function authoredProposalText(text: string): string {
  const note = text.replace(/```[\s\S]*?```/gu, " ").replace(/^\s*>.*$/gmu, " ")
    .replace(/[“「『][\s\S]*?[”」』]/gu, " ").replace(/"[^"\n]*"/gu, " ");
  return inlineRefusalEmphasis(note);
}

const verbs = "保存|记录|记住|储存|存储|建档|归档|添加|创建|新建|更新|修改|安排|建立|操作|调用|执行|使用|发送|发出|建|add|create|save|record|remember|store|archive|update|modify|schedule|arrange|call|invoke|execute|use|send|perform|take|make|do";
const negative = "(?:(?:不要|不用|不需要|不必|无需|不许|禁止|请勿|别|不)\\s*(?:(?:再|自动|对外|向外)\\s*)*|\\b(?:do\\s+not|don['’]t|never|no\\s+need\\s+to)\\s+(?:(?:automatically|ever|externally)\\s+)*)";
const action = new RegExp(`${negative}(${verbs})\\s*`, "giu");
const nextVerb = new RegExp(`^(?:${verbs})\\s*`, "iu");
const target = /^(?:(?:新的?|任何|一个|这些|这位|这个|这条|我的|到|为)\s*|(?:the|my|a|an|any|new)\s+)*(?:(?<contact>联系人|人物|通讯录|contacts?\b(?:\s+(?:creation|drafts?|proposals?|reviews?))?|people\b|persons?\b)|(?<memory>记忆|memories\b|memory\b)|(?<calendar>会议|日历|会面|日程|提醒|calendar\b(?:\s+(?:events?|drafts?|entries))?|meetings?\b|events?\b|reminders?\b)|(?<mcp>MCP\b(?:\s*(?:工具|调用|请求|连接|配置)|\s+(?:tools?|calls?|requests?|connections?))?|外部(?:工具|调用|操作|消息)|(?:对外)?消息|邮件|(?:external\s+)?(?:messages?\b|emails?\b|tool\s+calls?\b)))(?:\s*(?:草稿|提案|候选|建议|条目|记录|drafts?\b|proposals?\b|reviews?\b|items?\b|entries\b))?/iu;
const connector = /^(?:and\b|or\b|nor\b|以及|或者|或|和|并且?|也)\s*/iu;
const harmlessTail = /^(?:please|for\s+(?:now|this\s+(?:message|turn|request))|暂时|即可|就好|了)?\s*$/iu;
// Preserve existing contact opt-outs with intervening authored modifiers.
const legacyContactDecline = /(?:不要|不用|别|不需要|不必|不许|禁止|请勿)[^，,。；;!?！？\n]{0,12}(?:添加|建|保存)\s*(?:到|为|新的?|任何|一个|这些|这位|这个)?(?:联系人|人物)(?!以外|之外)|(?:do not|don['’]t|no need to)[^,;.!?\n]{0,12}(?:add|create|save)\s+(?:(?:a|new|any)\s+)?contacts?\b|\bno\s+contact\s+creation\b/giu;

/** An authored refusal can span formatting fragments. A complete instruction
 * contained in one inline quotation remains source data. */
function inlineRefusalEmphasis(note: string): string {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  let plain = "", cursor = 0;
  for (const match of note.matchAll(/`([^`\n]*)`/gu)) {
    plain += note.slice(cursor, match.index);
    const start = plain.length;
    plain += match[1]!;
    spans.push({ start, end: plain.length, text: match[1]! });
    cursor = match.index! + match[0].length;
  }
  if (!spans.length) return note;
  plain += note.slice(cursor);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of plain.matchAll(action)) {
    const after = match.index! + match[0].length;
    const object = target.exec(plain.slice(after));
    ranges.push({ start: match.index!, end: object ? after + object[0].length
      : match.index! + match[0].trimEnd().length });
  }
  for (const match of plain.matchAll(/\bno[\s_-]+/giu)) {
    const after = match.index! + match[0].length;
    const object = target.exec(plain.slice(after));
    if (object) ranges.push({ start: match.index!, end: after + object[0].length });
  }
  // Preserve the full conservative grammar, including authored modifiers
  // outside the typed action/object vocabulary.
  for (const pattern of [globalDecline, legacyContactDecline]) {
    for (const match of plain.matchAll(new RegExp(pattern.source, "giu"))) {
      ranges.push({ start: match.index!, end: match.index! + match[0].trimEnd().length });
    }
  }
  let index = 0;
  return note.replace(/`[^`\n]*`/gu, () => {
    const span = spans[index++]!;
    const quotedActions = [...span.text.matchAll(action), ...span.text.matchAll(/\bno[\s_-]+/giu)];
    const completeInside = quotedActions.some(match =>
      target.exec(span.text.slice(match.index! + match[0].length)) !== null);
    if (completeInside || globalDecline.test(span.text)
      || new RegExp(legacyContactDecline.source, "iu").test(span.text)) return " ";
    return ranges.some(range => range.start < span.end && range.end > span.start
      && (range.start < span.start || range.end > span.end)) ? span.text : " ";
  });
}

// Keep the existing conservative fallback for unqualified or ambiguous bans.
// Only a fully understood effect list is removed before this global check.
const globalDecline = /(?:仅供|只供)(?:分析|参考)|(?:只|仅仅?)(?:需要|要|想|帮我|请|做)?(?:分析|解释|描述|总结|翻译|看看|看一下)|(?:不要|不用|别|不必|不需要|无需|不许|禁止|请勿)[^，,。；;!?！？\n]{0,12}(?:保存|记录|记住|建档|归档|添加|创建|更新|操作|行动)|(?:不做|不进行)[^，,。；;!?！？\n]{0,8}(?:操作|更改|动作|行动)|(?:^|\s)不(?:保存|记录|记住|建档|归档|添加|创建|更新|操作|行动)(?:$|\s)|\b(?:no[\s_-]+(?:actions?|sav(?:e|ing)|proposals?)|analysis[\s_-]+only|(?:just|only)\s+(?:analy[sz]e|describe|explain|summari[sz]e|translate)|(?:do\s+not|don['’]t|never|no\s+need\s+to)\s+(?:(?:make|take|perform)\s+(?:any\s+)?(?:actions?|changes?)|do\s+anything|save|record|remember|store|archive|create|add|update))\b/iu;

/** Host-created contact cards require an authored contact request when a
 * separate Memory refusal would otherwise be read as an invitation to help. */
export function authoredContactDraftRequested(texts: readonly string[]): boolean {
  const request = /(?:准备|创建|新建|添加|建立|起草|prepare|create|add|draft|review)[^，,。；;!?！？\n]{0,36}(?:联系人|人物|contacts?)[^，,。；;!?！？\n]{0,18}(?:草稿|建议|待确认|审核|review|draft)|(?:联系人|人物|contacts?)[^，,。；;!?！？\n]{0,18}(?:草稿|建议|待确认|审核|review|draft)[^，,。；;!?！？\n]{0,24}(?:准备|创建|新建|添加|建立|起草|prepare|create|add|draft|review)/iu;
  return texts.some(text => {
    const policy = proposalDeclines([text]);
    return !policy.global && !policy.contact && request.test(authoredProposalText(text));
  });
}

function targets(text: string): { effects: Effect[]; complete: boolean } {
  const effects: Effect[] = [];
  let rest = text.trim();
  while (rest) {
    const match = target.exec(rest);
    if (!match) return { effects, complete: false };
    effects.push(...Object.keys(match.groups ?? {}).filter(key => match.groups![key] !== undefined) as Effect[]);
    rest = rest.slice(match[0].length).trim();
    if (harmlessTail.test(rest)) return { effects, complete: true };
    const join = connector.exec(rest);
    if (!join) return { effects, complete: false };
    rest = rest.slice(join[0].length).replace(nextVerb, "").trim();
    if (!rest) return { effects, complete: false };
  }
  return { effects, complete: false };
}

export function proposalDeclines(texts: readonly string[]): ProposalDeclines {
  const result: ProposalDeclines = { global: false, contact: false, memory: false, calendar: false, mcp: false };
  for (const text of texts) {
    const note = authoredProposalText(text);
    // A contrast begins a fresh clause, so its positive request cannot be
    // mistaken for another object of the preceding refusal.
    for (const original of note.split(/[，,。.;；!?！？\n]|但是|不过|而是|但|\b(?:but|however)\b/iu)) {
      const matches = [...original.matchAll(action)];
      let remainder = original;
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index]!;
        const start = match.index!;
        const end = matches[index + 1]?.index ?? original.length;
        const body = original.slice(start + match[0].length, end)
          .replace(/(?:and\b|or\b|nor\b|以及|或者|或|和|并且?|也)\s*$/iu, "").trim();
        const parsed = targets(body);
        for (const effect of parsed.effects) result[effect] = true;
        if (!parsed.complete && /^(?:保存|记录|记住|储存|存储|建档|归档|添加|创建|新建|更新|修改|建立|操作|建|save|record|remember|store|archive|create|add|update|modify|perform|take|make|do)$/iu.test(match[1]!)) result.global = true;
        if (/^(?:call|invoke|execute|use|send|调用|执行|使用|发送|发出)$/iu.test(match[1]!)) result.mcp = true;
        if (/^(?:schedule|arrange|安排)$/iu.test(match[1]!)) result.calendar = true;
        if (parsed.complete) remainder = remainder.slice(0, start) + " " + remainder.slice(end);
      }
      remainder = remainder.replace(legacyContactDecline, () => { result.contact = true; return " "; });
      remainder = remainder.replace(/^\s*(?:please\s+)?no[\s_-]+((?:new\s+)?contacts?(?:\s+creation)?|memory|memories|calendar(?:\s+events?)?|meetings?|MCP(?:\s+calls?)?)\b(?:\s+please)?\s*$/giu,
        (_match, object: string) => {
          const parsed = targets(object);
          for (const effect of parsed.effects) result[effect] = true;
          return parsed.complete ? " " : _match;
        });
      if (globalDecline.test(remainder)) result.global = true;
    }
  }
  return result;
}
