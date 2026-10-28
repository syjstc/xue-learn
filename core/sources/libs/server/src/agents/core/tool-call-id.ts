import { createHash } from "node:crypto";

/** Keep tool call/result identities stable within providers' 64-character limit. */
export function boundedToolCallId(id: string): string {
  if (id.length <= 64) return id;
  // Hash the entire ID: truncating would collapse distinct contract revisions.
  return `call_${createHash("sha256").update(id).digest("hex").slice(0, 56)}`;
}
