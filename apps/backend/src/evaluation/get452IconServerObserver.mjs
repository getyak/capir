/** Explicit Hosted-only passive observation in the owned Next child.
 * No HTTP patch/proxy, extra request, header/body read or public endpoint. */
import { channel } from "node:diagnostics_channel";
import { writeSync } from "node:fs";

const port = Number(process.env.GET452_ICON_OBSERVER_PORT);
if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true"
  || process.env.GET452_ICON_OBSERVER !== "1" || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("GET452 icon observer requires its explicit owned Hosted child");
}
const responses = new WeakSet();
let emitted = 0, saturated = false, unavailable = false;
function emit(line) {
  if (unavailable || saturated) return;
  try {
    if (emitted++ >= 4096) { writeSync(3, "saturated\n"); saturated = true; return; }
    writeSync(3, line + "\n");
  } catch { unavailable = true; }
}
channel("http.server.request.start").subscribe(message => {
  try {
    const { request, response, socket } = message;
    if (socket.localPort !== port || request.method !== "GET") return;
    emit("l"); // Closed channel-health count, without route/target information.
    if (typeof request.url !== "string" || !/^\/icon(?:\?|$)/.test(request.url)) return;
    if (responses.has(response)) return;
    responses.add(response); emit("s");
    response.once("close", () => { try { emit(response.writableFinished ? "c:1" : "c:0"); } catch { emit("observer_error"); } });
  } catch { emit("observer_error"); }
});
channel("http.server.response.finish").subscribe(message => {
  try {
    const { response } = message;
    if (!responses.has(response)) return;
    const status = response.statusCode;
    emit(Number.isInteger(status) && status >= 100 && status <= 599 ? `f:${status}` : "observer_error");
  } catch { emit("observer_error"); }
});
emit("ready");
