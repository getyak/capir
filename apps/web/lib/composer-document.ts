/**
 * Pure behaviour for document intake in the shared composer.
 *
 * The composer never pretends a document was attached. PNG/JPEG/WebP images
 * are real message attachments; documents only contribute editable draft text
 * after an explicit, in-place preview review. This module owns the local
 * decisions that must stay identical across picker, drag and paste intake:
 * file classification, atomic batch rules, bounded UTF-8 decoding and the
 * excerpt-versus-draft budget. It never touches React, the network or a draft.
 */

export type ComposerFileKind = "image" | "document" | "unsupported";

export type ComposerDocumentType = "pdf" | "docx" | "text";

export const COMPOSER_IMAGE_MIME_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** PDF and DOCX are extracted in the browser through the bounded preview API. */
export const COMPOSER_DOCUMENT_MIME_TYPES: readonly string[] = Object.freeze([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * UTF-8 text documents are decoded locally; no upload, no extraction service.
 * Extensions cover plain documents plus common source code, nothing binary.
 */
export const COMPOSER_TEXT_EXTENSIONS: readonly string[] = Object.freeze([
  ".txt", ".md", ".markdown", ".csv", ".json", ".log",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php",
  ".sh", ".bash", ".zsh", ".sql", ".html", ".css", ".scss", ".xml", ".yaml",
  ".yml", ".toml", ".ini",
]);

export const COMPOSER_PDF_MAX_BYTES = 6 * 1024 * 1024;
export const COMPOSER_DOCX_MAX_BYTES = 3 * 1024 * 1024;
export const COMPOSER_TEXT_MAX_BYTES = 2 * 1024 * 1024;

export const COMPOSER_DOCUMENT_SUPPORT_LABEL =
  "PNG、JPEG 或 WebP 图片，或 PDF、DOCX、TXT、MD、CSV、JSON 与代码文本文档";

/**
 * Honest intake disclosure. Text documents decode entirely on this device;
 * PDF/DOCX bytes are uploaded transiently to the signed-in preview endpoint
 * for parsing and are not retained. Only explicitly chosen text becomes an
 * editable draft the user sends; only images are real attachments.
 */
export const COMPOSER_DOCUMENT_DISCLOSURE =
  "文本文件在本机读取。PDF、DOCX 会临时上传以提取文本，解析后不保留原文件。选定的文本加入草稿后，仍需你发送；原文档不会作为附件发送。";

export function composerDocumentExcerptNotice(
  budget: number,
  total: number,
): string {
  return `请在下方选择或编辑要加入草稿的片段：片段与现有草稿合计需在 ${budget} 字以内（当前 ${total} 字）。完整文本可在上方查看。`;
}

function extension(name: string): string {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

/**
 * Classify a local file before anything is uploaded or parsed. Classification
 * is intentionally narrow: anything binary, archived, executable or audio is
 * unsupported and rejected locally instead of being guessed at.
 */
export function composerFileKind(file: {
  name: string;
  type: string;
}): ComposerFileKind {
  const type = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const suffix = extension(file.name);
  if (COMPOSER_IMAGE_MIME_TYPES.includes(type)) return "image";
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(suffix)) return "image";
  if (COMPOSER_DOCUMENT_MIME_TYPES.includes(type)) return "document";
  if (suffix === ".pdf" || suffix === ".docx") return "document";
  if (type.startsWith("text/") || COMPOSER_TEXT_EXTENSIONS.includes(suffix)) {
    return "document";
  }
  return "unsupported";
}

export function composerDocumentType(file: {
  name: string;
  type: string;
}): ComposerDocumentType | null {
  if (composerFileKind(file) !== "document") return null;
  const type = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const suffix = extension(file.name);
  if (type === "application/pdf" || suffix === ".pdf") return "pdf";
  if (
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    suffix === ".docx"
  ) {
    return "docx";
  }
  return "text";
}

export function composerDocumentByteLimit(
  kind: ComposerDocumentType,
): number {
  if (kind === "pdf") return COMPOSER_PDF_MAX_BYTES;
  if (kind === "docx") return COMPOSER_DOCX_MAX_BYTES;
  return COMPOSER_TEXT_MAX_BYTES;
}

export function composerDocumentByteLimitLabel(
  kind: ComposerDocumentType,
): string {
  return kind === "pdf" ? "6 MB" : kind === "docx" ? "3 MB" : "2 MB";
}

export type ComposerIntakePlan =
  | { kind: "images"; files: File[] }
  | { kind: "document"; file: File; documentType: ComposerDocumentType }
  | { kind: "reject"; message: string };

const REJECT_UNSUPPORTED = `暂不支持这类文件。可以添加${COMPOSER_DOCUMENT_SUPPORT_LABEL}。`;
const REJECT_MIXED =
  "图片和文档请分开添加：图片会随消息发送，文档文本需先预览再决定是否加入草稿。";
const REJECT_MANY_DOCUMENTS =
  "一次只预览一个文档。请单独添加这个文档；图片一次仍可添加多张。";

/**
 * One atomic decision for a selected, dropped or pasted batch. A batch that
 * mixes images and documents, or carries more than one document, is rejected
 * as a whole with copy that explains the split — never partially applied.
 */
export function composerFileIntakePlan(
  files: readonly File[],
): ComposerIntakePlan {
  if (files.length === 0) {
    return { kind: "reject", message: "没有收到文件。" };
  }
  const kinds = files.map((file) => composerFileKind(file));
  if (kinds.some((kind) => kind === "unsupported")) {
    return { kind: "reject", message: REJECT_UNSUPPORTED };
  }
  const images = files.filter((_, index) => kinds[index] === "image");
  const documents = files.filter((_, index) => kinds[index] === "document");
  if (images.length > 0 && documents.length > 0) {
    return { kind: "reject", message: REJECT_MIXED };
  }
  if (documents.length > 1) {
    return { kind: "reject", message: REJECT_MANY_DOCUMENTS };
  }
  if (documents.length === 1) {
    const file = documents[0]!;
    const documentType = composerDocumentType(file)!;
    if (file.size === 0) {
      return { kind: "reject", message: "这个文件是空的，没有可预览的文本。" };
    }
    const limit = composerDocumentByteLimit(documentType);
    if (file.size > limit) {
      return {
        kind: "reject",
        message: `${file.name} 超过 ${composerDocumentByteLimitLabel(documentType)} 上限，未做任何处理。可先拆分文档后重试。`,
      };
    }
    return { kind: "document", file, documentType };
  }
  return { kind: "images", files: [...images] };
}

export type ComposerTextDecode =
  | { ok: true; text: string }
  | { ok: false; message: string };

/**
 * Local UTF-8 decoding for text documents. Invalid UTF-8 is reported honestly;
 * nothing is decoded leniently, truncated or silently normalized away.
 */
export function decodeComposerTextDocument(
  bytes: Uint8Array,
): ComposerTextDecode {
  if (bytes.byteLength === 0) {
    return { ok: false, message: "这个文件是空的，没有可预览的文本。" };
  }
  if (bytes.byteLength > COMPOSER_TEXT_MAX_BYTES) {
    return {
      ok: false,
      message: `文本文件超过 ${composerDocumentByteLimitLabel("text")} 上限，未做任何处理。`,
    };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      message: "这不是有效的 UTF-8 文本文件。二进制文件无法预览文本。",
    };
  }
  if (text.includes("\u0000")) {
    return { ok: false, message: "这不是可读取的 UTF-8 文本。请将文件导出为 UTF-8 文本后重试。" };
  }
  if (!text.trim()) {
    return { ok: false, message: "这个文件没有可加入草稿的文本。" };
  }
  return { ok: true, text };
}

export type ComposerDocumentStageState = {
  /** Excerpt, the staging separator and the untouched draft. */
  total: number;
  remaining: number;
  /** The import fits the staging bound below. */
  fits: boolean;
  /** min(sendLimit, maxLength): an import never creates an unsendable draft. */
  budget: number;
};

/** Separator staged between an existing draft and an imported excerpt. */
export const COMPOSER_DOCUMENT_SEPARATOR = "\n\n";

/**
 * A document import must land inside the send bound on every surface: the
 * whole excerpt plus an explicit separator plus the untouched draft fits
 * min(sendLimit, maxLength). Session drafts may still be typed to their full
 * manual limit; import simply cannot create an unsendable draft. The draft
 * itself is never trimmed or rewritten.
 */
export function composerDocumentStageState(input: {
  excerptLength: number;
  draftLength: number;
  separatorLength?: number;
  maxLength: number;
  sendLimit: number;
}): ComposerDocumentStageState {
  const excerptLength = Math.max(0, input.excerptLength);
  const draftLength = Math.max(0, input.draftLength);
  const separatorLength = Math.max(0, input.separatorLength ?? 0);
  const budget = Math.max(0, Math.min(input.maxLength, input.sendLimit));
  const total = excerptLength + draftLength + separatorLength;
  return {
    total,
    remaining: Math.max(0, budget - total),
    fits: total <= budget,
    budget,
  };
}
