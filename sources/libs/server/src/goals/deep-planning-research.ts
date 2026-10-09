import type { ContentSource, KnowledgeActivity } from "../../../domain/src/index.js";
import { createHash } from "node:crypto";
import {
  canonicalizeWebKnowledgeUrl,
  retrieveOrSearchWebKnowledge,
} from "../search/web-knowledge.js";
import type { GoalMapPlan } from "../llm/schemas.js";

export type DeepPlanningResearchEvent =
  | {
      type: "research_query";
      query: string;
      current: number;
      total: number;
      scope: "goal" | "module";
      moduleRef?: string;
    }
  | { type: "planning_warning"; code: string; message: string }
  | {
      type: "module_research_progress";
      current: number;
      total: number;
      moduleRef?: string;
      moduleTitle?: string;
      status: "queued" | "researching" | "complete" | "warning";
      sourceCount?: number;
    };

export type DeepPlanningResearchResult = {
  context: string;
  sources: ContentSource[];
  queryCount: number;
  warning?: string;
};

export type PlanningOutlineEvent = {
  type: "planning_outline";
  field: string;
  modeClarification: string;
  reusedSources: boolean;
  topicOverview?: string;
  whatYouWillLearn?: string[];
  prerequisitesAssumed?: string[];
  modules: Array<{
    moduleRef: string;
    title: string;
    objective: string;
    dependsOnPrevious: string;
    estimatedUnitCount?: number;
    scopeSize?: "compact" | "standard" | "large";
    progression?: string[];
  }>;
};

/**
 * A learner-safe explanation of the model's planning conclusions. This is
 * deliberately derived from validated structured output rather than exposing
 * provider reasoning tokens or hidden chain-of-thought.
 */
export function buildPlanningOutlineEvent(
  plan: GoalMapPlan,
  options: { reusedSources?: boolean } = {},
): PlanningOutlineEvent {
  return {
    type: "planning_outline",
    field: [plan.domainAnalysis.field, plan.domainAnalysis.subdomain]
      .filter(Boolean)
      .join(" · "),
    modeClarification: plan.domainAnalysis.modeClarification,
    reusedSources: options.reusedSources === true,
    topicOverview: plan.topicOverview,
    whatYouWillLearn: plan.whatYouWillLearn,
    prerequisitesAssumed: plan.prerequisitesAssumed,
    modules: (plan.modules ?? []).map((module, index) => ({
      moduleRef: `module_${index + 1}`,
      title: module.title,
      objective: module.objective,
      dependsOnPrevious: module.dependsOnPrevious,
    })),
  };
}

function publisher(source: ContentSource): string {
  if (source.publisher?.trim()) return source.publisher.trim().toLowerCase();
  try {
    return new URL(source.url ?? "").hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "unknown";
  }
}

/** Canonical URL dedupe plus a two-result publisher diversity ceiling. */
export function selectDiversePlanningSources(
  sources: ContentSource[],
  limit: number,
): ContentSource[] {
  const seen = new Set<string>();
  const seenContent = new Set<string>();
  const publisherCounts = new Map<string, number>();
  const selected: ContentSource[] = [];
  for (const source of sources) {
    const canonical = source.url
      ? canonicalizeWebKnowledgeUrl(source.url)
      : (source.sourceId ?? `${source.kind}:${source.title}`);
    if (!canonical || seen.has(canonical)) continue;
    const comparableContent = (source.excerpt?.trim() || source.title)
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const contentHash = comparableContent
      ? createHash("sha256").update(comparableContent).digest("hex")
      : "";
    if (contentHash && seenContent.has(contentHash)) continue;
    const owner = publisher(source);
    if ((publisherCounts.get(owner) ?? 0) >= 2) continue;
    seen.add(canonical);
    if (contentHash) seenContent.add(contentHash);
    publisherCounts.set(owner, (publisherCounts.get(owner) ?? 0) + 1);
    selected.push(source);
    if (selected.length >= limit) break;
  }
  return selected;
}

function goalQueries(title: string): string[] {
  return [
    `${title} official standard professional requirements authoritative curriculum`,
    `${title} university syllabus textbook table of contents recommended learning sequence`,
    `${title} practical job skills tools authentic tasks competency framework`,
    `${title} capstone projects assessment rubric observable learning outcomes`,
  ];
}

function moduleQueries(title: string, moduleTitle: string): string[] {
  return [
    `${title} ${moduleTitle} official knowledge standard prerequisite syllabus`,
    `${title} ${moduleTitle} practical exercises projects assessment rubric`,
  ];
}

export async function gatherDeepPlanningResearch(params: {
  userId: string;
  goalId: string;
  title: string;
  scope?: "goal" | "module";
  moduleTitle?: string;
  moduleRef?: string;
  queryLimit?: number;
  desiredSourceCount?: number;
  sourceLimit?: number;
  onEvent?: (event: DeepPlanningResearchEvent) => void | Promise<void>;
  onKnowledgeActivity?: (activity: KnowledgeActivity) => void | Promise<void>;
}): Promise<DeepPlanningResearchResult> {
  const scope = params.scope ?? "goal";
  const allQueries =
    scope === "module" && params.moduleTitle
      ? moduleQueries(params.title, params.moduleTitle)
      : goalQueries(params.title);
  const baseQueries = allQueries.slice(
    0,
    params.queryLimit ?? allQueries.length,
  );
  const desired = params.desiredSourceCount ?? (scope === "module" ? 5 : 16);
  const limit = params.sourceLimit ?? (scope === "module" ? 10 : 32);
  const contexts: string[] = [];
  const discovered: ContentSource[] = [];
  let queryCount = 0;

  const runQuery = async (query: string, current: number, total: number) => {
    queryCount += 1;
    await params.onEvent?.({
      type: "research_query",
      query,
      current,
      total,
      scope,
      moduleRef: params.moduleRef,
    });
    const result = await retrieveOrSearchWebKnowledge({
      userId: params.userId,
      goalId: params.goalId,
      query,
      reason:
        scope === "module"
          ? `为模块“${params.moduleTitle}”精读并交叉验证资料`
          : "为深度学习规划精读并交叉验证权威资料",
      freshnessClass: "normal",
      // Deep planning promises independent multi-query research. Without this,
      // a broad goal-level source already saved moments earlier satisfies every
      // module query from vector retrieval and no provider search occurs.
      forceSearch: true,
      reuseExactQuery: true,
      exactQueryMinimumSources: scope === "module" ? 4 : 5,
      searchPurpose: scope === "module" ? "module_research" : "deep_plan",
      resultCount: scope === "module" ? 8 : 10,
      onActivity: params.onKnowledgeActivity,
    });
    if (result.context.trim()) contexts.push(result.context.trim());
    discovered.push(...result.sources);
  };

  for (let index = 0; index < baseQueries.length; index += 1) {
    await runQuery(baseQueries[index]!, index + 1, baseQueries.length);
  }

  let selected = selectDiversePlanningSources(discovered, limit);
  const maximumQueryCount = params.queryLimit ?? Number.POSITIVE_INFINITY;
  if (selected.length < desired && queryCount < maximumQueryCount) {
    const retry =
      scope === "module"
        ? `${params.title} ${params.moduleTitle} primary sources best practices case study`
        : `${params.title} primary sources curriculum competency assessment learning roadmap`;
    await runQuery(retry, baseQueries.length + 1, baseQueries.length + 1);
    selected = selectDiversePlanningSources(discovered, limit);
  }

  const warning =
    selected.length < desired
      ? `资料覆盖有限：期望至少 ${desired} 个独立来源，当前获得 ${selected.length} 个。`
      : undefined;
  if (warning) {
    await params.onEvent?.({
      type: "planning_warning",
      code: "RESEARCH_COVERAGE_LIMITED",
      message: warning,
    });
  }

  const sourceCatalog = selected
    .map(
      (source, index) =>
        `[Source ${index + 1}] ${source.title}\n${source.url ?? source.filename ?? ""}\n${source.excerpt ?? ""}`,
    )
    .join("\n\n");
  // Full bodies are already bounded and extracted by the search provider. Keep
  // a goal-wide ceiling before the final planning prompt applies its own cap.
  const evidence = contexts.join("\n\n---\n\n").slice(0, 28_000);
  return {
    context: [
      "Carefully read source excerpts/full-page extracts:",
      evidence,
      "Server-selected research source catalog (URL/content deduplicated and publisher-diverse):",
      sourceCatalog,
      warning ? `Research warning: ${warning}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    sources: selected,
    queryCount,
    warning,
  };
}
