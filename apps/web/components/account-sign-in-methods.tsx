'use client';

import { useActionState, useEffect, useState, useSyncExternalStore } from 'react';
import type { AccountSettings, SignInMethodProvider } from '@talent-signal/contracts';
import {
  saveAccountPassword,
  startPasswordStepUpLink,
  startProviderReauth,
  unlinkLoginMethod,
  type LoginMethodActionState,
} from '@/app/workspace/settings/login-methods/actions';
import styles from './account-sign-in-methods.module.css';

/**
 * Settings A sign-in methods: one quiet reading column, one row per provider,
 * status always visible (including narrow layouts). Current-account
 * verification is separate from new-provider confirmation, and provider-only
 * accounts reauthenticate with a linked provider instead of a mandatory
 * password field. Every failure and provider cancellation leaves the account
 * unchanged and recoverable in place.
 */

const providerNames: Record<SignInMethodProvider, string> = { apple: 'Apple', google: 'Google', password: '密码' };
const stateLabels = { connected: '已绑定', unconnected: '未绑定', legacy_unverified: '需要验证邮箱' } as const;

type Flow =
  | { kind: 'password' }
  | { kind: 'unlink'; provider: SignInMethodProvider }
  | { kind: 'link'; provider: 'apple' | 'google' }
  | null;

type RenderedScope = { accountId: string; userId: string; accountRevision: number; userRevision: number };

function ScopeFields({ scope }: { scope: RenderedScope }) {
  return (
    <>
      <input type="hidden" name="accountId" value={scope.accountId} />
      <input type="hidden" name="userId" value={scope.userId} />
      <input type="hidden" name="accountRevision" value={String(scope.accountRevision)} />
      <input type="hidden" name="userRevision" value={String(scope.userRevision)} />
    </>
  );
}

function OperationAuthPanel({ flow, hasPassword, connectedProviders, scope, onUpdated, onCancel }: {
  flow: NonNullable<Flow>;
  hasPassword: boolean;
  connectedProviders: Array<'apple' | 'google'>;
  scope: RenderedScope;
  onUpdated: (settings: AccountSettings) => void;
  onCancel: () => void;
}) {
  // Three distinct chains: password change, unlink, and password step-up
  // followed by the NEW provider's own proof. A password-only owner can reach
  // every one of them without a mandatory provider reauthentication.
  const passwordAction =
    flow.kind === 'unlink'
      ? unlinkLoginMethod
      : flow.kind === 'link'
        ? startPasswordStepUpLink
        : saveAccountPassword;
  const [state, formAction, pending] = useActionState<LoginMethodActionState, FormData>(passwordAction, {});
  // Every successful operation carries the authoritative settings readback;
  // the visible rows and revisions update immediately, so the next action
  // starts against the state it is rendered from.
  useEffect(() => {
    if (state.data) {
      onUpdated(state.data);
      onCancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);
  const intent =
    flow.kind === 'link' ? 'link_provider' : flow.kind === 'unlink' ? 'unlink_provider' : 'set_password';
  const operationLabel =
    flow.kind === 'link'
      ? `将 ${providerNames[flow.provider]} 绑定到这个账户`
      : flow.kind === 'unlink'
        ? `解除 ${providerNames[flow.provider]} 绑定`
        : hasPassword ? '更换密码' : '设置密码';
  return (
    <div className={styles.stepUp}>
      <p className={styles.stepUpTitle}>{operationLabel}</p>
      <p className={styles.secondary}>
        {flow.kind === 'link'
          ? '添加登录方式不会创建工作空间、移动记录或更改主邮箱。先验证当前身份。'
          : '这一步只授权上面这项更改。先验证当前身份。'}
      </p>
      {hasPassword ? (
        <form action={formAction}>
          <ScopeFields scope={scope} />
          <p className={styles.stepUpTitle}>验证当前身份</p>
          <label className={styles.field}>
            <span>当前密码</span>
            <input name="currentPassword" type="password" autoComplete="current-password" required minLength={1} maxLength={128} />
          </label>
          {flow.kind === 'password' && (
            <label className={styles.field}>
              <span>新密码</span>
              <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
            </label>
          )}
          {flow.kind === 'unlink' && <input type="hidden" name="provider" value={flow.provider} />}
          {flow.kind === 'link' && <input type="hidden" name="targetProvider" value={flow.provider} />}
          {flow.kind === 'password' && <input type="hidden" name="hasPassword" value="true" />}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={pending} aria-busy={pending}>
              {pending ? '正在核验…' : '继续'}
            </button>
            <button type="button" className={styles.quiet} onClick={onCancel} disabled={pending}>取消</button>
          </div>
          <p aria-live="polite" className={state.error ? styles.error : styles.notice}>
            {state.error ?? (state.saved ? '已保存并核验。' : '')}
          </p>
        </form>
      ) : (
        <p className={styles.secondary}>这个账户还没有密码。用已绑定的登录方式验证当前身份。</p>
      )}
      {connectedProviders.map(provider => (
        <form key={provider} action={startProviderReauth}>
          <ScopeFields scope={scope} />
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="reauthProvider" value={provider} />
          {flow.kind === 'link' && <input type="hidden" name="targetProvider" value={flow.provider} />}
          {flow.kind === 'unlink' && <input type="hidden" name="unlinkProvider" value={flow.provider} />}
          <div className={styles.actions}>
            <button type="submit" className={hasPassword ? styles.quiet : styles.primary}>
              {`使用 ${providerNames[provider]} 验证当前身份`}
            </button>
            {!hasPassword && (
              <button type="button" className={styles.quiet} onClick={onCancel}>取消</button>
            )}
          </div>
        </form>
      ))}
    </div>
  );
}

type SignInMethod = AccountSettings["sign_in_methods"][number];

/**
 * One provider row. The same row is used for the always-visible methods and
 * for the optional providers disclosed under “添加登录方式”, so binding,
 * step-up, failure and readback behavior cannot drift between them.
 */
function MethodRow({ method, showActions, offline, hasPassword, connectedProviders, onLink, onPassword, onUnlink }: {
  method: SignInMethod;
  showActions: boolean;
  offline: boolean;
  hasPassword: boolean;
  connectedProviders: Array<'apple' | 'google'>;
  onLink: () => void;
  onPassword: () => void;
  onUnlink: () => void;
}) {
  const provider = method.provider;
  const linkDisabled = offline || (connectedProviders.length === 0 && !hasPassword);
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <strong>{providerNames[provider]}</strong>
        <span className={styles.badge} data-state={method.state}>
          {stateLabels[method.state]}
        </span>
      </div>
      {method.hint && method.state === 'connected' && (
        <p className={styles.secondary}>关联邮箱：{method.hint}</p>
      )}
      {method.state === 'legacy_unverified' && (
        <p className={styles.secondary}>这个密码登录还没有验证邮箱所有权。绑定一个提供方并验证后即可解决。</p>
      )}
      {showActions && (
        <div className={styles.actions}>
          {method.state === 'unconnected' && provider !== 'password' && (
            <button type="button" className={styles.quiet} disabled={linkDisabled} onClick={onLink}>绑定</button>
          )}
          {method.state === 'unconnected' && provider === 'password' && (
            <button type="button" className={styles.quiet} disabled={offline} onClick={onPassword}>设置密码</button>
          )}
          {method.state === 'connected' && provider === 'password' && (
            <button type="button" className={styles.quiet} disabled={offline} onClick={onPassword}>更换密码</button>
          )}
          {method.state !== 'unconnected' && method.can_unlink && (
            <button type="button" className={styles.quiet} disabled={offline} onClick={onUnlink}>解除绑定</button>
          )}
          {method.state !== 'unconnected' && !method.can_unlink && (
            <span className={styles.secondary}>至少保留一种登录方式</span>
          )}
        </div>
      )}
    </li>
  );
}

function subscribeLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}
const readLocation = () => window.location.search;
const emptyLocation = () => '';

export function AccountSignInMethods({ initial, linkStatus: linkStatusProp }: {
  initial: AccountSettings;
  linkStatus?: 'done' | 'error' | null;
}) {
  const [localResult, setLocalResult] = useState<{ source: AccountSettings; value: AccountSettings } | null>(null);
  const data = localResult?.source === initial ? localResult.value : initial;
  const setData = (value: AccountSettings) => setLocalResult({ source: initial, value });
  const [flow, setFlow] = useState<Flow>(null);
  const [offline, setOffline] = useState(false);
  // Failure/cancel recovery is visible in place: the staged round trip returns
  // to Settings with `?link=done|error` and the row keeps its method state.
  const search = useSyncExternalStore(subscribeLocation, readLocation, emptyLocation);
  const parameters = new URLSearchParams(search);
  const linkValue = parameters.get('link');
  const linkResult = linkStatusProp
    ? { status: linkStatusProp, method: undefined, state: undefined }
    : linkValue === 'done' || linkValue === 'error'
      ? { status: linkValue, method: parameters.get('method'), state: parameters.get('state') }
      : null;
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const hasPassword = data.sign_in_methods.some(method => method.provider === 'password' && method.state !== 'unconnected');
  const connectedProviders = data.sign_in_methods
    .filter(method => method.state === 'connected' && method.provider !== 'password')
    .map(method => method.provider as 'apple' | 'google');
  // Connected and legacy-unverified methods stay visible; a password that is
  // not set yet stays visible too, because setting it is a primary action.
  // Only optional unconnected providers are disclosed by count.
  const visibleMethods = data.sign_in_methods.filter(
    method => method.state !== 'unconnected' || method.provider === 'password',
  );
  const addableMethods = data.sign_in_methods.filter(
    method => method.state === 'unconnected' && method.provider !== 'password',
  );
  // Success is only claimed after the authoritative settings readback agrees;
  // a bare `?link=done` flag proves nothing, and a failure message never
  // claims the account is unchanged (a prior step may have committed).
  const verifiedMethod = linkResult?.status === 'done' && linkResult.method
    ? data.sign_in_methods.find(method => method.provider === linkResult.method)
    : undefined;
  const notice = linkResult?.status === 'done'
    ? (verifiedMethod?.state === 'connected' && (linkResult.state ? verifiedMethod.state === linkResult.state : true))
      ? '这个登录方式当前已绑定，可以用它登录同一个账户。'
      : '请核对下方登录方式的实际状态。'
    : linkResult?.status === 'error'
      ? '暂时无法确认这次操作的结果。请核对下方登录方式的实际状态，再决定是否重新验证。'
      : '';

  return (
    <section className={styles.section} aria-labelledby="sign-in-methods-title">
      <h2 id="sign-in-methods-title">登录方式</h2>
      <p className={styles.secondary}>一个账户，多种登录方式。已绑定和需要验证的方式显示在最前面。</p>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {offline && <p role="status" className={styles.error}>离线，恢复连接后重试</p>}
      <ul className={styles.rows} data-sign-in-visible>
        {visibleMethods.map(method => (
          <MethodRow
            key={method.provider}
            method={method}
            showActions={!flow}
            offline={offline}
            hasPassword={hasPassword}
            connectedProviders={connectedProviders}
            onLink={() => setFlow({ kind: 'link', provider: method.provider as 'apple' | 'google' })}
            onPassword={() => setFlow({ kind: 'password' })}
            onUnlink={() => setFlow({ kind: 'unlink', provider: method.provider })}
          />
        ))}
      </ul>
      {addableMethods.length > 0 && (
        <details className={styles.addMethods} data-add-login-methods>
          <summary>{`添加登录方式（${addableMethods.length}）`}</summary>
          <p className={styles.secondary}>添加登录方式不会创建工作空间、移动记录或更改主邮箱。</p>
          <ul className={styles.rows}>
            {addableMethods.map(method => (
              <MethodRow
                key={method.provider}
                method={method}
                showActions={!flow}
                offline={offline}
                hasPassword={hasPassword}
                connectedProviders={connectedProviders}
                onLink={() => setFlow({ kind: 'link', provider: method.provider as 'apple' | 'google' })}
                onPassword={() => setFlow({ kind: 'password' })}
                onUnlink={() => setFlow({ kind: 'unlink', provider: method.provider })}
              />
            ))}
          </ul>
        </details>
      )}
      {flow && (
        <OperationAuthPanel
          flow={flow}
          hasPassword={hasPassword}
          connectedProviders={connectedProviders}
          scope={{
            accountId: data.workspace.id,
            userId: data.user.id,
            accountRevision: data.workspace.revision,
            userRevision: data.user.revision,
          }}
          onUpdated={(settings) => {
            setData(settings);
            setFlow(null);
          }}
          onCancel={() => setFlow(null)}
        />
      )}
    </section>
  );
}

export function AccountDataSync({ lastObservedAt }: { lastObservedAt?: string | null }) {
  return (
    <details className={styles.disclosure} data-data-sync>
      <summary>数据同步说明</summary>
      <p className={styles.secondary}>联系人与对话会自动同步到你的设备</p>
      <p className={styles.secondary}>
        {lastObservedAt
          ? `最近一次同步：${new Date(lastObservedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' })}`
          : '打开或回到应用时会自动检查更新。'}
      </p>
    </details>
  );
}
