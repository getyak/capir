import {CapirAuthForm} from '@/components/capir-auth-form';
import {redirect} from 'next/navigation';
import {readPrimaryBackendSessionClaims} from '@/lib/server/backendAuth';
import {capirAuthRequest, sealCapirForm, validateConsentParams} from '@/lib/server/capir-auth';
import type {CapirAuthScope} from '@talent-signal/contracts';
import Link from 'next/link';
import {backendSessionRecoveryHref,isBackendSessionExpiredError} from '@/lib/backend-session';
import {AuthorizationFrame} from './authorization-frame';
import styles from './authorize.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'授权 capir CLI', referrer:'no-referrer', robots:{follow:false,index:false}};
const scopeLabels:Record<CapirAuthScope,string>={'grants.read':'查看本次 CLI 授权','grants.revoke':'撤销本次 CLI 授权','test.create':'创建隔离测试空间','test.status':'查看自己的测试空间','test.stop':'关闭自己的测试空间','test.handoff':'进入自己的测试空间'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  // Validate the callback and registered origins before constructing login return.
  try { validateConsentParams(params,['grants.read','grants.revoke']); } catch {
    return <AuthorizationFrame title="无法授权这个请求" summary="这个登录链接无法核对。请回到终端，重新发起登录。" note="核对账号与权限后，才能继续授权。"/>;
  }
  const query=new URLSearchParams(Object.entries(params).filter((entry):entry is [string,string] => typeof entry[1]==='string'));
  const returnTarget='/capir/authorize?'+query;
  const loginReturn='/login?callbackUrl='+encodeURIComponent(returnTarget);
  const claims=await readPrimaryBackendSessionClaims();
  if (!claims) {
    redirect(loginReturn);
  }
  let consent:ReturnType<typeof validateConsentParams>;
  let sealed:string;
  try {
    const context=await capirAuthRequest<{scopes:CapirAuthScope[]; identity:{account_id:string;user_id:string}}>('context',claims);
    if (context.identity.account_id!==claims.backendAccountId || context.identity.user_id!==claims.backendUserId) throw new Error('Identity changed');
    consent=validateConsentParams(params,context.scopes);
    sealed=sealCapirForm(claims,consent);
  } catch (error) {
    if (isBackendSessionExpiredError(error)) redirect(backendSessionRecoveryHref(returnTarget));
    return <AuthorizationFrame title="暂时无法授权" summary="当前授权请求暂时无法核对。请稍后重新载入，再确认账号与权限。" note="若终端请求已经结束，请回到终端重新登录。">
      <Link className={styles.retry} href={returnTarget}>重新载入</Link>
    </AuthorizationFrame>;
  }
  return <AuthorizationFrame title="授权 capir CLI" summary="核对当前账号和本次权限，再决定是否交回终端。" note="凭据只保存在本机系统钥匙串中。可随时在账号设置中撤销。">
    <dl className={styles.identity}>
      <dt>当前账号</dt><dd>{claims.backendUsername ?? claims.backendAccountName}</dd>
      <dt>客户端</dt><dd>{consent.client_label}</dd>
      <dt>环境</dt><dd>{consent.backend_origin}</dd>
    </dl>
    <section className={styles.permissions} aria-labelledby="capir-permissions-title">
      <h2 id="capir-permissions-title">本次权限</h2>
      <ul>{consent.scopes.map(scope=><li key={scope}>{scopeLabels[scope]}</li>)}</ul>
    </section>
    {!consent.scopes.some(scope=>scope.startsWith('test.')) && <p className={styles.entitlement}>此账号尚未获准创建测试空间。</p>}
    <CapirAuthForm sealed={sealed} loginReturn={loginReturn}/>
  </AuthorizationFrame>;

}
