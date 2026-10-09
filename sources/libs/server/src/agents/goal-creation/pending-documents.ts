import { ingestBuffer } from "../../rag/ingest.js";
import { ingestText } from "../../rag/ingest.js";
import {
  extractUrlSources,
  type ExtractedUrlSource,
} from "../../rag/url-source.js";
import {
  ingestSessionResources,
  persistSessionFiles,
  persistSessionUrls,
} from "./session-resources.js";
import { requireRagDocuments } from "../../rag/persistence.js";

type PendingFile = { filename: string; buffer: Buffer };

const pendingByThread = new Map<string, PendingFile[]>();
const pendingUrlsByThread = new Map<string, ExtractedUrlSource[]>();

export function hasPendingGoalDocuments(threadId: string): boolean {
  return (
    (pendingByThread.get(threadId)?.length ?? 0) > 0 ||
    (pendingUrlsByThread.get(threadId)?.length ?? 0) > 0
  );
}

export function clearPendingGoalDocuments(threadId: string): void {
  pendingByThread.delete(threadId);
  pendingUrlsByThread.delete(threadId);
}

export async function storePendingGoalUrls(threadId: string, urls: string[]) {
  const durableResults = await persistSessionUrls(threadId, urls);
  if (durableResults) {
    return {
      results: durableResults.map((item) =>
        item.status === "success"
          ? {
              status: item.status,
              url: item.source.originalUrl,
              title: item.source.title,
              sourceType: item.source.sourceType,
              provider: item.source.provider,
              warning: item.source.warning,
            }
          : item,
      ),
    };
  }
  const results = await extractUrlSources(urls);
  const sources = results
    .filter(
      (item): item is { status: "success"; source: ExtractedUrlSource } =>
        item.status === "success",
    )
    .map((item) => item.source);
  pendingUrlsByThread.set(threadId, sources);
  return {
    results: results.map((item) =>
      item.status === "success"
        ? {
            status: item.status,
            url: item.source.originalUrl,
            title: item.source.title,
            sourceType: item.source.sourceType,
            provider: item.source.provider,
            warning: item.source.warning,
          }
        : item,
    ),
  };
}

export function listPendingGoalUrlSources(
  threadId: string,
): ExtractedUrlSource[] {
  return pendingUrlsByThread.get(threadId) ?? [];
}

export async function storePendingGoalDocuments(
  threadId: string,
  files: Array<{ filename: string; buffer: Buffer }>,
): Promise<{ fileCount: number }> {
  if (files.length === 0) {
    clearPendingGoalDocuments(threadId);
    return { fileCount: 0 };
  }
  const durable = await persistSessionFiles(threadId, files);
  if (durable.persisted) return { fileCount: durable.fileCount };
  pendingByThread.set(threadId, files);
  return { fileCount: files.length };
}

export function listPendingGoalDocuments(
  threadId: string,
): Array<{ filename: string; buffer: Buffer }> {
  return pendingByThread.get(threadId) ?? [];
}

export async function ingestPendingGoalDocuments(
  threadId: string,
  goalId: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<{ fileCount: number; chunks: number }> {
  const durable = await ingestSessionResources(threadId, goalId, onProgress);
  if (durable && durable.fileCount > 0) return durable;
  const files = pendingByThread.get(threadId) ?? [];
  const urlSources = pendingUrlsByThread.get(threadId) ?? [];
  if (files.length === 0 && urlSources.length === 0) {
    return { fileCount: 0, chunks: 0 };
  }

  let totalChunks = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (files.length > 1) {
      await onProgress?.(
        `正在处理资料（${index + 1}/${files.length}）：${file.filename}…`,
      );
    }
    const chunks = await ingestBuffer(
      goalId,
      file.buffer,
      file.filename,
      onProgress,
    );
    if (chunks === 0) {
      throw new Error(
        `无法从《${file.filename}》提取到可用文本，请检查文件内容后重试`,
      );
    }
    totalChunks += chunks;
    const documents = requireRagDocuments();
    const existing = await documents.findByFilename(goalId, file.filename);
    if (!existing) {
      await documents.create({
        goalId,
        filename: file.filename,
        sourceType: "upload",
        sourceUrl: null,
        canonicalUrl: null,
        provider: null,
        title: null,
        warning: null,
        subtitleStatus: null,
      });
    }
  }

  for (const source of urlSources) {
    await onProgress?.(`正在写入来源《${source.title}》…`);
    totalChunks += await ingestText(
      goalId,
      source.text,
      {
        filename: source.title,
        source: "url",
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        sourceUrl: source.originalUrl,
        canonicalUrl: source.canonicalUrl,
        provider: source.provider,
        subtitleStatus: "",
      },
      onProgress,
    );
    await requireRagDocuments().create({
      goalId,
      filename: source.title,
      sourceType: source.sourceType,
      sourceUrl: source.originalUrl,
      canonicalUrl: source.canonicalUrl,
      provider: source.provider,
      title: source.title,
      warning: source.warning ?? null,
      subtitleStatus: null,
    });
  }

  clearPendingGoalDocuments(threadId);
  return { fileCount: files.length + urlSources.length, chunks: totalChunks };
}
