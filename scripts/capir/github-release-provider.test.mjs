import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,statSync,openSync,fstatSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GitHubReleaseProvider,realDownloadAsset,durableReceipt,positiveId} from './github-release-provider.mjs';
import {githubFixture,requestInfo} from './github-release-fixture.mjs';
const work=mkdtempSync(join(tmpdir(),'capir-provider-tests-'));after(()=>rmSync(work,{recursive:true,force:true}));
test('safe response receipts are atomically private JSON files',()=>{
 const path=join(work,'receipt.json');durableReceipt(path,{id:123,tag:'capir-v0.2.4'});const fd=openSync(path,'r');
 try{assert.equal(fstatSync(fd).mode&0o777,0o600);assert.deepEqual(JSON.parse(readFileSync(fd)),{id:123,tag:'capir-v0.2.4'});}finally{closeSync(fd);}
});
const commit='c'.repeat(40),probeTag='capir-contract-123456-2';let sequence=0;
function editable(tag=probeTag){
 const mock=githubFixture(commit),patches=[];
 const provider=new GitHubReleaseProvider({...mock,receiptDir:join(work,'edit-'+sequence++),gh:(args,options)=>{
  if(requestInfo(args)?.method==='PATCH')patches.push(JSON.parse(options.input));
  return mock.gh(args,options);
 }});
 const release=provider.create({tag,commit,name:'synthetic',body:'synthetic'});
 return {mock,patches,provider,release};
}
test('fixture reproduces the observed omitted-tag draft alias without source drift',()=>{
 const {mock,release}=editable();
 const response=mock.gh(['api','--method','PATCH',`repos/getyak/capir/releases/${release.id}`],{input:JSON.stringify({body:'edited',make_latest:'false'})});
 const current=JSON.parse(response.stdout.split('\n\n')[1]);
 assert.equal(current.tag_name,`untagged-synthetic-${release.id}`);assert.equal(current.target_commitish,commit);
 assert.equal(current.draft,true);assert.equal(mock.releases.has(probeTag),false);
});
for(const [tag,draft,channel]of [[probeTag,true,false],['capir-v0.2.4',false,false],['capir-stable',false,true]])test(`editing ${tag} binds its current tag and source explicitly`,()=>{
 const {provider,release,patches}=editable(tag);
 const edited=provider.edit(release,{body:'edited',draft},{channel});
 assert.equal(edited.tag_name,tag);assert.equal(edited.target_commitish,commit);assert.equal(edited.draft,draft);
 assert.deepEqual(patches,[{body:'edited',draft,tag_name:tag,target_commitish:commit,make_latest:'false'}]);
});
test('published stable checkpoint edits retain the channel source and identity',()=>{
 const {provider,release,patches}=editable('capir-stable');
 const published=provider.edit(release,{draft:false},{channel:true});patches.length=0;
 const edited=provider.edit({...published,target_commitish:'d'.repeat(40)},{body:'next checkpoint'},{channel:true});
 assert.equal(edited.draft,false);assert.equal(edited.target_commitish,commit);
 assert.deepEqual(patches,[{body:'next checkpoint',tag_name:'capir-stable',target_commitish:commit,make_latest:'false'}]);
});
for(const field of ['tag_name','target_commitish'])test(`edit caller cannot override ${field} before any PATCH`,()=>{
 const {provider,release,patches}=editable();
 assert.throws(()=>provider.edit(release,{body:'edited',[field]:field==='tag_name'?'capir-v9.9.9':'d'.repeat(40)}),/identity/);
 assert.equal(patches.length,0);
});
test('published version edits remain forbidden without any PATCH',()=>{
 const {provider,release,patches}=editable('capir-v0.2.4'),published=provider.edit(release,{draft:false});patches.length=0;
 assert.throws(()=>provider.edit(published,{body:'changed'}),/Published version/);assert.equal(patches.length,0);
});
for(const source of [undefined,null,'main','d'.repeat(39)])test(`invalid current source ${source} stops before PATCH`,()=>{
 const {mock,provider,release,patches}=editable();mock.releases.get(probeTag).target_commitish=source;
 assert.throws(()=>provider.edit(release,{body:'edited',draft:true}),/source binding/);assert.equal(patches.length,0);
});
test('an unavailable pre-edit read cannot authorize a PATCH',()=>{
 const {mock,provider,release,patches}=editable();provider.gh=()=>mock.response(503,{});
 assert.throws(()=>provider.edit(release,{draft:true}),/HTTP 503/);assert.equal(patches.length,0);
});
for(const stage of ['response','readback'])for(const field of ['id','tag_name','target_commitish','draft'])test(`edit ${stage} with mismatched ${field} is rejected`,()=>{
 const {mock,provider,release}=editable();let patched=false;
 provider.gh=(args,options)=>{
  const result=mock.gh(args,options),method=requestInfo(args)?.method;
  if(method==='PATCH')patched=true;
  if((stage==='response'&&method==='PATCH')||(stage==='readback'&&patched&&method==='GET')){
   const value=JSON.parse(result.stdout.split('\n\n')[1]);
   value[field]={id:99999,tag_name:'capir-v9.9.9',target_commitish:'d'.repeat(40),draft:false}[field];
   return mock.response(200,value);
  }
  return result;
 };
 assert.throws(()=>provider.edit(release,{body:'edited',draft:true}),/binding mismatch/);
 assert.equal(mock.calls.filter(args=>requestInfo(args)?.method==='PATCH').length,1);
});
for(const id of [0,-1,1.5,NaN,Infinity,'12','../../other',Number.MAX_SAFE_INTEGER+1])test(`invalid numeric ID ${id} cannot start a binary transport`,async()=>{
 const path=join(work,'invalid-'+String(id).replace(/\W/g,'x'));assert.equal(positiveId(id),false);await assert.rejects(realDownloadAsset(id,path,16),/bound/);assert.equal(existsSync(path),false);
});
test('binary transport preserves NUL/ESC/non-UTF8 bytes, strips the signing secret and enforces its byte cap',async()=>{
 const fake=join(work,'gh');
 writeFileSync(fake,'#!/usr/bin/env node\nif(process.env.CAPIR_RELEASE_SIGNING_KEY!==undefined)process.exit(91);process.stdout.write(process.env.CAPIR_TEST_OVERSIZE?Buffer.alloc(65536,7):Buffer.from([0,27,255,127,13,10,128,1]));\n',{mode:0o755});
 const oldPath=process.env.PATH,oldSigning=process.env.CAPIR_RELEASE_SIGNING_KEY,oldOversize=process.env.CAPIR_TEST_OVERSIZE;
 try{
  process.env.PATH=work+':'+oldPath;process.env.CAPIR_RELEASE_SIGNING_KEY='SYNTHETIC_ONLY';delete process.env.CAPIR_TEST_OVERSIZE;
  const file=join(work,'binary.bin'),result=await realDownloadAsset(123,file,8);assert.equal(result.bytes,8);assert.deepEqual(readFileSync(file),Buffer.from([0,27,255,127,13,10,128,1]));assert.equal(statSync(file).mode&0o777,0o600);
  process.env.CAPIR_TEST_OVERSIZE='1';const oversized=join(work,'oversized.bin');await assert.rejects(realDownloadAsset(123,oversized,8),/download failed/);assert.equal(existsSync(oversized),false);
 }finally{
  process.env.PATH=oldPath;
  if(oldSigning===undefined)delete process.env.CAPIR_RELEASE_SIGNING_KEY;else process.env.CAPIR_RELEASE_SIGNING_KEY=oldSigning;
  if(oldOversize===undefined)delete process.env.CAPIR_TEST_OVERSIZE;else process.env.CAPIR_TEST_OVERSIZE=oldOversize;
 }
});
