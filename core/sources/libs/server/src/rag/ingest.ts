import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { addDocumentsToCollection } from "./vector-store.js";
import { extractDocumentText } from "./extract-document.js";
import { normalizeIngestText } from "./ingest-text.js";
import { getRagMaxChunksPerUpload } from "./rag-config.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 800,
  chunkOverlap: 100,
});

export async function ingestText(
  goalId: string,
  text: string,
  metadata: Record<string, string> = {},
  onProgress?: (message: string) => void | Promise<void>,
): Promise<number> {
  const normalized = normalizeIngestText(text);
  if (!normalized) {
    const label =
      typeof metadata.filename === "string" && metadata.filename
        ? `《${metadata.filename}》`
        : "该文件";
    throw new Error(
      `无法从${label}提取到可用文本，请检查文件是否为扫描件或内容为空`,
    );
  }

  const doc = new Document({ pageContent: normalized, metadata });
  const chunks = await splitter.splitDocuments([doc]);

  const maxChunks = await getRagMaxChunksPerUpload();
  if (chunks.length > maxChunks) {
    const nextStep =
      process.env.XUELEARN_DESKTOP_LOCAL === "1"
        ? "请拆分文件、删减内容，或前往“本机设置 → 资料处理”提高单文件分段上限。"
        : "请拆分文件、删减内容，或联系管理员调整单文件分段上限。";
    throw new Error(
      `资料过长：切分为 ${chunks.length} 段，超过上限 ${maxChunks}。${nextStep}`,
    );
  }

  await addDocumentsToCollection(goalId, chunks, onProgress);
  return chunks.length;
}

export async function ingestBuffer(
  goalId: string,
  buffer: Buffer,
  filename: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<number> {
  await onProgress?.(`正在解析《${filename}》…`);
  const text = await extractDocumentText(buffer, filename);
  return ingestText(goalId, text, { filename, source: "upload" }, onProgress);
}

export async function extractBufferText(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  return extractDocumentText(buffer, filename);
}
