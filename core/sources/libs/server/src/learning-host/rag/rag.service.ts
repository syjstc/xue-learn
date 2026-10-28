import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { decodeMultipartFilename, tBackend } from "../../../../common/src/index.js";
import { deleteGoalUploadedDocument } from "../../rag/delete-document.js";
import { ingestBuffer } from "../../rag/ingest.js";
import { ingestText } from "../../rag/ingest.js";
import {
  deleteLocalResource,
  resolveLocalResourcePath,
  storeLocalResource,
} from "../../rag/local-resource-store.js";
import {
  extractUrlSources,
  localizeUrlSourceError,
  sourceId,
} from "../../rag/url-source.js";
import { deleteChunksByMetadata } from "../../rag/vector-store.js";
import { runWithUserId } from "../../user-context.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

export type RagUploadFile = Readonly<{
  originalname: string;
  buffer: Buffer;
}>;

@Injectable()
export class RagService {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  private async requireOwnedGoal(userId: string, goalId: string) {
    if (!(await this.learningSpaceOrm.ragDocument.ownsGoal(userId, goalId))) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
  }

  private async updateGoalPathSource(
    userId: string,
    goalId: string,
    pathSource: "rag" | "search" | "generic",
  ) {
    const updated =
      await this.learningSpaceOrm.goalMutations.updateOwnedSemantic({
        userId,
        goalId,
        patch: { pathSource },
      });
    if (!updated) throw new NotFoundException(tBackend("error.goal.notFound"));
  }

  async ingest(
    userId: string,
    goalId: string,
    files: readonly RagUploadFile[],
    onProgress?: (message: string) => void | Promise<void>,
  ) {
    if (files.length === 0 || !goalId) {
      throw new BadRequestException(tBackend("error.rag.filesAndGoalRequired"));
    }

    await this.requireOwnedGoal(userId, goalId);

    return runWithUserId(userId, async () => {
      const results: { filename: string; chunks: number }[] = [];
      let totalChunks = 0;

      for (const file of files) {
        const filename = decodeMultipartFilename(file.originalname);
        await onProgress?.(`正在处理《${filename}》…`);
        const documents = this.learningSpaceOrm.ragDocument;
        const stored = await storeLocalResource(file.buffer, filename);
        let chunks = 0;
        try {
          chunks = await ingestBuffer(
            goalId,
            file.buffer,
            filename,
            onProgress,
          );
          if (chunks === 0) {
            throw new BadRequestException(
              tBackend("error.rag.fileTextUnavailable", { filename }),
            );
          }

          const existing = await documents.findByFilename(goalId, filename);
          if (!existing) {
            await documents.create({
              goalId,
              filename,
              sourceType: "file",
              sourceUrl: null,
              canonicalUrl: null,
              provider: null,
              title: null,
              warning: null,
              subtitleStatus: null,
              storageKey: stored?.storageKey ?? null,
              contentHash: stored?.contentHash ?? null,
              contentType: stored?.contentType ?? null,
              byteSize: stored?.byteSize ?? null,
            });
          } else if (stored) {
            await documents.update(existing.id, stored);
            if (
              existing.storageKey &&
              existing.storageKey !== stored.storageKey &&
              (await documents.countByStorageKey(existing.storageKey)) === 0
            ) {
              await deleteLocalResource(existing.storageKey);
            }
          }
        } catch (error) {
          if (
            stored &&
            (await documents.countByStorageKey(stored.storageKey)) === 0
          ) {
            await deleteLocalResource(stored.storageKey);
          }
          throw error;
        }

        totalChunks += chunks;
        results.push({ filename, chunks });
        await onProgress?.(`《${filename}》已建立索引（${chunks} 段）`);
      }

      await this.updateGoalPathSource(userId, goalId, "rag");

      return {
        goalId,
        fileCount: files.length,
        chunks: totalChunks,
        files: results,
      };
    });
  }

  async deleteDocument(userId: string, goalId: string, documentId: string) {
    if (!goalId || !documentId) {
      throw new BadRequestException(
        tBackend("error.rag.goalAndDocumentRequired"),
      );
    }

    await this.requireOwnedGoal(userId, goalId);

    try {
      const existing = await this.learningSpaceOrm.ragDocument.findById(
        goalId,
        documentId,
      );
      const result = await deleteGoalUploadedDocument(goalId, documentId, {
        userId,
        goalMutations: this.learningSpaceOrm.goalMutations,
      });
      if (
        existing?.storageKey &&
        (await this.learningSpaceOrm.ragDocument.countByStorageKey(
          existing.storageKey,
        )) === 0
      ) {
        await deleteLocalResource(existing.storageKey);
      }
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof Error && err.message === "DOCUMENT_NOT_FOUND") {
        throw new NotFoundException(tBackend("error.rag.documentNotFound"));
      }
      throw err;
    }
  }

  async getOriginal(userId: string, goalId: string, documentId: string) {
    if (!goalId || !documentId) {
      throw new BadRequestException(
        tBackend("error.rag.goalAndDocumentRequired"),
      );
    }
    await this.requireOwnedGoal(userId, goalId);
    const document = await this.learningSpaceOrm.ragDocument.findById(
      goalId,
      documentId,
    );
    if (!document?.storageKey || !document.contentType) {
      throw new NotFoundException(tBackend("error.rag.documentNotFound"));
    }
    return {
      path: resolveLocalResourcePath(document.storageKey),
      filename: document.filename,
      contentType: document.contentType,
    };
  }

  async ingestUrls(
    userId: string,
    goalId: string,
    urls: string[],
    refresh = false,
  ) {
    if (!goalId || urls.length === 0) {
      throw new BadRequestException(tBackend("error.rag.goalAndUrlsRequired"));
    }
    if (urls.length > 10) {
      throw new BadRequestException(
        tBackend("error.rag.tooManyUrls", { count: 10 }),
      );
    }
    await this.requireOwnedGoal(userId, goalId);
    let extracted: Awaited<ReturnType<typeof extractUrlSources>>;
    try {
      extracted = await extractUrlSources(urls);
    } catch (error) {
      throw new BadRequestException(
        localizeUrlSourceError(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    const results: unknown[] = [];
    for (const item of extracted) {
      if (item.status === "error") {
        results.push({ ...item, error: localizeUrlSourceError(item.error) });
        continue;
      }
      const source = item.source;
      const documents = this.learningSpaceOrm.ragDocument;
      const existing = await documents.findByCanonicalUrl(
        goalId,
        source.canonicalUrl,
      );
      if (existing && !refresh) {
        results.push({
          status: "error",
          url: source.originalUrl,
          error: tBackend("error.rag.urlAlreadyAdded"),
        });
        continue;
      }
      if (existing) {
        try {
          await deleteChunksByMetadata("goal", goalId, {
            sourceId: sourceId(source.canonicalUrl),
          });
        } catch {
          // Re-ingestion below remains safe when the prior chunks are absent.
        }
      }
      try {
        const chunks = await ingestText(goalId, source.text, {
          filename: source.title,
          source: "url",
          sourceId: source.sourceId,
          sourceType: source.sourceType,
          sourceUrl: source.originalUrl,
          canonicalUrl: source.canonicalUrl,
          provider: source.provider,
          subtitleStatus: "",
        });
        const data = {
          filename: source.title,
          sourceType: source.sourceType,
          sourceUrl: source.originalUrl,
          canonicalUrl: source.canonicalUrl,
          provider: source.provider,
          title: source.title,
          warning: source.warning ?? null,
          subtitleStatus: null,
        };
        if (existing) {
          await documents.update(existing.id, data);
        } else {
          await documents.create({ goalId, ...data });
        }
        results.push({
          status: "success",
          url: source.originalUrl,
          title: source.title,
          sourceType: source.sourceType,
          provider: source.provider,
          warning: source.warning,
          chunks,
        });
      } catch (error) {
        results.push({
          status: "error",
          url: source.originalUrl,
          error: tBackend("error.rag.sourceIngestionFailed"),
        });
      }
    }
    if (
      results.some((item) => (item as { status?: string }).status === "success")
    ) {
      await this.updateGoalPathSource(userId, goalId, "rag");
    }
    return { goalId, results };
  }
}
