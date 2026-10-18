import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MemoryRecallItem } from "@talent-signal/contracts";
import styles from "./research-notebook.module.css";

const SCHEMA = "research-notebook.v1";
export function researchNoteMetadata(item: MemoryRecallItem): Record<string, unknown> | null {
  if (item.statement_kind !== "source_statement" || item.speaker !== "AI 人物研究笔记") return null;
  const ref = item.evidence_refs.find((entry) => entry.locator.kind === "document"
    && entry.locator.locator.schema === SCHEMA && entry.locator.locator.review_status === "unreviewed_research");
  return ref?.locator.kind === "document" ? ref.locator.locator : null;
}
export function safeResearchLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}
const label = (value: unknown) => typeof value === "string" ? value : "";
const body = (item: MemoryRecallItem) => item.display_text.replace(/^研究笔记（AI 整理，待复核）\n/, "");
const sectionLabels: Record<string, string> = { identity: "身份与未确认项", analysis: "值得研究的内容", learning: "怎样学习与应用", limits: "限制与反证" };
function ResearchLink({ url, children }: { url: unknown; children: React.ReactNode }) {
  const href = safeResearchLink(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
}
export function ResearchNotebook({ items }: { items: MemoryRecallItem[] }) {
  const records = items.filter(item => item.evidence_retained).map(item => ({ item, meta: researchNoteMetadata(item) })).filter(record => record.meta !== null)
    .sort((a, b) => label(a.meta!.note_key).localeCompare(label(b.meta!.note_key)));
  if (!records.length) return null;
  const platforms = records.filter(({ meta }) => meta!.section === "platform");
  const sourceNotes = records.filter(({ meta }) => meta!.section === "sources");
  const dossier = records.filter(({ meta }) => meta!.section === "dossier");
  const sourceCount = sourceNotes.reduce((sum, record) => sum + (Array.isArray(record.meta!.sources) ? record.meta!.sources.length : 0), 0);
  return <section className={styles.notebook} aria-labelledby="research-notebook-title">
    <header className={styles.header}><h2 id="research-notebook-title">人物研究档案</h2>
      <p>AI 整理 · 待人工复核。保存的是有来源的研究笔记；候选账号、相关机构和历史排除项保持原状态。</p></header>
    {records.filter(({ meta }) => Object.hasOwn(sectionLabels, label(meta!.section))).map(({ item, meta }) =>
      <article className={styles.note} key={item.id}><h3>{sectionLabels[label(meta!.section)]}</h3><p>{body(item)}</p></article>)}
    <section className={styles.platforms} aria-labelledby="research-platforms"><h3 id="research-platforms">社媒与平台 · {platforms.length}</h3>
      {!platforms.length ? <p>尚无足够依据确认入口，账号留空。</p> : <div className={styles.tableScroll}><table><thead><tr>
        <th scope="col">平台／账号</th><th scope="col">归属与状态</th><th scope="col">读取范围与用途</th>
      </tr></thead><tbody>{platforms.map(({ item, meta }) => <tr key={item.id}>
        <td><ResearchLink url={meta!.url}>{label(meta!.platform) || "平台"} · {label(meta!.handle) || label(meta!.url)}</ResearchLink></td>
        <td>{label(meta!.role)}<small>{label(meta!.ownership)}</small><ResearchLink url={meta!.evidenceUrl}>归属来源</ResearchLink></td>
        <td>{label(meta!.captureStatus)}<small>{label(meta!.use)}</small><details><summary>保存的原始笔记</summary><p>{body(item)}</p></details></td>
      </tr>)}</tbody></table></div>}
    </section>
    {sourceCount > 0 && <details className={styles.details}><summary>出处与阅读范围 · {sourceCount}</summary>
      {sourceNotes.map(({ item, meta }) => <ul className={styles.sources} key={item.id}>
        {(Array.isArray(meta!.sources) ? meta!.sources : []).map((raw: unknown, index: number) => {
          const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
          return <li key={index}><ResearchLink url={source.url}>{label(source.title) || label(source.url) || "来源"}</ResearchLink>
            <small>{source.readStatus === "read" ? "取得指定文本窗口" : "读取状态待核查"} · {label(source.accessedAt)}</small>
            <p>{label(source.summary)}</p><small>{label(source.limits)}</small></li>;
        })}<li><details><summary>保存的来源说明</summary><p>{body(item)}</p></details></li>
      </ul>)}
    </details>}
    {dossier.length > 0 && <details className={styles.details}><summary>完整档案与历史研究 · {dossier.length} 段</summary>
      <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <ResearchLink url={href}>{children}</ResearchLink>, img: ({ alt }) => <span>{alt ?? "研究资料图像"}</span> }}>
        {dossier.map(({ item }) => body(item)).join("")}
      </ReactMarkdown></div>
    </details>}
  </section>;
}
