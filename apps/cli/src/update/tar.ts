/**
 * Minimal, strictly confined tar.gz reader/extractor for release archives.
 *
 * Node has no built-in tar; the standalone updater must extract archives
 * without shelling out and without trusting them. This reader understands
 * ustar, GNU long name/link and pax extended headers — the formats the
 * release builder produces — and refuses everything else.
 *
 * Confinement is proven over the whole ENTRY GRAPH before any write:
 *   - no absolute entry paths, no `..` segments, no NUL or backslash tricks;
 *   - no duplicate normalized paths;
 *   - entry types limited to file, directory and symlink (no hardlinks,
 *     devices, fifos, setuid/setgid);
 *   - no regular file or directory may live under a symlink ancestor;
 *   - every symlink target is resolved PHYSICALLY through the complete link
 *     graph (chains and nested hops included) and must stay under the
 *     extraction root; link cycles are rejected outright. Lexical checks
 *     alone are insufficient: `a -> ..`, `b -> a/..` then `b/pwn` escapes
 *     even though every target looks contained in isolation.
 *
 * Extraction writes regular entries and directories first, then hardlinks (as
 * copies of their referenced member), and only then symlinks, so no file is
 * ever written through a link.
 */
import { createGunzip, gunzipSync } from "node:zlib";
import { createReadStream, mkdirSync, writeFileSync, symlinkSync, chmodSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { CapirCliError, EXIT } from "../errors.js";

const BLOCK = 512;

export interface TarEntry {
  /** Normalized relative entry path (forward slashes, no leading ./). */
  path: string;
  type: "file" | "directory" | "symlink" | "hardlink";
  mode: number;
  size: number;
  /** Symlink target or hardlink member reference exactly as recorded. */
  linkTarget?: string | undefined;
  /** Offset of the entry's data in the returned buffer. */
  dataOffset: number;
}

export interface TarArchive {
  entries: TarEntry[];
  data: Buffer;
}

/** Graph node used by both archive preflight and real-tree validation. */
export interface LinkNode {
  path: string;
  type: "file" | "directory" | "symlink" | "hardlink";
  linkTarget?: string | undefined;
}

function archiveError(message: string): CapirCliError {
  return new CapirCliError("CAPIR_UPDATE_ARCHIVE_UNSAFE", EXIT.INFRASTRUCTURE, message);
}

function readString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(buffer: Buffer, offset: number, length: number): number {
  const text = readString(buffer, offset, length).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw archiveError("Archive header carries a malformed numeric field.");
  return parseInt(text, 8);
}

function validateHeaderChecksum(block: Buffer, index: number): void {
  const stored = readOctal(block, 148, 8);
  let unsigned = 0;
  for (let i = 0; i < BLOCK; i++) {
    unsigned += i >= 148 && i < 156 ? 0x20 : block[i]!;
  }
  if (unsigned !== stored) {
    throw archiveError(`Archive header block ${index} fails its checksum; refusing to extract.`);
  }
}

/** Reject absolute paths, parent traversal and platform-dependent separators. */
function normalizeEntryPath(raw: string): string {
  if (!raw || raw.includes("\0")) throw archiveError("Archive entry with empty or NUL path refused.");
  const path = raw.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!path || path.startsWith("/") || isAbsolute(path))
    throw archiveError(`Archive entry "${raw}" uses an absolute path; refused.`);
  for (const segment of path.split("/")) {
    if (segment === ".." || segment === "")
      throw archiveError(`Archive entry "${raw}" escapes the extraction root; refused.`);
  }
  return path;
}

function paxFields(chunk: Buffer): Map<string, string> {
  const fields = new Map<string, string>();
  let offset = 0;
  while (offset < chunk.length) {
    const space = chunk.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(chunk.subarray(offset, space).toString("utf8"));
    if (!Number.isInteger(length) || length <= 0 || offset + length > chunk.length)
      throw archiveError("Archive pax header record is malformed; refused.");
    const record = chunk.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) fields.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return fields;
}

function posixDirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/**
 * Physical link-graph confinement proof. `nodes` are normalized relative
 * paths. Throws CAPIR_UPDATE_ARCHIVE_UNSAFE when any path is duplicated, any
 * file/directory hides under a symlink ancestor, any symlink chain cycles, or
 * any symlink's fully resolved target escapes the root. Lexical containment
 * of individual targets is deliberately NOT accepted as proof.
 */
export function validateLinkGraph(nodes: LinkNode[], label: string): void {
  const map = new Map<string, LinkNode>();
  for (const node of nodes) {
    const existing = map.get(node.path);
    if (existing) {
      if (existing.type === node.type && existing.linkTarget === node.linkTarget) continue;
      throw archiveError(`${label}: duplicate path "${node.path}" with conflicting entries.`);
    }
    map.set(node.path, node);
  }

  // No regular file or directory may sit under a symlink ancestor.
  for (const node of map.values()) {
    let parent = posixDirname(node.path);
    while (parent) {
      const ancestor = map.get(parent);
      if (ancestor?.type === "symlink")
        throw archiveError(
          `${label}: "${node.path}" lives under symlink "${parent}"; refusing symlink-ancestor trees.`,
        );
      parent = posixDirname(parent);
    }
  }

  // Resolve every symlink target physically through the full link graph.
  const resolveTarget = (linkPath: string, visiting: Set<string>): string[] => {
    const entry = map.get(linkPath);
    if (!entry || entry.type !== "symlink" || entry.linkTarget === undefined)
      throw archiveError(`${label}: "${linkPath}" is not a symlink.`);
    if (visiting.has(linkPath))
      throw archiveError(`${label}: symlink cycle through "${linkPath}"; refused.`);
    visiting.add(linkPath);
    const target = entry.linkTarget;
    if (!target || target.includes("\0") || target.startsWith("/") || isAbsolute(target.replaceAll("\\", "/")))
      throw archiveError(`${label}: symlink "${linkPath}" has an empty or absolute target; refused.`);
    const stack = posixDirname(linkPath) === "" ? [] : posixDirname(linkPath).split("/");
    const segments = target.replaceAll("\\", "/").split("/");
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        if (stack.length === 0)
          throw archiveError(
            `${label}: symlink "${linkPath}" escapes the root via "${target}"; refused.`,
          );
        stack.pop();
        continue;
      }
      stack.push(segment);
      const here = stack.join("/");
      const hop = map.get(here);
      if (hop?.type === "symlink") {
        // Follow the chain physically, then continue with remaining segments.
        const resolved = resolveTarget(here, visiting);
        stack.length = 0;
        stack.push(...resolved);
      }
    }
    visiting.delete(linkPath);
    return stack;
  };

  for (const node of map.values()) {
    if (node.type !== "symlink") continue;
    resolveTarget(node.path, new Set());
  }

  // Hardlinks may only reference another regular member (possibly through
  // other hardlinks), never a symlink and never a path outside the root.
  for (const node of map.values()) {
    if (node.type !== "hardlink") continue;
    if (!node.linkTarget || node.linkTarget.includes("\0") || node.linkTarget.startsWith("/"))
      throw archiveError(`${label}: hardlink "${node.path}" has an empty or absolute target; refused.`);
    const normalized = normalizeEntryPath(node.linkTarget);
    let reference = map.get(normalized);
    const visiting = new Set<string>([node.path]);
    while (reference?.type === "hardlink") {
      if (visiting.has(reference.path))
        throw archiveError(`${label}: hardlink cycle through "${reference.path}"; refused.`);
      visiting.add(reference.path);
      if (!reference.linkTarget || reference.linkTarget.startsWith("/"))
        throw archiveError(`${label}: hardlink "${reference.path}" has an invalid target; refused.`);
      reference = map.get(normalizeEntryPath(reference.linkTarget));
    }
    if (reference?.type !== "file")
      throw archiveError(
        `${label}: hardlink "${node.path}" does not resolve to a regular archive member; refused.`,
      );
  }
}

/** Parse a fully buffered tar (already gunzipped) and prove confinement. */
export function parseTar(data: Buffer): TarArchive {
  const entries: TarEntry[] = [];
  const graph: LinkNode[] = [];
  let offset = 0;
  let longName: string | null = null;
  let longLink: string | null = null;
  let pendingPath: string | null = null;
  let pendingLink: string | null = null;

  const push = (entry: TarEntry): void => {
    entries.push(entry);
    graph.push(
      entry.type === "symlink" || entry.type === "hardlink"
        ? { path: entry.path, type: entry.type, linkTarget: entry.linkTarget }
        : { path: entry.path, type: entry.type },
    );
  };

  while (offset + BLOCK <= data.length) {
    const block = data.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    validateHeaderChecksum(block, entries.length + 1);
    const size = readOctal(block, 124, 12);
    const dataOffset = offset + BLOCK;
    if (dataOffset + size > data.length) throw archiveError("Archive is truncated; refusing partial extraction.");
    const typeflag = String.fromCharCode(block[156]!).replace("\0", "0");
    const rawName = readString(block, 0, 100);
    const prefix = readString(block, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    const linkTarget = longLink ?? readstring157(block);
    const mode = readOctal(block, 100, 8);
    const payload = data.subarray(dataOffset, dataOffset + size);

    if (typeflag === "L") {
      longName = payload.toString("utf8").replace(/\0+$/, "");
    } else if (typeflag === "K") {
      longLink = payload.toString("utf8").replace(/\0+$/, "");
    } else if (typeflag === "x") {
      const fields = paxFields(payload);
      pendingPath = fields.get("path") ?? null;
      pendingLink = fields.get("linkpath") ?? null;
    } else if (typeflag === "g") {
      // Global pax headers carry no per-entry path information we accept.
    } else if (typeflag === "2") {
      push({
        path: normalizeEntryPath(pendingPath ?? name),
        type: "symlink",
        mode: 0o777,
        size: 0,
        linkTarget: pendingLink ?? linkTarget,
        dataOffset,
      });
      longName = null;
      longLink = null;
      pendingPath = null;
      pendingLink = null;
    } else if (typeflag === "1") {
      push({
        path: normalizeEntryPath(pendingPath ?? name),
        type: "hardlink",
        mode: mode & 0o777,
        size: 0,
        linkTarget: pendingLink ?? linkTarget,
        dataOffset,
      });
      longName = null;
      longLink = null;
      pendingPath = null;
      pendingLink = null;
    } else if (typeflag === "5") {
      push({
        path: normalizeEntryPath(pendingPath ?? name),
        type: "directory",
        mode: mode & 0o777,
        size: 0,
        dataOffset,
      });
      longName = null;
      longLink = null;
      pendingPath = null;
      pendingLink = null;
    } else if (typeflag === "0") {
      push({
        path: normalizeEntryPath(pendingPath ?? name),
        type: "file",
        mode: mode & 0o777,
        size,
        dataOffset,
      });
      longName = null;
      longLink = null;
      pendingPath = null;
      pendingLink = null;
    } else {
      throw archiveError(
        `Archive entry "${pendingPath ?? name}" uses a refused link/device/unknown type (${typeflag}); refused.`,
      );
    }
    offset = dataOffset + Math.ceil(size / BLOCK) * BLOCK;
  }

  validateLinkGraph(graph, "archive");
  return { entries, data };
}

function readstring157(block: Buffer): string {
  return readString(block, 157, 100);
}

export async function readTarGz(path: string): Promise<TarArchive> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolveDone, reject) => {
    const stream = createReadStream(path).pipe(createGunzip());
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolveDone());
    stream.on("error", reject);
  });
  return parseTar(Buffer.concat(chunks));
}

export function readTarGzSync(path: string): TarArchive {
  return parseTar(gunzipSync(readFileSync(path)));
}

/**
 * Extract a graph-validated archive under `dest`. Regular entries and
 * directories are written first, then hardlinks (as copies of their
 * referenced member), and only then symlinks, so no file is ever written
 * through a link. The caller must have parsed via parseTar (or run
 * validateLinkGraph) first.
 */
export function extractTar(archive: TarArchive, dest: string): void {
  validateLinkGraph(
    archive.entries.map((entry) =>
      entry.type === "symlink" || entry.type === "hardlink"
        ? { path: entry.path, type: entry.type, linkTarget: entry.linkTarget }
        : { path: entry.path, type: entry.type },
    ),
    "archive",
  );
  const root = resolve(dest);
  const targetFor = (entry: TarEntry): string => {
    const target = resolve(dest, entry.path);
    if (target !== root && !target.startsWith(root + sep))
      throw archiveError(`Archive entry "${entry.path}" escapes the extraction root.`);
    return target;
  };
  for (const entry of archive.entries) {
    if (entry.type !== "file" && entry.type !== "directory") continue;
    const target = targetFor(entry);
    if (entry.type === "directory") {
      mkdirSync(target, { recursive: true, mode: 0o755 });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(target, archive.data.subarray(entry.dataOffset, entry.dataOffset + entry.size), {
      mode: 0o600,
    });
    chmodSync(target, entry.mode & 0o111 ? 0o755 : 0o644);
  }
  // Hardlinks materialize as copies of their referenced member's data.
  for (const entry of archive.entries) {
    if (entry.type !== "hardlink") continue;
    const reference = resolveHardlinkSource(archive, entry);
    const target = targetFor(entry);
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(
      target,
      archive.data.subarray(reference.dataOffset, reference.dataOffset + reference.size),
      { mode: 0o600 },
    );
    chmodSync(target, entry.mode & 0o111 ? 0o755 : 0o644);
  }
  for (const entry of archive.entries) {
    if (entry.type !== "symlink") continue;
    symlinkSync(entry.linkTarget!, targetFor(entry));
  }
}

function resolveHardlinkSource(archive: TarArchive, entry: TarEntry): TarEntry {
  const byPath = new Map(archive.entries.map((item) => [item.path, item]));
  let reference = byPath.get(normalizeEntryPath(entry.linkTarget!));
  const visiting = new Set<string>([entry.path]);
  while (reference?.type === "hardlink") {
    if (visiting.has(reference.path))
      throw archiveError(`Archive hardlink cycle through "${reference.path}"; refused.`);
    visiting.add(reference.path);
    reference = byPath.get(normalizeEntryPath(reference.linkTarget!));
  }
  if (reference?.type !== "file")
    throw archiveError(`Archive hardlink "${entry.path}" has no regular source member; refused.`);
  return reference;
}

export async function extractTarGz(path: string, dest: string): Promise<TarEntry[]> {
  const archive = await readTarGz(path);
  extractTar(archive, dest);
  return archive.entries;
}
