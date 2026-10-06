import { describe, expect, it } from "vitest";

import {
  COMPOSER_DOCX_MAX_BYTES,
  COMPOSER_PDF_MAX_BYTES,
  COMPOSER_TEXT_MAX_BYTES,
  composerDocumentByteLimit,
  composerDocumentStageState,
  composerDocumentType,
  composerFileIntakePlan,
  composerFileKind,
  decodeComposerTextDocument,
} from "./composer-document";

function file(
  name: string,
  type: string,
  size = 1_024,
): File {
  const blob = new File([new Uint8Array(Math.min(size, 8))], name, { type });
  Object.defineProperty(blob, "size", { value: size });
  return blob;
}

describe("composer file classification", () => {
  it("keeps PNG/JPEG/WebP on the real attachment path", () => {
    expect(composerFileKind({ name: "a.png", type: "image/png" })).toBe("image");
    expect(composerFileKind({ name: "b.jpeg", type: "image/jpeg" })).toBe("image");
    expect(composerFileKind({ name: "c.webp", type: "image/webp" })).toBe("image");
    expect(composerFileKind({ name: "d.png", type: "" })).toBe("image");
  });

  it("recognises PDF, DOCX and UTF-8 text documents", () => {
    expect(composerDocumentType({ name: "cv.pdf", type: "application/pdf" })).toBe("pdf");
    expect(composerDocumentType({ name: "cv.docx", type: "" })).toBe("docx");
    expect(composerDocumentType({ name: "notes.md", type: "text/markdown" })).toBe("text");
    expect(composerDocumentType({ name: "data.csv", type: "" })).toBe("text");
    expect(composerDocumentType({ name: "main.tsx", type: "" })).toBe("text");
    expect(composerDocumentType({ name: "config.json", type: "application/json" })).toBe("text");
  });

  it("rejects binary, archive, executable and audio formats locally", () => {
    for (const candidate of [
      { name: "a.zip", type: "application/zip" },
      { name: "b.exe", type: "application/octet-stream" },
      { name: "c.mp3", type: "audio/mpeg" },
      { name: "d.heic", type: "image/heic" },
      { name: "e.gif", type: "image/gif" },
      { name: "f.xlsx", type: "application/vnd.ms-excel" },
      { name: "g", type: "application/octet-stream" },
    ]) {
      expect(composerFileKind(candidate)).toBe("unsupported");
    }
  });

  it("maps byte limits per document type", () => {
    expect(composerDocumentByteLimit("pdf")).toBe(COMPOSER_PDF_MAX_BYTES);
    expect(composerDocumentByteLimit("docx")).toBe(COMPOSER_DOCX_MAX_BYTES);
    expect(composerDocumentByteLimit("text")).toBe(COMPOSER_TEXT_MAX_BYTES);
  });
});

describe("composer intake batches", () => {
  it("routes an all-image batch to the attachment path", () => {
    const plan = composerFileIntakePlan([
      file("a.png", "image/png"),
      file("b.webp", "image/webp"),
    ]);
    expect(plan.kind).toBe("images");
  });

  it("routes a single document to preview", () => {
    const plan = composerFileIntakePlan([file("cv.pdf", "application/pdf")]);
    expect(plan).toMatchObject({ kind: "document", documentType: "pdf" });
  });

  it("rejects mixed image and document batches atomically", () => {
    const plan = composerFileIntakePlan([
      file("a.png", "image/png"),
      file("cv.pdf", "application/pdf"),
    ]);
    expect(plan).toMatchObject({ kind: "reject" });
    if (plan.kind === "reject") {
      expect(plan.message).toContain("分开添加");
    }
  });

  it("rejects multi-document batches atomically with useful copy", () => {
    const plan = composerFileIntakePlan([
      file("a.txt", "text/plain"),
      file("b.md", "text/markdown"),
    ]);
    expect(plan).toMatchObject({ kind: "reject" });
    if (plan.kind === "reject") {
      expect(plan.message).toContain("一次只预览一个文档");
    }
  });

  it("rejects empty and oversize documents before any upload", () => {
    const empty = composerFileIntakePlan([file("a.txt", "text/plain", 0)]);
    expect(empty).toMatchObject({ kind: "reject", message: "这个文件是空的，没有可预览的文本。" });
    const oversize = composerFileIntakePlan([
      file("huge.pdf", "application/pdf", COMPOSER_PDF_MAX_BYTES + 1),
    ]);
    expect(oversize).toMatchObject({ kind: "reject" });
    if (oversize.kind === "reject") {
      expect(oversize.message).toContain("6 MB");
    }
  });
});

describe("local text decoding", () => {
  it("decodes UTF-8 text without normalizing it away", () => {
    const bytes = new TextEncoder().encode("第一行\n\nsecond");
    expect(decodeComposerTextDocument(bytes)).toEqual({
      ok: true,
      text: "第一行\n\nsecond",
    });
  });

  it("reports invalid UTF-8, emptiness and oversize honestly", () => {
    expect(decodeComposerTextDocument(new Uint8Array([0x61, 0, 0x62, 0]))).toMatchObject({ ok: false });
    expect(decodeComposerTextDocument(new Uint8Array([0xff, 0xfe, 0xfd]))).toMatchObject({
      ok: false,
      message: expect.stringContaining("UTF-8"),
    });
    expect(decodeComposerTextDocument(new Uint8Array(0))).toMatchObject({ ok: false });
    expect(decodeComposerTextDocument(new Uint8Array([0x20, 0x0a]))).toMatchObject({
      ok: false,
      message: expect.stringContaining("没有可加入草稿的文本"),
    });
    const big = new Uint8Array(COMPOSER_TEXT_MAX_BYTES + 1);
    expect(decodeComposerTextDocument(big)).toMatchObject({
      ok: false,
      message: expect.stringContaining("2 MB"),
    });
  });
});

describe("excerpt and draft budget", () => {
  it("requires the excerpt, separator and untouched draft to fit", () => {
    const state = composerDocumentStageState({
      excerptLength: 398,
      draftLength: 500,
      separatorLength: 2,
      maxLength: 1_000,
      sendLimit: 1_000,
    });
    expect(state).toEqual({
      total: 900,
      remaining: 100,
      fits: true,
      budget: 1_000,
    });

    const over = composerDocumentStageState({
      excerptLength: 700,
      draftLength: 500,
      maxLength: 1_000,
      sendLimit: 1_000,
    });
    expect(over.fits).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("never lets an import create an unsendable Session draft", () => {
    // Session drafts type to 12,000 manually, but an import must fit the
    // 1,000-character send limit: 1,200 + 300 is rejected, not staged.
    const state = composerDocumentStageState({
      excerptLength: 1_200,
      draftLength: 300,
      maxLength: 12_000,
      sendLimit: 1_000,
    });
    expect(state.fits).toBe(false);
    expect(state.budget).toBe(1_000);
    expect(state.remaining).toBe(0);

    const fitting = composerDocumentStageState({
      excerptLength: 698,
      draftLength: 300,
      separatorLength: 2,
      maxLength: 12_000,
      sendLimit: 1_000,
    });
    expect(fitting.fits).toBe(true);
  });
});
