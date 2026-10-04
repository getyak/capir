import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, fixture, provider } from './model-helpers.mjs';
import { sandboxResponse } from './helpers.mjs';
const add = name => ['models','add',name,'--provider','openai-compatible','--base-url','http://127.0.0.1:9999/v1','--model','fixture','--auth','none'];
test('profiles mutate atomically without storing keys or selecting implicit defaults', async t => {
  const {root,env} = await fixture(t);
  assert.equal((await cli([...add('first'),'--default'],env)).code,0);
  assert.equal((await cli(add('second'),env)).code,0);
  assert.equal((await cli(add('first'),env)).code,2);
  const list=JSON.parse((await cli(['models','list'],env)).stdout);
  assert.equal(list.default_profile,'first'); assert.equal(list.profiles.length,2);
  assert.equal((await stat(join(root,'models.json'))).mode & 0o777,0o600);
  assert.equal((await cli(['models','use','second'],env)).code,0);
  assert.equal((await cli(['models','remove','second'],env)).code,0);
  assert.equal(JSON.parse(await readFile(join(root,'models.json'),'utf8')).default_profile,null);
});
test('invalid and inapplicable flags cannot mutate profiles or enter legacy dispatch', async t => {
  const {root,env}=await fixture(t);
  for (const args of [ [...add('bad'),'--json','--human'], [...add('bad'),'--provider','anthropic'], ['models','list','--system','oops'], ['auth','status','--open','ios'], ['models','wat'], ['asq'], ['models','add','toString'] ]) {
    assert.equal((await cli(args,env)).code,2,JSON.stringify(args));
  }
  await assert.rejects(stat(join(root,'models.json')),{code:'ENOENT'});
});
test('noncanonical endpoints and inappropriate credentials fail before mutation', async t => {
  const {env}=await fixture(t);
  for(const url of ['http://example.com/v1','http://localhost/v1','https://u:p@example.com/v1','https://example.com/v1?x=1','https://example.com/a/../v1','http://127.1/v1','https://EXAMPLE.com/v1','https://example.com/v1//']) {
    const args=add('bad'); args[args.indexOf('--base-url')+1]=url;
    assert.equal((await cli(args,env)).code,2);
  }
  assert.equal((await cli(['models','add','bad','--provider','anthropic','--base-url','https://api.example.com/v1','--model','fixture','--api-key-env','CAPIR_TOKEN'],env)).code,2);
});
test('doctor checks credentials offline with honest authorization and missing setup', async t => {
  const {env}=await fixture(t);
  assert.equal((await cli(['doctor'],env)).code,2);
  assert.equal((await cli(['models','add','work','--provider','anthropic','--base-url','https://api.example.com/v1','--model','fixture','--api-key-env','CAPIR_SYNTHETIC_KEY','--default'],env)).code,0);
  assert.equal((await cli(['doctor'],{...env,CAPIR_SYNTHETIC_KEY:''})).code,4);
  const result=await cli(['doctor'],{...env,CAPIR_SYNTHETIC_KEY:'synthetic-key'});
  assert.equal(result.code,0); assert.equal(JSON.parse(result.stdout).checks.authorization,'not_checked');
  assert.equal(result.stdout.includes('synthetic-key'),false);
});
test('malformed profile files and inherited members fail safely', async t => {
  const {root,env}=await fixture(t);
  for (const raw of ['null','{"schema_version":"capir.models.v1","profiles":{},"default_profile":"toString"}','{"schema_version":"capir.models.v1","profiles":{},"default_profile":null,"secret":"hidden"}']) {
    await writeFile(join(root,'models.json'),raw);
    assert.equal((await cli(['models','list'],env)).code,2);
  }
});
test('concurrent adds preserve each independent profile', async t => {
  const {env}=await fixture(t);
  const results=await Promise.all(Array.from({length:8},(_,i)=>cli(add(`item${i}`),env)));
  assert.deepEqual(results.map(r=>r.code),Array(8).fill(0));
  assert.equal(JSON.parse((await cli(['models','list'],env)).stdout).profiles.length,8);
});

test('legacy stop preserves its explicit idempotency request ID across retries',async t=>{
  const f=await fixture(t);const sandbox='11111111-1111-4111-8111-111111111111';const id='22222222-2222-4222-8222-222222222222';
  const p=await provider(t,(_,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(sandboxResponse({id:sandbox,state:'deleted'})));});
  await writeFile(join(f.root,'environments.json'),JSON.stringify({environments:{fixture:{backend_origin:new URL(p.url).origin,web_origin:'http://127.0.0.1:3999'}}}));
  const env={...f.env,CAPIR_TOKEN:'synthetic-sandbox-credential-for-owned-fixture-only'};
  const args=['sandbox','stop',sandbox,'--env','fixture','--request-id',id,'--wait','0'];
  const first=await cli(args,env);assert.equal(first.code,0,first.stdout);assert.equal(JSON.parse(first.stdout).request_id,id);
  const second=await cli(args,env);assert.equal(second.code,0);assert.equal(JSON.parse(second.stdout).resumed,true);
  assert.deepEqual(p.requests.filter(x=>x.body!==null).map(x=>x.body.id),[id,id]);
});
