"use client";

import { useState } from "react";
import Link from "next/link";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { CopyCode } from "./copy-code";
import { CLI_SOURCE_INSTALL, CLI_DOC_HREF, MCP_DOC_HREF, mcpConfiguration, type McpClient } from "./release";
import styles from "./download.module.css";

export function DeveloperSetup({ locale }: { locale: MarketingLocale }) {
  const en = locale === "en";
  const [client, setClient] = useState<McpClient>("cursor");
  const [system, setSystem] = useState("unix");
  return <section id="tools" className={styles.tools} aria-labelledby="tools-title">
    <header className={styles.sectionHeader}>
      <p className={styles.kicker}>{en ? "IN YOUR WORKFLOW" : "融入熟悉的工具"}</p>
      <h2 id="tools-title">{en ? "A terminal. Your tools. The same context." : "在终端，在工具里。接着做。"}</h2>
      <p>{en ? "Choose how you work. Installation and access stay in your hands." : "选择你习惯的方式。安装与访问权限，始终由你掌握。"}</p>
    </header>
    <div className={styles.setupRow} id="cli">
      <div className={styles.setupIntro}>
        <span className={styles.index}>01 / CLI</span>
        <h3>capir</h3>
        <p>{en ? "The capri command-line companion. Inspect help, sign in to a configured workspace and run explicit commands." : "capri 的命令行工具。查看帮助，登录已配置的工作区，执行明确的操作。"}</p>
        <p className={styles.availability}>{en ? "Source installation · standalone channel not yet published" : "源码安装 · 独立安装包尚未公开发布"}</p>
        <a className={styles.textLink} href={CLI_DOC_HREF}>{en ? "CLI reference" : "CLI 使用文档"} ↗</a>
      </div>
      <div>
        <div className={styles.switcher} role="group" aria-label={en ? "CLI installation platform" : "CLI 安装平台"}>
          {[['unix', 'macOS / Linux'], ['windows', 'Windows']].map(([value, label]) => <button key={value} type="button" aria-pressed={system === value} onClick={() => setSystem(value)}>{label}</button>)}
        </div>
        <p className={styles.setupHint}>{en ? `First install Git, Node.js 22.19+ and pnpm 11.18. Run in ${system === "windows" ? "PowerShell" : "your terminal"}.` : `先安装 Git、Node.js 22.19+ 与 pnpm 11.18。在${system === "windows" ? " PowerShell " : "终端"}中运行。`}</p>
        <CopyCode key={system} code={CLI_SOURCE_INSTALL} label={system === "windows" ? "PowerShell" : "Terminal"} locale={locale} />
        <p className={styles.setupHint}>{en ? "Run from the cloned directory. This path does not install a global command or manage standalone updates." : "在克隆的目录内运行。这条路径不会安装全局命令，也不使用独立包自动更新。"}</p>
      </div>
    </div>
    <div className={styles.setupRow} id="mcp">
      <div className={styles.setupIntro}>
        <span className={styles.index}>02 / MCP</span>
        <h3>{en ? "Connect your context." : "把上下文接入工具。"}</h3>
        <p>{en ? "Let a compatible MCP client read your authorized workspace summary and bounded people directory." : "让兼容的 MCP 客户端读取你授权的工作区摘要与有限的联系人目录。"}</p>
        <ol className={styles.steps}>
          <li>{en ? "Open Extensions and create a scoped, expiring client token." : "打开扩展，创建限定范围与期限的客户端令牌。"}</li>
          <li>{en ? "Replace both placeholders with the endpoint and token shown there." : "用扩展页提供的地址和令牌替换两处占位符。"}</li>
          <li>{en ? "Save in your client and check its discovered tools." : "在客户端保存配置，检查实际发现的工具。"}</li>
        </ol>
        <Link className={styles.textLink} href="/workspace/extensions">{en ? "Open Extensions" : "打开扩展设置"} →</Link>
      </div>
      <div>
        <div className={styles.switcher} role="group" aria-label={en ? "MCP client configuration" : "MCP 客户端配置"}>
          {([['cursor', 'Cursor'], ['claude', 'Claude Code'], ['other', en ? 'Other clients' : '其他客户端']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={client === value} onClick={() => setClient(value)}>{label}</button>)}
        </div>
        <p className={styles.setupHint}>{client === "cursor" ? (en ? "Add to your private ~/.cursor/mcp.json; merge with existing servers." : "加入个人 ~/.cursor/mcp.json，保留已有服务器配置。") : client === "claude" ? (en ? "Add to a private .mcp.json; merge with existing servers." : "加入私有 .mcp.json，保留已有服务器配置。") : (en ? "Requires Streamable HTTP and a Bearer authorization header." : "客户端需支持 Streamable HTTP 与 Bearer 授权头。")}</p>
        <CopyCode key={client} code={mcpConfiguration(client)} label={client === "other" ? "Streamable HTTP" : "mcpServers"} locale={locale} />
        <p className={styles.setupHint}>{en ? "Templates contain placeholders only. Keep your real token private; do not commit or share it. Access is read-only, expires and can be revoked in Extensions." : "模板仅含占位符。真实令牌保持私有，不提交或分享；访问为只读，到期失效，可在扩展中撤销。"}</p>
      </div>
    </div>
    <div className={styles.inbound}>
      <div><h3>{en ? "Bring external tools into capri." : "也可以把外部工具接进 capri。"}</h3><p>{en ? "Add a trusted remote MCP server in Extensions. Connection verifies available tools; each call still requires your exact approval." : "在扩展中添加可信的远程 MCP 服务。连接后核实可用工具，每次调用仍由你明确批准。"}</p></div>
      <a className={styles.textLink} href={MCP_DOC_HREF}>{en ? "Connection guide" : "连接说明"} ↗</a>
    </div>
  </section>;
}
