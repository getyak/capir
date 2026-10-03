import type { ActivateBindingRequest, BindingStatus } from "./platform";

export function BindingBadge({ checking, status }: { checking: boolean; status: BindingStatus }) {
  const label = checking
    ? "核验中"
    : status.state === "verified"
      ? "Session 已核验"
      : status.state === "stale"
        ? "连接陈旧"
        : status.state === "revoked"
          ? "连接失效"
          : "尚未连接";
  return <span className="binding-badge" data-state={checking ? "checking" : status.state}>{label}</span>;
}

export function BindingForm({
  checking,
  error,
  form,
  onActivate,
  onChange,
  onDisconnect,
}: {
  checking: boolean;
  error: string | null;
  form: ActivateBindingRequest;
  onActivate: () => void;
  onChange: (value: ActivateBindingRequest) => void;
  onDisconnect: () => void;
}) {
  return (
    <section className="connection-card" id="connection">
      <div>
        <p className="eyebrow">连接设置</p>
        <h2>连接本机 capri 后端</h2>
        <p className="lede">
          只接受带显式端口、固定服务器证书的 <code>https://127.0.0.1</code> 或
          <code> https://localhost</code>。服务器证书会在发送令牌前完成 TLS 身份核验；
          核验成功后令牌写入 macOS Keychain 并立即从表单清除。
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onActivate();
        }}
      >
        <label>
          本机后端
          <input
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => onChange({ ...form, baseUrl: event.target.value })}
            spellCheck={false}
            value={form.baseUrl}
          />
        </label>
        <label>
          服务器证书 PEM（公开）
          <textarea
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) =>
              onChange({ ...form, serverCertificatePem: event.target.value })
            }
            placeholder="-----BEGIN CERTIFICATE-----"
            spellCheck={false}
            value={form.serverCertificatePem}
          />
        </label>
        <label>
          Agent Session ID
          <input
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => onChange({ ...form, sessionId: event.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
            spellCheck={false}
            value={form.sessionId}
          />
        </label>
        <label>
          Access token
          <input
            autoComplete="off"
            onChange={(event) => onChange({ ...form, accessToken: event.target.value })}
            type="password"
            value={form.accessToken}
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button
          disabled={
            checking ||
            !form.accessToken ||
            !form.serverCertificatePem ||
            !form.sessionId
          }
          type="submit"
        >
          {checking ? "正在核验…" : "核验并保存在 Keychain"}
        </button>
        {error ? (
          <button className="secondary-action" disabled={checking} onClick={onDisconnect} type="button">
            清除本机连接记录并重试
          </button>
        ) : null}
      </form>
    </section>
  );
}
