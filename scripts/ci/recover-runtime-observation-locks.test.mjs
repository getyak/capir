import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverableOwner } from "../deploy/recover-runtime-observation-locks.mjs";
const owner = { namespace: "a36615c2c5e7", token: "unique-owner", pid: 1 };
test("only a fully recorded, absent Docker namespace is recoverable", () => {
  assert.equal(recoverableOwner(owner, ["2507d167a365"]), true);
  assert.equal(recoverableOwner(owner, [owner.namespace]), false);
  assert.equal(recoverableOwner({ ...owner, namespace: "host-mac" }, []), false);
  assert.equal(recoverableOwner({ ...owner, namespace: undefined }, []), false);
  assert.equal(recoverableOwner({ ...owner, token: undefined }, []), false);
  assert.equal(recoverableOwner({ ...owner, pid: 0 }, []), false);
  assert.equal(Boolean(recoverableOwner(null, [])), false);
});
test("age and terminal state cannot override a known namespace", () => {
  assert.equal(recoverableOwner({ ...owner, created_at: "2000-01-01", state: "deleted" }, [owner.namespace]), false);
});

// Execute the production-generated programs against an in-memory filesystem,
// inside a separate process so built-in module substitutes cannot leak.
import { execFileSync } from "node:child_process";
const root = "/var/lib/talent-signal/runtime-observation";
const lock = `${root}/old.json.lock`;
const raw = JSON.stringify(owner);
function executeFixture(fixture) {
  const program = `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const fixture=JSON.parse(process.argv[1]);
const root=${JSON.stringify(root)};
const target={Id:'container-api',Name:'/api',State:{Running:true},Config:{Hostname:'2507d167a365',Labels:{'com.docker.compose.project':'talent-signal-testflight-local','com.docker.compose.service':'api'}},Mounts:[{Type:'volume',Destination:root,RW:true,Name:fixture.volume??'talent-signal-testflight-local_talent_signal_testflight_runtime_observation'}]};
const actualExec=cp.execFileSync;let calls=0;
cp.execFileSync=(_command,args,options)=>{
 if(args[0]==='ps')return target.Id+'\\n';
 if(args[0]==='inspect'){if(fixture.inventoryFailure){const failure=Error('private subprocess error');failure.stdout='synthetic-private-config';throw failure;}return JSON.stringify(target)+'\\n';}
 if(args[0]!=='exec')throw Error('unexpected call');
 const files=calls++===0?fixture.before:fixture.after;
 const harness=\`import path from 'node:path';
const files=\${JSON.stringify(files)};
const fs={
readdir:async()=>Object.keys(files).map(file=>({name:path.basename(file),isDirectory:()=>false,isFile:()=>true})),
readFile:async file=>{if(!(file in files)){const error=Error('missing');error.code='ENOENT';throw error;}return files[file];},
lstat:async()=>({isFile:()=>\${!fixture.symlink}}),
mkdir:async()=>{if(\${!!fixture.busy}){const error=Error('busy');error.code='EEXIST';throw error;}},
unlink:async file=>{delete files[file];},rmdir:async()=>{}};\\n\`;
 return actualExec(process.execPath,['--input-type=module','-'],{input:harness+options.input.replace("import fs from 'node:fs/promises';",'').replace("import path from 'node:path';",''),encoding:'utf8',env:{...process.env,TALENT_SIGNAL_OPIK_RUNTIME_OUTBOX:root},stdio:['pipe','pipe','pipe']});
};
syncBuiltinESMExports();
const {main}=await import(${JSON.stringify(new URL("../deploy/recover-runtime-observation-locks.mjs", import.meta.url).href)});
const write=process.stdout.write.bind(process.stdout);let output='';process.stdout.write=value=>{output+=value;return true;};
let error=null;try{main(['api','--apply']);}catch(failure){error=String(failure.message);}
write(JSON.stringify({counts:output?JSON.parse(output):null,calls,error}));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", program, JSON.stringify(fixture)],
    { encoding: "utf8", timeout: 10_000 }));
}

test("a new runtime lock after freeze never becomes a recovery candidate", () => {
  const result = executeFixture({ before: {}, after: { [lock]: raw } });
  assert.equal(result.counts.recovered, 0);
  assert.equal(result.counts.recoverable, 0);
});
test("an unchanged frozen absent owner is recovered", () => {
  assert.equal(executeFixture({ before: { [lock]: raw }, after: { [lock]: raw } }).counts.recovered, 1);
});
test("a replacement owner and symlink are preserved", () => {
  const replacement = JSON.stringify({ ...owner, namespace: "cccccccccccc", token: "new-owner" });
  for (const fixture of [
    { before: { [lock]: raw }, after: { [lock]: replacement } },
    { before: { [lock]: raw }, after: { [lock]: raw }, symlink: true },
  ]) {
    const result = executeFixture(fixture);
    assert.equal(result.counts.recovered, 0);
    assert.equal(result.counts.changed, 1);
  }
});
test("another volume is refused before any volume operation", () => {
  const result = executeFixture({ before: {}, after: {}, volume: "unrelated-volume" });
  assert.equal(result.error, "RECOVERY_VOLUME_INVALID");
  assert.equal(result.calls, 0);
});
test("an existing recovery guard fails closed", () => {
  const result = executeFixture({ before: { [lock]: raw }, after: { [lock]: raw }, busy: true });
  assert.equal(result.error, "RECOVERY_EXECUTION_UNAVAILABLE");
  assert.equal(result.counts, null);
});

test("inventory failure emits a fixed error without private subprocess output", () => {
  const result = executeFixture({ before: {}, after: {}, inventoryFailure: true });
  assert.equal(result.error, "DOCKER_CONTAINER_INVENTORY_CHANGED");
  assert.equal(result.calls, 0);
  assert.ok(!JSON.stringify(result).includes("synthetic-private-config"));
});
