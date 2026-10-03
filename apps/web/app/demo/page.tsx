import type { Metadata } from "next";
import { DemoWorkbench } from "@/components/demo-workbench";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getAiAvailability } from "@/lib/server/ai-analysis";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "在线产品演示",
  description:
    "使用本地规则，或主动选择私密 AI，体验 capri 的候选人对话审阅。",
  alternates: {
    canonical: "/demo",
  },
};

export default function DemoPage() {
  const ai = getAiAvailability();

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="demo-page" tabIndex={-1}>
        <div className="shell">
          <p className="demo-page__intro">
            这是一个受控的产品预览。本地分析只在你的浏览器中运行；可选 AI 路径只有在你主动选择后才会启动。
          </p>
          <DemoWorkbench
            aiEnabled={ai.enabled}
            aiProvider={ai.provider}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
