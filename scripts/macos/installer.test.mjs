import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, symlinkSync, readFileSync, existsSync, rmSync, writeFileSync, chmodSync} from 'node:fs';
import {join, resolve} from 'node:path';

// Integration, not a source-text assertion: build the utility, mount a real
// disposable image, read its generated Finder metadata, then detach that image.
test('the mounted installer preserves its own layout, background and Applications target', {skip:process.platform!=='darwin', timeout:180000}, () => {
  assert.ok(process.env.MACOS_INSTALLER_TEST_ROOT, 'Use a registered task artifact for mounted-image tests');
  const root=mkdtempSync(join(process.env.MACOS_INSTALLER_TEST_ROOT,'installer-contract.'));
  const source=join(root,'source'), mount=join(root,'mount'), image=join(root,'scratch.dmg');
  const packagePath=resolve('scripts/macos/installer');
  const run=(command,args)=>spawnSync(command,args,{encoding:'utf8',timeout:120000});
  let mounted=false;
  try {
    mkdirSync(source);mkdirSync(mount);mkdirSync(join(source,'Talent Signal.app'));
    writeFileSync(join(source,'Install.txt'),'Installation instructions remain available on the image.');
    symlinkSync('/Applications',join(source,'Applications'));
    let result=run('hdiutil',['create','-quiet','-volname','GET48 layout test','-srcfolder',source,'-format','UDRW',image]);
    assert.equal(result.status,0,result.stderr);
    result=run('hdiutil',['attach','-quiet','-nobrowse','-mountpoint',mount,image]);assert.equal(result.status,0,result.stderr);mounted=true;
    result=run('swift',['run','--package-path',packagePath,'--scratch-path',join(process.env.MACOS_INSTALLER_TEST_ROOT,'installer-build'),'InstallerLayout',mount]);
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(join(mount,'.background','install.png')));
    result=run('swift',['run','--skip-build','--package-path',packagePath,'--scratch-path',join(process.env.MACOS_INSTALLER_TEST_ROOT,'installer-build'),'InstallerLayout','--inspect',mount]);
    assert.equal(result.status,0,result.stderr);
    const receipt=JSON.parse(result.stdout);
    assert.deepEqual(receipt.windowSize,{width:720,height:460});
    assert.deepEqual(receipt.appPosition,{x:190,y:225});
    assert.deepEqual(receipt.applicationsPosition,{x:530,y:225});
    assert.deepEqual(receipt.backgroundPixels,{width:1440,height:920});
    assert.equal(receipt.backgroundIsCarbonAlias,true);
    assert.equal(receipt.applicationsTarget,'/Applications');
    assert.equal(receipt.hiddenBackground,true);
    assert.match(run('ls',['-ldO',join(mount,'Install.txt')]).stdout,/\bhidden\b/,
      'The optional text file must not create a cropped third icon in the compact installer');
    result=run('swift',['run','--skip-build','--package-path',packagePath,'--scratch-path',join(process.env.MACOS_INSTALLER_TEST_ROOT,'installer-build'),'InstallerLayout',source]);
    assert.notEqual(result.status,0,'An ordinary source folder must not acquire a volume-bound alias');
    assert.equal(existsSync(join(source,'.DS_Store')),false);
  } finally {
    if(mounted){const result=run('hdiutil',['detach','-quiet',mount]);assert.equal(result.status,0,result.stderr);}
    // Only this test's disposable image and staging directory; no source tree.
    rmSync(root,{recursive:true,force:true});
  }
});

test('a failed layout process detaches only its own mounted scratch image', () => {
  assert.ok(process.env.MACOS_INSTALLER_TEST_ROOT, 'Use a registered task artifact');
  const root=mkdtempSync(join(process.env.MACOS_INSTALLER_TEST_ROOT,'installer-failure.'));
  try {
    const bin=join(root,'bin'),source=join(root,'source'),output=join(root,'out'),log=join(root,'calls.jsonl');
    mkdirSync(bin);mkdirSync(source);mkdirSync(output);
    for(const name of ['hdiutil','swift']) {
      const path=join(bin,name);
      writeFileSync(path,`#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(process.env.GET48_TEST_LOG,JSON.stringify({command:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');process.exit(${name==='swift'?17:0});\n`);
      chmodSync(path,0o755);
    }
    const result=spawnSync('/bin/bash',[resolve('scripts/macos/create-installer.sh'),source,join(output,'final.dmg')],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,MACOS_OUTPUT_DIR:output,GET48_TEST_LOG:log}});
    assert.equal(result.status,17,`${result.stdout}\n${result.stderr}`);
    const calls=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
    const attach=calls.find(x=>x.command==='hdiutil'&&x.args[0]==='attach');
    const detaches=calls.filter(x=>x.command==='hdiutil'&&x.args[0]==='detach');
    assert.equal(detaches.length,1,'Failure must release the mounted task volume exactly once');
    const mount=attach.args[attach.args.indexOf('-mountpoint')+1];
    assert.ok(mount.startsWith(output+'/installer-mount.'));
    assert.deepEqual(detaches[0].args,['detach','-quiet',mount]);
    assert.equal(existsSync(join(output,'final.dmg')),false);
    assert.equal(calls.some(x=>x.command==='hdiutil'&&x.args[0]==='convert'),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
