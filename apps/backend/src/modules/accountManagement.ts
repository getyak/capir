import { CONTRACT_VERSION, type AccountSettings, type AccountMutation, type LanguagePreference } from '@talent-signal/contracts';
import type { Pool, PoolClient } from 'pg';
import { inTransaction } from '../database/pool.js';
import { ApiError } from '../lib/apiError.js';
import { sha256 } from '../lib/hash.js';
import { normalizeEmail, readEmailReservation } from './accountIdentity.js';
import type { AuthContext } from './auth.js';

type AccountRow = { id: string; name: string; slug: string; owner_user_id: string | null; settings_revision: number; retired_at: Date | null };
type UserRow = { id: string; display_name: string; email: string; username: string | null; email_verified_at: Date | null;
  kind: string; account_role: 'admin' | 'member'; status: 'active' | 'revoked'; profile_revision: number;
  display_language: LanguagePreference };
const iso = (value: Date) => value.toISOString();
const realUser = (kind: string) => ['password_human', 'google_human', 'apple_human'].includes(kind);

async function context(client: PoolClient, auth: AuthContext, write = false) {
  const account = (await client.query<AccountRow>(`SELECT * FROM accounts WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [auth.accountId])).rows[0];
  if (account?.retired_at) throw new ApiError(409, 'ACCOUNT_RETIRED', 'This account\'s sign-in methods were transferred to your canonical account. Nothing was written here.');
  const user = (await client.query<UserRow>('SELECT * FROM users WHERE account_id=$1 AND id=$2', [auth.accountId, auth.userId])).rows[0];
  const session = await client.query(`SELECT id FROM sessions WHERE id=$1 AND account_id=$2 AND user_id=$3
    AND revoked_at IS NULL AND expires_at>now() FOR SHARE`, [auth.sessionId, auth.accountId, auth.userId]);
  if (!account || !user || user.status !== 'active' || !session.rowCount) throw new ApiError(401, 'SESSION_INVALID', 'Sign in again.');
  const isOwner = account.owner_user_id === user.id;
  const canManage = user.kind !== 'lab_human' && (isOwner || user.account_role === 'admin');
  return { account, user, isOwner, canManage };
}

async function read(client: PoolClient, auth: AuthContext, labEnabled: boolean): Promise<AccountSettings> {
  const { account, user, isOwner, canManage } = await context(client, auth);
  const identities = (await client.query<{provider: 'google' | 'apple'; email_hint: string | null}>(`SELECT provider, email_hint FROM auth_identities WHERE account_id=$1 AND user_id=$2`, [auth.accountId, auth.userId])).rows;
  const password = await client.query(`SELECT 1 FROM password_credentials WHERE account_id=$1 AND user_id=$2`, [auth.accountId, auth.userId]);
  const methods = [...identities.map(row => row.provider), ...(password.rowCount ? ['password' as const] : [])];
  const connectedCount = methods.length;
  const reservation = await readEmailReservation(client, user.email);
  const emailOwnership: AccountSettings['email_ownership_state'] = user.email_verified_at
    ? 'verified'
    : reservation?.state === 'conflict' ? 'conflict' : 'legacy_unverified';
  const signInMethods: AccountSettings['sign_in_methods'] = (['apple', 'google', 'password'] as const).map(provider => {
    const connected = methods.includes(provider);
    const hint = provider === 'password'
      ? (connected ? user.email : null)
      : (identities.find(row => row.provider === provider)?.email_hint ?? null);
    const state: 'connected' | 'unconnected' | 'legacy_unverified' = !connected
      ? 'unconnected'
      // Existing password logins stay explicitly legacy-unverified until real
      // ownership proof is recorded; a verified email claim alone never counts.
      : (provider === 'password' && !user.email_verified_at) ? 'legacy_unverified' : 'connected';
    return { provider, state, hint, can_unlink: connected && connectedCount > 1 };
  });
  const sessions = (await client.query<{id: string; client_label: string; created_at: Date; expires_at: Date}>(`SELECT id,client_label,created_at,expires_at FROM sessions
    WHERE account_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 100`, [auth.accountId, auth.userId])).rows;
  const members = canManage ? (await client.query<UserRow>('SELECT * FROM users WHERE account_id=$1 ORDER BY created_at,id', [auth.accountId])).rows : [];
  const activity = canManage ? (await client.query<{id:string;kind:string;actor_name:string;created_at:Date}>(`SELECT e.id,e.kind,u.display_name AS actor_name,e.created_at
    FROM account_access_events e JOIN users u ON u.account_id=e.account_id AND u.id=e.actor_user_id
    WHERE e.account_id=$1 ORDER BY e.created_at DESC LIMIT 20`, [auth.accountId])).rows : [];
  return {
    contract_version: CONTRACT_VERSION,
    user: {id:user.id,email:user.email,display_name:user.display_name,username:user.username,kind:user.kind,
      revision:user.profile_revision,login_methods:methods,
      email_verified_at:user.email_verified_at?iso(user.email_verified_at):null},
    sign_in_methods: signInMethods,
    email_ownership_state: emailOwnership,
    workspace: {id:account.id,name:account.name,slug:account.slug,owner_user_id:account.owner_user_id,
      revision:account.settings_revision,role:user.account_role,is_owner:isOwner,can_manage:canManage,
      is_test:user.kind==='lab_human'||user.kind==='simulated_human'||account.slug.startsWith('fixture-')},
    sessions:sessions.map(s=>({...s,created_at:iso(s.created_at),expires_at:iso(s.expires_at),is_current:s.id===auth.sessionId})),
    members:members.map(m=>({id:m.id,display_name:m.display_name,email:m.email,role:m.account_role,status:m.status,is_owner:m.id===account.owner_user_id})),
    activity:activity.map(e=>({...e,created_at:iso(e.created_at)})),
    lab_enabled:labEnabled&&user.kind!=='lab_human',
    preferences:{display_language:user.display_language},
  };
}

export function readAccountSettings(pool: Pool, auth: AuthContext, labEnabled: boolean) {
  return inTransaction(pool, client=>read(client,auth,labEnabled));
}

/** Readback inside a caller-owned transaction (credential-change receipts). */
export function readAccountSettingsWith(client: PoolClient, auth: AuthContext, labEnabled: boolean) {
  return read(client, auth, labEnabled);
}

export async function mutateAccountSettings(pool: Pool, auth: AuthContext, input: AccountMutation, labEnabled: boolean) {
  return inTransaction(pool, async client=>{
    const {account,user,isOwner,canManage}=await context(client,auth,true);
    if (user.kind==='lab_human'&&input.kind!=='preferences') throw new ApiError(403,'TEST_ACCOUNT_READ_ONLY','Return to your account to manage access.');
    const hash=sha256(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))));
    const previous=(await client.query<{request_hash:string}>('SELECT request_hash FROM account_access_events WHERE account_id=$1 AND actor_user_id=$2 AND id=$3',[auth.accountId,auth.userId,input.id])).rows[0];
    if(previous){
      if(previous.request_hash!==hash) throw new ApiError(409,'ACCOUNT_OPERATION_CONFLICT','This operation ID was already used.');
      return read(client,auth,labEnabled);
    }
    // Structured audit details are canonical identifiers and lifecycle
    // revisions only; personal names, emails, credentials, and session tokens
    // never enter the audit trail.
    const details:Record<string,unknown>={};
    if(input.kind==='profile'){
      if(user.profile_revision!==input.expected_revision) throw new ApiError(409,'ACCOUNT_STALE','Refresh before saving this profile.');
      details.target_user_id=user.id;
      details.revision_before=user.profile_revision;
      details.revision_after=user.profile_revision+1;
      await client.query('UPDATE users SET display_name=$3,profile_revision=profile_revision+1 WHERE account_id=$1 AND id=$2',[auth.accountId,auth.userId,input.name.trim()]);
    } else if(input.kind==='preferences'){
      // User-scoped presentation preference. The language value itself stays
      // out of the audit trail; only identity and lifecycle revisions enter it.
      if(user.profile_revision!==input.expected_revision) throw new ApiError(409,'ACCOUNT_STALE','Refresh before saving this preference.');
      details.target_user_id=user.id;
      details.revision_before=user.profile_revision;
      details.revision_after=user.profile_revision+1;
      await client.query('UPDATE users SET display_language=$3,profile_revision=profile_revision+1 WHERE account_id=$1 AND id=$2',[auth.accountId,auth.userId,input.display_language]);
    } else if(input.kind==='revoke_session'){
      if(input.session_id===auth.sessionId) throw new ApiError(409,'CURRENT_SESSION','Use sign out to end this session.');
      // Lock the target session so the recorded before/after revocation state is
      // the state this transaction actually observed and produced.
      const before=(await client.query<{id:string;revoked_at:Date|null}>('SELECT id,revoked_at FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',[auth.accountId,auth.userId,input.session_id])).rows[0];
      if(!before) throw new ApiError(404,'SESSION_NOT_FOUND','Session not found.');
      const after=(await client.query<{revoked_at:Date}>('UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=$1 AND user_id=$2 AND id=$3 RETURNING revoked_at',[auth.accountId,auth.userId,input.session_id])).rows[0];
      if(!after) throw new ApiError(404,'SESSION_NOT_FOUND','Session not found.');
      details.target_session_id=before.id;
      details.revoked_at_before=before.revoked_at?iso(before.revoked_at):null;
      details.revoked_at_after=iso(after.revoked_at);
    } else {
      if(!canManage) throw new ApiError(403,'WORKSPACE_ADMIN_REQUIRED','Workspace management is not available to this member.');
      if(account.settings_revision!==input.expected_revision) throw new ApiError(409,'ACCOUNT_STALE','Workspace access changed. Refresh before continuing.');
      if(input.kind==='workspace'){
        details.revision_before=account.settings_revision;
        details.revision_after=account.settings_revision+1;
        await client.query('UPDATE accounts SET name=$2 WHERE id=$1',[auth.accountId,input.name.trim()]);
      }else{
        const target=(await client.query<UserRow>('SELECT * FROM users WHERE account_id=$1 AND id=$2 FOR UPDATE',[auth.accountId,input.user_id])).rows[0];
        if(!target) throw new ApiError(404,'MEMBER_NOT_FOUND','Member not found.');
        if(input.kind==='transfer'){
          if(!isOwner||!realUser(target.kind)||target.status!=='active'||target.id===user.id) throw new ApiError(403,'OWNER_TRANSFER_DENIED','Only the owner can transfer to another active real member.');
          details.target_user_id=target.id;
          details.owner_user_id_before=account.owner_user_id;
          details.owner_user_id_after=target.id;
          await client.query('UPDATE accounts SET owner_user_id=$2 WHERE id=$1',[auth.accountId,target.id]);
        }else{
          if(target.id===user.id||target.id===account.owner_user_id||(!isOwner&&(target.account_role==='admin'||input.role==='admin'))) throw new ApiError(403,'MEMBER_CHANGE_DENIED','This member can only be managed by the workspace owner.');
          if(!realUser(target.kind)) throw new ApiError(403,'FIXTURE_MEMBER_READ_ONLY','Simulated identities are managed by the development fixture.');
          details.target_user_id=target.id;
          details.role_before=target.account_role;
          details.role_after=input.role;
          details.status_before=target.status;
          details.status_after=input.status;
          details.revoked_session_ids=[];
          await client.query('UPDATE users SET account_role=$3,status=$4 WHERE account_id=$1 AND id=$2',[auth.accountId,target.id,input.role,input.status]);
          // Reinstating a member never resurrects prior sessions or tokens.
          if(input.status==='revoked'||input.role!==target.account_role){
            const revoked=await client.query<{id:string}>('UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id',[auth.accountId,target.id]);
            details.revoked_session_ids=revoked.rows.map(row=>row.id);
            const revokedGrants=await client.query<{id:string}>('UPDATE mcp_client_grants SET revoked_at=now(),revision=revision+1 WHERE account_id=$1 AND created_by_user_id=$2 AND revoked_at IS NULL RETURNING id',[auth.accountId,target.id]);
            details.revoked_mcp_grant_ids=revokedGrants.rows.map(row=>row.id);
          }
        }
      }
      await client.query('UPDATE accounts SET settings_revision=settings_revision+1 WHERE id=$1',[auth.accountId]);
    }
    await client.query('INSERT INTO account_access_events(id,account_id,actor_user_id,kind,request_hash,details) VALUES ($1,$2,$3,$4,$5,$6)',[input.id,auth.accountId,auth.userId,input.kind,hash,JSON.stringify(details)]);
    return read(client,auth,labEnabled);
  });
}
