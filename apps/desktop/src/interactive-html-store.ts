import { randomUUID } from "node:crypto";

export const INTERACTIVE_HTML_SCHEME = "xuelearn-html";
export const INTERACTIVE_HTML_HOST = "playground";
export const INTERACTIVE_HTML_MAX_CHARS = 80_000;
const MAX_DOCUMENTS_PER_OWNER = 16;

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InteractiveHtmlRegistration = {
  documentId: string;
  src: string;
};

export function interactiveHtmlDocumentUrl(documentId: string): string {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new Error("Invalid playground document id");
  }
  return `${INTERACTIVE_HTML_SCHEME}://${INTERACTIVE_HTML_HOST}/${documentId}`;
}

export function parseInteractiveHtmlDocumentId(
  requestUrl: string,
): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${INTERACTIVE_HTML_SCHEME}:`) return null;
    if (url.hostname !== INTERACTIVE_HTML_HOST) return null;
    const documentId = url.pathname.replace(/^\//, "");
    return DOCUMENT_ID_PATTERN.test(documentId) ? documentId : null;
  } catch {
    return null;
  }
}

export class InteractiveHtmlPlayground {
  private readonly documents = new Map<
    string,
    { html: string; ownerId: number }
  >();
  private readonly byOwner = new Map<number, string[]>();

  register(ownerId: number, html: unknown): InteractiveHtmlRegistration {
    if (
      typeof html !== "string" ||
      html.length === 0 ||
      html.length > INTERACTIVE_HTML_MAX_CHARS
    ) {
      throw new Error("Invalid playground HTML");
    }
    const owned = this.byOwner.get(ownerId) ?? [];
    while (owned.length >= MAX_DOCUMENTS_PER_OWNER) {
      const oldest = owned[0];
      if (oldest) this.release(ownerId, oldest);
      else break;
    }
    const documentId = randomUUID();
    this.documents.set(documentId, { html, ownerId });
    owned.push(documentId);
    this.byOwner.set(ownerId, owned);
    return { documentId, src: interactiveHtmlDocumentUrl(documentId) };
  }

  release(ownerId: number, documentId: unknown): void {
    if (typeof documentId !== "string") return;
    const record = this.documents.get(documentId);
    if (!record || record.ownerId !== ownerId) return;
    this.documents.delete(documentId);
    const owned = this.byOwner.get(ownerId);
    if (!owned) return;
    const next = owned.filter((id) => id !== documentId);
    if (next.length === 0) this.byOwner.delete(ownerId);
    else this.byOwner.set(ownerId, next);
  }

  releaseAll(ownerId: number): void {
    const owned = this.byOwner.get(ownerId);
    if (!owned) return;
    for (const documentId of [...owned]) this.release(ownerId, documentId);
  }

  documentForUrl(requestUrl: string): string | null {
    const documentId = parseInteractiveHtmlDocumentId(requestUrl);
    if (!documentId) return null;
    return this.documents.get(documentId)?.html ?? null;
  }
}
