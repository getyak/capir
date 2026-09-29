const test = require('node:test');
const assert = require('node:assert/strict');
const { trustedCI, changedReleaseFiles, macBuildNumber, decide } = require('./release-policy.cjs');
const run = { event: 'push', conclusion: 'success', head_branch: 'main', head_sha: 'abc', head_repository: { full_name: 'owner/repo' } };
test('release accepts only successful trusted exact-main push CI', () => {
  assert.equal(trustedCI(run, 'owner/repo', 'abc'), true);
  for (const change of [{event:'pull_request'}, {conclusion:'failure'}, {head_branch:'feature'}, {head_sha:'old'}, {head_repository:{full_name:'fork/repo'}}]) {
    assert.equal(trustedCI({...run,...change}, 'owner/repo', 'abc'), false);
  }
});
test('release detection includes removed and renamed source paths, excludes unrelated work', () => {
  assert.equal(changedReleaseFiles([{filename:'apps/web/app/page.tsx'}]), false);
  assert.equal(changedReleaseFiles([{filename:'apps/macos/Info.plist',status:'removed'}]), true);
  assert.equal(changedReleaseFiles([{filename:'scripts/ci/product-release-version.sh'}]), true);
  assert.equal(changedReleaseFiles([{filename:'scripts/ci/ensure-release-assets.sh'}]), true);
  assert.equal(changedReleaseFiles([{filename:'archive/old.sh',previous_filename:'scripts/macos/package.sh'}]), true);
  assert.equal(changedReleaseFiles([{filename:'docs/operations/macos-install.txt'}]), true);
});
test('a product release advances the Mac boundary only with an actual Mac asset', () => {
  assert.equal(macBuildNumber({assets:[{name:'TalentSignal.ipa'}]}), -1);
  assert.equal(macBuildNumber({assets:[{name:'Talent-Signal-0.1.92-35-macOS-universal-signed.dmg'}]}), 35);
});
function fixture({event='workflow_run', sha='abc', files=[], latest=true, releases, ci=run, ref='refs/heads/main', contextSha='abc'}={}) {
  const output={};
  const github={rest:{repos:{getBranch:async()=>({data:{commit:{sha}}}), listReleases:()=>{}, compareCommitsWithBasehead:async()=>({data:{files}})},actions:{listWorkflowRuns:async()=>({data:{workflow_runs:ci?[ci]:[]}})}},paginate:async()=> releases ?? (latest ? [{draft:false,tag_name:'macos-1-1',published_at:'2026-09-21',assets:[{name:'Talent-Signal-0.1.0-1-macOS-universal-signed.dmg'}]}] : [])};
  return {output,args:{github,context:{repo:{owner:'owner',repo:'repo'},eventName:event,ref,sha:contextSha,payload:{workflow_run:ci}},core:{setOutput:(k,v)=>{output[k]=v;},notice:()=>{}}}};
}
test('first release publishes, unrelated change skips, stale CI skips',async()=>{
  for (const [options,expected] of [[{latest:false},'true'],[{},'false'],[{files:[{filename:'apps/macos/Info.plist'}]},'true'],[{sha:'new'},'false']]) {
    const {args,output}=fixture(options);await decide(args);assert.equal(output.release,expected);
  }
});
test('manual dispatch requires current main and verified CI',async()=>{
  for (const options of [{ref:'refs/heads/feature'},{contextSha:'old'},{ci:null}]) {
    await assert.rejects(decide(fixture({event:'workflow_dispatch',...options}).args));
  }
  const {args,output}=fixture({event:'workflow_dispatch'});await decide(args);assert.equal(output.release,'true');
});
test('iOS-only product release does not hide a changed Mac source', async () => {
  const releases=[
    {draft:false,tag_name:'v0.1.92',published_at:'2026-09-22',assets:[{name:'TalentSignal.ipa'}]},
    {draft:false,tag_name:'macos-1-1',published_at:'2026-09-21',assets:[{name:'Talent-Signal-0.1.0-1-macOS-universal-signed.dmg'}]},
  ];
  const {args,output}=fixture({releases,files:[{filename:'apps/macos/Sources/App.swift'}]});
  await decide(args);assert.equal(output.release,'true');
  const unchanged=fixture({releases,files:[{filename:'apps/web/app/page.tsx'}]});
  await decide(unchanged.args);assert.equal(unchanged.output.release,'false');
});
test('newer native build wins even when its shared iOS release was published earlier', async () => {
  const releases=[
    {draft:false,tag_name:'macos-2-1',published_at:'2026-09-23',assets:[{name:'Talent-Signal-0.1.0-34-macOS-universal-signed.dmg'}]},
    {draft:false,tag_name:'v0.1.92',published_at:'2026-09-22',assets:[{name:'Talent-Signal-0.1.92-35-macOS-universal-signed.dmg'}]},
  ];
  let basehead='';
  const {args,output}=fixture({releases});
  args.github.rest.repos.compareCommitsWithBasehead=async ({basehead: value})=>{
    basehead=value;return {data:{files:[]}};
  };
  await decide(args);
  assert.equal(output.release,'false');
  assert.equal(basehead,'v0.1.92...abc');
});
