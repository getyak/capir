import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { BlogPostPreview } from "@/components/blog-post-preview";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { blogPosts, editorialAuthor } from "@/lib/blog";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "关系记忆与个人 Agent 研究",
  description:
    "围绕有来源的关系背景、人工决定和持续接续展开的研究。历史招聘文章保留其当时的场景与证据。",
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    type: "website",
    title: "capri 研究与实践方法",
    description:
      "面向客户、伙伴与协作来往的证据优先方法，保留历史招聘研究。",
    url: "/blog",
    images: [
      {
        url: blogPosts[0].heroImage,
        width: 1672,
        height: 941,
        alt: blogPosts[0].heroAlt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "capri 研究与实践方法",
    description:
      "面向客户、伙伴与协作来往的证据优先方法，保留历史招聘研究。",
    images: [blogPosts[0].heroImage],
  },
};

const blogSchema = {
  "@context": "https://schema.org",
  "@type": "Blog",
  "@id": `${siteConfig.url}/blog#blog`,
  name: "capri 研究与实践方法",
  description: metadata.description,
  url: `${siteConfig.url}/blog`,
  inLanguage: "zh-CN",
  author: {
    "@type": "Organization",
    name: editorialAuthor.name,
    url: `${siteConfig.url}${editorialAuthor.url}`,
  },
  publisher: {
    "@type": "Organization",
    name: siteConfig.name,
    url: siteConfig.url,
  },
  blogPost: blogPosts.map((post) => ({
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    url: `${siteConfig.url}/blog/${post.slug}`,
  })),
};

export default function BlogPage() {
  const [featuredPost, ...otherPosts] = blogPosts;

  return (
    <>
      <StructuredData value={blogSchema} />
      <SiteHeader />
      <main id="main-content" className="blog-index" tabIndex={-1}>
        <header className="blog-index__hero shell">
          <div>
            <p className="eyebrow">研究与实践方法</p>
            <h1>让下一次交流，拥有更好的背景。</h1>
          </div>
          <p>
            研究怎样从对话留下有出处的背景，尊重人的决定，并接续尚未结束的事情。早期招聘研究仍保留原场景。
          </p>
        </header>

        <section
          className="blog-index__featured shell"
          aria-labelledby="featured-article-title"
        >
          <h2 id="featured-article-title" className="sr-only">
            精选文章
          </h2>
          <BlogPostPreview post={featuredPost} priority variant="featured" />
        </section>

        <section
          className="blog-index__latest shell"
          aria-labelledby="latest-articles-title"
        >
          <header>
            <h2 id="latest-articles-title">最新文章</h2>
            <p>
              围绕证据、时间与人类自主决定展开的研究，区分历史场景与当前产品方向。
            </p>
          </header>
          <div className="blog-index__grid">
            {otherPosts.map((post) => (
              <BlogPostPreview key={post.slug} post={post} />
            ))}
          </div>
        </section>

        <aside className="blog-index__method shell">
          <div>
            <h2>这些内容如何产生</h2>
            <p>
              我们把产品判断与外部事实分开，引用原始来源，明确展示实质性更新，并且不发布私密候选人证据。
            </p>
          </div>
          <Link className="text-link" href="/blog/about">
            阅读编辑方法
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
