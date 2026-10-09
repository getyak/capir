/** Explicit server-operator registry command; never auto-enables ordinary
 * users/admins. UUID identity and named provenance are mandatory. */
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {inTransaction} from './pool.js';
import {assertAccountActive} from '../modules/accountIdentity.js';
const [operation,accountId,userId,provenance]=process.argv.slice(2);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!['grant','revoke'].includes(operation??'') || !uuid.test(accountId??'') || !uuid.test(userId??'') || !provenance || provenance.length>120)
 throw new Error('Usage: manageCapirTestEntitlement.ts grant|revoke <account-uuid> <user-uuid> <operator-provenance>');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
 const result=await inTransaction(pool,async client=>{
  await assertAccountActive(client,accountId!);
  const user=(await client.query<{kind:string;status:string}>('SELECT kind,status FROM users WHERE account_id=$1 AND id=$2 FOR SHARE',[accountId,userId])).rows[0];
  if(!user || user.kind==='lab_human' || user.status!=='active')throw new Error('An active real user is required.');
  if(operation==='grant')return (await client.query(`INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,granted_by)
    VALUES($1,$2,$3,ARRAY['test.create','test.status','test.stop','test.handoff'],$4)
    ON CONFLICT(account_id,user_id) DO UPDATE SET state='active',scopes=EXCLUDED.scopes,granted_by=EXCLUDED.granted_by,
      generation=capir_user_test_entitlements.generation+1,revoked_at=NULL,revoke_reason=NULL
    RETURNING account_id,user_id,state,generation`,[randomUUID(),accountId,userId,provenance])).rows[0];
  return (await client.query(`UPDATE capir_user_test_entitlements SET state='revoked',generation=generation+1,
    revoked_at=now(),revoke_reason=$3 WHERE account_id=$1 AND user_id=$2 RETURNING account_id,user_id,state,generation`,[accountId,userId,provenance])).rows[0]??{state:'absent'};
 });
 console.log(JSON.stringify(result)); // nonsecret registry receipt only
} finally {await pool.end();}
