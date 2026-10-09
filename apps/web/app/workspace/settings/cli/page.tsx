import styles from '@/components/capir-auth.module.css';
import {CapirAuthForm} from '@/components/capir-auth-form';
import {redirect} from 'next/navigation';
import {readPrimaryBackendSessionClaims} from '@/lib/server/backendAuth';
import {capirAuthRequest,sealCapirForm} from '@/lib/server/capir-auth';
import type {CapirAuthGrantListResponse} from '@talent-signal/contracts';
export const dynamic='force-dynamic';
export const metadata={title:'CLI 授权',referrer:'no-referrer'};
export default async function Page() {
 const claims=await readPrimaryBackendSessionClaims(); if(!claims) redirect('/login?callbackUrl=/workspace/settings/cli');
 let result:CapirAuthGrantListResponse;
 try {result=await capirAuthRequest<CapirAuthGrantListResponse>('grants',claims);} catch {return <main className={styles.manager}><h1>CLI 授权</h1><p>暂时无法读取授权。请确认当前账号已登录。</p></main>;}
 return <main className={styles.manager}><h1>CLI 授权</h1><p>这里仅显示当前账号的命令行授权。撤销会同时禁用该授权创建的测试入口。</p>
 {result.grants.length===0?<p>暂无 CLI 授权。</p>:<ul className={styles.list}>{result.grants.map(grant=><li key={grant.id} className={styles.card}><h2>{grant.client_label}</h2><p>{grant.environment.backend_origin}</p><p>状态：{grant.state} · 创建于 {grant.created_at} · 最近使用 {grant.last_used_at??'尚未使用'} · 到期 {grant.absolute_expires_at}</p><p>权限：{grant.scopes.join(', ')}</p>{grant.state==='active'&&<CapirAuthForm revoke sealed={sealCapirForm(claims,{grant_id:grant.id})}/>}</li>)}</ul>}
 </main>;
}
