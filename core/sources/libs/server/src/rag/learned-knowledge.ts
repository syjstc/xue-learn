import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type {
  CompletedUnitKnowledgeReadRepository,
  CompletedUnitKnowledgeSnapshot,
} from "../../../domain/src/index.js";
import { getEmbeddings } from "../llm/client.js";
import {
  addDocumentsToScopedCollection,
  deleteChunksByMetadata,
  getScopedDocumentCount,
  queryScopedCollection,
} from "./vector-store.js";
import { parseJson } from "../utils.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 900,
  chunkOverlap: 120,
});

function strings(raw: string): string[] {
  const value = parseJson<unknown>(raw, []);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function knowledgeText(unit: {
  unitTitle: string;
  contentSummary: string;
  goalTitle: string;
  material: {
    introduction: string;
    sections: string;
    keyTakeaways: string;
  } | null;
}): string {
  const material = unit.material;
  const sections = material ? parseJson<unknown>(material.sections, []) : [];
  const sectionText = Array.isArray(sections)
    ? sections
        .map((section) =>
          section && typeof section === "object"
            ? Object.values(section as Record<string, unknown>)
                .filter((value): value is string => typeof value === "string")
                .join("\n")
            : "",
        )
        .filter(Boolean)
        .join("\n\n")
    : "";
  return [
    `Learned course: ${unit.goalTitle}`,
    `Completed unit: ${unit.unitTitle}`,
    unit.contentSummary && `Summary:\n${unit.contentSummary}`,
    material?.introduction && `Introduction:\n${material.introduction}`,
    sectionText && `Lesson content:\n${sectionText}`,
    material && `Key takeaways:\n${strings(material.keyTakeaways).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Replace the searchable snapshot for a completed unit. Safe to call repeatedly. */
export async function indexCompletedUnitKnowledge(
  unitId: string,
  owner: {
    userId: string;
    source: CompletedUnitKnowledgeReadRepository;
  },
): Promise<void> {
  try {
    const snapshot: CompletedUnitKnowledgeSnapshot | null =
      await owner.source.findOwnedSnapshot(owner.userId, unitId);
    if (!snapshot) return;
    const userId = snapshot.userId;
    await deleteChunksByMetadata("learned", userId, { unitId });
    const docs = await splitter.splitDocuments([
      new Document({
        pageContent: knowledgeText(snapshot),
        metadata: {
          userId,
          goalId: snapshot.goalId,
          goalTitle: snapshot.goalTitle,
          unitId: snapshot.unitId,
          unitTitle: snapshot.unitTitle,
          knowledgeKind: "completed_unit",
        },
      }),
    ]);
    if (docs.length === 0) return;
    await addDocumentsToScopedCollection("learned", userId, docs, {
      userId,
      scope: "learned_knowledge",
    });
  } catch (error) {
    // Completion must still succeed if the optional retrieval backend is down.
    console.warn(
      `[rag] Failed to index completed unit ${unitId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function retrieveLearnedKnowledge(
  userId: string | null | undefined,
  query: string,
  options: { k?: number; excludeUnitId?: string } = {},
): Promise<{ context: string; unitIds: string[] }> {
  if (!userId || !query.trim()) return { context: "", unitIds: [] };
  try {
    const count = await getScopedDocumentCount("learned", userId);
    if (count === 0) return { context: "", unitIds: [] };
    const k = options.k ?? 5;
    const fetchK = options.excludeUnitId ? k * 2 : k;
    const docs = await queryScopedCollection("learned", userId, query, fetchK);
    const rows = docs
      .map((doc) => ({
        text: doc.pageContent,
        meta: doc.metadata as Record<string, unknown>,
      }))
      .filter(
        (row) =>
          row.text &&
          (!options.excludeUnitId || row.meta.unitId !== options.excludeUnitId),
      )
      .slice(0, k);
    return {
      unitIds: [
        ...new Set(
          rows
            .map((row) => row.meta.unitId)
            .filter((id): id is string => typeof id === "string"),
        ),
      ],
      context: rows
        .map((row, index) => {
          const title =
            typeof row.meta.unitTitle === "string"
              ? row.meta.unitTitle
              : "previous unit";
          return `[Prior knowledge ${index + 1}: ${title}]\n${row.text}`;
        })
        .join("\n\n---\n\n"),
    };
  } catch (error) {
    console.warn(
      "[rag] Learned-knowledge retrieval unavailable:",
      error instanceof Error ? error.message : error,
    );
    return { context: "", unitIds: [] };
  }
}

export function formatLearnedKnowledgePrompt(context: string): string {
  if (!context.trim()) return "";
  return `【学习者已学知识（仅用于建立联系、类比和比较）】
${context}

使用规则：
- 在确实能降低理解成本时，明确连接到上述已学概念。
- 说明相似点和关键差异，避免把类比当作定义或证据。
- 不要假设学习者仍然完全掌握；必要时用一句话快速复习。`;
}
