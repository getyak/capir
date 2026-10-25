import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {realDownloadAsset,durableReceipt,positiveId} from './github-release-provider.mjs';
const work=mkdtempSync(join(tmpdir(),'capir-provider-tests-'));after(()=>rmSync(work,{recursive:true,force:true}));
test('safe response receipts are atomically private JSON files',()=>{
 const path=join(work,'receipt.json');durableReceipt(path,{id:123,tag:'capir-v0.2.4'});assert.equal(statSync(path).mode&0o777,0o600);assert.deepEqual(JSON.parse(readFileSync(path)),{id:123,tag:'capir-v0.2.4'});
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
