import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  LOCAL_JSONL_TRUNCATED_MESSAGE,
  LOCAL_JSON_CORRUPT_MESSAGE,
  LOCAL_JSON_MALFORMED_MESSAGE,
  LOCAL_RECORD_NOT_REGULAR_MESSAGE,
  isLocalRecordFingerprint,
  isLocalRecordID,
  publishImmutableJsonRecord,
  readPersistedJsonlLines,
  readPersistedJsonRecord,
  replaceMutableJsonRecord,
} from "./localResearchFiles.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
} from "./test/research-store-worker.mjs";

const uuidControl = vi.hoisted(() => ({ values: [] as string[] }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID(): string {
      return uuidControl.values.shift() ?? actual.randomUUID();
    },
  };
});

const temporaryDirectories: string[] = [];

interface ExampleRecord {
  recordID: string;
  body: { label: string };
  createdAt: string;
}

function parseExample(value: Record<string, unknown>): ExampleRecord {
  const body = value.body;
  if (
    typeof value.recordID !== "string" ||
    typeof value.createdAt !== "string" ||
    (body !== null && (typeof body !== "object" || Array.isArray(body))) ||
    typeof (body as { label?: unknown } | null)?.label !== "string"
  ) {
    throw new Error("The persisted example record is corrupt.");
  }
  return {
    recordID: value.recordID,
    body: body as { label: string },
    createdAt: value.createdAt,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  uuidControl.values.length = 0;
  await cleanupResearchWorkers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

beforeAll(async () => {
  await ensureFreshHostBuild();
}, 180_000);

async function makeDirectory() {
  const directory = await fs.mkdtemp(join(tmpdir(), "talent-signal-files-"));
  temporaryDirectories.push(directory);
  return directory;
}

function temporaryFiles(directory: string) {
  return fs.readdir(directory).then((entries) =>
    entries.filter((entry) => entry.endsWith(".tmp")),
  );
}

describe("local persisted JSON records", () => {
  it("returns null only for an absent record", async () => {
    const directory = await makeDirectory();
    await expect(
      readPersistedJsonRecord(join(directory, "absent.json"), parseExample),
    ).resolves.toBeNull();
  });

  it("raises a fixed content-free failure for malformed persisted JSON", async () => {
    const directory = await makeDirectory();
    const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
    const path = join(directory, "record.json");
    const malformed = `{"objective": "${canary}", "provider": `;
    await fs.writeFile(path, malformed, "utf8");

    const failure = await readPersistedJsonRecord(path, parseExample).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(LOCAL_JSON_MALFORMED_MESSAGE);
    expect(String(failure)).not.toContain(canary);
    expect(failure).not.toHaveProperty("cause");
    expect(await fs.readFile(path, "utf8")).toBe(malformed);
  });

  it("treats a null or array envelope as corrupt, not absent", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "record.json");
    for (const content of ["null", "[]", '"text"']) {
      await fs.writeFile(path, content, "utf8");
      await expect(
        readPersistedJsonRecord(path, parseExample),
      ).rejects.toThrow(LOCAL_JSON_CORRUPT_MESSAGE);
      expect(await fs.readFile(path, "utf8")).toBe(content);
    }
  });

  it("rejects symlinked and non-regular persisted targets without following them", async () => {
    const directory = await makeDirectory();
    const target = join(directory, "target.json");
    await fs.writeFile(
      target,
      JSON.stringify({
        recordID: "33333333-3333-4333-8333-333333333333",
        body: { label: "private" },
        createdAt: "2026-08-30T00:00:00.000Z",
      }),
      "utf8",
    );
    const path = join(directory, "record.json");
    await fs.symlink(target, path);
    await expect(readPersistedJsonRecord(path, parseExample)).rejects.toThrow(
      LOCAL_RECORD_NOT_REGULAR_MESSAGE,
    );
    expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toMatchObject({
      body: { label: "private" },
    });

    await fs.unlink(path);
    await fs.mkdir(path);
    await expect(readPersistedJsonRecord(path, parseExample)).rejects.toThrow(
      LOCAL_RECORD_NOT_REGULAR_MESSAGE,
    );
  });

  it("publishes immutable records without ever replacing an existing record", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "record.json");
    const record: ExampleRecord = {
      recordID: "33333333-3333-4333-8333-333333333333",
      body: { label: "first" },
      createdAt: "2026-08-30T00:00:00.000Z",
    };
    const first = await publishImmutableJsonRecord(path, record, parseExample);
    expect(first).toEqual({ record, replayed: false });
    const published = await fs.readFile(path, "utf8");
    expect(JSON.parse(published)).toEqual(record);
    const publishedFile = await fs.open(path, "r");
    try {
      expect((await publishedFile.stat()).mode & 0o777).toBe(0o600);
    } finally {
      await publishedFile.close();
    }

    // Equivalent replay returns the ORIGINAL record and timestamps.
    const replay = await publishImmutableJsonRecord(
      path,
      { ...record, createdAt: "2026-08-31T00:00:00.000Z" },
      (value) => {
        const existing = parseExample(value);
        if (existing.body.label !== record.body.label) {
          throw new Error("conflict");
        }
        return existing;
      },
    );
    expect(replay).toEqual({ record, replayed: true });
    expect(await fs.readFile(path, "utf8")).toBe(published);
    expect(await temporaryFiles(directory)).toEqual([]);
  });

  it("rejects a conflict or helper I/O failure without overwrite and without leaving its temporary file", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "record.json");
    const record: ExampleRecord = {
      recordID: "33333333-3333-4333-8333-333333333333",
      body: { label: "first" },
      createdAt: "2026-08-30T00:00:00.000Z",
    };
    await publishImmutableJsonRecord(path, record, parseExample);
    const published = await fs.readFile(path, "utf8");

    await expect(
      publishImmutableJsonRecord(
        path,
        { ...record, body: { label: "conflict" } },
        () => {
          throw new Error("semantic conflict");
        },
      ),
    ).rejects.toThrow("semantic conflict");
    expect(await fs.readFile(path, "utf8")).toBe(published);
    expect(await temporaryFiles(directory)).toEqual([]);

    // A non-regular existing target is a read failure, not a replay: the
    // helper cleans its own temporary file and never overwrites the target.
    await fs.unlink(path);
    await fs.mkdir(path);
    await expect(
      publishImmutableJsonRecord(path, record, parseExample),
    ).rejects.toThrow();
    expect(await temporaryFiles(directory)).toEqual([]);

    // A denied directory fails before publication and still leaves no temp.
    await fs.rmdir(path);
    await fs.chmod(directory, 0o500);
    try {
      await expect(
        publishImmutableJsonRecord(path, record, parseExample),
      ).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await fs.chmod(directory, 0o700);
    }
    expect(await temporaryFiles(directory)).toEqual([]);
  });

  it("replaces only mutable records with an atomic rename and normal temp cleanup", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "checkpoint.json");
    await replaceMutableJsonRecord(path, { sequence: 1 });
    await replaceMutableJsonRecord(path, { sequence: 2 });
    expect(JSON.parse(await fs.readFile(path, "utf8"))).toEqual({
      sequence: 2,
    });
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    expect(await temporaryFiles(directory)).toEqual([]);

    await fs.unlink(path);
    await fs.mkdir(join(directory, "checkpoint.json"));
    await expect(
      replaceMutableJsonRecord(path, { sequence: 3 }),
    ).rejects.toThrow();
    expect(await temporaryFiles(directory)).toEqual([]);
  });

  it("fails without deleting a pre-existing temporary file it does not own", async () => {
    const directory = await makeDirectory();
    const collisionUUID = "00000000-0000-4000-8000-000000000000";
    const sentinelBytes = "SENTINEL-OWNED-ELSEWHERE";

    // Immutable publication: deterministic randomUUID collision puts the
    // exclusive create on a sentinel file. The operation rejects and the
    // unowned sentinel keeps its exact bytes.
    const immutableTarget = join(directory, "record.json");
    const immutableTemporary = `${immutableTarget}.${process.pid}.${collisionUUID}.tmp`;
    await fs.writeFile(immutableTemporary, sentinelBytes, "utf8");
    uuidControl.values.push(collisionUUID);
    await expect(
      publishImmutableJsonRecord(
        immutableTarget,
        {
          recordID: "33333333-3333-4333-8333-333333333333",
          body: { label: "first" },
          createdAt: "2026-08-30T00:00:00.000Z",
        },
        parseExample,
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(immutableTemporary, "utf8")).toBe(sentinelBytes);
    await expect(fs.access(immutableTarget)).rejects.toThrow();

    // Mutable replacement: same collision contract.
    const mutableTarget = join(directory, "checkpoint.json");
    const mutableTemporary = `${mutableTarget}.${process.pid}.${collisionUUID}.tmp`;
    await fs.writeFile(mutableTemporary, sentinelBytes, "utf8");
    uuidControl.values.push(collisionUUID);
    await expect(
      replaceMutableJsonRecord(mutableTarget, { sequence: 1 }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(mutableTemporary, "utf8")).toBe(sentinelBytes);
    await expect(fs.access(mutableTarget)).rejects.toThrow();
  });

  it("cleans its own partial temporary file when serialization fails after creation", async () => {
    const directory = await makeDirectory();
    const exploding: ExampleRecord & { toJSON(): never } = {
      recordID: "33333333-3333-4333-8333-333333333333",
      body: { label: "first" },
      createdAt: "2026-08-30T00:00:00.000Z",
      toJSON(): never {
        throw new Error("serialization exploded");
      },
    };

    // Both writers create their exclusive temporary file before serializing;
    // the partial file is owned by this call and must be cleaned, while the
    // failure itself propagates unchanged.
    await expect(
      publishImmutableJsonRecord<ExampleRecord>(
        join(directory, "record.json"),
        exploding,
        parseExample,
      ),
    ).rejects.toThrow("serialization exploded");
    expect(await temporaryFiles(directory)).toEqual([]);

    await expect(
      replaceMutableJsonRecord(join(directory, "checkpoint.json"), exploding),
    ).rejects.toThrow("serialization exploded");
    expect(await temporaryFiles(directory)).toEqual([]);
  });

  it("rejects a FIFO in a bounded real child without blocking the reader", async () => {
    const directory = await makeDirectory();
    const fifoPath = join(directory, "record.json");
    execFileSync("mkfifo", [fifoPath]);

    const worker = spawnResearchWorker({ kind: "read-record", path: fifoPath });
    await worker.waitFor("ready");
    worker.send("go");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        worker.result,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error("readPersistedJsonRecord blocked on a FIFO"),
              ),
            10_000,
          );
        }),
      ]);
      expect(result.ok).toBe(false);
      // Fixed nonregular rejection: the FIFO is neither followed nor read nor
      // treated as absent.
      expect(result.error).toBe(LOCAL_RECORD_NOT_REGULAR_MESSAGE);
    } finally {
      if (timer) clearTimeout(timer);
      // Terminates only this handle's owned child on any failure path.
      await worker.cleanup();
    }
    expect((await fs.lstat(fifoPath)).isFIFO()).toBe(true);
  });

  it("accepts only canonical lowercase digests and preserves UUID behavior", () => {
    expect(isLocalRecordFingerprint("a".repeat(64))).toBe(true);
    expect(isLocalRecordFingerprint("A".repeat(64))).toBe(false);
    expect(isLocalRecordFingerprint(`${"a".repeat(63)}A`)).toBe(false);
    expect(isLocalRecordID("33333333-3333-4333-8333-333333333333")).toBe(true);
    // Original UUID matching stays case-insensitive.
    expect(isLocalRecordID("33333333-3333-4333-8333-33333333333A")).toBe(true);
    expect(isLocalRecordID("33333333-3333-4333-8333-33333333333G")).toBe(false);
  });
});

describe("local persisted JSONL records", () => {
  it("returns no lines for an absent or empty journal and splits complete records", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "events.jsonl");
    await expect(readPersistedJsonlLines(path)).resolves.toEqual([]);
    await fs.writeFile(path, "", "utf8");
    await expect(readPersistedJsonlLines(path)).resolves.toEqual([]);
    await fs.writeFile(path, "{\"sequence\":1}\n{\"sequence\":2}\n", "utf8");
    await expect(readPersistedJsonlLines(path)).resolves.toEqual([
      '{"sequence":1}',
      '{"sequence":2}',
    ]);
  });

  it("rejects a torn final record even when its partial JSON would parse", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "events.jsonl");
    const torn = '{"sequence":2}';
    await fs.writeFile(path, `{"sequence":1}\n${torn}`, "utf8");

    const failure = await readPersistedJsonlLines(path).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(LOCAL_JSONL_TRUNCATED_MESSAGE);
    expect(failure).not.toHaveProperty("cause");
    // The torn record keeps its exact bytes; a future append cannot run over
    // this reader's failure and concatenate JSON objects.
    expect(await fs.readFile(path, "utf8")).toBe(`{"sequence":1}\n${torn}`);
  });

  it("rejects symlinked and non-regular journals without following them", async () => {
    const directory = await makeDirectory();
    const target = join(directory, "elsewhere-events.jsonl");
    await fs.writeFile(target, '{"sequence":1}\n', "utf8");
    const path = join(directory, "events.jsonl");
    await fs.symlink(target, path);
    await expect(readPersistedJsonlLines(path)).rejects.toThrow(
      LOCAL_RECORD_NOT_REGULAR_MESSAGE,
    );
    expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);

    await fs.unlink(path);
    await fs.mkdir(path);
    await expect(readPersistedJsonlLines(path)).rejects.toThrow(
      LOCAL_RECORD_NOT_REGULAR_MESSAGE,
    );
  });
});

  it("does not unlink a pathname transferred to a second writer after rename", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "checkpoint.json");
    const uuid = "00000000-0000-4000-8000-000000000000";
    uuidControl.values.push(uuid, uuid);
    const temporary = `${path}.${process.pid}.${uuid}.tmp`;
    const barrier = () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      return { promise, release };
    };
    const firstRenamed = barrier();
    const secondCreated = barrier();
    const allowFirst = barrier();
    const allowSecond = barrier();
    const originalRename = fs.rename.bind(fs);
    const originalChmod = fs.chmod.bind(fs);
    let renameCalls = 0;
    let chmodCalls = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (++renameCalls === 2) {
        secondCreated.release();
        await allowSecond.promise;
      }
      await originalRename(...args);
    });
    vi.spyOn(fs, "chmod").mockImplementation(async (...args) => {
      if (++chmodCalls === 1) {
        firstRenamed.release();
        await allowFirst.promise;
      }
      await originalChmod(...args);
    });
    const owned: Promise<void>[] = [];
    try {
      const first = replaceMutableJsonRecord(path, { sequence: 1 });
      owned.push(first);
      await firstRenamed.promise;
      const second = replaceMutableJsonRecord(path, { sequence: 2 });
      owned.push(second);
      await secondCreated.promise;
      allowFirst.release();
      await first;
      expect(JSON.parse(await fs.readFile(temporary, "utf8"))).toEqual({ sequence: 2 });
      allowSecond.release();
      await second;
      expect(JSON.parse(await fs.readFile(path, "utf8"))).toEqual({ sequence: 2 });
      expect(await temporaryFiles(directory)).toEqual([]);
    } finally {
      allowFirst.release();
      allowSecond.release();
      await Promise.allSettled(owned);
    }
  }, 10_000);
