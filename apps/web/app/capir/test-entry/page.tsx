/**
 * Public test-workspace entry page (`/capir/test-entry?run=<id>`).
 *
 * This URL carries no credential. Entry happens only through the private
 * one-use handoff POST (`capir test create --open web`) or direct password
 * login with the returned test credentials. When the live session resolves to
 * the exact canonical operator-owned run, the same test banner and deadline
 * are shown before the workspace link.
 */
import Link from "next/link";

import { CapirTestBanner } from "@/components/capir-test-banner";
import styles from "@/components/capir-test-banner.module.css";
import { readPrimaryBackendSessionClaims } from "@/lib/server/backendAuth";
import { loadCapirTestBanner } from "@/lib/server/capir-test-entry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CapirTestEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedRun =
    typeof params.run === "string" && UUID.test(params.run) ? params.run : null;

  let banner = null;
  try {
    const claims = await readPrimaryBackendSessionClaims();
    if (claims) banner = await loadCapirTestBanner(claims);
  } catch {
    banner = null;
  }
  const matchesRun = banner && (!requestedRun || banner.run.id === requestedRun);

  return (
    <main className={styles.entryPage}>
      <section aria-labelledby="test-entry-title" className={styles.entryPanel}>
      <p className={styles.eyebrow}>开发测试</p>
      <h1 id="test-entry-title">进入测试空间</h1>
      {matchesRun && banner ? (
        <>
          <CapirTestBanner banner={banner} />
          <p className={styles.entrySummary}>这个账号的合成数据已隔离，可以继续验证产品流程。</p>
          <Link className={styles.entryAction} href="/workspace">进入测试空间</Link>
        </>
      ) : (
        <>
          <p className={styles.entrySummary}>使用 CLI 创建测试账号并打开浏览器，或用已有测试账号登录。</p>
          <pre className={styles.entryCommand}><code>capir test create --env staging --open web</code></pre>
          <Link className={styles.entryAction} href="/login">登录测试账号</Link>
          <p className={styles.entryNote}>默认有效期 4 小时。到期后无法继续登录；这个入口链接本身不能登录账号。</p>
        </>
      )}
      </section>
    </main>
  );
}
