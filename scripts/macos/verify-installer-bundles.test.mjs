import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';

test('bundle identity preserves empty directories, entry types and exact symlink targets', async () => {
  const root=await mkdtemp(path.join(process.env.MACOS_INSTALLER_TEST_ROOT??tmpdir(),'bundle-identity.'));
  const a=path.join(root,'source.app'),b=path.join(root,'installed.app');
  const run=()=>spawnSync('python3',['scripts/macos/verify-installer-bundles.py',a,b],{encoding:'utf8'});
  try {
    for(const base of [a,b]){await mkdir(base);await mkdir(path.join(base,'empty'));await writeFile(path.join(base,'one'),'same bytes');await writeFile(path.join(base,'two'),'same bytes');await symlink('one',path.join(base,'current'));await symlink('missing',path.join(base,'dangling'));await symlink('empty',path.join(base,'directory-link'));}
    let result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).symlinksFollowed,false);
    // Following these links would see identical bytes. Their provenance still differs.
    await rm(path.join(b,'current'));await symlink('two',path.join(b,'current'));assert.notEqual(run().status,0);
    await rm(path.join(b,'current'));await symlink('one',path.join(b,'current'));
    await rm(path.join(b,'directory-link'));await mkdir(path.join(b,'directory-link'));assert.notEqual(run().status,0);
    await rm(path.join(b,'directory-link'),{recursive:true});await symlink('empty',path.join(b,'directory-link'));
    await rm(path.join(b,'empty'),{recursive:true});assert.notEqual(run().status,0);
    await mkdir(path.join(b,'empty'));await writeFile(path.join(b,'one'),'changed bytes');assert.notEqual(run().status,0);
    await writeFile(path.join(b,'one'),'same bytes');await rm(path.join(b,'dangling'));await symlink('other-missing',path.join(b,'dangling'));assert.notEqual(run().status,0);
    await rm(path.join(b,'dangling'));await symlink('missing',path.join(b,'dangling'));assert.equal(run().status,0);
    // Inject an enumeration error; do not change real permissions or depend on UID.
    const denied=spawnSync('python3',['-c',`
import importlib.util, os, pathlib, sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('bundle','scripts/macos/verify-installer-bundles.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
real=os.scandir
def denied(path):
    if pathlib.Path(path).name=='empty': raise PermissionError('synthetic unreadable subtree')
    return real(path)
with patch.object(m.os,'scandir',side_effect=denied):
    try: m.manifest(pathlib.Path(sys.argv[1]))
    except PermissionError: pass
    else: raise AssertionError('Unreadable subdirectories must fail the complete-manifest gate')
`,a],{encoding:'utf8'});
    assert.equal(denied.status,0,denied.stdout+denied.stderr);
  } finally {await rm(root,{recursive:true,force:true});}
});
