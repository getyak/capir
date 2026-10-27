/** GitHub release operations bind REST response IDs, never an opaque node ID.
 * https://docs.github.com/en/rest/releases/releases#create-a-release
 * https://docs.github.com/en/rest/releases/assets#get-a-release-asset
 * https://cli.github.com/manual/gh_release_view
 * REST lists can omit drafts for installation tokens; never infer absence
 * from a human token's visibility or decode GraphQL node IDs. */
import {execFileSync,spawn} from 'node:child_process';
import {openSync,writeSync,writeFileSync,fsyncSync,closeSync,renameSync,mkdirSync,unlinkSync,readFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
export const REPO='getyak/capir';
export const API_VERSION='2026-03-10';
const BASE=`repos/${REPO}/releases`;
export const positiveId=id=>Number.isSafeInteger(id)&&id>0;
const validTag=tag=>typeof tag==='string'&&/^(?:capir-v[0-9]+\.[0-9]+\.[0-9]+|capir-stable|capir-contract-[1-9][0-9]*-[1-9][0-9]*)$/.test(tag);
const validName=name=>typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name);
const childEnv=()=>{const env={...process.env,GH_HOST:'github.com'};delete env.CAPIR_RELEASE_SIGNING_KEY;return env;};
export function realGh(args,{input}={}){
 try{return {code:0,stdout:execFileSync('gh',args,{encoding:'utf8',env:childEnv(),input,stdio:['pipe','pipe','pipe'],timeout:720000,maxBuffer:1048576})};}
 catch(error){return {code:error.status??1,stdout:String(error.stdout??''),notFound:String(error.stderr??'').trim()==='release not found'};}
}
export function durableReceipt(path,value){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const temporary=path+`.tmp-${process.pid}`;let fd;
 try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,path);const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
 finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch{}}
}
/** gh owns the authenticated API redirect handling. Binary stdout goes only
 * to a bounded private file, never UTF-8 JSON capture or a terminal. */
export async function realDownloadAsset(id,file,maxBytes){
 if(!positiveId(id)||!Number.isSafeInteger(maxBytes)||maxBytes<=0||maxBytes>536870912)throw new Error('GitHub asset download bound is invalid');
 const fd=openSync(file,'wx',0o600);let child,bytes=0,timedOut=false,tooLarge=false,writeFailed=false;
 try{
  const code=await new Promise((resolve,reject)=>{
   child=spawn('gh',['api',`${BASE}/assets/${id}`,'--hostname','github.com','--header',`X-GitHub-Api-Version: ${API_VERSION}`,'--header','Accept: application/octet-stream','--allow-escape-sequences'],{env:childEnv(),stdio:['ignore','pipe','pipe']});
   const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},720000);timer.unref();
   child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){tooLarge=true;child.kill('SIGTERM');return;}try{let offset=0;while(offset<chunk.length){const n=writeSync(fd,chunk,offset,chunk.length-offset);if(n<=0)throw new Error();offset+=n;}}catch{writeFailed=true;child.kill('SIGTERM');}});
   child.stderr.resume(); // Never forward provider bodies/headers/credentials.
   child.once('error',()=>{clearTimeout(timer);reject(new Error('GitHub binary transport unavailable'));});
   child.once('close',code=>{clearTimeout(timer);resolve(code);});
  });
  if(code!==0||timedOut||tooLarge||writeFailed)throw new Error('GitHub binary asset download failed');
  fsyncSync(fd);return {bytes,transport_exit_code:0,http_status:'not-captured-by-gh-binary-transport'};
 }catch(error){try{unlinkSync(file);}catch{}throw error;}
 finally{closeSync(fd);}
}
export function validateRelease(body,tag,id,draft){
 if(!positiveId(body?.id)||body.tag_name!==tag||typeof body.draft!=='boolean'||!Array.isArray(body.assets)
  ||body.assets.some(a=>!positiveId(a?.id)||typeof a.name!=='string'||!Number.isSafeInteger(a.size)||a.size<0)
  ||(id!==undefined&&body.id!==id)||(draft!==undefined&&body.draft!==draft)
  ||(body.body!==undefined&&body.body!==null&&typeof body.body!=='string'))throw new Error('GitHub release metadata binding mismatch');
 return body;
}
export class GitHubReleaseProvider{
 constructor({gh=realGh,downloadAsset=realDownloadAsset,receiptDir,saveReceipt=durableReceipt,context={}}={}){
  this.gh=gh;this.binary=downloadAsset;this.receiptDir=receiptDir;this.saveReceipt=saveReceipt;this.context=context;
  this.operations=[];this.created=[];this.createdAssets=[];this.receiptHealthy=true;
 }
 persist(name,extra={}){
  if(!this.receiptDir)throw new Error('GitHub response receipt directory is required');
  const receipt={schema:1,at:new Date().toISOString(),repository:REPO,api_version:API_VERSION,...this.context,...extra,created:this.created,operations:this.operations,credentials_logged_or_saved:false};
  try{this.saveReceipt(join(this.receiptDir,name+'.json'),receipt);}
  catch{this.receiptHealthy=false;const error=new Error('GitHub response receipt could not be persisted; further mutations stopped');error.safeReceipt=receipt;throw error;}
 }
 request(method,path,body,{allow404=false,inputFile}={}){
  if(method!=='GET'&&!this.receiptHealthy)throw new Error('GitHub mutations stopped after receipt failure');
  const args=['api','--include','--hostname','github.com','--method',method,path,'--header',`X-GitHub-Api-Version: ${API_VERSION}`,'--header','Accept: application/vnd.github+json'];
  if(inputFile)args.push('--header','Content-Type: application/octet-stream','--input',inputFile);
  else if(body!==undefined)args.push('--header','Content-Type: application/json','--input','-');
  const result=this.gh(args,body===undefined?{}:{input:JSON.stringify(body)}),status=Number(/^HTTP\/\S+\s+(\d+)/m.exec(result.stdout)?.[1]);
  this.operations.push({at:new Date().toISOString(),method,path,status:Number.isInteger(status)?status:null});
  if(allow404&&status===404)return null;
  const expected=method==='POST'?201:method==='DELETE'?204:200;
  if(result.code||status!==expected)throw new Error(`GitHub ${method} operation failed (HTTP ${status||'unknown'})`);
  if(expected===204)return null;
  const separator=/\r?\n\r?\n/.exec(result.stdout);if(!separator)throw new Error('GitHub metadata response is malformed');
  try{return JSON.parse(result.stdout.slice(separator.index+separator[0].length));}catch{throw new Error('GitHub metadata response is malformed');}
 }
 byId(id,tag,draft){if(!positiveId(id))throw new Error('GitHub release ID is invalid');return validateRelease(this.request('GET',`${BASE}/${id}`),tag,id,draft);}
 find(tag){
  if(!validTag(tag))throw new Error('GitHub release tag is invalid');
  const published=this.request('GET',`${BASE}/tags/${tag}`,undefined,{allow404:true});
  if(published)return validateRelease(published,tag);
  const viewed=this.gh(['release','view',tag,'--repo',REPO,'--json','apiUrl,isDraft,tagName']);
  this.operations.push({at:new Date().toISOString(),method:'VIEW',tag,exit_code:viewed.code,not_found:viewed.notFound===true});
  if(viewed.code){if(viewed.notFound===true)return null;throw new Error('GitHub draft discovery could not be verified');}
  let value;try{value=JSON.parse(viewed.stdout);}catch{throw new Error('GitHub draft discovery is malformed');}
  const match=typeof value.apiUrl==='string'?/^https:\/\/api\.github\.com\/repos\/getyak\/capir\/releases\/([1-9][0-9]*)$/.exec(value.apiUrl):null;
  const id=match?Number(match[1]):NaN;
  if(!positiveId(id)||value.tagName!==tag||typeof value.isDraft!=='boolean')throw new Error('GitHub draft discovery binding mismatch');
  return this.byId(id,tag,value.isDraft);
 }
 create({tag,commit,name,body,prerelease=false}){
  if(!validTag(tag)||!/^[0-9a-f]{40}$/.test(commit))throw new Error('GitHub create request binding is invalid');
  const response=this.request('POST',BASE,{tag_name:tag,target_commitish:commit,name,body,draft:true,prerelease,make_latest:'false'});
  validateRelease(response,tag,undefined,true);
  if(response.target_commitish!==commit||response.assets.length!==0)throw new Error('GitHub create response source binding mismatch');
  this.created.push({id:response.id,tag,source_commit:commit});
  // This acknowledgement precedes GET, upload, edit and every other mutation.
  this.persist('created-'+response.id,{stage:'create-response-acknowledged',release_id:response.id,tag,source_commit:commit});
  return this.byId(response.id,tag,true);
 }
 edit(release,body,{channel=false}={}){
  if(Object.hasOwn(body,'tag_name')||Object.hasOwn(body,'target_commitish'))throw new Error('GitHub edit caller cannot change release identity');
  const current=this.byId(release.id,release.tag_name);
  if(!current.draft&&!(channel&&release.tag_name==='capir-stable'))throw new Error('Published version release edits are forbidden');
  if(typeof current.target_commitish!=='string'||!/^[0-9a-f]{40}$/.test(current.target_commitish))throw new Error('GitHub edit source binding is invalid');
  // Bind every edit, including a draft checkpoint, to the independently read
  // identity. An omitted tag produced an untagged alias in CI run 40236765053.
  // https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#update-a-release
  const response=this.request('PATCH',`${BASE}/${release.id}`,{...body,tag_name:current.tag_name,target_commitish:current.target_commitish,make_latest:'false'});validateRelease(response,release.tag_name,release.id,body.draft);
  const checked=this.byId(release.id,release.tag_name,body.draft);
  if(response.target_commitish!==current.target_commitish||checked.target_commitish!==current.target_commitish)throw new Error('GitHub edited release source binding mismatch');
  return checked;
 }
 deleteAsset(release,asset,{channel=false}={}){
  const current=this.byId(release.id,release.tag_name);
  if(!current.draft&&!(channel&&release.tag_name==='capir-stable'))throw new Error('Published version asset writes are forbidden');
  if(!current.assets.some(a=>a.id===asset.id&&a.name===asset.name)||!positiveId(asset.id))throw new Error('GitHub asset scope mismatch');
  this.request('DELETE',`${BASE}/assets/${asset.id}`);
 }
 upload(release,file,name,{channel=false}={}){
  if(!validName(name))throw new Error('GitHub asset name is invalid');
  const current=this.byId(release.id,release.tag_name);
  if(!current.draft&&!(channel&&release.tag_name==='capir-stable'))throw new Error('Published version asset writes are forbidden');
  if(current.assets.some(a=>a.name===name))throw new Error('GitHub asset already exists; explicit scoped deletion required');
  const asset=this.request('POST',`https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,undefined,{inputFile:file});
  if(!positiveId(asset?.id)||asset.name!==name||asset.size!==statSync(file).size||asset.state!=='uploaded')throw new Error('GitHub uploaded asset binding mismatch');
  this.createdAssets.push({release_id:release.id,id:asset.id,name});
  this.persist('asset-'+asset.id,{stage:'asset-response-acknowledged',release_id:release.id,tag:release.tag_name,asset_id:asset.id,asset_name:name,bytes:asset.size});
  return asset;
 }
 async download(release,dir,names){
  mkdirSync(dir,{recursive:true,mode:0o700});const current=this.byId(release.id,release.tag_name);
  for(const name of names){
   if(!validName(name))throw new Error('GitHub asset name is invalid');
   const matches=current.assets.filter(a=>a.name===name);
   if(matches.length!==1||!positiveId(matches[0].id)||matches[0].size<=0||matches[0].size>536870912)throw new Error('GitHub asset download scope mismatch');
   const asset=matches[0],file=join(dir,name),transport=await this.binary(asset.id,file,asset.size);
   if(statSync(file).size!==asset.size)throw new Error('GitHub binary asset size mismatch');
   this.operations.push({at:new Date().toISOString(),method:'DOWNLOAD',release_id:release.id,asset_id:asset.id,bytes:asset.size,...transport});
  }
 }
 deleteOwnedProbe(release){
  const created=this.created.find(r=>r.id===release.id&&r.tag===release.tag_name);
  if(!created||!/^capir-contract-[1-9][0-9]*-[1-9][0-9]*$/.test(release.tag_name))throw new Error('Only a response-bound contract draft can be deleted');
  const current=this.byId(release.id,release.tag_name,true);
  if(current.target_commitish!==created.source_commit||current.assets.some(asset=>!this.createdAssets.some(a=>a.release_id===release.id&&a.id===asset.id&&a.name===asset.name)))throw new Error('GitHub probe cleanup scope drift');
  this.request('DELETE',`${BASE}/${release.id}`);
  if(this.request('GET',`${BASE}/${release.id}`,undefined,{allow404:true})!==null)throw new Error('GitHub probe cleanup was not confirmed');
 }
 version(){const value=this.gh(['--version']);if(value.code)throw new Error('GitHub CLI version could not be read');const match=/^gh version ([0-9]+\.[0-9]+\.[0-9]+)/.exec(value.stdout);if(!match)throw new Error('GitHub CLI version is malformed');return match[1];}
}
export const fileHash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
