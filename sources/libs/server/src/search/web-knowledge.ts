import { createHash, randomUUID } from "node:crypto";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type {
  ContentSource,
  KnowledgeActivity,
  WebKnowledgeFreshnessClass,
} from "../../../domain/src/index.js";
import { requireWebKnowledgePersistence } from "./web-knowledge-persistence.js";
import {
  addDocumentsToScopedCollection,
  deleteAllChunksByMetadata,
  queryScopedCollection,
  queryScopedCollectionByMetadata,
} from "../rag/vector-store.js";
import { isWebSearchAvailable } from "./runtime-config.js";
import { searchLearningPathWithSources, type SearchPayload } from "./run.js";
import type { LearningPathSearchPurpose } from "./run.js";
import { extractUrlSource } from "../rag/url-source.js";
import { normalizeIngestText } from "../rag/ingest-text.js";
import { RAG_SCOPE_CLEANUP_EVENT } from "../rag/scope-cleanup.js";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 900,
  chunkOverlap: 120,
});

const FRESHNESS_MS: Record<WebKnowledgeFreshnessClass, number> = {
  live: 0,
  rapid: 7 * 24 * 60 * 60 * 1000,
  normal: 30 * 24 * 60 * 60 * 1000,
  stable: 180 * 24 * 60 * 60 * 1000,
};

export const WEB_KNOWLEDGE_PDF_REFRESH_UNSUPPORTED =
  "WEB_KNOWLEDGE_PDF_REFRESH_UNSUPPORTED";

const LIVE_PATTERN =
  /\b(latest|current|today|now|news|price|schedule|recent)\b|最新|当前|今天|现在|新闻|价格|日程|近期/i;
const RAPID_PATTERN =
  /\b(version|release|api|sdk|law|regulation|policy|standard)\b|版本|发布|接口|法规|政策|标准/i;
const EXPLICIT_VERSION_DATE_PATTERN =
  /\bv?\d+\.\d+(?:\.\d+)?\b|\b20\d{2}(?:-\d{1,2}(?:-\d{1,2})?)?\b|版本\s*[vV]?\d|截至/i;
const STABLE_PATTERN =
  /\b(fundamental|fundamentals|basic concept|established|history of)\b|基本原理|基础概念|经典理论|历史沿革/i;
const EXPLICIT_LIVE_VERIFICATION_PATTERN =
  /\b(latest|today|news|price|schedule|recent)\b|最新|今天|新闻|价格|日程|近期|(?:current|now|当前|现在).{0,12}(?:version|release|law|regulation|policy|price|schedule|flight|exchange rate|weather|score|ranking|版本|发布|法规|政策|价格|日程|航班|汇率|天气|比分|排名)|(?:version|release|law|regulation|policy|price|schedule|flight|exchange rate|weather|score|ranking|版本|发布|法规|政策|价格|日程|航班|汇率|天气|比分|排名).{0,12}(?:current|now|当前|现在)/i;

export type KnowledgeActivitySink = (
  activity: KnowledgeActivity,
) => void | Promise<void>;

export type WebKnowledgeResult = {
  context: string;
  sources: ContentSource[];
  activity: KnowledgeActivity;
  stale: boolean;
};

export function canonicalizeWebKnowledgeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function isPdfWebKnowledgeUrl(raw: string): boolean {
  try {
    return new URL(raw).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function publisherForUrl(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function freshUntil(
  freshnessClass: WebKnowledgeFreshnessClass,
  now = new Date(),
): Date {
  return new Date(now.getTime() + FRESHNESS_MS[freshnessClass]);
}

export function detectWebKnowledgeFreshness(
  query: string,
  requested?: WebKnowledgeFreshnessClass,
): WebKnowledgeFreshnessClass {
  if (LIVE_PATTERN.test(query)) return "live";
  if (RAPID_PATTERN.test(query)) return "rapid";
  if (STABLE_PATTERN.test(query)) return "stable";
  return requested ?? "normal";
}

export function requiresCurrentWebVerification(query: string): boolean {
  // Force a search only when the wording identifies information whose answer
  // changes over time. “当前这个定义” and similar conversational references
  // must not become web calls merely because they contain 当前/current.
  return (
    EXPLICIT_LIVE_VERIFICATION_PATTERN.test(query) ||
    EXPLICIT_VERSION_DATE_PATTERN.test(query)
  );
}

/**
 * Correct common training-cutoff year bias in live/rapid web queries.
 * - No year + live wording → append current calendar year
 * - Year is exactly one year behind current → rewrite to current year
 */
export function alignLiveSearchQueryToCurrentYear(
  query: string,
  options?: { year?: string },
): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  const freshness = detectWebKnowledgeFreshness(trimmed);
  if (freshness !== "live" && freshness !== "rapid") return trimmed;

  const currentYear =
    options?.year ??
    new Intl.DateTimeFormat("en-CA", { year: "numeric" }).format(new Date());
  const currentYearNum = Number(currentYear);
  if (!Number.isFinite(currentYearNum)) return trimmed;

  const years = [...trimmed.matchAll(/\b(20\d{2})\b/g)].map((match) =>
    Number(match[1]),
  );
  if (years.length === 0) {
    return LIVE_PATTERN.test(trimmed) ? `${trimmed} ${currentYear}` : trimmed;
  }

  const staleCutoffYear = currentYearNum - 1;
  if (!years.every((year) => year === staleCutoffYear)) return trimmed;
  return trimmed.replaceAll(String(staleCutoffYear), currentYear);
}

async function emit(
  sink: KnowledgeActivitySink | undefined,
  activity: KnowledgeActivity,
) {
  await sink?.(activity);
}

async function requireOwnedGoal(userId: string, goalId: string) {
  if (!(await requireWebKnowledgePersistence().goalIsOwned(userId, goalId))) throw new Error("GOAL_NOT_FOUND");
}

type PersistPayload = {
  userId: string;
  goalId: string;
  query: string;
  freshnessClass: WebKnowledgeFreshnessClass;
  sources: ContentSource[];
  sourceContents: Record<string, string>;
  targetIds?: string[];
  provider?: string;
};

async function indexRevision(params: {
  userId: string;
  goalId: string;
  sourceId: string;
  revisionId: string;
  title: string;
  content: string;
}) {
  const content = normalizeIngestText(params.content);
  if (!content) return;

  await deleteAllChunksByMetadata("web_knowledge", params.userId, {
    sourceId: params.sourceId,
  });
  const chunks = await splitter.splitDocuments([
    new Document({
      pageContent: content,
      metadata: {
        userId: params.userId,
        goalId: params.goalId,
        sourceId: params.sourceId,
        revisionId: params.revisionId,
        title: params.title,
        knowledgeKind: "web",
      },
    }),
  ]);
  if (chunks.length === 0) return;
  await addDocumentsToScopedCollection("web_knowledge", params.userId, chunks, {
    userId: params.userId,
    goalId: params.goalId,
  });
}

export async function persistWebKnowledge(
  params: PersistPayload,
): Promise<ContentSource[]> {
  await requireOwnedGoal(params.userId, params.goalId);
  const persistence = requireWebKnowledgePersistence();
  const validTargetIds = await persistence.validTargetIds(params.goalId, params.targetIds ?? []);
  const now = new Date();
  const stored: ContentSource[] = [];
  const seenCanonicalUrls = new Set<string>();

  for (const candidate of params.sources) {
    if (candidate.kind !== "web" || !candidate.url) continue;
    const canonical = canonicalizeWebKnowledgeUrl(candidate.url);
    if (!canonical) continue;
    if (seenCanonicalUrls.has(canonical)) continue;
    seenCanonicalUrls.add(canonical);
    const content = normalizeIngestText(
      (
        params.sourceContents[candidate.url] ??
        params.sourceContents[canonical] ??
        candidate.excerpt ??
        ""
      ).slice(0, 20_000),
    );
    if (!content) continue;
    const contentHash = hashContent(content);
    const { source, revision, revisionCreated } = await persistence.saveSourceRevision({
      userId: params.userId, goalId: params.goalId, canonicalUrl: canonical,
      originalUrl: candidate.url, title: candidate.title,
      publisher: candidate.publisher ?? publisherForUrl(candidate.url) ?? null,
      provider: params.provider ?? "search", content, contentHash,
      retrievedAt: now, freshUntil: freshUntil(params.freshnessClass, now),
      freshnessClass: params.freshnessClass, searchQuery: params.query,
      targetIds: validTargetIds,
    });
    if (revisionCreated) {
      void indexRevision({
        userId: params.userId,
        goalId: params.goalId,
        sourceId: source.id,
        revisionId: revision.id,
        title: source.title,
        content,
      }).catch((error) => {
        console.warn(
          `[web-knowledge] indexing failed for ${source.id}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
    stored.push({
      ...candidate,
      sourceId: source.id,
      revisionId: revision.id,
      publisher: source.publisher ?? undefined,
      retrievedAt: revision.retrievedAt.toISOString(),
      freshUntil: revision.freshUntil.toISOString(),
      freshnessClass: params.freshnessClass,
      saved: true,
      stale: false,
    });
  }
  return stored;
}

async function sourceRows(params: {
  userId: string;
  goalId?: string;
  targetIds?: string[];
}) {
  return requireWebKnowledgePersistence().listSources({ ...params, limit: 60 });
}

export async function retrieveWebKnowledge(params: {
  userId: string;
  query: string;
  goalId?: string;
  targetIds?: string[];
  k?: number;
  includeStale?: boolean;
}): Promise<{ context: string; sources: ContentSource[]; stale: boolean }> {
  const rows = await sourceRows(params);
  const now = Date.now();
  const requestedCount = Math.max(params.k ?? 5, 1);
  const eligible = rows.filter((source) => {
    const revision = source.revisions[0];
    return (
      revision &&
      (params.includeStale ||
        (source.status === "active" && revision.freshUntil.getTime() > now))
    );
  });
  if (eligible.length === 0) return { context: "", sources: [], stale: false };
  const byId = new Map(eligible.map((source) => [source.id, source]));
  let docs: Document[] = [];
  try {
    docs = params.goalId
      ? await queryScopedCollectionByMetadata(
          "web_knowledge",
          params.userId,
          params.query,
          { goalId: params.goalId },
          Math.min(requestedCount * 3, 30),
        )
      : await queryScopedCollection(
          "web_knowledge",
          params.userId,
          params.query,
          Math.min(requestedCount * 3, 30),
        );
  } catch {
    docs = [];
  }
  const vectorCandidates = docs
    .map((doc) => ({
      doc,
      source:
        typeof doc.metadata.sourceId === "string" &&
        typeof doc.metadata.revisionId === "string"
          ? (() => {
              const source = byId.get(doc.metadata.sourceId);
              return source?.revisions[0]?.id === doc.metadata.revisionId
                ? source
                : undefined;
            })()
          : undefined,
    }))
    .filter(
      (row): row is { doc: Document; source: (typeof eligible)[number] } =>
        Boolean(row.source),
    );
  const seenSourceIds = new Set<string>();
  const vectorSelected: typeof vectorCandidates = [];
  for (const candidate of vectorCandidates) {
    if (seenSourceIds.has(candidate.source.id)) continue;
    seenSourceIds.add(candidate.source.id);
    vectorSelected.push(candidate);
    if (vectorSelected.length >= requestedCount) break;
  }
  const selected =
    vectorSelected.length > 0
      ? vectorSelected
      : eligible.slice(0, requestedCount).map((source) => ({
          source,
          doc: new Document({
            pageContent: source.revisions[0]!.content,
            metadata: { sourceId: source.id },
          }),
        }));
  const sources = selected.map(({ source }) => {
    const revision = source.revisions[0]!;
    const stale =
      source.status !== "active" || revision.freshUntil.getTime() <= now;
    return {
      kind: "web" as const,
      title: source.title,
      url: source.originalUrl,
      excerpt: revision.content.replace(/\s+/g, " ").slice(0, 220),
      sourceId: source.id,
      revisionId: revision.id,
      publisher: source.publisher ?? undefined,
      publishedAt: revision.publishedAt?.toISOString(),
      retrievedAt: revision.retrievedAt.toISOString(),
      freshUntil: revision.freshUntil.toISOString(),
      freshnessClass: revision.freshnessClass as WebKnowledgeFreshnessClass,
      saved: true,
      stale,
    };
  });
  return {
    context: selected
      .map(
        ({ doc, source }, index) =>
          `[Web knowledge ${index + 1}: ${source.title}]\n${source.originalUrl}\n${doc.pageContent}`,
      )
      .join("\n\n---\n\n"),
    sources,
    stale: sources.some((source) => source.stale),
  };
}

async function retrieveExactQueryWebKnowledge(params: {
  userId: string;
  goalId: string;
  query: string;
  k: number;
}): Promise<{ context: string; sources: ContentSource[]; stale: boolean }> {
  const rows = (await sourceRows(params))
    .filter((source) => {
      const revision = source.revisions[0];
      return (
        source.status === "active" &&
        revision?.searchQuery === params.query &&
        revision.freshUntil.getTime() > Date.now()
      );
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, Math.max(params.k, 1));
  const sources = rows.map((source) => {
    const revision = source.revisions[0]!;
    return {
      kind: "web" as const,
      title: source.title,
      url: source.originalUrl,
      excerpt: revision.content.replace(/\s+/g, " ").slice(0, 220),
      sourceId: source.id,
      revisionId: revision.id,
      publisher: source.publisher ?? undefined,
      publishedAt: revision.publishedAt?.toISOString(),
      retrievedAt: revision.retrievedAt.toISOString(),
      freshUntil: revision.freshUntil.toISOString(),
      freshnessClass: revision.freshnessClass as WebKnowledgeFreshnessClass,
      saved: true,
      stale: false,
    };
  });
  return {
    context: rows
      .map((source, index) => {
        const revision = source.revisions[0]!;
        return `[Web knowledge ${index + 1}: ${source.title}]\n${source.originalUrl}\n${revision.content}`;
      })
      .join("\n\n---\n\n"),
    sources,
    stale: false,
  };
}

export async function retrieveOrSearchWebKnowledge(params: {
  userId: string;
  query: string;
  reason: string;
  goalId?: string;
  targetIds?: string[];
  freshnessClass?: WebKnowledgeFreshnessClass;
  forceSearch?: boolean;
  reuseExactQuery?: boolean;
  exactQueryMinimumSources?: number;
  searchPurpose?: LearningPathSearchPurpose;
  resultCount?: number;
  onActivity?: KnowledgeActivitySink;
}): Promise<WebKnowledgeResult> {
  const id = randomUUID();
  const query = alignLiveSearchQueryToCurrentYear(params.query);
  const freshnessClass = detectWebKnowledgeFreshness(
    query,
    params.freshnessClass,
  );
  const currentRequired = requiresCurrentWebVerification(query);
  if (params.reuseExactQuery && params.goalId && !currentRequired) {
    const exact = await retrieveExactQueryWebKnowledge({
      userId: params.userId,
      goalId: params.goalId,
      query,
      k: params.resultCount ?? 5,
    });
    if (
      exact.context &&
      exact.sources.length >= (params.exactQueryMinimumSources ?? 1)
    ) {
      const activity: KnowledgeActivity = {
        id,
        mode: "saved_knowledge",
        status: "complete",
        query,
        reason: params.reason,
        goalId: params.goalId,
        sourceCount: exact.sources.length,
        sources: exact.sources,
        freshUntil: exact.sources[0]?.freshUntil,
        saved: true,
        stale: false,
      };
      await emit(params.onActivity, activity);
      return { ...exact, activity };
    }
  }
  const saved = await retrieveWebKnowledge({
    userId: params.userId,
    query,
    goalId: params.goalId,
    targetIds: params.targetIds,
    k: params.resultCount ?? 5,
  });
  if (saved.context && !params.forceSearch && !currentRequired) {
    const activity: KnowledgeActivity = {
      id,
      mode: "saved_knowledge",
      status: "complete",
      query,
      reason: params.reason,
      goalId: params.goalId,
      sourceCount: saved.sources.length,
      sources: saved.sources,
      freshUntil: saved.sources[0]?.freshUntil,
      saved: true,
      stale: saved.stale,
    };
    await emit(params.onActivity, activity);
    return { ...saved, activity };
  }

  const searching: KnowledgeActivity = {
    id,
    mode: "web_search",
    status: "searching",
    query,
    reason: params.reason,
    goalId: params.goalId,
  };
  await emit(params.onActivity, searching);
  if (!(await isWebSearchAvailable(params.userId))) {
    const stale = await retrieveWebKnowledge({
      userId: params.userId,
      query,
      goalId: params.goalId,
      targetIds: params.targetIds,
      k: 5,
      includeStale: true,
    });
    const activity: KnowledgeActivity = {
      ...searching,
      status: "error",
      sources: stale.sources,
      sourceCount: stale.sources.length,
      saved: stale.sources.length > 0,
      stale: stale.sources.length > 0,
      error: "网页搜索未启用或搜索服务不可用",
    };
    await emit(params.onActivity, activity);
    return { ...stale, activity, stale: stale.sources.length > 0 };
  }

  await emit(params.onActivity, { ...searching, status: "reading" });
  let result: SearchPayload;
  try {
    result = await searchLearningPathWithSources(query, {
      purpose: params.searchPurpose ?? "answer",
      ...(params.resultCount ? { maxResults: params.resultCount } : {}),
      meta: {
        userId: params.userId,
        goalId: params.goalId,
        scope: "web_knowledge",
      },
    });
  } catch (error) {
    console.warn(
      "[web-knowledge] search failed:",
      error instanceof Error ? error.message : error,
    );
    const stale = await retrieveWebKnowledge({
      userId: params.userId,
      query,
      goalId: params.goalId,
      targetIds: params.targetIds,
      k: 5,
      includeStale: true,
    });
    const activity: KnowledgeActivity = {
      ...searching,
      status: "error",
      sources: stale.sources,
      sourceCount: stale.sources.length,
      saved: stale.sources.length > 0,
      stale: stale.sources.length > 0,
      error: "网页搜索失败，当前信息未能验证",
    };
    await emit(params.onActivity, activity);
    return { ...stale, activity, stale: stale.sources.length > 0 };
  }
  if (!result.context || result.sources.length === 0) {
    const stale = await retrieveWebKnowledge({
      userId: params.userId,
      query,
      goalId: params.goalId,
      targetIds: params.targetIds,
      k: 5,
      includeStale: true,
    });
    const activity: KnowledgeActivity = {
      ...searching,
      status: "error",
      error: "未找到可验证的网页来源",
      sources: stale.sources,
      sourceCount: stale.sources.length,
      saved: stale.sources.length > 0,
      stale: stale.sources.length > 0,
    };
    await emit(params.onActivity, activity);
    return { ...stale, activity, stale: stale.sources.length > 0 };
  }

  let sources = result.sources;
  if (params.goalId) {
    await emit(params.onActivity, {
      ...searching,
      status: "saving",
      sourceCount: sources.length,
      sources,
    });
    try {
      const storedSources = await persistWebKnowledge({
        userId: params.userId,
        goalId: params.goalId,
        query,
        freshnessClass,
        sources,
        sourceContents: result.sourceContents,
        targetIds: params.targetIds,
        provider: result.provider,
      });
      if (storedSources.length > 0) sources = storedSources;
    } catch (error) {
      console.warn(
        "[web-knowledge] persistence failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  const now = new Date();
  const activity: KnowledgeActivity = {
    ...searching,
    status: "complete",
    sourceCount: sources.length,
    sources,
    searchedAt: now.toISOString(),
    freshUntil: freshUntil(freshnessClass, now).toISOString(),
    saved: Boolean(params.goalId && sources.some((source) => source.saved)),
    stale: false,
  };
  await emit(params.onActivity, activity);
  return {
    context: result.context,
    sources,
    activity,
    stale: false,
  };
}

export async function listGoalWebKnowledge(userId: string, goalId: string) {
  await requireOwnedGoal(userId, goalId);
  const rows = await sourceRows({ userId, goalId });
  return rows.map((source) => {
    const revision = source.revisions[0];
    const stale = revision
      ? source.status !== "active" ||
        revision.freshUntil.getTime() <= Date.now()
      : true;
    return {
      id: source.id,
      title: source.title,
      url: source.originalUrl,
      publisher: source.publisher,
      provider: source.provider,
      status: stale && source.status === "active" ? "stale" : source.status,
      retrievedAt: revision?.retrievedAt.toISOString() ?? null,
      freshUntil: revision?.freshUntil.toISOString() ?? null,
      stale,
      targetIds: source.targets.map((binding) => binding.learningTarget.id),
      targetTitles: source.targets.map(
        (binding) => binding.learningTarget.title,
      ),
    };
  });
}

export async function deleteGoalWebKnowledgeSource(
  userId: string,
  goalId: string,
  sourceId: string,
) {
  await requireOwnedGoal(userId, goalId);
  const persistence = requireWebKnowledgePersistence();
  const source = await persistence.findOwnedSource(userId, goalId, sourceId);
  if (!source) throw new Error("SOURCE_NOT_FOUND");
  await persistence.deleteSourceWithCleanup(userId, sourceId, JSON.stringify({
          scope: "web_knowledge",
          scopeId: userId,
          metadataFilter: { sourceId },
          reason: "source_delete",
        }));
  try {
    await deleteAllChunksByMetadata("web_knowledge", userId, { sourceId });
  } catch (error) {
    console.warn(
      "[web-knowledge] immediate source vector cleanup failed; queued for retry:",
      error instanceof Error ? error.message : error,
    );
  }
  return { ok: true };
}

export async function refreshGoalWebKnowledgeSource(
  userId: string,
  goalId: string,
  sourceId: string,
) {
  await requireOwnedGoal(userId, goalId);
  const persistence = requireWebKnowledgePersistence();
  const source = await persistence.findOwnedSource(userId, goalId, sourceId);
  if (!source) throw new Error("SOURCE_NOT_FOUND");
  if (isPdfWebKnowledgeUrl(source.originalUrl)) {
    throw new Error(WEB_KNOWLEDGE_PDF_REFRESH_UNSUPPORTED);
  }
  try {
    const extracted = await extractUrlSource(source.originalUrl);
    const [stored] = await persistWebKnowledge({
      userId,
      goalId,
      query: source.title,
      freshnessClass: "normal",
      provider: source.provider,
      sources: [
        {
          kind: "web",
          title: extracted.title,
          url: extracted.originalUrl,
          excerpt: extracted.text.slice(0, 220),
        },
      ],
      sourceContents: { [extracted.originalUrl]: extracted.text },
    });
    return stored;
  } catch (error) {
    if (
      error instanceof Error &&
      /不支持的网页内容类型：\s*application\/pdf\b/i.test(error.message)
    ) {
      throw new Error(WEB_KNOWLEDGE_PDF_REFRESH_UNSUPPORTED);
    }
    await persistence.markSourceError(source.id);
    throw error;
  }
}

export async function bindWebKnowledgeSourcesToUnitTargets(params: {
  goalId: string;
  unitId: string;
  sourceIds: string[];
}) {
  const sourceIds = [...new Set(params.sourceIds.filter(Boolean))];
  if (sourceIds.length === 0) return;
  await requireWebKnowledgePersistence().bindSourcesToUnitTargets(params.goalId, params.unitId, sourceIds);
}
