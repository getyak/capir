'use server';

import { TalentSignalHttpError, type AccountMutation, type AccountSettings, type LanguagePreference } from '@talent-signal/contracts';
import { revalidatePath } from 'next/cache';
import { readBackendSessionClaims } from '@/lib/server/backendAuth';
import { updateAccountSettings } from '@/lib/server/accountBackend';

export type AccountActionState = { data?: AccountSettings; error?: string; saved?: boolean };

export async function saveAccountSettings(_previous: AccountActionState, form: FormData): Promise<AccountActionState> {
  try {
    const scope=await readBackendSessionClaims();
    if(!scope||(scope.backendAccountId!==form.get('workspaceId')||scope.backendUserId!==form.get('actorUserId')))return {error:'登录空间已变化，请刷新后重试。'};
  } catch { return {error:'登录或测试会话已过期，请返回自己的空间后重试。'}; }
  const kind = form.get('kind');
  const common = { id: String(form.get('operationId') ?? ''), expected_revision: Number(form.get('revision')) };
  let input: AccountMutation;
  switch (kind) {
    case 'profile': case 'workspace': input = { ...common, kind, name: String(form.get('name') ?? '').trim() }; break;
    case 'member': {
      const role=form.get('role'), status=form.get('status');
      if ((role!=='member'&&role!=='admin')||(status!=='active'&&status!=='revoked')) return {error:'请选择有效的成员权限。'};
      input={...common,kind,user_id:String(form.get('userId')),role,status}; break;
    }
    case 'transfer': input={...common,kind,user_id:String(form.get('userId'))}; break;
    case 'revoke_session': input={id:common.id,kind,session_id:String(form.get('sessionId'))}; break;
    case 'preferences': {
      const display=String(form.get('display_language') ?? 'system');
      if (display!=='system'&&display!=='en'&&display!=='zh-CN'&&display!=='zh-TW'&&display!=='ja'&&display!=='ko') return {error:'请选择有效的界面语言。'};
      input={...common,kind,display_language:display as LanguagePreference}; break;
    }
    default: return {error:'无法识别这次操作。'};
  }
  try {
    const data = await updateAccountSettings(input);
    if (kind === 'preferences') revalidatePath('/', 'layout');
    else if (kind === 'profile' || kind === 'workspace') revalidatePath('/workspace', 'layout');
    return { data, saved:true };
  }
  catch(error) {
    if(error instanceof TalentSignalHttpError) {
      if(error.status===401) return {error:'登录已过期，请重新登录后继续。'};
      if(error.status===403) return {error:'当前账号没有这项管理权限。'};
      if(error.code==='ACCOUNT_STALE') return {error:'资料或权限已发生变化。请刷新页面，核对最新内容后再提交。'};
      if(error.status===400) return {error:'请检查填写内容，名称应为 1–100 个字符。'};
    }
    return {error:'暂时无法核验保存结果。保留当前内容，可用同一次操作重试或刷新核对。'};
  }
}
