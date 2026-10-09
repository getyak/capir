#!/usr/bin/env node
// Operator-only recovery. Docker inventory and a frozen owner record prove an
// old namespace is gone; age, PID guesses and receipt state grant no authority.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function recoverableOwner(owner, namespaces) {
  return owner && typeof owner.namespace === "string"
    && /^[a-f0-9]{12,64}$/u.test(owner.namespace)
    && typeof owner.token === "string" && owner.token.length > 0
    && Number.isInteger(owner.pid) && owner.pid > 0
    && !namespaces.includes(owner.namespace);
}

function docker(args, options, errorCode) {
  try { return execFileSync("docker", args, { ...options, stdio: ["pipe", "pipe", "pipe"] }); }
  catch { throw new Error(errorCode); }
}
function inventory() {
  const ids = docker(["ps", "-aq"], { encoding: "utf8", timeout: 30_000 }, "DOCKER_CONTAINER_INVENTORY_UNAVAILABLE")
    .trim().split(/\s+/u).filter(Boolean);
  if (!ids.length) throw new Error("DOCKER_CONTAINER_INVENTORY_EMPTY");
  // Extract only operational identity. Even a disappearing container must never
  // expose Config.Env through a child-process exception or its captured stdout.
  const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"State":{"Running":{{json .State.Running}}},'
    + '"Config":{"Hostname":{{json .Config.Hostname}},"Labels":{'
    + '"com.docker.compose.project":{{json (index .Config.Labels "com.docker.compose.project")}},'
    + '"com.docker.compose.service":{{json (index .Config.Labels "com.docker.compose.service")}}}},"Mounts":{{json .Mounts}}}';
  const output = docker(["inspect", "--format", format, ...ids],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, "DOCKER_CONTAINER_INVENTORY_CHANGED");
  try { return output.trim().split("\n").map(line => JSON.parse(line)); }
  catch { throw new Error("DOCKER_CONTAINER_INVENTORY_INVALID"); }
}

export function main(args = process.argv.slice(2)) {
  const [container, mode = "--dry-run"] = args;
  if (!container || args.length > 2 || !["--dry-run", "--apply"].includes(mode)) {
    throw new Error("Usage: recover-runtime-observation-locks.mjs CONTAINER [--dry-run|--apply]");
  }
  const records = inventory();
  const target = records.find(record => record.Id === container || record.Name === `/${container}`);
  if (!target?.State?.Running || target.Config?.Labels?.["com.docker.compose.project"] !== "talent-signal-testflight-local"
      || target.Config?.Labels?.["com.docker.compose.service"] !== "api") throw new Error("RECOVERY_TARGET_INVALID");
  const mount = target.Mounts.find(m => m.Type === "volume" && m.Destination === "/var/lib/talent-signal/runtime-observation");
  if (mount?.Name !== "talent-signal-testflight-local_talent_signal_testflight_runtime_observation" || !mount.RW) {
    throw new Error("RECOVERY_VOLUME_INVALID");
  }
  const execute = program => docker(["exec", "-i", target.Id, "node", "--input-type=module", "-"],
    { input: program, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, "RECOVERY_EXECUTION_UNAVAILABLE");
  const prelude = `
import fs from 'node:fs/promises';
import path from 'node:path';
const root='/var/lib/talent-signal/runtime-observation';
if(process.env.TALENT_SIGNAL_OPIK_RUNTIME_OUTBOX!==root)throw Error('RECOVERY_ROOT_MISMATCH');`;
  // Freeze exact owner records BEFORE the second inventory. A container arriving
  // later cannot introduce a new candidate into this recovery operation.
  const frozen = JSON.parse(execute(`${prelude}
const records=[];
async function scan(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);
 if(entry.isDirectory()){if(entry.name!=='.operator-recovery.guard')await scan(file);continue;}
 if(!entry.isFile()||!entry.name.endsWith('.lock'))continue;
 try{const raw=await fs.readFile(file,'utf8');records.push({file,raw,owner:JSON.parse(raw)});}
 catch{records.push({file,raw:null,owner:null});}
}}
await scan(root);console.log(JSON.stringify(records));`));
  const second = inventory();
  const fingerprint = values => JSON.stringify(values.map(v => [v.Id, v.Config?.Hostname, v.State?.Running]).sort());
  if (fingerprint(records) !== fingerprint(second)) throw new Error("DOCKER_CONTAINER_INVENTORY_CHANGED");
  const namespaces = second.map(record => record.Config?.Hostname).filter(Boolean);
  const candidates = frozen.filter(record => recoverableOwner(record.owner, namespaces));
  if (mode === "--dry-run") {
    process.stdout.write(`${JSON.stringify({ mode: "dry_run", locks: frozen.length,
      recoverable: candidates.length, recovered: 0, preserved: frozen.length - candidates.length, changed: 0 })}\n`);
    return;
  }
  const output = execute(`${prelude}
const candidates=${JSON.stringify(candidates)};
const counts={mode:'apply',locks:${frozen.length},recoverable:candidates.length,recovered:0,preserved:${frozen.length - candidates.length},changed:0};
// Serialize helpers. A crashed guard fails closed and requires inspection.
const guard=path.join(root,'.operator-recovery.guard');
await fs.mkdir(guard,{mode:0o700});
try{for(const candidate of candidates){
 if(!candidate.file.startsWith(root+'/')||!candidate.file.endsWith('.lock'))throw Error('RECOVERY_CANDIDATE_INVALID');
 try{const stat=await fs.lstat(candidate.file);
  if(!stat.isFile()||await fs.readFile(candidate.file,'utf8')!==candidate.raw){counts.changed++;continue;}
  await fs.unlink(candidate.file);counts.recovered++;
 }catch(error){if(error.code!=='ENOENT')throw error;counts.changed++;}
}console.log(JSON.stringify(counts));}
finally{await fs.rmdir(guard);}`);
  process.stdout.write(output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
