import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,openSync,fstatSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runContract,contractContext} from './publication-contract.mjs';
import {githubFixture,requestInfo} from './github-release-fixture.mjs';
const work=mkdtempSync(join(tmpdir(),'capir-contract-tests-'));after(()=>rmSync(work,{recursive:true,force:true}));
const sha='c'.repeat(40),environment={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'getyak/capir',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'getyak/capir/.github/workflows/release-capir.yml@refs/heads/main',GITHUB_RUN_ID:'123456',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:sha,GH_TOKEN:'SYNTHETIC_JOB_TOKEN'};
let sequence=0;
const options=mock=>({...mock,env:{...environment},receiptDir:join(work,'case-'+sequence++)});
test('real contract orchestration exercises ID assets, fresh draft discovery and exact cleanup without publishing',async()=>{
 const mock=githubFixture(sha),o=options(mock),result=await runContract(o);
 assert.equal(result.result,'passed');assert.equal(result.cleanup,'response-bound-draft-deleted-and-404-verified');assert.equal(mock.releases.size,0);assert.equal(mock.refs.size,0);
 assert.equal(result.existing_draft_rediscovered,true);assert.equal(result.fixture.binary_verified,true);assert.equal(result.asset_delete_and_reupload_verified,true);
 assert.ok(mock.calls.some(args=>args[0]==='release'&&args[1]==='view'));assert.ok(mock.calls.some(args=>requestInfo(args)?.method==='DELETE'&&requestInfo(args)?.path.includes('/assets/')));
 for(const args of mock.calls){const req=requestInfo(args);assert.ok(!args.includes('auth'));assert.ok(!req?.path.includes('capir-stable'));}
 for(const filename of readdirSync(o.receiptDir).filter(x=>x.endsWith('.json'))){const fd=openSync(join(o.receiptDir,filename),'r');try{assert.equal(fstatSync(fd).mode&0o777,0o600);assert.ok(!readFileSync(fd,'utf8').includes('SYNTHETIC_JOB_TOKEN'));}finally{closeSync(fd);}}
 assert.equal(result.api_version,'2026-03-10');assert.equal(result.gh_version,'2.97.0');
});
for(const [key,value]of Object.entries({GITHUB_ACTIONS:'false',GITHUB_EVENT_NAME:'push',GITHUB_REPOSITORY:'other/repo',GITHUB_REF:'refs/heads/feature',GITHUB_WORKFLOW_REF:'other/path',GITHUB_RUN_ID:'0',GITHUB_RUN_ATTEMPT:'0',GITHUB_SHA:'not-a-sha',GH_TOKEN:''}))test(`invalid ${key} fails before IO`,async()=>{
 const env={...environment,[key]:value};let invoked=false;await assert.rejects(runContract({env,receiptDir:join(work,'invalid'),gh:()=>{invoked=true;}}));assert.equal(invoked,false);
});
test('unexpected pre-existing probe is not adopted or deleted',async()=>{
 const mock=githubFixture(sha),o=options(mock),context=contractContext(environment);
 mock.gh(['api','--include','--hostname','github.com','--method','POST','repos/getyak/capir/releases'],{input:JSON.stringify({tag_name:context.tag,target_commitish:sha,name:'unexpected',body:'',draft:true,make_latest:'false'})});
 const before=mock.calls.length,result=await runContract(o);assert.equal(result.result,'failed');assert.equal(result.cleanup,'not-created');assert.equal(mock.releases.size,1);
 assert.ok(!mock.calls.slice(before).some(args=>['POST','PATCH','DELETE'].includes(requestInfo(args)?.method)));
});
test('failed fresh installation-token rediscovery stops writes and cleans only the response-owned draft',async()=>{
 const mock=githubFixture(sha),o=options(mock);o.gh=(args,init)=>args[0]==='release'&&mock.releases.size?{code:1,stdout:'',notFound:true}:mock.gh(args,init);
 const result=await runContract(o);assert.equal(result.result,'failed');assert.equal(result.failure_stage,'fresh-client-draft-rediscovery');assert.equal(result.cleanup,'response-bound-draft-deleted-and-404-verified');assert.equal(mock.releases.size,0);
 assert.ok(!mock.calls.some(args=>{const path=requestInfo(args)?.path;return path!==undefined&&new URL(path,'https://api.github.com').origin==='https://uploads.github.com';}));
});
test('binary failure is never a passing contract even after confirmed cleanup',async()=>{
 const mock=githubFixture(sha),o=options(mock);o.downloadAsset=async()=>{throw new Error('synthetic');};const result=await runContract(o);assert.equal(result.result,'failed');assert.equal(result.failure_stage,'upload-download-fixture');assert.equal(result.cleanup,'response-bound-draft-deleted-and-404-verified');assert.equal(mock.releases.size,0);
});
test('cleanup denial preserves the bound ID and fails the whole contract',async()=>{
 const mock=githubFixture(sha),o=options(mock);o.gh=(args,init)=>requestInfo(args)?.method==='DELETE'&&!requestInfo(args)?.path.includes('/assets/')?mock.response(403,{}):mock.gh(args,init);
 const result=await runContract(o);assert.equal(result.result,'failed');assert.equal(result.cleanup,'unconfirmed');assert.equal(typeof result.release_id,'number');assert.equal(mock.releases.size,1);
});
test('receipt failure after create prevents even cleanup mutations and reports the bound ID',async()=>{
 const mock=githubFixture(sha),o=options(mock);o.saveReceipt=()=>{throw new Error('disk-full');};const result=await runContract(o);
 assert.equal(result.result,'failed');assert.equal(result.cleanup,'blocked-by-receipt-write-failure');assert.equal(typeof result.release_id,'number');assert.equal(mock.releases.size,1);
 assert.equal(mock.calls.filter(args=>['POST','PATCH','DELETE'].includes(requestInfo(args)?.method)).length,1);
});
test('an unexpected asset in the probe is preserved and blocks whole-release cleanup',async()=>{
 const mock=githubFixture(sha),o=options(mock);let changed=false;
 o.downloadAsset=async(...args)=>{await mock.downloadAsset(...args);const r=[...mock.releases.values()][0];r.assets.set('foreign',Buffer.from('x'));r.records.set('foreign',{id:99999,name:'foreign',size:1,state:'uploaded'});changed=true;};
 const result=await runContract(o);assert.equal(changed,true);assert.equal(result.result,'failed');assert.equal(result.cleanup,'unconfirmed');assert.ok([...mock.releases.values()][0].assets.has('foreign'));
});
test('a malformed create response does not claim no creation or guess a cleanup ID',async()=>{
 const mock=githubFixture(sha),o=options(mock);
 o.gh=(args,init)=>{const result=mock.gh(args,init),info=requestInfo(args);if(info?.method==='POST'&&info.path==='repos/getyak/capir/releases'){
  const body=JSON.parse(result.stdout.split('\n\n')[1]);body.id='opaque';return mock.response(201,body);
 }return result;};
 const result=await runContract(o);assert.equal(result.result,'failed');assert.equal(result.cleanup,'creation-unconfirmed-no-bound-id');assert.equal(mock.releases.size,1);assert.ok(!mock.calls.some(args=>requestInfo(args)?.method==='DELETE'));
});
test('a moved main after cleanup fails acceptance while preserving confirmed cleanup evidence',async()=>{
 const mock=githubFixture(sha),o=options(mock);let reads=0;
 o.gh=(args,init)=>{if(requestInfo(args)?.path==='repos/getyak/capir/git/ref/heads/main'&&++reads===2)return mock.response(200,{object:{type:'commit',sha:'d'.repeat(40)}});return mock.gh(args,init);};
 const result=await runContract(o);assert.equal(result.result,'failed');assert.equal(result.failure_stage,'final-main-readback');assert.equal(result.cleanup,'response-bound-draft-deleted-and-404-verified');assert.equal(mock.releases.size,0);
});
