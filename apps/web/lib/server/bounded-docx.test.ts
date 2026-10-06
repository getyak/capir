import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertBoundedDocxArchive, MAX_EXPANDED_DOCX_BYTES } from "./bounded-docx";

function archive(content: Buffer, declared = content.length, method = 8): Buffer {
  const name = Buffer.from("word/document.xml");
  const payload = method === 8 ? deflateRawSync(content) : content;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + payload.length, 16);
  return Buffer.concat([local, name, payload, central, name, end]);
}

describe("DOCX expansion boundary", () => {
  it("accepts bounded stored and deflated entries", async () => {
    for (const method of [0, 8]) {
      await expect(assertBoundedDocxArchive(archive(Buffer.from("synthetic text"), undefined, method))).resolves.toBeUndefined();
    }
  });

  it("rejects actual expansion over the limit even with lying metadata", async () => {
    const compressed = archive(Buffer.alloc(MAX_EXPANDED_DOCX_BYTES + 1, 65), 1);
    expect(compressed.length).toBeLessThan(100_000);
    await expect(assertBoundedDocxArchive(compressed)).rejects.toThrow("parsing boundary");
  });

  it("rejects inconsistent sizes and truncated archives", async () => {
    const valid = archive(Buffer.from("synthetic text"));
    await expect(assertBoundedDocxArchive(archive(Buffer.from("synthetic text"), 1))).rejects.toThrow();
    await expect(assertBoundedDocxArchive(valid.subarray(0, valid.length - 1))).rejects.toThrow();
    await expect(assertBoundedDocxArchive(new Uint8Array())).rejects.toThrow();
  });

  it("rejects encrypted and shifted archive layouts", async () => {
    const encrypted = archive(Buffer.from("synthetic text"));
    encrypted.writeUInt16LE(1, 6);
    const central = encrypted.readUInt32LE(encrypted.length - 6);
    encrypted.writeUInt16LE(1, central + 8);
    await expect(assertBoundedDocxArchive(encrypted)).rejects.toThrow();
    const shifted = Buffer.concat([Buffer.from("prefix"), archive(Buffer.from("synthetic text"))]);
    await expect(assertBoundedDocxArchive(shifted)).rejects.toThrow();
  });
});
