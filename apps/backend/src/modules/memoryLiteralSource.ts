import {
  MEMORY_LITERAL_PROTOCOL, MemoryContentError, verifyMemoryMessageRange,
  type MemoryMessageRangeV2,
} from "@talent-signal/contracts";
import { sha256 } from "../lib/hash.js";
import { sourceRevisionHash, type MemorySourceAuthority } from "./memoryReviewStore.js";

export interface MemoryLiteralGroundingOptions {
  contentProtocol: unknown;
  authority: MemorySourceAuthority;
  locator: unknown;
}

/** Pure validation of already host-admitted source authority. This does not
 * load a source, authorize a caller, renew TTL or convert pixels to text. */
export function verifiedLiteralMessageRange(excerpt: string, options: MemoryLiteralGroundingOptions): Readonly<MemoryMessageRangeV2> | null {
  if (options.contentProtocol !== MEMORY_LITERAL_PROTOCOL) return null;
  const authority = options.authority;
  if (typeof authority.text !== "string" || !authority.messageId) return null;
  const textHash = sha256(authority.text);
  if (authority.messageTextHash !== textHash) return null;
  try {
    const range = verifyMemoryMessageRange(excerpt, options.locator, {
      text: authority.text, session_id: authority.sessionId, message_id: authority.messageId,
      source_revision_hash: sourceRevisionHash(authority), source_text_sha256: textHash,
    });
    return range.excerpt_sha256 === sha256(excerpt) ? range : null;
  } catch (error) {
    if (error instanceof MemoryContentError) return null;
    throw error;
  }
}
