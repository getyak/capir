import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { buildManifest, signManifest, SUPPORTED_PLATFORMS } from './manifest.mjs';
import { strictVersion, verifyCohort, promotionDecision, publishRelease } from './publication.mjs';
import {githubFixture,requestInfo} from './github-release-fixture.mjs';

const work=mkdtempSync(join(tmpdir(),'capir-publication-test-'));
after(()=>rmSync(work,{recursive:true,force:true}));
const { publicKey, privateKey }=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const keyFile=join(work,'public-key.txt');writeFileSync(keyFile,publicKey);
const installer=join(work,'install.sh');writeFileSync(installer,'#!/bin/sh\necho fixture\n');
const commit='c'.repeat(40), nodeVersion='22.23.2';
function cohort(version,salt) {
  const dir=join(work,version+'-'+salt);mkdirSync(dir);
  const assets=SUPPORTED_PLATFORMS.map(platform=>{
    const bytes=Buffer.from(platform+salt),filename=`capir-${version}-${platform}.tar.gz`;
    writeFileSync(join(dir,filename),bytes);
    return {platform,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  });
  const text=buildManifest({version,sourceCommit:commit,nodeVersion,assets});
  writeFileSync(join(dir,'manifest.json'),text);writeFileSync(join(dir,'manifest.json.sig'),signManifest(text,privateKey));
  writeFileSync(join(dir,'install.sh'),readFileSync(installer));
  return { version,tag:`capir-v${version}`,commit,nodeVersion,archivesDir:dir,manifestDir:dir,installer,publicKeyFile:keyFile,receiptDir:join(dir,'receipts') };
}
const mockGitHub=()=>githubFixture(commit);

test('release versions reject malformed values before any shell or publication operation',()=>{
  assert.equal(strictVersion('0.2.1'),'0.2.1');
  for(const value of ['1.2','01.2.3','1.2.3\n','1.2.3; echo value','1.2.3$(id)','9007199254740992.1.1'])assert.throws(()=>strictVersion(value));
});
test('installation-token REST tag/list blindness uses response IDs through a complete first publication',async()=>{
  const mock=mockGitHub(),a=cohort('0.2.4','installation-token-contract');
  const result=await publishRelease(a,mock);assert.equal(result.stable,a.version);assert.equal(mock.releases.get(a.tag).draft,false);assert.equal(mock.releases.get(a.tag).assets.size,7);
  assert.ok(!mock.calls.some(args=>args.includes('--paginate')),'REST release listings cannot discover installation-token drafts');
  const actions=mock.calls.map(requestInfo),versionPublished=actions.findIndex(x=>x?.method==='PATCH'&&x.path.endsWith('/'+mock.releases.get(a.tag).id));
  const stableCreated=actions.findIndex((x,i)=>x?.method==='POST'&&x.path==='repos/getyak/capir/releases'&&i>versionPublished);
  assert.ok(versionPublished>=0&&stableCreated>versionPublished);
});
test('a partial draft upload can be rebuilt and published as one fully verified cohort',async()=>{
  const mock=mockGitHub(),first=cohort('1.0.0','partial-a');mock.fail(first.tag,2);
  await assert.rejects(publishRelease(first,mock),/GitHub POST operation failed/);
  assert.equal(mock.releases.get(first.tag).draft,true);
  assert.equal(mock.releases.has('capir-stable'),false);
  const rebuilt=cohort('1.0.0','partial-b'),result=await publishRelease(rebuilt,mock);
  assert.equal(result.stable,'1.0.0');assert.equal(mock.releases.get(first.tag).assets.size,7);assert.equal(mock.releases.get(first.tag).draft,false);
  assert.deepEqual(mock.releases.get(first.tag).assets.get('manifest.json'),readFileSync(join(rebuilt.manifestDir,'manifest.json')));
});
test('a full rerun reuses published bytes despite rebuilding different archive bytes',async()=>{
  const mock=mockGitHub(),first=cohort('1.1.0','original');await publishRelease(first,mock);
  const before=new Map(mock.releases.get(first.tag).assets),rebuilt=cohort('1.1.0','rebuilt');
  assert.notDeepEqual(readFileSync(join(first.manifestDir,'manifest.json')),readFileSync(join(rebuilt.manifestDir,'manifest.json')));
  const earlierCalls=mock.calls.length;
  await publishRelease(rebuilt,mock);assert.deepEqual(mock.releases.get(first.tag).assets,before);
  assert.ok(!mock.calls.slice(earlierCalls).some(args=>requestInfo(args)?.method==='POST'&&requestInfo(args)?.path.includes('/'+mock.releases.get(first.tag).id+'/assets?')));
  assert.ok(!mock.calls.slice(earlierCalls).some(args=>args[0]==='release'&&args[1]==='view'),'published metadata uses the tag endpoint without listing drafts');
});
test('replaying an older published release cannot downgrade the stable channel',async()=>{
  const mock=mockGitHub(),a=cohort('1.2.0','older'),b=cohort('1.2.1','newer');await publishRelease(a,mock);await publishRelease(b,mock);
  const before=new Map(mock.releases.get('capir-stable').assets),result=await publishRelease(a,mock);
  assert.equal(result.channel_promoted,false);assert.equal(result.stable,'1.2.1');assert.deepEqual(mock.releases.get('capir-stable').assets,before);
});
test('a partial channel upload is repaired using the immutable published cohort',async()=>{
  const mock=mockGitHub(),a=cohort('1.3.0','a'),b=cohort('1.3.1','b');await publishRelease(a,mock);mock.fail('capir-stable',1);
  await assert.rejects(publishRelease(b,mock),/GitHub POST operation failed/);
  const retry=cohort('1.3.1','rebuilt'),result=await publishRelease(retry,mock);
  assert.equal(result.stable,'1.3.1');assert.deepEqual(mock.releases.get('capir-stable').assets.get('manifest.json'),mock.releases.get(b.tag).assets.get('manifest.json'));
});
test('tag movement before publication preserves the complete draft and never promotes it',async()=>{
  const mock=mockGitHub(),a=cohort('1.4.0','move');mock.move();
  await assert.rejects(publishRelease(a,mock),/tag moved/);assert.equal(mock.releases.get(a.tag).draft,true);assert.equal(mock.releases.has('capir-stable'),false);
});
test('a mismatched version publication response stops before any stable write',async()=>{
 const mock=mockGitHub(),a=cohort('1.4.1','edit-tag-drift');
 const gh=(args,options)=>{
  const response=mock.gh(args,options);
  if(requestInfo(args)?.method==='PATCH'){
   const body=JSON.parse(response.stdout.split('\n\n')[1]);body.tag_name='untagged-synthetic';return mock.response(200,body);
  }
  return response;
 };
 await assert.rejects(publishRelease(a,{...mock,gh}),/binding mismatch/);
 assert.equal(mock.releases.has('capir-stable'),false);assert.equal(mock.releases.get(a.tag).assets.size,7);
 assert.equal(mock.calls.filter(args=>requestInfo(args)?.method==='PATCH').length,1);
});
test('a transient metadata error is not mistaken for a missing release',async()=>{
 const mock=mockGitHub(),a=cohort('1.5.0','metadata');
 const gh=(args,options)=>requestInfo(args)?.path.includes('/releases/tags/')?mock.response(503,{}):mock.gh(args,options);
 await assert.rejects(publishRelease(a,{...mock,gh}),/HTTP 503/);assert.equal(mock.releases.size,0);
});
for(const mode of ['wrong-id','wrong-tag','wrong-source','published','unexpected-assets'])test(`create response ${mode} stops without asset writes`,async()=>{
 const mock=mockGitHub(),a=cohort('3.0.'+['wrong-id','wrong-tag','wrong-source','published','unexpected-assets'].indexOf(mode),'create-'+mode);
 const gh=(args,options)=>{
  const result=mock.gh(args,options),info=requestInfo(args);
  if(info?.method!=='POST'||info.path!=='repos/getyak/capir/releases')return result;
  const split=result.stdout.indexOf('\n\n'),body=JSON.parse(result.stdout.slice(split+2));
  if(mode==='wrong-id')body.id='opaque-node-id';if(mode==='wrong-tag')body.tag_name='capir-v9.9.9';if(mode==='wrong-source')body.target_commitish='d'.repeat(40);if(mode==='published')body.draft=false;if(mode==='unexpected-assets')body.assets=[{id:123,name:'unexpected',size:1}];
  return mock.response(201,body);
 };
 await assert.rejects(publishRelease(a,{...mock,gh}),/binding/);assert.equal(mock.releases.get(a.tag).assets.size,0);assert.equal(mock.releases.has('capir-stable'),false);
});
for(const mode of ['id','tag','draft','apiUrl','unavailable'])test(`fresh draft discovery ${mode} cannot authorize a retry`,async()=>{
 const mock=mockGitHub(),a=cohort('3.1.'+['id','tag','draft','apiUrl','unavailable'].indexOf(mode),'view-'+mode);mock.fail(a.tag,1);await assert.rejects(publishRelease(a,mock));
 const before=new Map(mock.releases.get(a.tag).assets);
 const gh=(args,options)=>{
  const result=mock.gh(args,options);if(args[0]!=='release'||args[1]!=='view')return result;
  if(mode==='unavailable')return {code:1,stdout:'',notFound:false};
  const value=JSON.parse(result.stdout);if(mode==='id')value.apiUrl=value.apiUrl.replace(/\d+$/,'999999');if(mode==='tag')value.tagName='capir-v9.9.9';if(mode==='draft')value.isDraft=false;if(mode==='apiUrl')value.apiUrl='https://attacker.invalid/releases/1000';return {code:0,stdout:JSON.stringify(value)};
 };
 await assert.rejects(publishRelease(a,{...mock,gh}),/discovery|binding|HTTP 404/);assert.deepEqual(mock.releases.get(a.tag).assets,before);
});
test('failure to persist the create acknowledgement stops subsequent mutations',async()=>{
 const mock=mockGitHub(),a=cohort('3.2.0','receipt-failure');
 await assert.rejects(publishRelease(a,{...mock,saveReceipt:()=>{throw new Error('synthetic');}}),/receipt could not be persisted/);
 assert.equal(mock.releases.get(a.tag).assets.size,0);assert.equal(mock.calls.filter(args=>requestInfo(args)?.method==='POST').length,1);
});
test('signed cohort verification rejects a corrupt archive and a wrong source commit',()=>{
  const a=cohort('1.6.0','tamper'),expected={version:a.version,commit,nodeVersion,publicKey,installer};
  assert.throws(()=>verifyCohort(a.archivesDir,{...expected,commit:'d'.repeat(40)}),/validated source/);
  writeFileSync(join(a.archivesDir,`capir-${a.version}-linux-x64.tar.gz`),'changed');assert.throws(()=>verifyCohort(a.archivesDir,expected),/asset verification/);
});
test('unauthenticated channel content cannot be accepted as a version decision',async()=>{
  const a=cohort('1.7.0','candidate');
  const candidate={manifestBytes:readFileSync(join(a.manifestDir,'manifest.json')),signature:readFileSync(join(a.manifestDir,'manifest.json.sig'))};
  const current={manifestBytes:Buffer.from('{"version":"1.7.1"}'),signature:Buffer.from('bad')};
  await assert.rejects(promotionDecision(candidate,current,publicKey,async()=>new Response('bad',{status:200})),/signature/);
});

for (const before of [1, 2, 3]) test(`channel recovery survives deletion before asset ${before} upload`, async () => {
  const mock=mockGitHub(), a=cohort(`2.${before}.0`,'a'), b=cohort(`2.${before}.1`,'b');
  await publishRelease(a,mock);mock.failBefore('capir-stable',before);
  await assert.rejects(publishRelease(b,mock),/GitHub POST operation failed/);
  const oldResult=await publishRelease(a,mock);
  assert.equal(oldResult.channel_promoted,false);assert.equal(oldResult.stable,b.version);
  const retry=cohort(b.version,'rebuilt'), result=await publishRelease(retry,mock);
  assert.equal(result.stable,b.version);
  for(const name of ['manifest.json','manifest.json.sig','install.sh']) assert.deepEqual(mock.releases.get('capir-stable').assets.get(name),mock.releases.get(b.tag).assets.get(name));
});
test('an initial channel draft with no assets resumes from its verified checkpoint', async () => {
  const mock=mockGitHub(), a=cohort('2.4.0','first');mock.failBefore('capir-stable',1);
  await assert.rejects(publishRelease(a,mock),/GitHub POST operation failed/);
  assert.equal(mock.releases.get('capir-stable').assets.size,0);
  const result=await publishRelease(a,mock);assert.equal(result.stable,a.version);
  assert.equal(mock.releases.get('capir-stable').draft,false);
});
