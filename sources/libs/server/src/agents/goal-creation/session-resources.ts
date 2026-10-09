import { extractBufferText, ingestText } from "../../rag/ingest.js";
import { extractUrlSources, sourceId } from "../../rag/url-source.js";
import { deleteChunksByMetadata } from "../../rag/vector-store.js";
import { requireRagDocuments } from "../../rag/persistence.js";
import { requireAgentConversationPersistence } from "../core/checkpoint.js";

async function sessionForThread(threadId: string) {
  const id =
    await requireAgentConversationPersistence().findGoalCreationSessionId(
      threadId,
    );
  return id ? { id } : null;
}

export async function persistSessionFiles(
  threadId: string,
  files: Array<{ filename: string; buffer: Buffer }>,
) {
  const session = await sessionForThread(threadId);
  if (!session) return { persisted: false, fileCount: files.length };
  const resources = [];
  for (const file of files) {
    const text = await extractBufferText(file.buffer, file.filename);
    if (!text.trim()) {
      throw new Error(`无法从《${file.filename}》提取到可用文本`);
    }
    resources.push({
      kind: "file",
      filename: file.filename,
      extractedText: text,
    });
  }
  await requireAgentConversationPersistence().replacePendingGoalCreationResources(
    session.id,
    "file",
    resources,
  );
  return { persisted: true, fileCount: files.length };
}

export async function persistSessionUrls(threadId: string, urls: string[]) {
  const session = await sessionForThread(threadId);
  if (!session) return null;
  const results = await extractUrlSources(urls);
  await requireAgentConversationPersistence().replacePendingGoalCreationResources(
    session.id,
    "url",
    results.flatMap((result) =>
      result.status === "success"
        ? [
            {
              kind: "url",
              filename: result.source.title,
              sourceUrl: result.source.originalUrl,
              canonicalUrl: result.source.canonicalUrl,
              provider: result.source.provider,
              extractedText: result.source.text,
              warning: result.source.warning ?? "",
            },
          ]
        : [],
    ),
  );
  return results;
}

export async function listSessionResourceTexts(threadId: string) {
  const session = await sessionForThread(threadId);
  if (!session) return [];
  return requireAgentConversationPersistence().listGoalCreationResources(
    session.id,
    ["ready", "ingested"],
  );
}

export async function ingestSessionResources(
  threadId: string,
  goalId: string,
  onProgress?: (message: string) => void | Promise<void>,
) {
  const session = await sessionForThread(threadId);
  if (!session) return null;
  const resources =
    await requireAgentConversationPersistence().listGoalCreationResources(
      session.id,
      ["ready"],
    );
  if (resources.length === 0) return { fileCount: 0, chunks: 0 };
  let chunks = 0;
  for (const [index, resource] of resources.entries()) {
    await onProgress?.(
      `正在处理资料（${index + 1}/${resources.length}）：${resource.filename}…`,
    );
    const chunkIdentity: Record<string, string> = resource.canonicalUrl
      ? { sourceId: sourceId(resource.canonicalUrl) }
      : { filename: resource.filename };
    // A worker can be interrupted after vector publication but before the
    // resource checkpoint. Replacing this resource's chunks makes retry safe.
    await deleteChunksByMetadata("goal", goalId, chunkIdentity);
    chunks += await ingestText(
      goalId,
      resource.extractedText,
      resource.kind === "url"
        ? {
            filename: resource.filename,
            source: "url",
            sourceId: sourceId(
              resource.canonicalUrl ?? resource.sourceUrl ?? resource.id,
            ),
            sourceUrl: resource.sourceUrl ?? "",
            canonicalUrl: resource.canonicalUrl ?? "",
            provider: resource.provider ?? "",
          }
        : { filename: resource.filename, source: "upload" },
      onProgress,
    );
    const documents = requireRagDocuments();
    const document = resource.canonicalUrl
      ? await documents.findByCanonicalUrl(goalId, resource.canonicalUrl)
      : await documents.findByFilename(goalId, resource.filename);
    if (!document) {
      await documents.create({
        goalId,
        filename: resource.filename,
        sourceType: resource.kind,
        sourceUrl: resource.sourceUrl,
        canonicalUrl: resource.canonicalUrl,
        provider: resource.provider,
        title: resource.kind === "url" ? resource.filename : null,
        warning: resource.warning || null,
        subtitleStatus: null,
      });
    }
    await requireAgentConversationPersistence().markGoalCreationResourceIngested(
      resource.id,
    );
  }
  return { fileCount: resources.length, chunks };
}
