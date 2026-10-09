import { z } from "zod";
import { invokeWithSchema } from "../../llm/structured-invoke.js";
import { extractBufferText } from "../../rag/ingest.js";
import type { ThreadCheckpoint } from "../core/checkpoint.js";
import { goalStateFromCheckpoint } from "./state.js";
import {
  hasPendingGoalDocuments,
  listPendingGoalDocuments,
  listPendingGoalUrlSources,
} from "./pending-documents.js";
import { listSessionResourceTexts } from "./session-resources.js";

const DOCUMENT_TOPIC_MAX_CHARS = 12_000;

const documentTopicSchema = z.object({
  topic: z.string().min(2),
  refinedTitle: z.string().min(2),
  intentAnalysis: z.string().min(2),
  documentSummary: z.string().min(2),
});

export type DocumentGoalSeed = z.infer<typeof documentTopicSchema> & {
  filenames: string[];
};

function truncateDocumentText(text: string): string {
  if (text.length <= DOCUMENT_TOPIC_MAX_CHARS) return text;
  return `${text.slice(0, DOCUMENT_TOPIC_MAX_CHARS)}\n\n[内容已截断]`;
}

export async function analyzePendingGoalDocuments(
  threadId: string,
): Promise<DocumentGoalSeed> {
  const files = listPendingGoalDocuments(threadId);
  const urlSources = listPendingGoalUrlSources(threadId);
  const durableResources = await listSessionResourceTexts(threadId);
  if (
    files.length === 0 &&
    urlSources.length === 0 &&
    durableResources.length === 0
  ) {
    throw new Error("没有待分析的学习资料");
  }

  const sections: string[] = [];
  for (const resource of durableResources) {
    const heading = resource.filename;
    const sourceLine =
      resource.kind === "url" && resource.canonicalUrl
        ? `来源：${resource.canonicalUrl}\n`
        : "";
    sections.push(
      `### ${heading}\n${sourceLine}${truncateDocumentText(resource.extractedText)}`,
    );
  }
  for (const source of urlSources) {
    sections.push(
      `### ${source.title}\n来源：${source.canonicalUrl}\n${truncateDocumentText(source.text)}`,
    );
  }
  for (const file of files) {
    const text = await extractBufferText(file.buffer, file.filename);
    if (!text.trim()) continue;
    sections.push(`### ${file.filename}\n${truncateDocumentText(text)}`);
  }

  const combined = sections.join("\n\n").trim();
  if (!combined) {
    throw new Error("无法从资料中提取有效文本，请换一份 PDF/Word/TXT/MD 文件");
  }

  const filenames = [
    ...durableResources.map((resource) => resource.filename),
    ...files.map((file) => file.filename),
    ...urlSources.map((source) => source.title),
  ];
  const analysis = await invokeWithSchema(
    documentTopicSchema,
    `资料文件名：${filenames.join("、")}

资料正文：
${combined}`,
    {
      operation: "agent.document_topic",
      schemaShape: `{
  "topic": "string",
  "refinedTitle": "string",
  "intentAnalysis": "string",
  "documentSummary": "string"
}`,
      meta: { threadId },
    },
  );

  return { ...analysis, filenames };
}

export function applyDocumentGoalSeed(
  checkpoint: ThreadCheckpoint,
  seed: DocumentGoalSeed,
  userTopic?: string,
): ThreadCheckpoint {
  const state = goalStateFromCheckpoint(checkpoint);
  const topic =
    userTopic?.trim() || seed.topic.trim() || seed.refinedTitle.trim();
  const generationOptions = [
    state.generationOptions,
    seed.documentSummary.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const nextState = {
    ...state,
    topic,
    refinedTitle: seed.refinedTitle.trim() || topic,
    intentAnalysis: seed.intentAnalysis.trim(),
    generationOptions,
    hasDocuments: true,
    planningMode: state.isSmallCourse ? "fast" : "docs_first",
    documentFilenames: seed.filenames,
    collectedFields: Array.from(
      new Set([...state.collectedFields, "documents"]),
    ),
  };

  return { ...checkpoint, goalState: nextState };
}

export { hasPendingGoalDocuments };
