import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "../lib/hash.js";

/** Each immutable attempt directory is also its commit capability. */
export class LocalChatMediaUploads {
  constructor(private readonly directory: string) {}
  private base(key: string) { return resolve(this.directory, ".chat-media-attempts", sha256(key)); }
  private path(key: string, id: string, state: "pending" | "committed" | "cancelled") {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid local upload attempt identity");
    return resolve(this.base(key), `${state}-${id}`);
  }
  private async matches(path: string, id: string, size: number, type: string) {
    try {
      const file = resolve(path, "receipt.json"), info = await stat(file);
      if (!info.isFile() || info.size > 4096) return false;
      const receipt = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      return receipt.version === "local-media-attempt.v1" && receipt.attempt_id === id &&
        receipt.byte_size === size && receipt.content_type === type;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
      throw error;
    }
  }
  async reserve(key: string, id: string, size: number, type: string) {
    await mkdir(this.base(key), { recursive: true, mode: 0o700 });
    for (const state of ["committed", "cancelled"] as const) {
      try { await stat(this.path(key, id, state)); throw new Error("Local attempt identity is already settled"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const pending = this.path(key, id, "pending");
    await mkdir(pending, { mode: 0o700 });
    await writeFile(resolve(pending, "receipt.json"), JSON.stringify({ version: "local-media-attempt.v1",
      attempt_id: id, byte_size: size, content_type: type }), { mode: 0o600, flag: "wx" });
  }
  async put(key: string, id: string, body: Uint8Array) {
    const pending = this.path(key, id, "pending");
    // Never recreate a missing directory: an operator may have atomically
    // cancelled this capability while its process was stopped or still alive.
    const file = await open(resolve(pending, "body"), "wx", 0o600);
    try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
    // Commit and cancellation rename the SAME source directory. Exactly one
    // can win; a delayed writer cannot publish a cancelled directory later.
    await rename(pending, this.path(key, id, "committed"));
  }
  async verify(key: string, id: string, size: number, type: string) {
    const committed = this.path(key, id, "committed");
    if (!await this.matches(committed, id, size, type)) return false;
    try { const info = await stat(resolve(committed, "body")); return info.isFile() && info.size === size; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  async reconcile(key: string, id: string, size: number, type: string): Promise<"completed" | "cancelled" | null> {
    if (await this.verify(key, id, size, type)) return "completed";
    const pending = this.path(key, id, "pending"), cancelled = this.path(key, id, "cancelled");
    if (await this.matches(pending, id, size, type)) {
      try { await rename(pending, cancelled); return "cancelled"; }
      catch (error) {
        if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
    if (await this.verify(key, id, size, type)) return "completed";
    return await this.matches(cancelled, id, size, type) ? "cancelled" : null;
  }
  async get(key: string, id: string) { return readFile(resolve(this.path(key, id, "committed"), "body")); }
  async exists(key: string) {
    try { return (await readdir(this.base(key))).length > 0; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  async delete(key: string) { await rm(this.base(key), { recursive: true, force: true }); }
}
