/** Closed counters from fd3 of this task's owned Next child, never raw logs. */
import type { ChildProcess } from "node:child_process";
import { Readable } from "node:stream";

export function observeDirectoryIconServer(child: ChildProcess) {
  const stream = child.stdio[3];
  let ready = false, invalid = !(stream instanceof Readable), saturated = false;
  let bytes = 0, pending = "", listenerGets = 0, started = 0, finished = 0, closedComplete = 0, closedIncomplete = 0;
  const statuses: Record<string, number> = {};
  if (stream instanceof Readable) {
    stream.on("error", () => { invalid = true; });
    stream.on("end", () => { if (pending) invalid = true; });
    stream.on("data", (data: Buffer) => {
      if (invalid || !Buffer.isBuffer(data)) { invalid = true; return; }
      bytes += data.length;
      if (bytes > 65536) { invalid = true; pending = ""; return; }
      pending += data.toString("ascii");
      while (pending.includes("\n")) {
        const end = pending.indexOf("\n"), line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line === "ready" && !ready) ready = true;
        else if (!ready || saturated) invalid = true;
        else if (line === "l") listenerGets++;
        else if (line === "s") started++;
        else if (/^f:[1-5][0-9]{2}$/.test(line)) {
          finished++; const status = line.slice(2); statuses[status] = (statuses[status] ?? 0) + 1;
        } else if (line === "c:1") closedComplete++;
        else if (line === "c:0") closedIncomplete++;
        else if (line === "saturated") saturated = true;
        else invalid = true;
      }
      if (pending.length > 32) { invalid = true; pending = ""; }
    });
  }
  return { snapshot: () => ({ ready, invalid, saturated, listenerGets, started, finished, closedComplete, closedIncomplete, statuses: { ...statuses } }) };
}
