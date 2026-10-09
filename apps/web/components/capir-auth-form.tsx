'use client';
import styles from './capir-auth.module.css';
import {signOut} from 'next-auth/react';
import {useState,type FormEvent} from 'react';
/** Fetch uses CORS mode so Origin remains exact even on a no-referrer
 * document. Plain navigation forms would send Origin:null in that policy. */
export function CapirAuthForm({sealed,revoke=false,loginReturn}:{sealed:string;revoke?:boolean;loginReturn?:string}) {
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(pending)return;setPending(true);setError('');
  const button=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
  const body=new URLSearchParams({sealed,decision:button?.value??'approve'});
  try {const response=await fetch(revoke?'/api/capir/grants/revoke':'/api/capir/authorize',{method:'POST',mode:'cors',redirect:'error',body});
   if(!response.ok)throw new Error('Request failed');const result=await response.json() as {location?:string};
   if(!result.location)throw new Error('Missing result');
   const target=new URL(result.location,window.location.origin);
   if(revoke ? target.origin!==window.location.origin || target.pathname!=='/workspace/settings/cli' : target.protocol!=='http:' || target.hostname!=='127.0.0.1' || target.pathname!=='/capir/callback')throw new Error('Invalid result');
   window.location.assign(target.toString());
  } catch {setError(revoke?'撤销未完成，请重试。':'授权未完成，请回到终端重新登录。');setPending(false);}
 }
 return <form className={styles.actions} onSubmit={submit}><button name="decision" value="approve" disabled={pending}>{pending?'正在处理…':revoke?'撤销授权':'授权并返回终端'}</button>{!revoke&&<button name="decision" value="deny" disabled={pending}>取消</button>}{loginReturn&&<button type="button" disabled={pending} onClick={()=>{void signOut({redirectTo:loginReturn});}}>切换账号</button>}{error&&<p role="alert">{error}</p>}<noscript>请启用 JavaScript 完成授权。</noscript></form>;
}
