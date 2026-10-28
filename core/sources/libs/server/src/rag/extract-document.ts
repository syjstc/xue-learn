import { getEnv } from "../env.js";
import { normalizeIngestText } from "./ingest-text.js";
import {
  extractPdfText,
  extractPortableDocumentText,
} from "./extract-document-portable.js";

/** Below this length, PDF text is treated as image-only and OCR is attempted. */
const OCR_MIN_TEXT_CHARS = 80;

async function ocrPdfText(buffer: Buffer): Promise<string> {
  const env = getEnv();
  const pdf = (await import("pdf-to-img")).default;
  const { createWorker } = await import("tesseract.js");

  const doc = await pdf(buffer, { scale: 2 });
  const maxPages = env.DOCUMENT_OCR_MAX_PAGES;
  if (doc.length > maxPages) {
    await doc.destroy();
    throw new Error(
      `扫描版 PDF 共 ${doc.length} 页，超过 OCR 上限 ${maxPages} 页。请拆分文件或在 .env 中提高 DOCUMENT_OCR_MAX_PAGES。`,
    );
  }

  const worker = await createWorker(env.DOCUMENT_OCR_LANGUAGES);
  const pageTexts: string[] = [];

  try {
    let pageNum = 0;
    for await (const image of doc) {
      pageNum += 1;
      const {
        data: { text },
      } = await worker.recognize(image);
      const trimmed = text.trim();
      if (trimmed) {
        pageTexts.push(trimmed);
      }
      if (pageNum >= maxPages) break;
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }

  return pageTexts.join("\n\n");
}

async function extractPdfWithOptionalOcr(buffer: Buffer): Promise<string> {
  const env = getEnv();
  const directText = await extractPdfText(buffer);
  const normalizedDirect = normalizeIngestText(directText);

  if (normalizedDirect.length >= OCR_MIN_TEXT_CHARS || !env.DOCUMENT_OCR_ENABLED) {
    return normalizedDirect;
  }

  try {
    const ocrText = normalizeIngestText(await ocrPdfText(buffer));
    return ocrText.length > normalizedDirect.length ? ocrText : normalizedDirect;
  } catch (err) {
    if (normalizedDirect.length > 0) return normalizedDirect;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法从 PDF 提取文本（OCR 失败：${message}）`);
  }
}

export async function extractDocumentText(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  return filename.toLowerCase().endsWith(".pdf")
    ? extractPdfWithOptionalOcr(buffer)
    : extractPortableDocumentText(buffer, filename);
}
