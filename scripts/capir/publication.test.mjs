import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { buildManifest, signManifest, SUPPORTED_PLATFORMS } from './manifest.mjs';
import { strictVersion, verifyCohort, promotionDecision, publishRelease } from './publication.mjs';

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
  return { version,tag:`capir-v${version}`,commit,nodeVersion,archivesDir:dir,manifestDir:dir,installer,publicKeyFile:keyFile };
}
function mockGitHub() {
  const releases=new Map(), calls=[], refs=new Map(); let failUpload=null, moveAfterUpload=false, failBeforeUpload=null;
  const response=(status,body)=>({code:status===200?0:1,stdout:`HTTP/2.0 ${status}\nContent-Type: application/json\n\n${JSON.stringify(body)}`});
  const gh=args=>{
    calls.push([...args]);
    if(args[0]==='api') {
      if(args[1]==='--include') {
        const tag=args[2].split('/').at(-1), release=releases.get(tag);
        return release?response(200,{draft:release.draft,body:release.body,assets:[...release.assets.keys()].map(name=>({name}))}):response(404,{message:'Not Found'});
      }
      const tag=args[1].split('/').at(-1);return {code:0,stdout:JSON.stringify({object:{type:'commit',sha:refs.get(tag)??commit}})};
    }
    const command=args[1],tag=args[2];let release=releases.get(tag);
    if(command==='create') { assert.ok(!release); releases.set(tag,{draft:args.includes('--draft'),body:args.includes('--notes-file')?readFileSync(args[args.indexOf('--notes-file')+1],'utf8'):'',assets:new Map()}); }
    else if(command==='upload') {
      assert.ok(release); assert.ok(tag==='capir-stable'||release.draft,'published version writes are forbidden');
      const files=args.slice(args.indexOf('--repo')+2).filter(arg=>!arg.startsWith('--'));
      let count=0;
      for(const file of files) {
        if(release.assets.has(basename(file)))assert.ok(args.includes('--clobber'));
        release.assets.delete(basename(file));
        count++;
        if(failBeforeUpload?.tag===tag&&count===failBeforeUpload.before){failBeforeUpload=null;return {code:1,stdout:''};}
        release.assets.set(basename(file),readFileSync(file));
        if(failUpload?.tag===tag&&count===failUpload.after){failUpload=null;return {code:1,stdout:''};}
      }
      if(moveAfterUpload&&tag!=='capir-stable')refs.set(tag,'d'.repeat(40));
    } else if(command==='download') {
      const dir=args[args.indexOf('--dir')+1];mkdirSync(dir,{recursive:true});
      for(let i=0;i<args.length;i++)if(args[i]==='--pattern') {
        const name=args[++i];assert.ok(release?.assets.has(name));writeFileSync(join(dir,name),release.assets.get(name));
      }
    } else if(command==='edit') {assert.ok(release);if(args.includes('--draft=false'))release.draft=false;if(args.includes('--notes-file'))release.body=readFileSync(args[args.indexOf('--notes-file')+1],'utf8');assert.ok(args.includes('--latest=false'));}
    else throw new Error('unexpected mock gh operation');
    return {code:0,stdout:''};
  };
  const fetchImpl=async url=>{
    const parts=new URL(url).pathname.split('/'),tag=parts.at(-2),name=parts.at(-1),bytes=releases.get(tag)?.assets.get(name);
    return new Response(bytes??'missing',{status:bytes?200:404});
  };
  return {gh,fetchImpl,releases,calls,fail:(tag,after)=>{failUpload={tag,after};},failBefore:(tag,before)=>{failBeforeUpload={tag,before};},move:()=>{moveAfterUpload=true;}};
}

test('release versions reject malformed values before any shell or publication operation',()=>{
  assert.equal(strictVersion('0.2.1'),'0.2.1');
  for(const value of ['1.2','01.2.3','1.2.3\n','1.2.3; echo value','1.2.3$(id)','9007199254740992.1.1'])assert.throws(()=>strictVersion(value));
});
test('a partial draft upload can be rebuilt and published as one fully verified cohort',async()=>{
  const mock=mockGitHub(),first=cohort('1.0.0','partial-a');mock.fail(first.tag,2);
  await assert.rejects(publishRelease(first,mock),/GitHub operation failed/);
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
  await publishRelease(rebuilt,mock);assert.deepEqual(mock.releases.get(first.tag).assets,before);
});
test('replaying an older published release cannot downgrade the stable channel',async()=>{
  const mock=mockGitHub(),a=cohort('1.2.0','older'),b=cohort('1.2.1','newer');await publishRelease(a,mock);await publishRelease(b,mock);
  const before=new Map(mock.releases.get('capir-stable').assets),result=await publishRelease(a,mock);
  assert.equal(result.channel_promoted,false);assert.equal(result.stable,'1.2.1');assert.deepEqual(mock.releases.get('capir-stable').assets,before);
});
test('a partial channel upload is repaired using the immutable published cohort',async()=>{
  const mock=mockGitHub(),a=cohort('1.3.0','a'),b=cohort('1.3.1','b');await publishRelease(a,mock);mock.fail('capir-stable',1);
  await assert.rejects(publishRelease(b,mock),/GitHub operation failed/);
  const retry=cohort('1.3.1','rebuilt'),result=await publishRelease(retry,mock);
  assert.equal(result.stable,'1.3.1');assert.deepEqual(mock.releases.get('capir-stable').assets.get('manifest.json'),mock.releases.get(b.tag).assets.get('manifest.json'));
});
test('tag movement before publication preserves the complete draft and never promotes it',async()=>{
  const mock=mockGitHub(),a=cohort('1.4.0','move');mock.move();
  await assert.rejects(publishRelease(a,mock),/tag moved/);assert.equal(mock.releases.get(a.tag).draft,true);assert.equal(mock.releases.has('capir-stable'),false);
});
test('a transient metadata error is not mistaken for a missing release',async()=>{
  const mock=mockGitHub(),a=cohort('1.5.0','metadata');
  const gh=args=>args[0]==='api'&&args[1]==='--include'?{code:1,stdout:'HTTP/2.0 503\n\n{}'}:mock.gh(args);
  await assert.rejects(publishRelease(a,{gh,fetchImpl:mock.fetchImpl}),/HTTP 503/);assert.equal(mock.releases.size,0);
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
  await assert.rejects(publishRelease(b,mock),/GitHub operation failed/);
  const oldResult=await publishRelease(a,mock);
  assert.equal(oldResult.channel_promoted,false);assert.equal(oldResult.stable,b.version);
  const retry=cohort(b.version,'rebuilt'), result=await publishRelease(retry,mock);
  assert.equal(result.stable,b.version);
  for(const name of ['manifest.json','manifest.json.sig','install.sh']) assert.deepEqual(mock.releases.get('capir-stable').assets.get(name),mock.releases.get(b.tag).assets.get(name));
});
test('an initial channel draft with no assets resumes from its verified checkpoint', async () => {
  const mock=mockGitHub(), a=cohort('2.4.0','first');mock.failBefore('capir-stable',1);
  await assert.rejects(publishRelease(a,mock),/GitHub operation failed/);
  assert.equal(mock.releases.get('capir-stable').assets.size,0);
  const result=await publishRelease(a,mock);assert.equal(result.stable,a.version);
  assert.equal(mock.releases.get('capir-stable').draft,false);
});
