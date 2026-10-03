import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import {
  blogPosts,
  editorialAuthor,
  formatBlogDate,
  getBlogPost,
  getBlogPostReadingMinutes,
  getBlogPostWordCount,
} from "@/lib/blog";
import { siteConfig } from "@/lib/site";

type BlogArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    return {};
  }

  const path = `/blog/${post.slug}`;

  return {
    title: post.seoTitle,
    description: post.description,
    authors: [
      {
        name: editorialAuthor.name,
        url: editorialAuthor.url,
      },
    ],
    alternates: {
      canonical: path,
    },
    keywords: [
      post.category,
      "候选人进展",
      "独立招聘顾问工作流",
      "证据优先招聘",
      "关系驱动型寻访",
    ],
    openGraph: {
      type: "article",
      url: path,
      title: post.seoTitle,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [`${siteConfig.url}${editorialAuthor.url}`],
      section: post.category,
      tags: ["候选人进展", "招聘", post.category],
      images: [
        {
          url: post.heroImage,
          width: 1672,
          height: 941,
          alt: post.heroAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.seoTitle,
      description: post.description,
      images: [post.heroImage],
    },
  };
}

export default async function BlogArticlePage({ params }: BlogArticlePageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const articleUrl = `${siteConfig.url}/blog/${post.slug}`;
  const imageUrl = `${siteConfig.url}${post.heroImage}`;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${articleUrl}#article`,
    headline: post.title,
    description: post.description,
    image: [imageUrl],
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
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
    mainEntityOfPage: articleUrl,
    url: articleUrl,
    isPartOf: {
      "@type": "Blog",
      "@id": `${siteConfig.url}/blog#blog`,
      name: "capri 研究与实践方法",
    },
    articleSection: post.category,
    keywords: [
      post.category,
      "候选人进展",
      "证据优先招聘",
      "关系驱动型寻访",
    ],
    wordCount: getBlogPostWordCount(post),
    timeRequired: `PT${getBlogPostReadingMinutes(post)}M`,
    inLanguage: "zh-CN",
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "首页",
        item: siteConfig.url,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "研究",
        item: `${siteConfig.url}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
        item: articleUrl,
      },
    ],
  };
  const relatedPosts = post.relatedSlugs
    .map((relatedSlug) => getBlogPost(relatedSlug))
    .filter((relatedPost) => relatedPost !== undefined);

  return (
    <>
      <StructuredData value={articleSchema} />
      <StructuredData value={breadcrumbSchema} />
      <SiteHeader />
      <main id="main-content" className="article-page" tabIndex={-1}>
        <article>
          <header className="article-header shell">
            <nav aria-label="面包屑导航">
              <Link href="/blog">
                <ArrowLeft aria-hidden="true" size={14} />
                全部文章
              </Link>
            </nav>
            <div className="article-header__title">
              <p className="eyebrow">{post.category}</p>
              <h1>{post.title}</h1>
              <p>{post.excerpt}</p>
            </div>
            <div className="article-header__meta">
              <p>
                作者：<Link href={editorialAuthor.url}>{editorialAuthor.name}</Link>
              </p>
              <p>
                <time dateTime={post.publishedAt}>
                  {formatBlogDate(post.publishedAt)}
                </time>
                <span aria-hidden="true"> · </span>
                阅读约 {getBlogPostReadingMinutes(post)} 分钟
              </p>
            </div>
          </header>

          <figure className="article-hero shell">
            <Image
              src={post.heroImage}
              alt={post.heroAlt}
              width={1672}
              height={941}
              loading="eager"
              fetchPriority="high"
              sizes="(max-width: 767px) 100vw, 92vw"
            />
          </figure>

          <div className="article-layout shell">
            <aside className="article-toc" aria-label="本页目录">
              <p>本页内容</p>
              <nav>
                <a href="#in-brief">简要回答</a>
                {post.sections.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
                <a href="#sources">来源</a>
              </nav>
            </aside>

            <div className="article-body">
              <section id="in-brief" className="article-answer">
                <h2>简要回答</h2>
                <p>{post.directAnswer}</p>
              </section>

              <aside className="article-takeaways" aria-labelledby="takeaways-title">
                <h2 id="takeaways-title">核心要点</h2>
                <ul>
                  {post.keyTakeaways.map((takeaway) => (
                    <li key={takeaway}>{takeaway}</li>
                  ))}
                </ul>
              </aside>

              {post.sections.map((section) => (
                <section key={section.id} id={section.id}>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.points && (
                    <dl className="article-points">
                      {section.points.map((point) => (
                        <div key={point.title}>
                          <dt>{point.title}</dt>
                          <dd>{point.body}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {section.references && (
                    <p className="article-references">
                      支持来源：{" "}
                      {section.references.map((reference, index) => (
                        <span key={reference}>
                          {index > 0 && ", "}
                          <a href={`#source-${reference}`}>[{reference}]</a>
                        </span>
                      ))}
                    </p>
                  )}
                </section>
              ))}

              <section id="sources" className="article-sources">
                <h2>来源</h2>
                <ol>
                  {post.sources.map((source, index) => (
                    <li key={source.url} id={`source-${index + 1}`}>
                      <a href={source.url}>{source.title}</a>
                      <span>{source.publisher}</span>
                    </li>
                  ))}
                </ol>
                <p>
                  发布于{" "}
                  <time dateTime={post.publishedAt}>
                    {formatBlogDate(post.publishedAt)}
                  </time>
                  ，最近审阅于{" "}
                  <time dateTime={post.updatedAt}>
                    {formatBlogDate(post.updatedAt)}
                  </time>
                  。
                </p>
              </section>
            </div>
          </div>
        </article>

        <aside className="related-reading shell" aria-labelledby="related-title">
          <header>
            <h2 id="related-title">继续阅读</h2>
            <Link className="text-link" href="/blog">
              全部文章
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </header>
          <div>
            {relatedPosts.map((relatedPost) => (
              <article key={relatedPost.slug}>
                <p>{relatedPost.category}</p>
                <h3>
                  <Link href={`/blog/${relatedPost.slug}`}>
                    {relatedPost.title}
                  </Link>
                </h3>
                <p>{relatedPost.excerpt}</p>
              </article>
            ))}
          </div>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
