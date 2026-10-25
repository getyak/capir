/** Synthetic installation-token provider. REST tag/list hide drafts;
 * GraphQL-backed view and response-bound ID endpoints expose them. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function requestInfo(args){
 if(args[0]!=='api')return null;
 const index=args.indexOf('--method');
 return index<0?null:{method:args[index+1],path:args[index+2]};
}
export function githubFixture(commit='c'.repeat(40)){
 const releases=new Map(),refs=new Map(),calls=[];let nextId=1000,nextAssetId=2000,failed,moveAfterUpload=false;
 const response=(status,body)=>({code:status>=200&&status<300?0:1,stdout:`HTTP/2.0 ${status}\nContent-Type: application/json\n\n${body===undefined?'':JSON.stringify(body)}`});
 const metadata=(tag,r)=>({id:r.id,tag_name:tag,draft:r.draft,name:r.name,body:r.body,target_commitish:r.target_commitish,assets:[...r.records.values()]});
 const findId=id=>[...releases].find(([,r])=>r.id===id);
 const findAsset=id=>{for(const [tag,r]of releases)for(const [name,a]of r.records)if(a.id===id)return {tag,r,name,asset:a};};
 const gh=(args,options={})=>{
  calls.push([...args]);
  if(args[0]==='--version')return {code:0,stdout:'gh version 2.97.0 (synthetic)\n'};
  if(args[0]==='release'&&args[1]==='view'){
   const tag=args[2],r=releases.get(tag);
   return r?{code:0,stdout:JSON.stringify({apiUrl:`https://api.github.com/repos/getyak/capir/releases/${r.id}`,tagName:tag,isDraft:r.draft})}:{code:1,stdout:'',notFound:true};
  }
  const info=requestInfo(args);assert.ok(info,'only the ID adapter may invoke the synthetic provider');
  const {method,path}=info,body=options.input?JSON.parse(options.input):undefined;
  if(path==='repos/getyak/capir/git/ref/heads/main')return response(200,{object:{type:'commit',sha:commit}});
  if(path.startsWith('repos/getyak/capir/git/ref/tags/')){
   const tag=path.split('/').at(-1),sha=refs.get(tag)??(tag.startsWith('capir-contract-')?undefined:commit);
   return sha?response(200,{object:{type:'commit',sha}}):response(404,{});
  }
  if(path.startsWith('repos/getyak/capir/releases/tags/')){
   const tag=path.split('/').at(-1),r=releases.get(tag);
   return r&&!r.draft?response(200,metadata(tag,r)):response(404,{});
  }
  if(path==='repos/getyak/capir/releases'&&method==='POST'){
   assert.equal(body.draft,true);assert.equal(body.make_latest,'false');
   if(releases.has(body.tag_name))return response(422,{});
   const r={id:nextId++,draft:true,body:body.body,name:body.name,target_commitish:body.target_commitish,assets:new Map(),records:new Map()};releases.set(body.tag_name,r);
   return response(201,metadata(body.tag_name,r));
  }
  const releasePath=/^repos\/getyak\/capir\/releases\/(\d+)$/.exec(path);
  if(releasePath){
   const found=findId(Number(releasePath[1]));if(!found)return response(404,{});
   const [tag,r]=found;
   if(method==='GET')return response(200,metadata(tag,r));
   if(method==='PATCH'){
    assert.equal(body.make_latest,'false');assert.ok(r.draft||tag==='capir-stable','published version writes are forbidden');
    assert.ok(!tag.startsWith('capir-contract-')||body.draft!==false,'a probe must never publish');
    for(const key of ['draft','body','name'])if(Object.hasOwn(body,key))r[key]=body[key];
    if(!r.draft)refs.set(tag,r.target_commitish);
    return response(200,metadata(tag,r));
   }
   if(method==='DELETE'){assert.ok(tag.startsWith('capir-contract-'),'production releases must never be deleted');releases.delete(tag);return response(204);}
  }
  const upload=/^https:\/\/uploads\.github\.com\/repos\/getyak\/capir\/releases\/(\d+)\/assets\?name=([^&]+)$/.exec(path);
  if(upload&&method==='POST'){
   const found=findId(Number(upload[1]));if(!found)return response(404,{});
   const [tag,r]=found,name=decodeURIComponent(upload[2]);assert.ok(r.draft||tag==='capir-stable');assert.ok(!r.assets.has(name),'clobber must be an explicit scoped asset ID deletion');
   const bytes=readFileSync(args[args.indexOf('--input')+1]);
   if(failed?.tag===tag){failed.remaining--;if(failed.remaining===0&&failed.before){failed=null;return response(500,{});}}
   const asset={id:nextAssetId++,name,size:bytes.length,state:'uploaded',digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};r.assets.set(name,bytes);r.records.set(name,asset);
   if(moveAfterUpload&&tag!=='capir-stable')refs.set(tag,'d'.repeat(40));
   if(failed?.tag===tag&&failed.remaining===0){failed=null;return response(500,{});}
   return response(201,asset);
  }
  const assetPath=/^repos\/getyak\/capir\/releases\/assets\/(\d+)$/.exec(path);
  if(assetPath&&method==='DELETE'){
   const found=findAsset(Number(assetPath[1]));if(!found)return response(404,{});
   assert.ok(found.r.draft||found.tag==='capir-stable');found.r.assets.delete(found.name);found.r.records.delete(found.name);return response(204);
  }
  throw new Error('unexpected synthetic GitHub operation');
 };
 const downloadAsset=async(id,file,maxBytes)=>{
  const found=findAsset(id);assert.ok(found);const bytes=found.r.assets.get(found.name);assert.ok(bytes.length<=maxBytes);writeFileSync(file,bytes,{mode:0o600});calls.push(['DOWNLOAD',id]);return {bytes:bytes.length,transport_exit_code:0};
 };
 const fetchImpl=async url=>{const p=new URL(url).pathname.split('/'),bytes=releases.get(p.at(-2))?.assets.get(p.at(-1));return new Response(bytes??'missing',{status:bytes?200:404});};
 return {gh,downloadAsset,fetchImpl,releases,refs,calls,response,findId,findAsset,fail:(tag,after)=>{failed={tag,remaining:after,before:false};},failBefore:(tag,before)=>{failed={tag,remaining:before,before:true};},move:()=>{moveAfterUpload=true;}};
}
