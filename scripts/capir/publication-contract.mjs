/** Real job-scoped GITHUB_TOKEN contract; never publishes a release or reads
 * Infisical. Create/GET/PATCH/DELETE and binary assets use response-bound IDs.
 * https://docs.github.com/en/rest/releases/releases#create-a-release
 * https://docs.github.com/en/rest/releases/assets#upload-a-release-asset */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GitHubReleaseProvider,REPO,API_VERSION,fileHash} from './github-release-provider.mjs';
export function contractContext(env){
 const expectedWorkflow=`${REPO}/.github/workflows/release-capir.yml@refs/heads/main`;
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_WORKFLOW_REF!==expectedWorkflow
  ||!/^\d{1,15}$/.test(env.GITHUB_RUN_ID??'')||!/^\d{1,8}$/.test(env.GITHUB_RUN_ATTEMPT??'')||Number(env.GITHUB_RUN_ID)<=0||Number(env.GITHUB_RUN_ATTEMPT)<=0
  ||!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'')||!env.GH_TOKEN)throw new Error('Publication contract requires the trusted main-only GitHub Actions context');
 return {run_id:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,source_commit:env.GITHUB_SHA,tag:`capir-contract-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`};
}
export async function runContract({env=process.env,receiptDir,gh,downloadAsset,saveReceipt}={}){
 const context=contractContext(env);
 if(!receiptDir)throw new Error('Publication contract receipt directory is required');
 mkdirSync(receiptDir,{recursive:true,mode:0o700});
 const provider=new GitHubReleaseProvider({gh,downloadAsset,saveReceipt,receiptDir,context:{mode:'contract-only',...context}});
 const receipt={schema:1,repository:REPO,api_version:API_VERSION,...context,credentials_logged_or_saved:false,secret_values_read:false,oidc_used:false,published_probe:false,stable_touched:false,result:'failed',cleanup:'not-created'};
 let owned,stage='trusted-main-preflight';
 try{
  receipt.gh_version=provider.version();
  const main=provider.request('GET',`repos/${REPO}/git/ref/heads/main`);
  if(main.object?.type!=='commit'||main.object.sha!==context.source_commit)throw new Error('Publication contract main revision changed');
  if(provider.request('GET',`repos/${REPO}/git/ref/tags/${context.tag}`,undefined,{allow404:true})!==null||provider.find(context.tag))throw new Error('Publication contract name already exists; nothing may be adopted');
  stage='create-response-bound-probe';owned=provider.create({tag:context.tag,commit:context.source_commit,name:'capir provider contract (unpublished)',body:'Temporary response-bound publication contract. Never publish.',prerelease:true});
  receipt.release_id=owned.id;
  stage='fresh-client-draft-rediscovery';
  const fresh=new GitHubReleaseProvider({gh,downloadAsset,saveReceipt,receiptDir,context:{mode:'contract-rediscovery',...context}}),recovered=fresh.find(context.tag);
  provider.operations.push(...fresh.operations);
  if(!recovered||recovered.id!==owned.id||recovered.target_commitish!==context.source_commit||!recovered.draft||recovered.assets.length!==0)throw new Error('Publication contract existing draft recovery failed');
  receipt.existing_draft_rediscovered=true;
  const fixtureDir=join(receiptDir,'fixture');mkdirSync(fixtureDir,{recursive:true,mode:0o700});
  const name='contract-fixture.json',file=join(fixtureDir,name);
  writeFileSync(file,JSON.stringify({schema:'capir-publication-contract.v1',...context})+'\n',{mode:0o600});
  stage='upload-download-fixture';const asset=provider.upload(owned,file,name);
  const downloaded=join(receiptDir,'downloaded');await provider.download(owned,downloaded,[name]);
  if(fileHash(file)!==fileHash(join(downloaded,name)))throw new Error('Publication contract binary bytes differ');
  const current=provider.byId(owned.id,context.tag,true);
  if(current.assets.length!==1||current.assets[0].id!==asset.id||current.assets[0].name!==name)throw new Error('Publication contract unexpected asset appeared');
  receipt.fixture={name,bytes:readFileSync(file).length,sha256:fileHash(file),asset_id:asset.id,binary_verified:true};
  stage='edit-draft-by-id';const edited=provider.edit(owned,{name:'capir provider contract verified (unpublished)',body:'Temporary response-bound publication contract verified. Never publish.',draft:true});
  if(edited.target_commitish!==context.source_commit||edited.name!=='capir provider contract verified (unpublished)')throw new Error('Publication contract draft edit readback mismatch');
  stage='delete-and-reupload-own-asset';provider.deleteAsset(owned,asset);
  if(provider.byId(owned.id,context.tag,true).assets.length!==0)throw new Error('Publication contract asset deletion was not confirmed');
  provider.upload(owned,file,name);receipt.asset_delete_and_reupload_verified=true;
  receipt.result='contract-operations-verified';
 }catch{receipt.failure_stage=stage;receipt.result='failed';}
 finally{
  // A failed immediate receipt forbids even cleanup mutations. A validated
  // response ID is still emitted in the safe failure acknowledgement.
  const created=provider.created.find(r=>r.tag===context.tag);
  if(created)receipt.release_id=created.id;
  if(created&&provider.receiptHealthy){
   try{
    provider.deleteOwnedProbe({id:created.id,tag_name:context.tag});
    if(provider.request('GET',`repos/${REPO}/git/ref/tags/${context.tag}`,undefined,{allow404:true})!==null)throw new Error('Publication contract unexpected git reference remains');
    receipt.cleanup='response-bound-draft-deleted-and-404-verified';
    stage='final-main-readback';
    const finalMain=provider.request('GET',`repos/${REPO}/git/ref/heads/main`);
    if(finalMain.object?.type!=='commit'||finalMain.object.sha!==context.source_commit)throw new Error('Publication contract main revision changed before completion');
   }catch{if(receipt.cleanup!=='response-bound-draft-deleted-and-404-verified')receipt.cleanup='unconfirmed';receipt.failure_stage??=stage;receipt.result='failed';}
  }else if(created){receipt.cleanup='blocked-by-receipt-write-failure';receipt.result='failed';}
  else if(provider.operations.some(op=>op.method==='POST'&&op.path==='repos/getyak/capir/releases'))receipt.cleanup='creation-unconfirmed-no-bound-id';
  receipt.operations=provider.operations;
  if(receipt.result==='contract-operations-verified'&&receipt.cleanup==='response-bound-draft-deleted-and-404-verified')receipt.result='passed';
  try{provider.persist('contract-result',receipt);}catch{receipt.result='failed';receipt.receipt_write_failed=true;}
 }
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='run'||args[1]!=='--receipt-dir'){process.stderr.write('usage: publication-contract.mjs run --receipt-dir <directory>\n');process.exitCode=2;}
 else{
  try{const result=await runContract({receiptDir:args[2]});process.stdout.write(JSON.stringify(result)+'\n');if(result.result!=='passed')process.exitCode=1;}
  catch{process.stderr.write('Publication contract preflight unavailable; no success claimed.\n');process.exitCode=1;}
 }
}
