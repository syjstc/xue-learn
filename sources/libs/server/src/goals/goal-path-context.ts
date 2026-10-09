import {
  goalHasRagDocuments,
  retrieveForUnitWithSources,
  retrieveUploadedForUnitWithSources,
} from "../rag/retrieve.js";
import {
  deleteLegacyPersistedSearchContext,
  goalHasPersistedSearchContext,
  goalHasUserUploadedDocuments,
} from "../search/persist-search-context.js";
import type { KnowledgeActivity } from "../../../domain/src/index.js";
import {
  retrieveOrSearchWebKnowledge,
  retrieveWebKnowledge,
} from "../search/web-knowledge.js";
import { requireRagDocuments } from "../rag/persistence.js";
import { readUploadedPlanningSources } from "../rag/planning-sources.js";
import { catalogSearchQuery, isItemizedCatalogGoal } from "./catalog-goal.js";

export { isItemizedCatalogGoal } from "./catalog-goal.js";

export type GoalPathContext = {
  context: string;
  pathSource: "rag" | "search" | "generic";
  sourceCount: number;
};

export type GoalPathSearchPurpose = "summary" | "map";

const CONFIRMED_GOAL_CONTRACT_HEADER =
  "[User-confirmed goal contract — authoritative]";
const NON_SEARCH_CONTRACT_LABELS = new Set([
  "Starting level",
  "Course pattern",
]);

/**
 * Preserve the learner's confirmed subject when a concise display title drops
 * essential qualifiers (for example, "English speaking" becoming merely
 * "everyday conversation"). Profile/memory blocks are deliberately excluded.
 */
export function buildGoalPathSearchQuery(params: {
  title: string;
  generationOptions?: string | null;
  extraQuery?: string;
}): string {
  const parts = [params.title.trim()];
  const options = params.generationOptions ?? "";
  const contractStart = options.indexOf(CONFIRMED_GOAL_CONTRACT_HEADER);
  if (contractStart >= 0) {
    const contract = options
      .slice(contractStart + CONFIRMED_GOAL_CONTRACT_HEADER.length)
      .split(
        /\n\s*\n(?=Learner profile|Global learner cognitive memory)/,
        1,
      )[0];
    for (const rawLine of contract.split("\n")) {
      const line = rawLine.trim();
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const label = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (
        !value ||
        NON_SEARCH_CONTRACT_LABELS.has(label) ||
        parts.includes(value)
      ) {
        continue;
      }
      parts.push(value.slice(0, 220));
    }
  }
  const extra = params.extraQuery?.trim();
  if (extra) parts.push(extra.slice(0, 220));
  return parts.filter(Boolean).join(" ").slice(0, 700);
}

/** RAG first; web search only when `allowWebSearch` (plan summary / map gen). */
export async function gatherGoalPathContext(params: {
  goalId: string;
  title: string;
  /** Optional hint when docs are not yet persisted on the goal (creation-time only). */
  hasUpload?: boolean;
  /** Extra retrieval hints, e.g. user adjustment text during map regeneration. */
  extraQuery?: string;
  /** When false, only read existing indexed material — no new Tavily calls. */
  allowWebSearch?: boolean;
  /** Restrict RAG to learner-uploaded files and exclude indexed web context. */
  uploadedDocumentsOnly?: boolean;
  /** Richer search for map generation vs lightweight plan summary. */
  searchPurpose?: GoalPathSearchPurpose;
  onKnowledgeActivity?: (activity: KnowledgeActivity) => void | Promise<void>;
}): Promise<GoalPathContext> {
  const hasDocs =
    params.hasUpload === true || (await goalHasRagDocuments(params.goalId));
  const ragK = params.searchPurpose === "map" ? 10 : 8;
  let legacyFallback: GoalPathContext | undefined;

  if (hasDocs) {
    if (params.uploadedDocumentsOnly && params.searchPurpose === "map") {
      const complete = await readUploadedPlanningSources(params.goalId);
      return {
        context: complete.context,
        pathSource: "rag",
        sourceCount: complete.sources.length,
      };
    }
    const baseQuery = isItemizedCatalogGoal(params.title)
      ? `${params.title} complete list outline table of contents all items`
      : "outline syllabus chapters topic overview scope";
    const ragQuery = [baseQuery, params.extraQuery?.trim()]
      .filter(Boolean)
      .join("; ");
    const retrieved = params.uploadedDocumentsOnly
      ? await retrieveUploadedForUnitWithSources(
          params.goalId,
          params.title,
          ragQuery,
          ragK,
        )
      : await retrieveForUnitWithSources(
          params.goalId,
          params.title,
          ragQuery,
          ragK,
        );
    if (retrieved.context) {
      const hasUserUploads = await goalHasUserUploadedDocuments(params.goalId);
      const result: GoalPathContext = {
        context: retrieved.context,
        pathSource: hasUserUploads ? "rag" : "search",
        sourceCount: retrieved.sources.length,
      };
      if (hasUserUploads || !params.allowWebSearch) return result;
      legacyFallback = result;
    }
    if (params.uploadedDocumentsOnly) {
      return { context: "", pathSource: "rag", sourceCount: 0 };
    }
  }

  const goal = await requireRagDocuments().findGoalSearchContext(params.goalId);
  if (!goal) {
    return (
      legacyFallback ?? {
        context: "",
        pathSource: "generic",
        sourceCount: 0,
      }
    );
  }
  const searchQuery = isItemizedCatalogGoal(params.title)
    ? catalogSearchQuery(params.title)
    : buildGoalPathSearchQuery({
        title: params.title,
        generationOptions: goal.generationOptions,
        extraQuery: params.extraQuery,
      });
  if (!params.allowWebSearch) {
    const saved = await retrieveWebKnowledge({
      userId: goal.userId,
      goalId: params.goalId,
      query: searchQuery,
      k: ragK,
    });
    return saved.context
      ? {
          context: saved.context,
          pathSource: "search",
          sourceCount: saved.sources.length,
        }
      : (legacyFallback ?? {
          context: "",
          pathSource: "generic",
          sourceCount: 0,
        });
  }
  const { context, sources } = await retrieveOrSearchWebKnowledge({
    userId: goal.userId,
    goalId: params.goalId,
    query: searchQuery,
    reason:
      params.searchPurpose === "summary"
        ? "为学习计划补充当前资料"
        : "为学习地图和目标补充当前资料",
    freshnessClass: "normal",
    searchPurpose: params.searchPurpose ?? "summary",
    onActivity: params.onKnowledgeActivity,
  });
  if (!context) {
    return (
      legacyFallback ?? {
        context: "",
        pathSource: "generic",
        sourceCount: 0,
      }
    );
  }

  if (await goalHasPersistedSearchContext(params.goalId)) {
    try {
      await deleteLegacyPersistedSearchContext(params.goalId);
    } catch (error) {
      console.warn(
        "[web-knowledge] failed to remove legacy search pseudo-document:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { context, pathSource: "search", sourceCount: sources.length };
}
