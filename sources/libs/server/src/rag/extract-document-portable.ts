import {
  isSupportedDocumentFilename,
  SUPPORTED_DOCUMENT_LABEL,
} from "./document-formats.js";
import { normalizeIngestText } from "./ingest-text.js";

type PdfGeometryGlobals = typeof globalThis & {
  DOMMatrix?: typeof DOMMatrix;
  pdfjsWorker?: { WorkerMessageHandler?: unknown };
};

/**
 * PDF.js constructs a DOMMatrix while its module is loading, including for
 * text-only extraction. The standalone desktop sidecar intentionally does not
 * ship @napi-rs/canvas's native renderer, so install the package's bundled
 * pure-JavaScript geometry implementation before importing pdf-parse.
 */
export function ensurePortablePdfGeometry(): void {
  const runtime = globalThis as PdfGeometryGlobals;
  if (runtime.DOMMatrix) return;
  // Static require lets esbuild include geometry.js without pulling the native
  // canvas binding into the desktop-local artifact.
  const geometry = require("@napi-rs/canvas/geometry.js") as {
    DOMMatrix: typeof DOMMatrix;
  };
  runtime.DOMMatrix = geometry.DOMMatrix;
}

async function ensurePortablePdfWorker(): Promise<void> {
  const runtime = globalThis as PdfGeometryGlobals;
  if (runtime.pdfjsWorker?.WorkerMessageHandler) return;
  // PDF.js otherwise tries to resolve a worker URL at runtime, which does not
  // exist inside the standalone CJS sidecar. Esbuild embeds this module and its
  // side effect registers WorkerMessageHandler on globalThis.
  // @ts-expect-error pdfjs-dist does not publish declarations for its worker entry.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  if (!runtime.pdfjsWorker?.WorkerMessageHandler) {
    throw new Error("Bundled PDF worker failed to initialize.");
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  ensurePortablePdfGeometry();
  await ensurePortablePdfWorker();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractLegacyDocText(buffer: Buffer): Promise<string> {
  const { writeFile, unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { randomUUID } = await import("node:crypto");
  const WordExtractor = (await import("word-extractor")).default;

  const tmpPath = join(tmpdir(), `xue-learn-${randomUUID()}.doc`);
  try {
    await writeFile(tmpPath, buffer);
    const extractor = new WordExtractor();
    const doc = await extractor.extract(tmpPath);
    return doc.getBody();
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * Portable document extraction without the optional scanned-PDF OCR graph.
 * Keep this boundary free of native image dependencies so local runtimes can
 * embed it without shipping an unused Sharp/libvips toolchain.
 */
export async function extractPortableDocumentText(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const lower = filename.toLowerCase();
  if (!isSupportedDocumentFilename(filename)) {
    throw new Error(`Unsupported file type. Use ${SUPPORTED_DOCUMENT_LABEL}.`);
  }

  let text = "";
  if (lower.endsWith(".pdf")) {
    text = await extractPdfText(buffer);
  } else if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    text = buffer.toString("utf-8");
  } else if (lower.endsWith(".docx")) {
    text = await extractDocxText(buffer);
  } else if (lower.endsWith(".doc")) {
    text = await extractLegacyDocText(buffer);
  }

  return normalizeIngestText(text);
}
