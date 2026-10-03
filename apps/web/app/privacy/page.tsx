import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "隐私原则",
  description:
    "了解 capri 如何处理主动导入的证据、用户确认、来源追溯与删除。",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="prose-page" tabIndex={-1}>
        <article className="shell prose-page__inner">
          <header>
            <p className="eyebrow">隐私原则</p>
            <h1>关系背景值得被审慎处理。</h1>
            <p>
              capri 围绕主动导入、明确确认和始终可查验的证据而设计。
            </p>
          </header>

          <section>
            <h2>主动输入</h2>
            <p>
              一切从你主动选择一张对话截图或一条笔记开始。产品并不是横跨私密沟通工具的静默监控层。
            </p>
          </section>

          <section>
            <h2>关联来源的事实</h2>
            <p>
              提取出的事实和拟议行动始终保留来源引用；已核验陈述与推断、建议保持分离。
            </p>
          </section>

          <section>
            <h2>工作台登录</h2>
            <p>
              网页工作台使用加密的会话 Cookie。通过 Google 或 Apple 登录时，认证请求会依据对应身份提供商的隐私条款发送给所选服务。邮箱登录会在服务端验证密码哈希，应用不会保存明文密码。
            </p>
          </section>

          <section>
            <h2>变更前确认</h2>
            <p>
              联系人或日历变更必须经过清晰的审阅步骤；你可以确认、编辑或驳回每项提案。
            </p>
          </section>

          <section>
            <h2>连同衍生数据一起删除</h2>
            <p>
              产品架构把来源证据与衍生数据视为同一删除范围，避免原始证据移除后仍遗留失去关联的摘要。
            </p>
          </section>

          <aside>
            <h2>关于在线演示</h2>
            <p>
              本地模式使用浏览器端的确定性规则，不会传输对话文本。可选的私密 AI 路径只有在用户主动选择后才会运行；笔记会在请求零留存与不收集数据的前提下发送给已配置的模型服务商。capri 不会持久化该笔记，也不会把它写入应用日志。
            </p>
            <Link className="text-link" href="/demo">
              打开在线演示
            </Link>
          </aside>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
