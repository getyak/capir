'use server';
import { primarySessionFingerprint } from "@/lib/server/primary-session-binding";
import { createHmac } from 'node:crypto';
import { TalentSignalClient, TalentSignalHttpError, type LabWorkspace, type LabWorkspaceEntry } from '@talent-signal/contracts';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { backendSessionRecoveryHref } from '@/lib/backend-session';
import { authSecret, backendAuthBaseUrl } from '@/lib/server/backendAuth';
import { primaryAccount, testWorkspaceRequest } from '@/lib/server/testWorkspaceBackend';
import { clearTestWorkspaceSession, setTestWorkspaceSession, testWorkspaceSession } from '@/lib/server/testWorkspaceSession';

export type TestActionState={error?:string;workspace?:LabWorkspace};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function manageTestWorkspace(_previous:TestActionState,form:FormData):Promise<TestActionState>{
  const operationId=String(form.get('operationId')??''),workspaceId=String(form.get('workspaceId')??'');
  if(!uuid.test(operationId))return {error:'请刷新后重试。'};
  const kind=form.get('kind');
  try{
    const primary=await primaryAccount();
    if(form.get('parentAccountId')!==primary.backendAccountId||form.get('parentUserId')!==primary.backendUserId) return {error:'登录身份已变化，请刷新后重试。'};
    if(kind==='create'){
      const duration=Number(form.get('duration'));
      if(![1,4,24].includes(duration))return {error:'请选择有效时长。'};
      const result=await testWorkspaceRequest<{workspace:LabWorkspace}>('',{id:operationId,duration_hours:duration});
      revalidatePath('/workspace/settings/testing');return {workspace:result.workspace};
    }
    if(!uuid.test(workspaceId))return {error:'请选择一个测试空间。'};
    if(kind==='stop'){
      const result=await testWorkspaceRequest<{workspace:LabWorkspace}>(`/${workspaceId}/stop`,{id:operationId});
      revalidatePath('/workspace/settings/testing');return {workspace:result.workspace};
    }
    if(kind!=='enter')return {error:'无法识别操作。'};
    if(await testWorkspaceSession(primary))return {error:'请先返回我的空间，再进入另一个测试空间。'};
    // Stable, secret entry credential makes retries recover the same backend entry.
    const accessToken=createHmac('sha256',authSecret()).update(`${primary.backendLegacyAccessToken ?? (primary.backendSessionId ? primarySessionFingerprint(primary) : primary.backendAccessToken)}:${workspaceId}:${operationId}`).digest('base64url');
    const result=await testWorkspaceRequest<{entry:LabWorkspaceEntry}>(`/${workspaceId}/entries`,{id:operationId,access_token:accessToken});
    if(result.entry.state!=='active'||!result.entry.session)throw new Error('Inactive test session');
    const session=await new TalentSignalClient(backendAuthBaseUrl(),accessToken).currentSession();
    if(session.account.id!==result.entry.session.account.id||session.user.id!==result.entry.session.user.id||session.user.kind!=='lab_human')throw new Error('Invalid test identity');
    await setTestWorkspaceSession(primary,{workspaceId,entryId:result.entry.id,name:session.account.name,claims:{
      backendAccessToken:accessToken,backendAccountId:session.account.id,backendAccountName:session.account.name,
      backendAccountSlug:session.account.slug,backendExpiresAt:session.expires_at,backendRole:session.user.role,
      backendUserId:session.user.id,backendUsername:session.user.username,
    }});
  }catch(error){
    if(error instanceof TalentSignalHttpError&&error.code==='LAB_WORKSPACE_SCHEMA_CHANGED')return {error:'测试空间的数据清理规则需要更新，当前没有创建或进入测试空间。'};
    if(error instanceof TalentSignalHttpError&&error.status===403)return {error:'当前环境或账号未开放测试空间。'};
    return {error:'操作结果暂时无法核验，请保留页面重试；不会切换到其他空间。'};
  }
  revalidatePath('/workspace','layout');redirect('/workspace');
}
export async function leaveTestWorkspace(){
  let primary:Awaited<ReturnType<typeof primaryAccount>>;
  try{primary=await primaryAccount();}
  catch(error){
    if(!(error instanceof TalentSignalHttpError)||error.status!==401)throw error;
    // Explicit return can clear this browser's stale test cookie even when
    // backend authority is gone. No remote leave/revocation is claimed.
    await clearTestWorkspaceSession();revalidatePath('/workspace','layout');
    redirect(backendSessionRecoveryHref('/workspace/settings/testing'));
  }
  let test;
  try{test=await testWorkspaceSession(primary);}catch{ /* Explicit return may discard an expired cookie; no hidden scope fallback. */ }
  if(test){
    try{await testWorkspaceRequest(`/${test.workspaceId}/entries/${test.entryId}/leave`,{});}
    catch(error){
      if(!(error instanceof TalentSignalHttpError)||![401,403,404,410].includes(error.status))redirect('/workspace/settings/testing?leave=retry');
    }
  }
  await clearTestWorkspaceSession();revalidatePath('/workspace','layout');redirect('/workspace/settings/testing');
}
