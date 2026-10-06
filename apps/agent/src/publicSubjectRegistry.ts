import {createHash} from "node:crypto";
import {assertPersonResearchQuery} from "./personResearchPolicy.js";

export interface AuthorizedPublicSubject {
  id:string;
  name:string;
  /** Typed source-grounded public context admitted from exact current excerpts. */
  anchors?:readonly PublicContextAnchor[];
  /** A first-contact name observation, never a confirmed identity. */
  tentative?:boolean;
  isCurrent?:()=>Promise<boolean>;
}
// A name field cannot carry arbitrary instructions, contact details, or a
// sentence. A single English first name is deliberately insufficient.
export function isBoundedPublicName(value:string):boolean {
  return /^(?:[\p{Script=Han}]{2,4}|[A-Z][\p{Script=Latin}'’-]{1,24}(?: [A-Z][\p{Script=Latin}'’-]{1,24}){1,3})$/u.test(value);
}

/**
 * Typed public context anchors. Only works/projects, explicit professional
 * organizations/roles, and public handles or profile URLs may support a search;
 * each anchor is an exact excerpt of a current source, never model-written text.
 */
export type PublicContextAnchorKind = "work"|"role"|"handle";
export interface PublicContextAnchor {kind:PublicContextAnchorKind;text:string}
export interface PublicContextAnchorInput {kind:PublicContextAnchorKind;text:string}

export const PUBLIC_CONTEXT_ANCHOR_MAX_LENGTH = 120;
export const PUBLIC_CONTEXT_ANCHORS_PER_SUBJECT = 4;

const ANCHOR_SENTENCE_MARKERS=/[。！？!?；;…\n\r「」『』“”‘’]/u;
const ANCHOR_INSTRUCTION_MARKERS=/(?:ignore|disregard|follow)\s+(?:these|my|the|previous|above)|system\s*[:：]|assistant\s*[:：]|user\s*[:：]|忽略|无视|以上指令|系统[:：]|指令|请(?:你|帮|勿)/iu;
// First/second-person wording marks raw chat, not a work, role, or handle. An
// over-rejected anchor only narrows context; leaked chat would leave the
// authorized purpose boundary.
const ANCHOR_PRIVATE_PRONOUNS=/我|你|您|咱们|对方|\b(?:i|me|my|mine|you|your|yours|we|us|our|ours)\b/iu;
const PRIVATE_CONTEXT=/住址|家住|住在|婚姻|离婚|怀孕|疾病|病史|艾滋|宗教|身份证|护照|hiv|aids|cancer|syphilis|diabet|alzheimer|depress|anxiety|disease|positive|pregnan|divorc|married|diagnos|illness|religion|passport|address|token|secret/iu;
// A model's category label cannot authorize arbitrary prose. Admit only a
// conservative project identifier or explicit professional role shape.
// Unknown CamelCase text can still encode private facts. This small public
// vocabulary is deliberately conservative; unfamiliar work names fall back
// to name/profile research instead of trusting the inspector's category.
const PUBLIC_PROJECT_IDENTIFIERS=new Set(["nanoGPT","nanochat","micrograd","makemore","minGPT","GPT","GPT-2","GPT-3","GPT-4","BERT","LLM","RNN","CNN","PyTorch","TensorFlow","JAX","ChatGPT","StableDiffusion","Llama"]);
const PROFESSIONAL_ROLE=/^(?:(?:OpenAI|Google|DeepMind|Anthropic|Microsoft|Meta|Tesla|Stanford|MIT) )?(?:engineer|researcher|scientist|professor|founder|co-founder|CEO|CTO|developer|designer|工程师|研究员|科学家|教授|创始人|开发者|设计师)$/iu;

/**
 * One bounded, source-grounded context anchor. The text must be an exact
 * excerpt of a CURRENT admitted source; sensitive details (contact values,
 * addresses, background-check wording), raw chat, and arbitrary instructions
 * are rejected rather than transmitted.
 */
export function admitPublicContextAnchor(
  kind:PublicContextAnchorKind,
  text:string,
  groundingTexts:readonly string[],
):PublicContextAnchor|null {
  if(kind!=="work"&&kind!=="role"&&kind!=="handle")return null;
  const value=text.normalize("NFKC").replace(/\s+/gu," ").trim();
  if(value.length<2||value.length>PUBLIC_CONTEXT_ANCHOR_MAX_LENGTH)return null;
  if(!groundingTexts.some(source=>source.normalize("NFKC").replace(/\s+/gu," ").includes(value)))return null;
  if(ANCHOR_SENTENCE_MARKERS.test(value)||ANCHOR_INSTRUCTION_MARKERS.test(value)||ANCHOR_PRIVATE_PRONOUNS.test(value)||PRIVATE_CONTEXT.test(value))return null;
  if(kind==="handle"){
    if(/^https?:\/\//iu.test(value)){
      try{
        const url=new URL(value);
        const profilePaths:Record<string,RegExp>={
          "github.com":/^\/[A-Za-z0-9-]{1,39}(?:\/[A-Za-z0-9_.-]{1,80})?\/?$/u,
          "www.linkedin.com":/^\/in\/[A-Za-z0-9-]{2,80}\/?$/u,
          "linkedin.com":/^\/in\/[A-Za-z0-9-]{2,80}\/?$/u,
          "x.com":/^\/[A-Za-z0-9_]{1,15}\/?$/u,
          "twitter.com":/^\/[A-Za-z0-9_]{1,15}\/?$/u,
        };
        if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash||!profilePaths[url.hostname]?.test(url.pathname))return null;
      }catch{return null;}
    }else if(!/^@[A-Za-z0-9_.-]{2,40}$/u.test(value))return null;
    return {kind,text:value};
  }
  if(/^[a-z][a-z0-9+.-]*:\/\//iu.test(value))return null;
  if(kind==="work"&&!PUBLIC_PROJECT_IDENTIFIERS.has(value))return null;
  if(kind==="role"&&!PROFESSIONAL_ROLE.test(value))return null;
  try{assertPersonResearchQuery(value);}catch{return null;}
  return {kind,text:value};
}

function admitAnchors(
  inputs:readonly PublicContextAnchorInput[]|undefined,
  groundingTexts:readonly string[],
):PublicContextAnchor[] {
  const anchors:PublicContextAnchor[]=[];
  for(const input of inputs??[]){
    if(anchors.length>=PUBLIC_CONTEXT_ANCHORS_PER_SUBJECT)break;
    const anchor=admitPublicContextAnchor(input?.kind,input?.text??"",groundingTexts);
    if(anchor&&!anchors.some(existing=>existing.kind===anchor.kind&&existing.text===anchor.text))anchors.push(anchor);
  }
  return anchors;
}

/** Minimal project/profile clues from the SAME authored name-bearing clause. */
export function publicContextAnchorsFromText(name:string,text:string):PublicContextAnchor[] {
  const anchors:PublicContextAnchor[]=[];
  for(const clause of text.split(/[。！？!?；;\n]/u)){
    if(!clause.includes(name)||ANCHOR_INSTRUCTION_MARKERS.test(clause))continue;
    const candidates=clause.match(/https:\/\/[^\s，,]+|@[A-Za-z0-9_.-]{2,40}|[A-Za-z][A-Za-z0-9_-]{1,60}/gu)??[];
    for(const candidate of candidates){
      const kind:PublicContextAnchorKind=/^(?:https:|@)/u.test(candidate)?"handle":"work";
      const anchor=admitPublicContextAnchor(kind,candidate,[clause]);
      if(anchor&&!anchors.some(existing=>existing.text===anchor.text))anchors.push(anchor);
      if(anchors.length===PUBLIC_CONTEXT_ANCHORS_PER_SUBJECT)return anchors;
    }
  }
  return anchors;
}

/** Explicit "do not search/research" wording removes all search authorization. */
export function publicSearchDeclined(text:string):boolean {
  return /(?:不要|不用|不需要|不必|不许|别|禁止)[^，。！？;；\n]{0,12}(?:搜|查|检索|研究)|(?:do not|don['’]t|never|no need to)\s+(?:search|research|look up)/iu.test(text);
}

export function publicSubjectRegistry(objective:string) {
  const subjects=new Map<string,AuthorizedPublicSubject>();
  const register=(name:string,binding:string,isCurrent?:()=>Promise<boolean>,anchors?:readonly PublicContextAnchor[],tentative?:boolean)=>{
    if(!isBoundedPublicName(name))return null;
    const id=createHash("sha256").update(binding+"\0"+name).digest("hex").slice(0,24);
    const item:AuthorizedPublicSubject={id,name,...(anchors?.length?{anchors:[...anchors]}:{}),...(tentative?{tentative:true}:{}),...(isCurrent?{isCurrent}:{})};subjects.set(id,item);return {id,name,...(anchors?.length?{anchors:[...anchors]}:{}),...(tentative?{tentative:true}:{})};
  };
  // Text subjects bind to an explicit positive research clause. Names elsewhere
  // in the note (including a private contact) are not research authorization;
  // a validated first-contact proposal uses registerTentative below instead.
  const prohibited=publicSearchDeclined(objective);
  if(!prohibited){
    for(const clause of objective.split(/[，。！？;；\n]/u)){
      // Parse bounded clauses in separate linear steps. Overlapping whitespace
      // and optional suffix patterns can otherwise backtrack on hostile input.
      if(clause.length>512)continue;
      let request=clause.trim();
      for(const prefix of ["请","帮我"])if(request.startsWith(prefix)){
        request=request.slice(prefix.length).trimStart();break;
      }
      const verb=["查一下","查查","搜索","研究","了解一下","介绍一下","look up","research"]
        .find(prefix=>request.toLowerCase().startsWith(prefix));
      if(!verb)continue;
      request=request.slice(verb.length).trimStart();
      if(request.startsWith("聊天提到的"))request=request.slice("聊天提到的".length).trimStart();
      const suffixes=["的背景","的作品","的文章"].map(suffix=>request.indexOf(suffix)).filter(index=>index>=0);
      if(suffixes.length)request=request.slice(0,Math.min(...suffixes));
      const names=request.replace(/\s+/gu," ").trim().split(/ and | 和 |、|与/u);
      // Every token must be a complete bounded name. Reject a whole ambiguous
      // target phrase instead of finding capitalized substrings within it.
      if(names.every(name=>/[\p{Script=Latin}]/u.test(name) && isBoundedPublicName(name.trim())))for(const name of names)register(name.trim(),"objective");
    }
  }
  return {subjects:()=>[...subjects.values()],
    // Third-party reading/research topics discussed in an admitted image. The
    // direct-chat counterparty is admitted through registerCounterparty as a
    // tentative subject, never through this topic path.
    registerImage(input:{name:string;excerpt:string;visibleText:readonly string[];artifactID:string;isCurrent:()=>Promise<boolean>;counterparty?:string|null;anchors?:readonly PublicContextAnchorInput[]}){
      if(prohibited || input.name===input.counterparty||!input.excerpt.includes(input.name)||!input.visibleText.some(text=>text.includes(input.excerpt)))return null;
      // The inspector supplies public topic observations; this evidence gate
      // excludes arbitrary isolated private-name observations.
      if(!/读|文章|作品|作者|访谈|课程|博客|写|推荐|blog|read|writ|course|author|book|paper/iu.test(input.excerpt))return null;
      return register(input.name,input.artifactID,input.isCurrent,admitAnchors(input.anchors,input.visibleText));
    },
    // The exact visible direct-chat counterparty becomes a tentative research
    // subject (a name observation, never a confirmed identity). Group and
    // unknown threads, unbounded names, stale sources and declined searches
    // never register.
    registerCounterparty(input:{name:string;excerpt:string;visibleText:readonly string[];artifactID:string;isCurrent:()=>Promise<boolean>;anchors?:readonly PublicContextAnchorInput[]}){
      if(prohibited)return null;
      const name=input.name.trim();
      const excerpt=input.excerpt.normalize("NFKC").replace(/\s+/gu," ").trim();
      if(excerpt!==name||!input.visibleText.some(text=>text.normalize("NFKC").trim()===name))return null;
      return register(name,input.artifactID,input.isCurrent,admitAnchors(input.anchors,input.visibleText),true);
    },
    // A validated first-contact proposal may research its exact proposed name
    // with only source-grounded typed context. The model cannot register or
    // widen a subject; only the host, after grounding and intent validation,
    // admits this tentative entry bound to its source message.
    registerTentative(input:{name:string;binding:string;isCurrent?:()=>Promise<boolean>;anchors?:readonly PublicContextAnchorInput[];groundingTexts?:readonly string[]}){
      if(prohibited)return null;
      return register(input.name.trim(),input.binding,input.isCurrent,admitAnchors(input.anchors,input.groundingTexts??[]),true);
    }};
}
