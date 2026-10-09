import {CapirAuthForm} from '@/components/capir-auth-form';
import {redirect} from 'next/navigation';
import {readPrimaryBackendSessionClaims} from '@/lib/server/backendAuth';
import {capirAuthRequest, sealCapirForm, validateConsentParams} from '@/lib/server/capir-auth';
import type {CapirAuthScope} from '@talent-signal/contracts';
import styles from '@/components/capir-test-banner.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'授权 capir CLI', referrer:'no-referrer'};
const scopeLabels:Record<CapirAuthScope,string>={'grants.read':'查看本次 CLI 授权','grants.revoke':'撤销本次 CLI 授权','test.create':'创建隔离测试空间','test.status':'查看自己的测试空间','test.stop':'关闭自己的测试空间','test.handoff':'进入自己的测试空间'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  // Validate the callback and registered origins before constructing login return.
  try { validateConsentParams(params,['grants.read','grants.revoke']); } catch {return <main><h1>无法授权</h1><p>请求无效或当前环境尚未启用。请回到终端重新登录。</p></main>;}
  const claims=await readPrimaryBackendSessionClaims();
  if (!claims) {
    const query=new URLSearchParams(Object.entries(params).filter((entry):entry is [string,string] => typeof entry[1]==='string'));
    redirect('/login?callbackUrl='+encodeURIComponent('/capir/authorize?'+query));
  }
  let consent:ReturnType<typeof validateConsentParams>;
  let sealed:string;
  try {
    const context=await capirAuthRequest<{scopes:CapirAuthScope[]; identity:{account_id:string;user_id:string}}>('context',claims);
    if (context.identity.account_id!==claims.backendAccountId || context.identity.user_id!==claims.backendUserId) throw new Error('Identity changed');
    consent=validateConsentParams(params,context.scopes);
    sealed=sealCapirForm(claims,consent);
  } catch {return <main><h1>暂时无法授权</h1><p>当前登录或授权服务不可用。请重新登录后重试。</p></main>;}
    return <main className={styles.entryPage}><section className={styles.entryPanel}><p className={styles.eyebrow}>命令行登录</p><h1>授权 capir CLI</h1>
      <p>当前账号：{claims.backendUsername ?? claims.backendAccountName}</p><p>客户端：{consent.client_label}</p><p>环境：{consent.backend_origin}</p>
      <ul>{consent.scopes.map(scope=><li key={scope}>{scopeLabels[scope]}</li>)}</ul>
      <p>凭据只保存在本机系统钥匙串中。可随时在账号设置中撤销。</p>
      {!consent.scopes.some(scope=>scope.startsWith('test.')) && <p>此账号尚未获准创建测试空间。</p>}
      <CapirAuthForm sealed={sealed} loginReturn={'/login?callbackUrl='+encodeURIComponent('/capir/authorize?'+new URLSearchParams(Object.entries(params).filter((e):e is [string,string]=>typeof e[1]==='string')))}/>
    </section></main>;

}
