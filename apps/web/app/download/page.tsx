import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getMarketingLocale } from "@/lib/server/marketing-locale";
import { siteConfig } from "@/lib/site";
import { DeveloperSetup } from "./setup";
import { MACOS_DOWNLOAD_HREF, MACOS_CHECKSUM_HREF, MACOS_RELEASES_HREF, MACOS_DISTRIBUTION_DOC_HREF, MACOS_VERSION, requestAccessHref } from "./release";
import styles from "./download.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await getMarketingLocale()) === "en";
  return { title: en ? "Download and connect" : "下载与连接", description: en ? "Get capri for Mac, request the iPhone preview, open the Web workspace and set up CLI or MCP." : "下载 capri Mac 客户端，申请 iPhone 预览，打开 Web 工作区，设置 CLI 与 MCP。", alternates: { canonical: "/download" } };
}

function EntryIcon({ kind }: { kind: "mac" | "phone" | "web" | "tools" }) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "mac" ? <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 21h8M12 16v5" /></> : kind === "phone" ? <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></> : kind === "web" ? <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></> : <><path d="m5 7 5 5-5 5m8 0h6" /></>}
  </svg>;
}
export default async function DownloadPage() {
  const locale = await getMarketingLocale();
  const en = locale === "en";
  return <><SiteHeader /><main id="main-content" tabIndex={-1} className={styles.page} lang={locale}>
    <section className={styles.hero} aria-labelledby="download-title">
      <div className={styles.heroIntro}>
        <p className={styles.kicker}>{en ? "DOWNLOAD & CONNECT" : "下载与连接"}</p>
        <h1 id="download-title">{en ? <>Your context.<br />Where you are.</> : <>选一个入口。<br />接上你的日常。</>}</h1>
        <p className={styles.lead}>{en ? "Keep the people and unfinished things that matter close, on the devices and tools you know." : "把重要的人和未完的事，带进你熟悉的设备与工具。"}</p>
        <div className={styles.continuity} aria-label={en ? "Relationship continuity" : "关系接续"}>
          <span>{en ? "How you met" : "认识的背景"}</span><i aria-hidden="true" /><span>{en ? "What you promised" : "答应的事情"}</span><i aria-hidden="true" /><span>{en ? "Where to continue" : "下一次交流"}</span>
        </div>
        <p className={styles.heroNote}>{en ? "One workspace. Choose your way in." : "同一个工作区，选择适合你的入口。"}</p>
      </div>
      <div className={styles.entries}>
        <article className={styles.entry}>
          <EntryIcon kind="mac" /><div><h2>macOS <span className={styles.badge}>{en ? "Preview" : "预览"}</span></h2><p>{en ? "Apple silicon + Intel · macOS 14+" : "Apple 芯片与 Intel · macOS 14+"}</p></div>
          <a className={styles.primary} href={MACOS_DOWNLOAD_HREF}>{en ? "Download .dmg" : "下载 .dmg"}<span aria-hidden="true">↗</span></a>
        </article>
        <article className={styles.entry}>
          <EntryIcon kind="phone" /><div><h2>iPhone</h2><p>{en ? "Invited TestFlight preview" : "TestFlight 受邀预览"}</p></div>
          <a className={styles.secondary} href={requestAccessHref(locale)}>{en ? "Request invite" : "申请邀请"}<span aria-hidden="true">↗</span></a>
        </article>
        <article className={styles.entry}>
          <EntryIcon kind="web" /><div><h2>Web</h2><p>{en ? "Your browser · no installation" : "浏览器访问 · 无需安装"}</p></div>
          <Link className={styles.secondary} href="/login?callbackUrl=/workspace">{en ? "Open workspace" : "打开工作区"}<span aria-hidden="true">↗</span></Link>
        </article>
        <article className={styles.entry}>
          <EntryIcon kind="tools" /><div><h2>CLI & MCP</h2><p>{en ? "Terminal and client setup" : "命令行安装与客户端连接"}</p></div>
          <a className={styles.secondary} href="#tools">{en ? "Set up" : "查看设置"}<span aria-hidden="true">↓</span></a>
        </article>
        <p className={styles.platformNote}>{en ? "Windows, Linux and Android: use Web. Native desktop/mobile packages are not available for these platforms." : "Windows、Linux 与 Android 可使用 Web；这些平台暂无原生桌面或移动安装包。"}</p>
      </div>
    </section>
    <section className={styles.install} aria-labelledby="install-title">
      <div><span className={styles.index}>{en ? "AFTER DOWNLOAD" : "下载之后"}</span><h2 id="install-title">{en ? "On your Mac, in three steps." : "在 Mac 上，三步开始。"}</h2><p>{en ? `Version ${MACOS_VERSION} · Developer ID signed and notarized. The installed app may still be named Talent Signal.` : `版本 ${MACOS_VERSION} · Developer ID 签名并公证。已发布应用可能仍名为 Talent Signal。`}</p></div>
      <ol className={styles.installSteps}>
        <li><span>01</span><div><h3>{en ? "Install" : "安装"}</h3><p>{en ? "Open the DMG and drag Talent Signal to Applications." : "打开 DMG，将 Talent Signal 拖入「应用程序」。"}</p></div></li>
        <li><span>02</span><div><h3>{en ? "Connect" : "连接"}</h3><p>{en ? "Enter the HTTPS workspace address your owner provides. Private workspaces require their authorized network." : "输入工作区所有者提供的 HTTPS 地址。私有工作区需先连入获准网络。"}</p></div></li>
        <li><span>03</span><div><h3>{en ? "Sign in" : "登录"}</h3><p>{en ? "Sign in in your browser, then return to the Mac app." : "在系统浏览器中登录，再回到 Mac 客户端。"}</p></div></li>
      </ol>
      <div className={styles.installLinks}><a href={MACOS_CHECKSUM_HREF}>{en ? "SHA-256 checksums" : "SHA-256 校验清单"} ↗</a><a href={MACOS_RELEASES_HREF}>{en ? "All releases" : "所有发布版本"} ↗</a><a href={MACOS_DISTRIBUTION_DOC_HREF}>{en ? "Installation guide" : "完整安装说明"} ↗</a></div>
    </section>
    <DeveloperSetup locale={locale} />
    <section className={styles.help} aria-labelledby="help-title"><div><p className={styles.kicker}>{en ? "A LITTLE HELP" : "需要一点帮助"}</p><h2 id="help-title">{en ? "An easier start." : "让开始，更顺手。"}</h2><a className={styles.textLink} href={`mailto:${siteConfig.email}`}>{siteConfig.email} ↗</a></div><div className={styles.faqs}>
      {[
        [en ? "How do I install on iPhone?" : "如何在 iPhone 上安装？", en ? "Request access above. After receiving an invitation, install through TestFlight. There is no public App Store or TestFlight link yet." : "先通过上方入口申请邀请。收到邀请后，通过 TestFlight 安装；目前没有公开的 App Store 或 TestFlight 安装链接。"],
        [en ? "Do the apps share the same account?" : "各端使用同一个账号吗？", en ? "Sign in to the same workspace with your account. Each platform releases independently; hosted features depend on your workspace." : "使用自己的账号登录同一个工作区。各端独立发布，实际功能取决于你连接的工作区。"],
        [en ? "How do I update?" : "安装后如何更新？", en ? "Check in This Mac settings. An update offer appears only after a verified check. Source CLI installs are rebuilt from source; they are not standalone managed installs." : "Mac 客户端可在「此 Mac 设置」中检查更新，仅可靠检查后才提示可更新。源码安装的 CLI 需从源码重新构建，不属于独立包托管安装。"],
        [en ? "Does MCP grant access automatically?" : "复制 MCP 配置就会开放访问吗？", en ? "No. The template has no real endpoint or credential. Create an explicit scoped grant in Extensions, replace the placeholders and configure your client. Revoke access there whenever needed." : "不会。模板不含真实地址或凭据。先在扩展中明确创建限定范围的授权，再替换占位符并配置客户端；需要时可在扩展中撤销。"],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}
    </div></section>
  </main><SiteFooter distribution /></>;
}
