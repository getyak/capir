import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { editorialAuthor } from "@/lib/blog";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "编辑方法",
  description:
    "capri 如何研究、撰写、引用、更新和修正有关证据优先关系智能的公开内容。",
  alternates: {
    canonical: "/blog/about",
  },
};

const editorialSchema = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${siteConfig.url}/blog/about#page`,
  name: "capri 编辑方法",
  description: metadata.description,
  url: `${siteConfig.url}/blog/about`,
  mainEntity: {
    "@type": "Organization",
    "@id": `${siteConfig.url}/blog/about#editorial`,
    name: editorialAuthor.name,
    description: editorialAuthor.description,
    url: `${siteConfig.url}/blog/about`,
    parentOrganization: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
  },
};

export default function EditorialMethodPage() {
  return (
    <>
      <StructuredData value={editorialSchema} />
      <SiteHeader />
      <main id="main-content" className="editorial-page" tabIndex={-1}>
        <article className="shell editorial-page__inner">
          <header>
            <p className="eyebrow">编辑方法</p>
            <h1>信任始于结论如何形成。</h1>
            <p>
              capri 编辑团队把产品研究转化为面向维护客户、伙伴与协作关系的人的实践指南。
            </p>
          </header>

          <div className="editorial-page__principles">
            <section id="who-writes">
              <h2>谁在写作</h2>
              <p>
                在明确的出版负责人制度建立前，文章以 capri 编辑团队名义发布。署名代表组织身份，不是虚构人物。
              </p>
            </section>
            <section id="how-we-research">
              <h2>我们如何研究</h2>
              <p>
                我们从关系协作中的实际问题出发，检查现有产品证据，并以一手文档支持外部事实。产品判断、示例与外部事实始终彼此分离。
              </p>
            </section>
            <section id="ai-assistance">
              <h2>AI 可以如何协助</h2>
              <p>
                AI 可以帮助整理研究或起草文字，但其输出不被视为证据、权威或发布批准。来源必须与公开结论一致。
              </p>
            </section>
            <section id="updates">
              <h2>我们如何更新</h2>
              <p>
                只有发生实质且可见的编辑后，修改日期才会变化。重要修正会保留规范网址；若修正可能改变读者判断，我们会明确说明。
              </p>
            </section>
            <section id="privacy">
              <h2>我们不会发布什么</h2>
              <p>
                未经明确、限定用途的授权，我们不会发布候选人的私密对话、截图、身份或衍生个人事实。示例会保持通用，并标明其情境。
              </p>
            </section>
          </div>

          <aside>
            <h2>问题或更正</h2>
            <p>
              请发送文章网址、有疑问的结论，以及支持更正的一手来源。
            </p>
            <a className="text-link" href={`mailto:${siteConfig.email}`}>
              联系编辑团队
              <ArrowRight aria-hidden="true" size={15} />
            </a>
          </aside>

          <Link className="editorial-page__back" href="/blog">
            返回全部文章
          </Link>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
