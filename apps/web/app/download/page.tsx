import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteConfig } from "@/lib/site";
import { SupportEmailEntry } from "@/components/support-email-entry";

import {
  MACOS_DISTRIBUTION_DOC_HREF,
  downloadSurfaces,
} from "./release";

export const metadata: Metadata = {
  title: "下载 Talent Signal",
  description:
    "下载 Talent Signal 桌面与移动端：macOS 公开下载，iOS 通过受邀预览提供，可申请使用。",
  alternates: {
    canonical: "/download",
  },
};

export default function DownloadPage() {
  const surfaces = downloadSurfaces("zh-CN");
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="prose-page" tabIndex={-1}>
        <article className="shell prose-page__inner">
          <header>
            <p className="eyebrow">下载</p>
            <h1>在你的设备上使用 Talent Signal。</h1>
            <p>
              各端独立发布。只有取得可靠更新结果时，应用才会提示可更新；下面的安装入口都指向真实的发布位置。
            </p>
          </header>

          {surfaces.map((surface) => (
            <section key={surface.platform}>
              <h2>{surface.title}</h2>
              <p>
                <strong>{surface.status}</strong>
              </p>
              <p>{surface.detail}</p>
              <p>
                {surface.installHref ? (
                  <a href={surface.installHref}>
                    {surface.title} 公开下载（GitHub Releases）↗
                  </a>
                ) : (
                  <SupportEmailEntry subject="申请使用 Talent Signal">
                    申请使用 {surface.title} 版（邮件）↗
                  </SupportEmailEntry>
                )}
              </p>
              {surface.platform === "macos" ? (
                <p>
                  安装步骤、校验与签名说明见{" "}
                  <a href={MACOS_DISTRIBUTION_DOC_HREF}>macOS 下载与分发文档 ↗</a>。
                  已安装的应用可在「此 Mac 设置」中检查更新。
                </p>
              ) : null}
              {surface.platform === "ios" ? (
                <p>
                  收到邀请后通过 TestFlight 安装；安装地址由邀请提供，这里不发布公开安装链接。
                </p>
              ) : null}
            </section>
          ))}

          <section>
            <h2>帮助与支持</h2>
            <p>
              遇到安装或使用问题时，可在工作区「账号 → 帮助与支持」查看系统检测，或直接来信{" "}
              <SupportEmailEntry>{siteConfig.email}</SupportEmailEntry>
              ；也可以 <Link href="/login">登录工作区</Link> 后查看设置与诊断。
            </p>
          </section>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
