/**
 * Display-only native defense (ADR 0022): when the native application marks
 * its request agent, the Web login page shows this inert notice instead of any
 * password, registration or provider form. The native app itself intercepts
 * /login and owns the signed-out browser-login surface; this branch only
 * removes forms from the Web page a stray native load could reach.
 */
export function isNativeLoginUserAgent(userAgent: string | null): boolean {
  return Boolean(userAgent && userAgent.includes("TalentSignalMac"));
}

export function DesktopNativeLoginNotice() {
  return (
    <main>
      <h1>请在 capri 应用中登录</h1>
      <p>
        此页面不提供密码、注册或第三方登录表单。请回到 Mac 应用，点击“在浏览器中登录”，
        在系统浏览器中完成登录。
      </p>
    </main>
  );
}
