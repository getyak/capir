/** Linux Hosted-only process ownership; no ambient browser or service reuse. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export class DirectoryProtocolFailure extends Error {
  constructor(readonly code: string) { super("GET452 protocol assertion failed"); }
}
export function requireProtocol(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DirectoryProtocolFailure(code);
}
type Identity = { pid: number; pgid: number; sid: number; uid: number; start: string };
type Group = { pgid: number; start: string | undefined; known: Map<number, string>; closed: boolean };
const groups = new Map<ChildProcess, Group>();
function identity(pid: number): Identity | undefined {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
    requireProtocol(/^\d+$/.test(fields[19] ?? ""), "PROCESS_IDENTITY");
    return { pid, pgid: Number(fields[2]), sid: Number(fields[3]), uid: statSync(`/proc/${pid}`).uid, start: fields[19]! };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
function pids(pgid: number): number[] {
  try {
    return execFileSync("/usr/bin/pgrep", ["-g", String(pgid)], { encoding: "utf8", timeout: 1000, maxBuffer: 65536, stdio: ["ignore", "pipe", "ignore"] })
      .trim().split(/\s+/).filter(Boolean).map(value => { requireProtocol(/^\d+$/.test(value), "PROCESS_MEMBERSHIP"); return Number(value); });
  } catch (error) { if ((error as { status?: number }).status === 1) return []; throw new DirectoryProtocolFailure("PROCESS_MEMBERSHIP"); }
}
function members(group: Group) {
  const leader = identity(group.pgid);
  if (leader) requireProtocol(leader.start === group.start && leader.pgid === group.pgid && leader.sid === group.pgid, "PROCESS_LEADER_REUSED");
  const rows: Identity[] = [];
  for (const pid of pids(group.pgid)) {
    const row = identity(pid); if (!row) continue;
    requireProtocol(row.pgid === group.pgid && row.sid === group.pgid && row.uid === process.getuid?.(), "PROCESS_GROUP_CHANGED");
    const prior = group.known.get(pid);
    if (prior) requireProtocol(prior === row.start, "PROCESS_MEMBER_REUSED");
    else { requireProtocol(leader, "UNKNOWN_ORPHAN_PROCESS"); group.known.set(pid, row.start); }
    rows.push(row);
  }
  return rows;
}
export function ownedChild(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, stderr = false): ChildProcess {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "ignore", stderr ? "pipe" : "ignore"] });
  child.on("error", () => {}); // Readiness fails; cleanup still owns any successfully created group.
  if (child.pid) {
    const row = identity(child.pid);
    const group: Group = { pgid: child.pid, start: row?.start, known: new Map(), closed: false };
    groups.set(child, group);
    if (row) {
      requireProtocol(row.pgid === child.pid && row.sid === child.pid && row.uid === process.getuid?.(), "PROCESS_NOT_OWNED");
      group.known.set(row.pid, row.start);
    }
  }
  return child;
}
export function rememberChild(child: ChildProcess) {
  const group = groups.get(child); requireProtocol(group, "PROCESS_UNREGISTERED"); if (!group.closed) members(group);
}
export function childOwnsListeningPort(child: ChildProcess, port: number) {
  const group = groups.get(child); requireProtocol(group && !group.closed, "PROCESS_UNREGISTERED");
  const target = port.toString(16).toUpperCase().padStart(4, "0"), inodes = new Set<string>();
  for (const name of ["tcp", "tcp6"]) {
    for (const line of readFileSync(`/proc/net/${name}`, "utf8").split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] === "0A" && fields[1]?.split(":")[1] === target && /^\d+$/.test(fields[9] ?? "")) inodes.add(fields[9]!);
    }
  }
  if (!inodes.size) return false;
  for (const row of members(group)) {
    let descriptors: string[];
    try { descriptors = readdirSync(`/proc/${row.pid}/fd`); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const descriptor of descriptors) {
      try {
        const link = readlinkSync(`/proc/${row.pid}/fd/${descriptor}`), match = /^socket:\[(\d+)\]$/.exec(link);
        if (match && inodes.has(match[1]!)) return true;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  return false;
}
async function empty(group: Group, milliseconds: number) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!pids(group.pgid).length) { await delay(50); if (!pids(group.pgid).length) { group.closed = true; return true; } }
    else members(group);
    await delay(50);
  }
  return false;
}
export async function stopChild(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  const group = groups.get(child); requireProtocol(group, "PROCESS_UNREGISTERED");
  if (group.closed || await empty(group, 100)) return;
  const signal = (name: NodeJS.Signals) => {
    if (!members(group).length) return;
    try { process.kill(-group.pgid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  signal("SIGTERM"); if (await empty(group, 5000)) return;
  signal("SIGKILL"); requireProtocol(await empty(group, 5000), "PROCESS_CLEANUP");
}
export async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); requireProtocol(address && typeof address !== "string", "PORT_RESERVATION");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export function chromeAnnouncement(child: ChildProcess, port: number) {
  requireProtocol(child.stderr, "CHROME_ANNOUNCEMENT_PIPE");
  const state: { uuid: string | undefined; invalid: boolean } = { uuid: undefined, invalid: false };
  let retained = "", bytes = 0;
  child.stderr.on("data", (chunk: Buffer) => {
    if (state.uuid || state.invalid) return; // The pipe remains drained, never emitted.
    bytes += chunk.length; if (bytes > 16384) { state.invalid = true; retained = ""; return; }
    retained += chunk.toString("utf8"); const lines = retained.split(/\r?\n/); retained = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("DevTools listening on ")) continue;
      const match = /^DevTools listening on ws:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/devtools\/browser\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(line);
      if (!match || Number(match[1]) !== port) { state.invalid = true; retained = ""; return; }
      state.uuid = match[2]; retained = ""; return;
    }
  });
  child.stderr.once("error", () => { state.invalid = true; retained = ""; });
  return state;
}
