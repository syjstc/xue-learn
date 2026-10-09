export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".doc",
  ".docx",
] as const;

export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_DOCUMENT_EXTENSIONS.join(",");

export const SUPPORTED_DOCUMENT_LABEL = "PDF / Word / TXT / MD";

export function isSupportedDocumentFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
