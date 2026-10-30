import type { ReadingDocument } from "../../../domain/src/reading-document.js";

/** A ready reading document can inform Display without acquiring its generation lock. */
let read: ((owner: string, unit: string, section: string) => Promise<string | null>) | undefined;
export function configureReadingContext(provider: typeof read) { read = provider; }
export async function readyReadingContext(owner: string, unit: string, section: string) {
  // Reading is optional evidence. Its storage or component failures must never
  // turn into a prerequisite for independently generated Display content.
  try {return await read?.(owner, unit, section) ?? null;}
  catch {return null;}
}
let readDocument: ((owner: string, unit: string, section: string, documentId: string) => Promise<ReadingDocument | null>) | undefined;
export function configureReadingDocument(provider: typeof readDocument) { readDocument = provider; }
export async function readingDocumentForFollowUp(owner: string, unit: string, section: string, documentId: string) {
  return await readDocument?.(owner, unit, section, documentId) ?? null;
}
