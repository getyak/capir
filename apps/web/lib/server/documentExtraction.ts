import "server-only";

import { createHash } from "node:crypto";

import type { EvidenceFragmentInput } from "@talent-signal/contracts";
import mammoth from "mammoth";
import mammothPackage from "mammoth/package.json";
import { PDFParse } from "pdf-parse";
import { assertBoundedDocxArchive } from "./bounded-docx";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_DOCX_BYTES = 3 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 200_000;
const MAX_FRAGMENTS = 300;
const MAX_FRAGMENT_CHARACTERS = 35_000;

export type ExtractedDocument = {
  byte_size: number;
  content_hash: string;
  fragments: EvidenceFragmentInput[];
  links: string[];
  parser_warnings: string[];
};

function extension(name: string): string {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

function canonicalLink(value: string): string | null {
  try {
    const url = new URL(value.replace(/[),.;!?]+$/, ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractLinks(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const canonical = canonicalLink(match[0]);
    if (canonical) {
      links.add(canonical);
    }
    if (links.size >= 20) {
      break;
    }
  }
  return [...links];
}

function chunks(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) {
    return [];
  }
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, "\n").trim())
    .filter(Boolean);
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    for (
      let offset = 0;
      offset < paragraph.length;
      offset += MAX_FRAGMENT_CHARACTERS
    ) {
      output.push(
        paragraph.slice(offset, offset + MAX_FRAGMENT_CHARACTERS),
      );
    }
  }
  return output;
}

function assertExtractionBounds(
  values: string[],
): void {
  const characters = values.reduce(
    (total, value) => total + value.length,
    0,
  );
  if (
    characters === 0 ||
    characters > MAX_EXTRACTED_CHARACTERS ||
    values.length > MAX_FRAGMENTS
  ) {
    throw new Error(
      characters === 0
        ? "No readable text was found in this document."
        : "提取后的文档超出有边界的审阅范围。",
    );
  }
}

function fragmentBase(
  clientResourceId: string,
  sequence: number,
  text: string,
  parser: { name: string; version: string },
): Pick<
  EvidenceFragmentInput,
  | "client_resource_id"
  | "sequence"
  | "text"
  | "attribution"
  | "review_status"
  | "parser"
> {
  return {
    client_resource_id: clientResourceId,
    sequence,
    text,
    attribution: {
      actor_kind: "document_author",
      status: "proposed",
    },
    review_status: "proposed",
    parser,
  };
}

export async function extractDocument(
  file: File,
  clientResourceId: string,
): Promise<ExtractedDocument> {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new Error("请选择一个不超过 6 MB 的非空文档。");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const suffix = extension(file.name);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const warnings: string[] = [];
  let fragments: EvidenceFragmentInput[] = [];
  let completeText = "";

  if (
    file.type === "application/pdf" ||
    suffix === ".pdf"
  ) {
    if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
      throw new Error("所选文件没有有效的 PDF 文件头。");
    }
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      const values = result.pages.flatMap((page) =>
        chunks(page.text).map((text, paragraphIndex) => ({
          page: page.num,
          paragraph: paragraphIndex + 1,
          text,
        })),
      );
      assertExtractionBounds(values.map((value) => value.text));
      fragments = values.map((value, sequence) => ({
        ...fragmentBase(clientResourceId, sequence, value.text, {
          name: "pdf-parse",
          version: "2.4.5",
        }),
        kind: "page_text",
        locator: {
          kind: "page_text",
          page: value.page,
          paragraph: value.paragraph,
        },
      }));
      completeText = values.map((value) => value.text).join("\n\n");
    } finally {
      await parser.destroy();
    }
  } else if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    suffix === ".docx"
  ) {
    if (file.size > MAX_DOCX_BYTES) {
      throw new Error(
        "DOCX intake is limited to 3 MB to bound archive expansion.",
      );
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error("所选文件没有有效的 DOCX 容器。");
    }
    await assertBoundedDocxArchive(bytes);
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    const values = chunks(result.value);
    assertExtractionBounds(values);
    warnings.push(
      ...result.messages.map((message) => message.message).slice(0, 20),
    );
    fragments = values.map((text, sequence) => ({
      ...fragmentBase(clientResourceId, sequence, text, {
        name: "mammoth-raw-text",
        version: mammothPackage.version,
      }),
      kind: "document_text",
      locator: {
        kind: "document_text",
        paragraph: sequence + 1,
      },
    }));
    completeText = values.join("\n\n");
  } else if (
    file.type.startsWith("text/") ||
    [".txt", ".md", ".markdown"].includes(suffix)
  ) {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const values = chunks(decoded);
    assertExtractionBounds(values);
    fragments = values.map((text, sequence) => ({
      ...fragmentBase(clientResourceId, sequence, text, {
        name: "utf8-text",
        version: "1.0.0",
      }),
      kind: "document_text",
      locator: {
        kind: "document_text",
        paragraph: sequence + 1,
      },
    }));
    completeText = values.join("\n\n");
  } else {
    throw new Error("请使用 PDF、DOCX、TXT 或 Markdown 文档。");
  }

  return {
    byte_size: file.size,
    content_hash: contentHash,
    fragments,
    links: extractLinks(completeText),
    parser_warnings: warnings,
  };
}
