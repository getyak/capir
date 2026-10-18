import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, chmod, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';

const helper = 'scripts/macos/installer-drag-acceptance.sh';
const validator = 'scripts/macos/verify-installer-drag-summary.py';
const scratch = process.env.MACOS_INSTALLER_TEST_ROOT ?? tmpdir();

test('Finder drag refuses local/self-hosted execution before platform effects', async () => {
  const root = await mkdtemp(path.join(scratch, 'drag-guard.'));
  try {
    const bin = path.join(root, 'bin'); await mkdir(bin);
    const calls = path.join(root, 'calls');
    for (const name of ['find', 'defaults', 'hdiutil', 'open', 'xcodebuild', 'xcrun', 'codesign']) {
      const f = path.join(bin, name);
      await writeFile(f, `#!/bin/bash\nprintf '%s\\n' '$0' >> '${calls}'\nexit 91\n`);
      await chmod(f, 0o755);
    }
    for (const env of [{}, {CI:'true', GITHUB_ACTIONS:'true', RUNNER_ENVIRONMENT:'self-hosted', RUNNER_OS:'macOS'}]) {
      const r = spawnSync('/bin/bash', [helper], {env:{...env, PATH:bin+':/usr/bin:/bin', HOME:root}, encoding:'utf8'});
      assert.equal(r.status, 78, r.stdout+r.stderr);
      assert.match(r.stderr, /disposable GitHub-hosted macOS/);
    }
    await assert.rejects(readFile(calls), {code:'ENOENT'});
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('hosted destination/profile probes are isolated and fail closed before any mount', async () => {
  const root=await mkdtemp(path.join(scratch,'drag-profile.'));
  try {
    const bin=path.join(root,'bin');await mkdir(bin);
    const log=path.join(root,'calls.jsonl'), mode=path.join(root,'mode');
    const scripts={
      find:`#!/usr/bin/env node
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({command:'find',args:process.argv.slice(2)})+'\\n');
const mode=fs.readFileSync(${JSON.stringify(mode)},'utf8');if(mode==='existing')console.log('/Applications/Talent Signal.app');if(mode==='unreadable')process.exit(19);
`,
      defaults:`#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({command:'defaults',args:process.argv.slice(2)})+'\\n');process.exit(0);
`,
    };
    for(const name of ['hdiutil','open','xcodebuild','xcrun','codesign'])scripts[name]=`#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({command:${JSON.stringify(name)}})+'\\n');process.exit(91);
`;
    for(const [name,body] of Object.entries(scripts)){const f=path.join(bin,name);await writeFile(f,body);await chmod(f,0o755);}
    const image=path.join(root,'fixture.dmg');await writeFile(image,'synthetic input');const derived=path.join(root,'derived');await mkdir(derived);
    for(const [value,status,commands] of [['existing',1,['find']],['unreadable',19,['find']],['configured',1,['find','defaults']]]){
      await writeFile(mode,value);await writeFile(log,'');
      const r=spawnSync('/bin/bash',[helper],{encoding:'utf8',env:{CI:'true',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'macOS',PATH:bin+':'+process.env.PATH,HOME:root,RUNNER_TEMP:root,MACOS_DERIVED_DATA:derived,MACOS_INSTALLER_DMG:image,MACOS_INSTALLER_DRAG_RESULT:path.join(root,'drag.xcresult')}});
      assert.equal(r.status,status,r.stdout+r.stderr);
      const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(x=>x.command),commands);
      assert.deepEqual(calls[0].args,['-H','/Applications','-maxdepth','1','-name','Talent Signal.app','-print','-quit']);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('drag summary requires exactly one actual passed test and rejects skipped/invalid evidence', async () => {
  const root = await mkdtemp(path.join(scratch, 'drag-summary.'));
  try {
    const f = path.join(root, 'summary.json');
    for (const [summary, success] of [
      [{passedTests:1,failedTests:0,skippedTests:0,totalTestCount:1}, true],
      [{passedTests:0,failedTests:1,skippedTests:0,totalTestCount:1}, false],
      [{passedTests:0,failedTests:0,skippedTests:1,totalTestCount:1}, false],
      [{passedTests:1,failedTests:0,skippedTests:0,totalTestCount:2}, false],
      [{passedTests:true,failedTests:0,skippedTests:0,totalTestCount:1}, false],
      [{passedTests:0,failedTests:0,skippedTests:0,totalTestCount:0}, false],
      ['malformed JSON', false],
    ]) {
      await writeFile(f, typeof summary==='string' ? summary : JSON.stringify(summary));
      const r = spawnSync('python3', [validator,f], {encoding:'utf8'});
      assert.equal(r.status===0, success, r.stdout+r.stderr);
    }
  } finally { await rm(root, {recursive:true, force:true}); }
});

// All macOS effects here are spies. This proves cleanup/refusal, not a real drag.
test('post-mount failure retains status/evidence and detaches only its own mount', async () => {
  const root = await mkdtemp(path.join(scratch, 'drag-cleanup.'));
  try {
    const bin = path.join(root, 'bin'); await mkdir(bin);
    const log = path.join(root, 'calls.jsonl');
    const scripts = {
      find: '#!/bin/bash\nexit 0\n',
      defaults: '#!/bin/bash\nexit 1\n',
      hdiutil: `#!/usr/bin/env node
const fs=require('node:fs');const p=require('node:path');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({command:'hdiutil',args:a})+'\\n');
if(a[0]==='attach'){const m=a[a.indexOf('-mountpoint')+1];fs.mkdirSync(p.join(m,'Talent Signal.app'),{recursive:true});fs.symlinkSync('/Applications',p.join(m,'Applications'));}
`,
      codesign: '#!/bin/bash\nexit 17\n',
    };
    for (const name of ['open','xcodebuild','xcrun']) scripts[name]=`#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({command:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');process.exit(99);
`;
    for (const [name,body] of Object.entries(scripts)) {const f=path.join(bin,name);await writeFile(f,body);await chmod(f,0o755);}
    const image=path.join(root,'fixture.dmg');await writeFile(image,'synthetic mount spy only');
    const derived=path.join(root,'derived');await mkdir(derived);
    const r=spawnSync('/bin/bash',[helper],{encoding:'utf8',env:{CI:'true',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'macOS',PATH:bin+':'+process.env.PATH,HOME:root,RUNNER_TEMP:root,MACOS_DERIVED_DATA:derived,MACOS_INSTALLER_DMG:image,MACOS_INSTALLER_DRAG_RESULT:path.join(root,'drag.xcresult')}});
    assert.equal(r.status,17,r.stdout+r.stderr);
    const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
    const attach=calls.find(x=>x.command==='hdiutil'&&x.args[0]==='attach');
    const mount=attach.args[attach.args.indexOf('-mountpoint')+1];
    assert.ok(mount.startsWith(root+path.sep));
    assert.deepEqual(calls.filter(x=>x.args[0]==='detach').map(x=>x.args),[['detach','-quiet',mount]]);
    assert.equal(calls.some(x=>['open','xcodebuild','xcrun'].includes(x.command)),false);
    assert.equal(calls.some(x=>x.args.includes('-force')),false);
  } finally {await rm(root,{recursive:true,force:true});}
});
