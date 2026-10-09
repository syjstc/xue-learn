import { z } from "zod";

import type { retrieveContextForUnitWithSources } from "../../rag/retrieve.js";
import { requireRagDocuments } from "../../rag/persistence.js";
import type {
  CapabilityQueryTool,
  ContextEnvelope,
  LearningSystemCapability,
  LearningSystemSubject,
} from "../types.js";

const VERSION = "1.0.0";
const SCHEMA_VERSION = 1;

export const RAG_VIEW_KEY = "rag.sources.v1";
export const RAG_QUERY_TOOL_KEY = "search_indexed_sources";

const sourceSchema = z.object({
  kind: z.enum(["upload", "web"]),
  title: z.string(),
  url: z.string().optional(),
  filename: z.string().optional(),
  excerpt: z.string().optional(),
});

const sourceContextSchema = z.object({
  context: z.string(),
  sources: z.array(sourceSchema),
  mode: z.enum(["rag", "search", "none"]),
});

const ragResultSchema = sourceContextSchema.extend({ query: z.string() });

export type CreateRagCapabilityOptions = {
  retrieveContextForUnitWithSources: typeof retrieveContextForUnitWithSources;
  now: () => Date;
};

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Capability query was aborted");
  error.name = "AbortError";
  throw error;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}…`;
}

function envelope<T>(
  scope: LearningSystemSubject,
  asOf: string,
  data: T,
): ContextEnvelope<T> {
  return {
    ownerCapabilityId: "rag",
    ownerCapabilityVersion: VERSION,
    schemaVersion: SCHEMA_VERSION,
    authority: "verified_source",
    scope: { ...scope },
    freshness: { asOf, stale: false },
    data,
  };
}

async function resolveOwnedScope(
  subject: LearningSystemSubject,
): Promise<{ goalId: string; unitTitle: string } | null> {
  if (!subject.userId) return null;
  return requireRagDocuments().resolveOwnedScope(subject.userId, {
    ...(subject.goalId ? { goalId: subject.goalId } : {}),
    ...(subject.unitId ? { unitId: subject.unitId } : {}),
  });
}

export function createRagCapability({
  retrieveContextForUnitWithSources: retrieve,
  now,
}: CreateRagCapabilityOptions): LearningSystemCapability {
  const searchTool: CapabilityQueryTool<
    { query: string; limit?: number },
    z.infer<typeof ragResultSchema>
  > = {
    key: RAG_QUERY_TOOL_KEY,
    ownerCapabilityId: "rag",
    schemaVersion: SCHEMA_VERSION,
    description:
      "Retrieve passages and source metadata from indexed documents in the server-bound goal.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(8).optional(),
      })
      .strict(),
    resultSchema: ragResultSchema,
    requiredScopes: ["user"],
    authority: "verified_source",
    maxResultTokens: 3_000,
    query: async (subject, input, signal) => {
      abortIfNeeded(signal);
      const scope = await resolveOwnedScope(subject);
      if (!scope) {
        return envelope(subject, now().toISOString(), {
          query: input.query,
          context: "",
          sources: [],
          mode: "none" as const,
        });
      }
      const result = await retrieve(
        scope.goalId,
        scope.unitTitle,
        input.query,
        input.limit ?? 5,
      );
      abortIfNeeded(signal);
      return envelope(subject, now().toISOString(), {
        query: input.query,
        context: compactText(result.context, 6_000),
        sources: result.sources.slice(0, 8),
        mode: result.mode,
      });
    },
  };

  return {
    manifest: {
      id: "rag",
      version: VERSION,
      kind: "tool_provider",
      providesViews: [RAG_VIEW_KEY],
      providesQueryTools: [RAG_QUERY_TOOL_KEY],
    },
    getView: async (request) => {
      if (request.key !== RAG_VIEW_KEY) return null;
      const scope = await resolveOwnedScope(request.subject);
      if (!scope) return null;
      abortIfNeeded(request.signal);
      const result = await retrieve(
        scope.goalId,
        scope.unitTitle,
        request.query,
        4,
      );
      abortIfNeeded(request.signal);
      return envelope(
        request.subject,
        now().toISOString(),
        sourceContextSchema.parse({
          context: compactText(result.context, 12_000),
          sources: result.sources.slice(0, 8),
          mode: result.mode,
        }),
      );
    },
    getQueryTools: () => [searchTool] as CapabilityQueryTool[],
  };
}
