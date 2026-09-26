'use client';

import { createContext, useContext, useActionState, useId, useState } from 'react';
import type { AccountSettings } from '@talent-signal/contracts';
import Link from 'next/link';
import { saveAccountSettings, type AccountActionState } from '@/app/workspace/settings/actions';
import styles from './account-settings.module.css';
import { AvatarEditor } from './avatar-editor';
import { AccountDataSync, AccountSignInMethods } from './account-sign-in-methods';
import { AccountConflictRecovery } from './account-conflict-recovery';

const WorkspaceScope = createContext({workspaceId:'',userId:''});
const eventNames: Record<string,string> = {profile:'更新个人资料',workspace:'更新空间名称',member:'调整成员访问',transfer:'移交空间所有权',revoke_session:'退出其他会话',onboarding:'更新个人资料引导'};
function date(value:string){return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'});}

function MutationForm({children, kind, revision, confirmation, onSaved}:{children:React.ReactNode;kind:string;revision?:number;confirmation?:string;onSaved:(data:AccountSettings)=>void}) {
  const {workspaceId,userId}=useContext(WorkspaceScope);
  const [operationId,setOperationId]=useState('');
  const [state,action,pending]=useActionState(async(previous:AccountActionState,form:FormData)=>{
    const result=await saveAccountSettings(previous,form);
    if(result.data){onSaved(result.data);setOperationId('');}
    return result;
  },{});
  return <form action={action} className={styles.form} onSubmit={event=>{
    if(pending){event.preventDefault();return;}
    if(confirmation&&!window.confirm(confirmation)){event.preventDefault();return;}
    const id=operationId||crypto.randomUUID();
    (event.currentTarget.elements.namedItem('operationId') as HTMLInputElement).value=id;
    setOperationId(id);
  }}>
    <input type="hidden" name="operationId" defaultValue={operationId}/>
    <input type="hidden" name="workspaceId" value={workspaceId}/><input type="hidden" name="actorUserId" value={userId}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="revision" value={revision??1}/>
    <fieldset disabled={pending}>{children}</fieldset>
    <p aria-live="polite" className={state.error?styles.error:styles.notice}>{pending?'正在保存…':state.error??(state.saved?'已保存并核验。':'')}</p>
  </form>;
}
function NameForm({name,kind,revision,label,onSaved}:{name:string;kind:string;revision:number;label:string;onSaved:(data:AccountSettings)=>void}){
  const id=useId();
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(name);
  return <div className={styles.nameField}>
    {editing ? <MutationForm kind={kind} revision={revision} onSaved={data=>{onSaved(data);setEditing(false);}}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.editRow}><input autoFocus id={id} name="name" value={draft} onChange={event=>setDraft(event.target.value)} maxLength={100} required/><button className={styles.saveButton} type="submit">保存</button><button type="button" onClick={()=>{setDraft(name);setEditing(false);}}>取消</button></div>
    </MutationForm> : <><span className={styles.fieldLabel}>{label}</span><button type="button" className={styles.editValue} onClick={()=>{setDraft(name);setEditing(true);}} aria-label={`编辑${label}`}><span>{name}</span><span>编辑</span></button></>}
  </div>;
}

export function AccountSettingsPanel({initial,section,embedded=false,recovery,avatarUrl}:{avatarUrl?:string|null;initial:AccountSettings;section:'profile'|'account'|'workspace';embedded?:boolean;recovery?:{operationRef:string|null;roles:{current:{provider:string;expiresAt:string}|null;duplicate:{provider:string;expiresAt:string}|null}}}){
  const [data,setData]=useState(initial);
  const role=data.workspace.is_owner?'所有者':data.workspace.role==='admin'?'管理员':'成员';
  return <WorkspaceScope.Provider value={{workspaceId:data.workspace.id,userId:data.user.id}}>
    {embedded?null:<><header className={styles.heading}><p className={styles.eyebrow}>你的身份与空间</p><h1>{section==='account'?'账号与安全':'工作空间'}</h1><p>{section==='account'?'管理自己的资料、登录方式与访问设备。':'空间中的资料与成员，始终有清楚的归属。'}</p></header>
    <nav className={styles.tabs} aria-label="账号设置"><Link href="/workspace/settings" aria-current={section==='account'?'page':undefined}>账号与安全</Link><Link href="/workspace/settings?section=workspace" aria-current={section==='workspace'?'page':undefined}>工作空间</Link>{data.lab_enabled&&<Link href="/workspace/settings/testing">测试空间</Link>}</nav></>}
    {section==='profile'?<>
      <section className={styles.section}>
        <div className={styles.profileIdentity}><AvatarEditor id="self" self label={data.user.display_name} url={avatarUrl} size={64} shape="squircle" triggerLabel="更换头像" /><div><h2>{data.user.display_name}</h2><p className={styles.secondary}>{data.user.email}</p></div></div>
        {data.user.kind==='lab_human'?<p className={styles.secondary}>测试身份由隔离空间管理。返回自己的账号后可以修改资料。</p>:<NameForm key={`profile-${data.user.revision}`} name={data.user.display_name} kind="profile" revision={data.user.revision} label="显示名称" onSaved={setData}/>}
      </section>
      <section className={styles.section}><h2>个人介绍</h2><div className={styles.row}><p className={styles.secondary}>主页和个人介绍</p><Link className={styles.button} href="/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings">编辑资料 →</Link></div></section>
      <details className={styles.disclosure}><summary>头像保存在哪里？</summary><p>头像保存在当前浏览器或应用的这台设备上，按账号隔离，暂不跨设备同步。不会修改来源平台的照片。</p><Link href="/workspace/settings?section=appearance">管理头像风格与本机数据 →</Link></details>
    </>:section==='account'?<>
      {data.user.login_methods.length ? <>
        <AccountSignInMethods initial={data} />
        <AccountConflictRecovery initial={data} recovery={recovery} />
        <AccountDataSync />
      </> : <section className={styles.section}><h2>登录方式</h2><p>此身份通过受限的测试会话访问。</p></section>}
      <section className={styles.section}><h2>登录会话</h2><p className={styles.secondary}>设备名称由客户端提供；时间按北京时间显示。退出会话后，该设备需要重新登录。</p>{data.sessions.map(session=><div className={styles.row} key={session.id}><div><strong>{session.client_label}</strong><p className={styles.secondary}>登录于 {date(session.created_at)} · 到期 {date(session.expires_at)}</p></div>{session.is_current?<span className={styles.badge}>当前会话</span>:data.user.kind!=='lab_human'?<MutationForm kind="revoke_session" onSaved={setData} confirmation={`退出「${session.client_label}」的会话？该设备需要重新登录。`}><input type="hidden" name="sessionId" value={session.id}/><button type="submit">退出此会话</button></MutationForm>:null}</div>)}</section>
    </>:<>
      <section className={styles.section}><div className={styles.row}><h2>{data.workspace.name}</h2><span className={styles.badge}>{role}{data.workspace.is_test?' · 测试':''}</span></div>{data.workspace.can_manage?<NameForm key={`workspace-${data.workspace.revision}`} name={data.workspace.name} kind="workspace" revision={data.workspace.revision} label="空间名称" onSaved={setData}/>:<p>空间设置由所有者或管理员维护。</p>}{!data.workspace.owner_user_id&&<p className={styles.secondary}>此历史空间尚未指定所有者，系统不会自动推定归属。</p>}</section>
      {data.workspace.can_manage&&<section className={styles.section}><h2>成员与权限</h2><p className={styles.secondary}>管理员管理本空间；具体资料访问与外部操作仍遵循各自的授权。当前版本管理已有成员。</p>{data.members.map(member=><div className={styles.member} key={member.id}><div><strong>{member.display_name}{member.id===data.user.id?'（你）':''}</strong><p className={styles.secondary}>{member.email}</p><span>{member.is_owner?'所有者':member.role==='admin'?'管理员':'成员'} · {member.status==='active'?'正常':'已停用'}</span></div>{member.id!==data.user.id&&!member.is_owner&&(data.workspace.is_owner||member.role!=='admin')&&<MutationForm kind="member" revision={data.workspace.revision} onSaved={setData} confirmation={`确认修改「${member.display_name}」的访问权限？停用或变更角色会退出其已有会话。`}><input type="hidden" name="userId" value={member.id}/><label>角色<select name="role" defaultValue={member.role}>{data.workspace.is_owner&&<option value="admin">管理员</option>}<option value="member">成员</option></select></label><label>状态<select name="status" defaultValue={member.status}><option value="active">正常</option><option value="revoked">停用</option></select></label><button type="submit">更新权限</button></MutationForm>}{data.workspace.is_owner&&member.id!==data.user.id&&member.status==='active'&&<MutationForm kind="transfer" revision={data.workspace.revision} onSaved={setData} confirmation={`将空间所有权移交给「${member.display_name}」？你将保留原成员角色，失去所有者权限。`}><input type="hidden" name="userId" value={member.id}/><button type="submit">移交所有权</button></MutationForm>}</div>)}</section>}
      {data.workspace.can_manage&&<details className={styles.disclosure}><summary>最近管理记录</summary>{data.activity.length?data.activity.map(event=><div className={styles.row} key={event.id}><span>{event.actor_name} · {eventNames[event.kind]??event.kind}</span><time dateTime={event.created_at}>{date(event.created_at)}</time></div>):<p className={styles.secondary}>暂无管理变更。</p>}</details>}
    </>}
  </WorkspaceScope.Provider>;
}
