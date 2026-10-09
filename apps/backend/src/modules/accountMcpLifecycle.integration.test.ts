import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../database/pool.js';
import { mutateAccountSettings } from './accountManagement.js';
import type { AuthContext } from './auth.js';

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, idleTimeoutMillis: 0, connectionTimeoutMillis: 3000, statement_timeout: 5000, max: 2 }) : null;
afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)('MCP member authority lifecycle', () => {
  it.each(['suspend', 'role-change'] as const)('never resurrects old grants after %s and reinstatement', async (operation) => {
    const account = randomUUID(), owner = randomUUID(), member = randomUUID(), session = randomUUID(), grant = randomUUID();
    const auth: AuthContext = {accountId:account,accountSlug:`mcp-lifecycle-${account}`,sessionId:session,userId:owner,userEmail:`${owner}@example.test`,userKind:'password_human'};
    try {
      await inTransaction(pool!, async (client) => {
        await client.query("INSERT INTO accounts(id,name,slug) VALUES ($1,'Synthetic MCP lifecycle',$2)",[account,auth.accountSlug]);
        await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES ($1,'owned',$3,$4),($2,'owned',$3,$5)",[auth.userEmail,`${member}@example.test`,account,owner,member]);
        await client.query("INSERT INTO users(id,account_id,email,display_name,kind,account_role) VALUES ($1,$3,$4,'Synthetic owner','password_human','admin'),($2,$3,$5,'Synthetic member','password_human','admin')",[owner,member,account,auth.userEmail,`${member}@example.test`]);
      });
      await pool!.query('UPDATE accounts SET owner_user_id=$2 WHERE id=$1',[account,owner]);
      await pool!.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES ($1,$2,$3,$4,'synthetic',now()+interval '1 hour')",[session,account,owner,createHash('sha256').update(randomUUID()).digest('hex')]);
      await pool!.query("INSERT INTO mcp_client_grants(account_id,id,created_by_user_id,name,token_hash,token_hint,scopes,expires_at,creation_idempotency_key) VALUES($1,$2,$3,'Synthetic client',$4,'test',ARRAY['workspace_metadata_read'],now()+interval '1 day',$5)",[account,grant,member,createHash('sha256').update(randomUUID()).digest('hex'),randomUUID()]);
      const changed = await mutateAccountSettings(pool!, auth, {id:randomUUID(),kind:'member',expected_revision:1,user_id:member,role:operation==='role-change'?'member':'admin',status:operation==='suspend'?'revoked':'active'},false);
      const revoked = (await pool!.query('SELECT revoked_at,revision FROM mcp_client_grants WHERE account_id=$1 AND id=$2',[account,grant])).rows[0];
      expect(revoked.revoked_at).toBeInstanceOf(Date);
      expect(revoked.revision).toBe(2);
      await mutateAccountSettings(pool!,auth,{id:randomUUID(),kind:'member',expected_revision:changed.workspace.revision,user_id:member,role:'admin',status:'active'},false);
      const after = (await pool!.query('SELECT revoked_at,revision FROM mcp_client_grants WHERE account_id=$1 AND id=$2',[account,grant])).rows[0];
      expect(after.revoked_at).toEqual(revoked.revoked_at);
      expect(after.revision).toBe(2);
    } finally {
      for (const table of ['account_access_events','mcp_client_grants','sessions','account_email_reservations']) await pool!.query(`DELETE FROM ${table} WHERE account_id=$1`,[account]);
      await pool!.query('UPDATE accounts SET owner_user_id=NULL WHERE id=$1',[account]);
      await pool!.query('DELETE FROM users WHERE account_id=$1',[account]);
      await pool!.query('DELETE FROM harness_source_generations WHERE account_id=$1',[account]);
      await pool!.query('DELETE FROM accounts WHERE id=$1',[account]);
    }
  }, 20_000);
});
