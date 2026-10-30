// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { createHash, randomUUID } from "node:crypto";
import { publishedMaterialForRewrite } from "../unit-authoring/published-topic-rewrite.js";
import { tBackend } from "../../../common/src/index.js";
import { learningTargetWorkload } from "../cognitive-model/workload.js";
import {
  sqPreviewSchema,
  type LearningMaterialContent,
} from "../llm/schemas.js";
import {
  parseLearningMaterial,
  parseMaterialContextSources,
  patchMaterialIllustrationBlock,
} from "../graph/unit-session.js";
import { invalidateAgendaForUser } from "../agenda/index.js";
import { streamGenerateLearningMaterialText } from "../graph/unit-session-stream.js";
import { OperationExecutionError } from "../generation/execution/context.js";
import { resolveOverviewCatalogBranches } from "../goals/generate-overview-course.js";
import { sectionAuthoringUnitTitle } from "../goals/overview-lesson-title.js";
import { serializeMaterialContextSources } from "../graph/unit-session.js";
import {
  listMaterialCheckResults,
  buildMaterialCheckTaskDeclarations,
  loadUnitAssessmentTargets,
  publishMaterialCheckTasks,
  publishedMaterialCheckDefinitions,
} from "../assessment/activities.js";
import {
  compileCourseMaterialInlineCheckArray,
  inlineCheckAuthorityBindingsFromTargets,
  planCourseMaterialInlineChecks,
} from "../llm/course-material-inline-checks.js";
import { replayLearnerEntityState } from "../cognition/persistence.js";
import { refreshUnitLearningProgressReset } from "../domain/reset-unit-learning.js";
import { DEFAULT_DIMENSION_INFERENCE_THRESHOLDS } from "../cognition/inference.js";
import {
  detectContentLanguage,
  type ContentLanguageCode,
} from "../llm/content-language.js";
import {
  dedupeContentSources,
  type ContentSource,
} from "../rag/content-sources.js";
import {
  createChatNarrationCoordinator,
  type ChatNarrationAsset,
} from "../audio/chat-narration.js";
import { enrichMaterialWithImages } from "../images/enrich-material.js";
import { runWithUserId } from "../user-context.js";
import { runGenerationContextScope } from "../generation/kernel.js";
import type {
  LearnerStateMemoryInvalidationRepository,
  MaterialCheckCompletionRepository,
  UnitSectionPlanRepository,
  UnitSectionPlanTargetRecord,
  UnitSectionProgressRepository,
} from "../../../domain/src/index.js";
import {
  learningTargetContextFromSqJson,
  verifyAndRepairMiniTest,
  type ContentVerificationPatch,
  type ContentVerificationResult,
} from "../content-verification/index.js";
import {
  Persistence,
  type PersistenceClient,
} from "../persistence/persistence-compat.js";
import {
  microCourseSectionPlanDraft,
  persistedSectionContentKind,
} from "../survey/authoring.js";
import { parseDerivationDocument } from "../../../formal-derivation/src/index.js";
import { parseTeachingDerivationDocument } from "../../../teaching-derivation/src/index.js";
import { sectionGenerationProgress } from "./section-generation-progress.js";
import { refreshUnitCourseKeyPointsSafe } from "../key-points/generate.js";
import { resolveDerivationFormat } from "./teaching-derivation-format.js";
import { assertMiniTestGenerationReady } from "./mini-test-generation-gate.js";
import { readyReadingMaterial } from "../reading/learning-material.js";
import { getCurrentUserId } from "../user-context.js";

let configuredUnitSectionPlanPersistence: UnitSectionPlanRepository | undefined;

export function configureUnitSectionPlanPersistence(
  repository: UnitSectionPlanRepository | undefined,
): void {
  configuredUnitSectionPlanPersistence = repository;
}

export function configuredUnitSectionPlanRepository() {
  return configuredUnitSectionPlanPersistence;
}
export const UNIT_SECTION_PREFETCH_EVENT = "unit.section.prefetch";
// Nested html_generate / component compile often continues after authoring
// tokens stop. A 45s stale steal aborted those calls with "This operation was
// aborted" on desktop-local. Keep the lease at the structured-output budget.
const SECTION_GENERATION_LEASE_MS = 300_000;
const SECTION_GENERATION_HEARTBEAT_MS = 10_000;
const SECTION_GENERATION_POLL_MS = 1_000;
const SECTION_GENERATION_STOPPED_MESSAGE = "生成已停止";
export const SECTION_GENERATION_INTERRUPTED_ERROR =
  "[SERVER_RESTART_INTERRUPTED]";
export const PREVIOUS_SECTION_CONTEXT_MAX_CHARS = 1_800;
export const SECTION_BOUNDARY_CONTEXT_MAX_CHARS = 2_400;

function orientationLessonFromRecords(input: {
  goal: Record<string, unknown> | object;
  catalogSummary?: string | null;
  liveCatalog?: Array<{ title: string; summary: string }>;
}): {
  topicOverview: string;
  branches: Array<{ title: string; summary: string }>;
} {
  const goal = input.goal as Record<string, unknown>;
  return {
    topicOverview: String(goal.topicOverview ?? "").trim(),
    branches: resolveOverviewCatalogBranches({
      liveCatalog: input.liveCatalog,
      storedSummary: input.catalogSummary,
    }),
  };
}

function isOverviewUnitKindValue(value: unknown): boolean {
  return String(value ?? "") === "overview";
}

function persistableSectionGenerationError(error: unknown): string {
  if (error instanceof OperationExecutionError && error.cause instanceof Error) {
    const nested = error.cause.message.trim();
    if (nested && nested !== error.message && !error.message.endsWith(`: ${nested}`)) {
      return `${error.message}: ${nested}`.slice(0, 2000);
    }
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function learnerFacingSectionGenerationError(
  status: string,
  internalError: string | null | undefined,
): string {
  if (status !== "failed") return "";
  if (internalError === SECTION_GENERATION_STOPPED_MESSAGE) {
    return SECTION_GENERATION_STOPPED_MESSAGE;
  }
  if (internalError === SECTION_GENERATION_INTERRUPTED_ERROR) {
    return tBackend("error.generation.interrupted");
  }
  return tBackend("error.generation.failedFriendly");
}

const activeSectionGenerations = new Map<
  string,
  { token: string; controller: AbortController }
>();

const sectionImageEnrichments = new Map<string, Promise<void>>();

export async function waitForUnitSectionImages(userId: string, unitId: string, sectionId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const task = sectionImageEnrichments.get(`${userId}:${unitId}:${sectionId}`);
  if (!task) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function enrichUnitSectionImagesInBackground(params: {
  client?: PersistenceClient;
  repository?: UnitSectionPlanRepository;
  userId: string;
  goalId: string;
  unitId: string;
  unitTitle: string;
  sectionId: string;
  sectionContentRevision: number;
  contentLanguage: ContentLanguageCode;
  material: LearningMaterialContent;
}) {
  const key = `${params.userId}:${params.unitId}:${params.sectionId}`;
  const task = runWithUserId(params.userId, async () => {
    let material = params.material;
    let expectedSectionRevision = params.sectionContentRevision;
    let persistTail = Promise.resolve();

    await enrichMaterialWithImages(
      params.material,
      params.unitId,
      {
        goalId: params.goalId,
        unitTitle: params.unitTitle,
        contentLanguage: params.contentLanguage,
        storageRevision: `section-${params.sectionId}-${params.sectionContentRevision}`,
      },
      {
        onImageReady: async ({ blockIndex, block }) => {
          material = patchMaterialIllustrationBlock(material, blockIndex, {
            imageId: block.imageId!,
            imageUrl: block.imageUrl!,
          });
          const snapshot = material;
          const task = persistTail.then(async () => {
            const applied = params.repository
              ? await params.repository.persistIllustration({
                  unitId: params.unitId,
                  sectionId: params.sectionId,
                  expectedContentRevision: expectedSectionRevision,
                  blocks: JSON.stringify(snapshot.blocks),
                })
              : await params.client!.$transaction(async (tx) => {
                  const claimed = await tx.unitSection.updateMany({
                    where: {
                      id: params.sectionId,
                      contentRevision: expectedSectionRevision,
                      generationStatus: "ready",
                    },
                    data: { contentRevision: { increment: 1 } },
                  });
                  if (claimed.count !== 1) return false;
                  await tx.unitSectionMaterial.update({
                    where: { sectionId: params.sectionId },
                    data: { blocks: JSON.stringify(snapshot.blocks) },
                  });
                  await tx.learningUnit.update({
                    where: { id: params.unitId },
                    data: { contentRevision: { increment: 1 } },
                  });
                  return true;
                });
            if (applied) {
              expectedSectionRevision += 1;
            } else if (params.repository) {
              const fresh = await params.repository
                .findSectionContent({
                  userId: params.userId,
                  unitId: params.unitId,
                  sectionId: params.sectionId,
                })
                .catch(() => null);
              if (fresh?.material) {
                const reloadedMaterial = parseLearningMaterial(fresh.material);
                const reloadedSnapshot = patchMaterialIllustrationBlock(
                  reloadedMaterial,
                  blockIndex,
                  {
                    imageId: block.imageId!,
                    imageUrl: block.imageUrl!,
                  },
                );
                const retried = await params.repository.persistIllustration({
                  unitId: params.unitId,
                  sectionId: params.sectionId,
                  expectedContentRevision: fresh.contentRevision,
                  blocks: JSON.stringify(reloadedSnapshot.blocks),
                });
                if (retried) {
                  material = reloadedSnapshot;
                  expectedSectionRevision = fresh.contentRevision + 1;
                }
              }
            }
          });
          persistTail = task.then(
            () => undefined,
            () => undefined,
          );
          await task;
        },
      },
    );
    await persistTail;
  }).catch((error) => {
    console.error(
      `[sections] background illustration enrichment failed section=${params.sectionId}`,
      error instanceof Error ? error.message : error,
    );
  });
  sectionImageEnrichments.set(key, task);
  void task.finally(() => {
    if (sectionImageEnrichments.get(key) === task) sectionImageEnrichments.delete(key);
  });
}

export type UnitSectionManifest = {
  id: string;
  sourceSectionId: string;
  sectionKind: "content" | "mini_test";
  stableKey: string;
  orderIndex: number;
  title: string;
  contentSummary: string;
  requiredForCompletion: boolean;
  baseEstimatedMinutes: number;
  generationStatus: string;
  generationError: string;
  contentRevision: number;
  status: "available" | "in_progress" | "completed" | "skipped";
  activeSeconds: number;
  recommendSkip: boolean;
  contentKind?: "standard" | "formal_derivation";
  virtualComponents: Array<{
    id: string;
    title: string;
    componentType: string;
    description: string;
    anchor: string;
  }>;
  legacy: boolean;
};

function compactContextText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function compactContextBlock(value: string, maxChars: number): string {
  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function sectionBlockContextText(
  block: LearningMaterialContent["blocks"][number],
): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.text;
    case "code":
      return block.code;
    case "callout":
      return `${block.title ?? ""} ${block.body}`;
    case "accordion":
      return `${block.title} ${block.body}`;
    case "compare":
      return `${block.left.label}: ${block.left.points.join("；")} / ${block.right.label}: ${block.right.points.join("；")}`;
    case "conversation":
      return `${block.title ?? ""} ${block.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join(" / ")}`;
    case "svg":
      return `${block.title ?? ""} ${block.caption} ${block.alt}`;
    case "chemistry_lab":
      return `${block.title} ${block.summary} ${block.experimentId}`;
    default:
      return "";
  }
}

/**
 * Give the next section enough local continuity to connect and deduplicate,
 * without putting the full prior lesson back into the model context window.
 */
export function buildPreviousSectionContext(params: {
  title: string;
  contentSummary: string;
  material: LearningMaterialContent;
}): string {
  const content = splitSectionMaterial(params.material).content;
  const closingExcerpts = content.blocks
    .map(sectionBlockContextText)
    .filter(Boolean)
    .slice(-3)
    .map((text) => compactContextText(text, 360));
  const lines = [
    `Title: ${compactContextText(params.title, 180)}`,
    params.contentSummary
      ? `Planned focus: ${compactContextText(params.contentSummary, 360)}`
      : "",
    content.introduction
      ? `Opening: ${compactContextText(content.introduction, 280)}`
      : "",
    content.keyTakeaways.length
      ? `Key takeaways:\n${content.keyTakeaways
          .slice(0, 4)
          .map((text) => `- ${compactContextText(text, 260)}`)
          .join("\n")}`
      : "",
    closingExcerpts.length
      ? `Closing excerpts:\n${closingExcerpts.map((text) => `- ${text}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return compactContextBlock(lines, PREVIOUS_SECTION_CONTEXT_MAX_CHARS);
}

export function buildSectionBoundaryContext(params: {
  currentSectionId: string;
  sections: Array<{
    id: string;
    orderIndex: number;
    title: string;
    contentSummary: string;
  }>;
}): string {
  const ordered = [...params.sections].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  const lines = ordered.map((section, index) => {
    const role =
      section.id === params.currentSectionId
        ? "CURRENT — teach only this"
        : "OTHER — exclude";
    const focus = compactContextText(
      section.contentSummary || section.title,
      420,
    );
    return `${index + 1}. [${role}] ${compactContextText(section.title, 180)}\n   Owned focus: ${focus}`;
  });
  return compactContextBlock(
    lines.join("\n"),
    SECTION_BOUNDARY_CONTEXT_MAX_CHARS,
  );
}

const MINI_TEST_PREFIX = "mini-test:";

function persistedSectionId(sectionId: string): {
  id: string;
  kind: "content" | "mini_test";
} {
  return sectionId.startsWith(MINI_TEST_PREFIX)
    ? { id: sectionId.slice(MINI_TEST_PREFIX.length), kind: "mini_test" }
    : { id: sectionId, kind: "content" };
}

function miniTestSectionId(sectionId: string): string {
  return `${MINI_TEST_PREFIX}${sectionId}`;
}

function sectionGenerationKey(
  unitId: string,
  sectionId: string,
  kind: SectionGenerationKind,
): string {
  return `${unitId}:${sectionId}:${kind}`;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Generation aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Generation aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function claimSectionGenerationLease(params: {
  client?: PersistenceClient;
  repository?: UnitSectionPlanRepository;
  sectionId: string;
  kind: SectionGenerationKind;
  token: string;
  signal?: AbortSignal;
  force?: boolean;
}): Promise<boolean> {
  let waitingForExistingRun = false;
  while (true) {
    const staleBefore = new Date(Date.now() - SECTION_GENERATION_LEASE_MS);
    if (params.repository) {
      const result = await params.repository.claimGeneration({
        sectionId: params.sectionId,
        kind: params.kind,
        token: params.token,
        staleBefore,
        force: params.force,
        initialAttempt: !waitingForExistingRun,
      });
      if (result === "claimed") return true;
      waitingForExistingRun = true;
      if (result === "ready") return false;
      if (result === "missing") throw new Error("Section not found");
      if (result === "failed") {
        throw new Error("Section generation stopped before completion");
      }
      await abortableDelay(SECTION_GENERATION_POLL_MS, params.signal);
      continue;
    }
    const client = params.client;
    if (!client)
      throw new Error("Section generation persistence is not configured");
    const claimed =
      params.kind === "content"
        ? await client.unitSection.updateMany({
            where: {
              id: params.sectionId,
              OR: [
                ...(!waitingForExistingRun
                  ? [{ generationStatus: { in: ["pending", "failed"] } }]
                  : []),
                ...(params.force && !waitingForExistingRun
                  ? [{ generationStatus: "ready" }]
                  : []),
                { generationStartedAt: { lt: staleBefore } },
              ],
            },
            data: {
              generationStatus: "building",
              generationError: "",
              generationStartedAt: new Date(),
              generationToken: params.token,
            },
          })
        : await client.unitSection.updateMany({
            where: {
              id: params.sectionId,
              OR: [
                ...(!waitingForExistingRun
                  ? [
                      {
                        testGenerationStatus: {
                          in: ["pending", "failed"],
                        },
                      },
                    ]
                  : []),
                { testGenerationStartedAt: { lt: staleBefore } },
              ],
            },
            data: {
              testGenerationStatus: "building",
              testGenerationError: "",
              testGenerationStartedAt: new Date(),
              testGenerationToken: params.token,
            },
          });
    if (claimed.count === 1) return true;

    waitingForExistingRun = true;
    const current = await client.unitSection.findUnique({
      where: { id: params.sectionId },
      select: {
        generationStatus: true,
        generationError: true,
        testGenerationStatus: true,
        testGenerationError: true,
      },
    });
    if (!current) throw new Error("Section not found");
    const status =
      params.kind === "content"
        ? current.generationStatus
        : current.testGenerationStatus;
    const error =
      params.kind === "content"
        ? current.generationError
        : current.testGenerationError;
    if (status === "ready") return false;
    if (status !== "building") {
      throw new Error(error || "Section generation stopped before completion");
    }
    await abortableDelay(SECTION_GENERATION_POLL_MS, params.signal);
  }
}

function registerSectionGeneration(params: {
  client?: PersistenceClient;
  repository?: UnitSectionPlanRepository;
  unitId: string;
  sectionId: string;
  kind: SectionGenerationKind;
  token: string;
  signal?: AbortSignal;
}): {
  signal: AbortSignal;
  quiesceHeartbeat: () => Promise<void>;
  release: () => Promise<void>;
} {
  const key = sectionGenerationKey(
    params.unitId,
    params.sectionId,
    params.kind,
  );
  const controller = new AbortController();
  const previous = activeSectionGenerations.get(key);
  if (previous?.token !== params.token) previous?.controller.abort();
  activeSectionGenerations.set(key, { token: params.token, controller });
  sectionGenerationProgress.begin(key, params.token);
  const signal = params.signal
    ? AbortSignal.any([params.signal, controller.signal])
    : controller.signal;
  let heartbeat: Promise<unknown> | null = null;
  let heartbeatStopped = false;
  // Desktop-local uses a single SQLite connection. Overlapping heartbeats can
  // stall MikroORM's queue, so skip a tick while one write is already in flight.
  // Do still renew the lease: otherwise a reconnect after ~45s steals the token
  // and aborts nested unit.learning_material / html_generate work.
  const timer = setInterval(() => {
    if (heartbeatStopped || heartbeat) return;
    heartbeat = (
      params.repository
        ? params.repository.heartbeatGeneration({
            sectionId: params.sectionId,
            kind: params.kind,
            token: params.token,
            at: new Date(),
          })
        : params.kind === "content"
          ? params.client!.unitSection.updateMany({
              where: {
                id: params.sectionId,
                generationToken: params.token,
                generationStatus: "building",
              },
              data: { generationStartedAt: new Date() },
            })
          : params.client!.unitSection.updateMany({
              where: {
                id: params.sectionId,
                testGenerationToken: params.token,
                testGenerationStatus: "building",
              },
              data: { testGenerationStartedAt: new Date() },
            })
    )
      .catch(() => undefined)
      .finally(() => {
        heartbeat = null;
      });
  }, SECTION_GENERATION_HEARTBEAT_MS);
  timer.unref?.();

  const quiesceHeartbeat = async () => {
    if (!heartbeatStopped) {
      heartbeatStopped = true;
      if (timer) clearInterval(timer);
    }
    await heartbeat?.catch(() => undefined);
  };

  return {
    signal,
    quiesceHeartbeat,
    release: async () => {
      await quiesceHeartbeat();
      const active = activeSectionGenerations.get(key);
      if (active?.token === params.token) activeSectionGenerations.delete(key);
      sectionGenerationProgress.end(key, params.token);
    },
  };
}

const SECTION_QUESTION_TITLES = new Set([
  "小节测验",
  "小節測驗",
  "Section questions",
  "セクション問題",
  "섹션 확인 문제",
  "Preguntas de la sección",
  "Questions de la section",
  "Abschnittsfragen",
]);

function sectionQuestionTitle(material: LearningMaterialContent): string {
  const language = detectContentLanguage(
    [material.introduction, ...material.keyTakeaways].join("\n"),
  );
  if (language === "zh-Hant") return "小節測驗";
  if (language === "zh-Hans") return "小节测验";
  if (language === "ja") return "セクション問題";
  if (language === "ko") return "섹션 확인 문제";
  if (language === "es") return "Preguntas de la sección";
  if (language === "fr") return "Questions de la section";
  if (language === "de") return "Abschnittsfragen";
  return "Section questions";
}

/**
 * Compatibility layout for material created before section-end assessments.
 * Check identities stay unchanged; only their learner-visible block positions
 * move into one required question section at the end of this teaching slice.
 */
export function groupMaterialChecksAtSectionEnd(
  material: LearningMaterialContent,
): LearningMaterialContent {
  const checks = material.blocks.filter((block) => block.type === "check");
  if (checks.length === 0) return material;
  const teachingBlocks = material.blocks.filter(
    (block) => block.type !== "check",
  );
  const lastTeachingBlock = teachingBlocks.at(-1);
  const hasQuestionHeading =
    lastTeachingBlock?.type === "heading" &&
    SECTION_QUESTION_TITLES.has(lastTeachingBlock.text);
  return {
    ...material,
    blocks: [
      ...teachingBlocks,
      ...(hasQuestionHeading
        ? []
        : [
            {
              type: "heading" as const,
              level: 2 as const,
              text: sectionQuestionTitle(material),
            },
          ]),
      ...checks,
    ],
  };
}

export function splitSectionMaterial(material: LearningMaterialContent): {
  content: LearningMaterialContent;
  test: LearningMaterialContent | null;
} {
  const grouped = groupMaterialChecksAtSectionEnd(material);
  const firstCheck = grouped.blocks.findIndex(
    (block) => block.type === "check",
  );
  if (firstCheck < 0) return { content: grouped, test: null };
  const precedingBlock = grouped.blocks[firstCheck - 1];
  const headingIndex =
    firstCheck > 0 &&
    precedingBlock?.type === "heading" &&
    SECTION_QUESTION_TITLES.has(precedingBlock.text)
      ? firstCheck - 1
      : firstCheck;
  return {
    content: { ...grouped, blocks: grouped.blocks.slice(0, headingIndex) },
    test: {
      introduction: "",
      blocks: grouped.blocks.slice(headingIndex),
      keyTakeaways: [],
    },
  };
}

function asComponentPlan(
  value: unknown,
): UnitSectionManifest["virtualComponents"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.componentType !== "string")
      return [];
    const description =
      typeof item.description === "string" ? item.description : "";
    return [
      {
        id: item.id,
        title:
          typeof item.title === "string" && item.title.trim()
            ? item.title.trim()
            : description.slice(0, 48) || "互动练习",
        componentType: item.componentType,
        description,
        anchor: `component-${item.id}`,
      },
    ];
  });
}

function plannedComponents(sq3rData: string | null | undefined) {
  if (!sq3rData) return [];
  try {
    const parsed = sqPreviewSchema.safeParse(JSON.parse(sq3rData));
    return parsed.success
      ? (parsed.data.componentSelection?.plannedComponents ?? [])
      : [];
  } catch {
    return [];
  }
}

export function plannedTeachingSectionCount(targetCount: number): number {
  return Math.max(2, Math.min(5, Math.ceil(Math.max(1, targetCount) / 2)));
}

function componentSectionScore(
  componentDescription: string,
  sectionText: string,
): number {
  const normalizedDescription = componentDescription.toLocaleLowerCase();
  const words = sectionText
    .toLocaleLowerCase()
    .split(/[\s与和及、/,，:：;；()（）_-]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
  return [...new Set(words)].reduce(
    (score, word) =>
      score + (normalizedDescription.includes(word) ? word.length : 0),
    0,
  );
}

/**
 * Delete the frozen section spine for a unit. Used when regenerating Survey —
 * component plan and target buckets must be rebuilt from the replacement SQ.
 */
export async function deleteUnitSections(
  unitId: string,
  client?: PersistenceClient,
): Promise<number> {
  if (configuredUnitSectionPlanPersistence) {
    return configuredUnitSectionPlanPersistence.deleteAll(unitId);
  }
  if (!client)
    throw new Error("Unit section plan persistence is not configured");
  const result = await client.unitSection.deleteMany({ where: { unitId } });
  return result.count;
}

/**
 * Keep the frozen section plan but drop authored content, mini-tests, and
 * learner section progress so material regeneration can restart from section 1.
 */
export async function clearUnitSectionGeneratedContent(
  unitId: string,
  client?: PersistenceClient,
): Promise<number> {
  if (configuredUnitSectionPlanPersistence) {
    return configuredUnitSectionPlanPersistence.clearGenerated(unitId);
  }
  if (!client)
    throw new Error("Unit section plan persistence is not configured");
  const sections = await client.unitSection.findMany({
    where: { unitId },
    select: { id: true },
  });
  if (sections.length === 0) return 0;
  const sectionIds = sections.map((section) => section.id);
  await client.$transaction(async (tx) => {
    await tx.unitSectionMaterial.deleteMany({
      where: { sectionId: { in: sectionIds } },
    });
    await tx.unitSectionProgress.deleteMany({
      where: { sectionId: { in: sectionIds } },
    });
    await tx.unitSection.updateMany({
      where: { unitId },
      data: {
        generationStatus: "pending",
        generationError: "",
        generationStartedAt: null,
        generationToken: null,
        testGenerationStatus: "pending",
        testGenerationError: "",
        testGenerationStartedAt: null,
        testGenerationToken: null,
      },
    });
  });
  return sections.length;
}

/**
 * Freeze the section spine for every course kind. Mastery courses bind the
 * frozen Survey outline to published KACOM targets; KACOM-free courses use the
 * same outline and transport without inventing target identities.
 */
export async function ensureUnitSectionPlan(
  unitId: string,
  client?: PersistenceClient,
  options: { force?: boolean } = {},
) {
  const persistedSource = configuredUnitSectionPlanPersistence
    ? await configuredUnitSectionPlanPersistence.findSource(unitId)
    : null;
  if (!persistedSource && !client) {
    throw new Error("Unit section plan persistence is not configured");
  }
  const unit = persistedSource
    ? {
        id: persistedSource.id,
        title: persistedSource.title,
        contentSummary: persistedSource.contentSummary,
        unitKind: persistedSource.unitKind,
        goal: persistedSource.goal,
        sessionState: persistedSource.sq3rData
          ? { sq3rData: persistedSource.sq3rData }
          : null,
        learningMaterial: persistedSource.hasLearningMaterial
          ? { unitId: persistedSource.id }
          : null,
        sections: persistedSource.existingSections,
        learningTargets: persistedSource.learningTargets.map((target) => ({
          ...target,
          learningTarget: { ...target.learningTarget },
        })),
      }
      : await client!.learningUnit.findUnique({
        where: { id: unitId },
        select: {
          id: true,
          title: true,
          contentSummary: true,
          unitKind: true,
          goal: {
            select: { goalKind: true, learningMode: true, userId: true },
          },
          sessionState: { select: { sq3rData: true } },
          learningMaterial: { select: { unitId: true } },
          sections: { orderBy: { orderIndex: "asc" } },
          learningTargets: {
            where: { role: { not: "review" } },
            orderBy: { orderIndex: "asc" },
            include: { learningTarget: true },
          },
        },
      });
  if (!unit || (unit.sections?.length ?? 0) > 0) {
    return unit?.sections ?? [];
  }
  if (unit.learningMaterial && !options.force) return [];
  const isOverview = String(unit.unitKind ?? "") === "overview";
  const usesCognitiveModel =
    !isOverview &&
    unit.goal.goalKind !== "micro" &&
    unit.goal.learningMode !== "exploration";
  const learningTargets: UnitSectionPlanTargetRecord[] =
    unit.learningTargets.map((target) => ({
      learningTargetId: target.learningTargetId,
      localRef: target.localRef,
      role: target.role,
      learningTarget: {
        title: target.learningTarget.title,
        explanation: target.learningTarget.explanation,
        learningObjective: target.learningTarget.learningObjective,
        importance: target.learningTarget.importance,
        difficulty: target.learningTarget.difficulty,
        targetCognitiveLevel: target.learningTarget.targetCognitiveLevel,
        definitionVersion: target.learningTarget.definitionVersion,
      },
    }));
  if (usesCognitiveModel && learningTargets.length === 0) return [];

  const storedSq = (() => {
    if (!unit.sessionState?.sq3rData) return null;
    try {
      const parsed = sqPreviewSchema.safeParse(
        JSON.parse(unit.sessionState.sq3rData),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })();
  const outline = storedSq?.survey.sectionOutline;
  const byLocalRef = new Map(
    learningTargets.map((target) => [target.localRef, target] as const),
  );
  const outlinePlans = outline?.map((item) => ({
    title: item.title,
    contentSummary: item.scope,
    assessmentAfter: usesCognitiveModel && item.checkpointAfter,
    contentKind: persistedSectionContentKind(item.contentKind),
    targets: (item.learningTargetIds ?? []).flatMap((localRef) => {
      const target = byLocalRef.get(localRef);
      return target ? [target] : [];
    }),
  }));
  const microOutlinePlans =
    outlinePlans ??
    storedSq?.survey.outline?.map((title) => ({
      title,
      contentSummary: unit.contentSummary?.trim() || title,
      contentKind: persistedSectionContentKind(storedSq.survey.contentKind),
    }));
  const explorationPlans = storedSq?.survey.sectionPlan?.map((section) => {
    const ownedOutline = section.outlineIndexes.map(
      (outlineIndex) => storedSq.survey.outline[outlineIndex]!,
    );
    return {
      title: section.title,
      contentSummary: [...new Set([section.scope, ...ownedOutline])].join("；"),
      assessmentAfter: false,
      contentKind: persistedSectionContentKind(section.contentKind),
      targets: [] as UnitSectionPlanTargetRecord[],
    };
  });
  const outlineTargetIds = new Set(
    outlinePlans?.flatMap((plan) =>
      plan.targets.map((target) => target.learningTargetId),
    ),
  );
  const hasCompleteOutlinePlan =
    Boolean(outlinePlans?.length) &&
    (!usesCognitiveModel ||
      (outlinePlans!.every((plan) => plan.targets.length > 0) &&
        learningTargets.every((target) =>
          outlineTargetIds.has(target.learningTargetId),
        )));
  const sectionPlans: Array<{
    title: string;
    contentSummary: string;
    assessmentAfter: boolean;
    contentKind?: "standard" | "formal_derivation";
    targets: UnitSectionPlanTargetRecord[];
  }> =
    unit.goal.goalKind === "micro" || isOverview
      ? [
          microCourseSectionPlanDraft({
            unitTitle: unit.title,
            unitContentSummary: unit.contentSummary,
            outlinePlans: isOverview
              ? [
                  {
                    title: unit.title,
                    contentSummary: unit.contentSummary?.trim() || unit.title,
                    contentKind: "standard",
                  },
                ]
              : microOutlinePlans,
            surveyContentKind: isOverview
              ? "standard"
              : storedSq?.survey.contentKind,
          }),
        ]
      : hasCompleteOutlinePlan
        ? outlinePlans!
        : !usesCognitiveModel
          ? explorationPlans?.length
            ? explorationPlans
            : (storedSq?.survey.outline?.length
                ? storedSq.survey.outline
                : [unit.title]
              ).map((title, index) => ({
                title,
                contentSummary:
                  index === 0 && unit.contentSummary
                    ? unit.contentSummary
                    : `围绕“${title}”完成本节学习。`,
                assessmentAfter: false,
                targets: [] as UnitSectionPlanTargetRecord[],
              }))
          : (() => {
              const count = plannedTeachingSectionCount(learningTargets.length);
              const buckets = Array.from(
                { length: count },
                () => [] as UnitSectionPlanTargetRecord[],
              );
              learningTargets.forEach((target, index) => {
                buckets[
                  Math.min(
                    count - 1,
                    Math.floor((index * count) / learningTargets.length),
                  )
                ]!.push(target);
              });
              for (const bucket of buckets) {
                if (bucket.length === 0) bucket.push(learningTargets.at(-1)!);
              }
              return buckets.map((targets, index) => {
                const first = targets[0]!.learningTarget;
                const last = targets.at(-1)!.learningTarget;
                return {
                  title:
                    targets.length === 1
                      ? index === count - 1 && count > learningTargets.length
                        ? `${first.title}：应用与巩固`
                        : first.title
                      : `${first.title} → ${last.title}`,
                  contentSummary: targets
                    .map(
                      (row) =>
                        row.learningTarget.learningObjective ||
                        row.learningTarget.explanation,
                    )
                    .filter(Boolean)
                    .join("；"),
                  assessmentAfter: true,
                  targets,
                };
              });
            })();

  const components = plannedComponents(unit.sessionState?.sq3rData);
  const componentAssignments = new Map<number, typeof components>();
  components.forEach((component, componentIndex) => {
    const scores = sectionPlans.map((plan) =>
      componentSectionScore(
        component.description,
        [
          plan.title,
          plan.contentSummary,
          ...plan.targets.map((target) => target.learningTarget.title),
        ].join(" "),
      ),
    );
    const bestScore = Math.max(...scores);
    const sectionIndex =
      bestScore > 0
        ? scores.indexOf(bestScore)
        : componentIndex % sectionPlans.length;
    componentAssignments.set(sectionIndex, [
      ...(componentAssignments.get(sectionIndex) ?? []),
      component,
    ]);
  });
  const targetOccurrenceCounts = new Map<string, number>();
  sectionPlans.forEach((plan) => {
    plan.targets.forEach((target) => {
      targetOccurrenceCounts.set(
        target.learningTargetId,
        (targetOccurrenceCounts.get(target.learningTargetId) ?? 0) + 1,
      );
    });
  });
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        unitId,
        targets: learningTargets.map((row) => [
          row.learningTargetId,
          row.learningTarget.definitionVersion,
        ]),
        components,
        sectionOutline: sectionPlans.map((plan) => ({
          title: plan.title,
          contentSummary: plan.contentSummary,
          assessmentAfter: plan.assessmentAfter,
          learningTargetIds: plan.targets.map(
            (target) => target.learningTargetId,
          ),
        })),
      }),
    )
    .digest("hex");

  const drafts = sectionPlans.map((plan, index) => {
    const targets = plan.targets;
    const componentPlan = (componentAssignments.get(index) ?? []).map(
      (component) => ({
        ...component,
        title: component.description.slice(0, 48),
      }),
    );
    const workloadMinutes = targets.reduce(
      (sum, row) =>
        sum +
        learningTargetWorkload({
          importance:
            row.learningTarget.importance === "supporting" ||
            row.learningTarget.importance === "enrichment"
              ? row.learningTarget.importance
              : "core",
          difficulty:
            row.learningTarget.difficulty === "easy" ||
            row.learningTarget.difficulty === "hard"
              ? row.learningTarget.difficulty
              : "medium",
          targetCognitiveLevel:
            row.learningTarget.targetCognitiveLevel === "remember" ||
            row.learningTarget.targetCognitiveLevel === "apply" ||
            row.learningTarget.targetCognitiveLevel === "analyze" ||
            row.learningTarget.targetCognitiveLevel === "evaluate" ||
            row.learningTarget.targetCognitiveLevel === "create"
              ? row.learningTarget.targetCognitiveLevel
              : "understand",
        }).teachingMinutes /
          (targetOccurrenceCounts.get(row.learningTargetId) ?? 1),
      usesCognitiveModel ? 0 : 4,
    );
    return {
      stableKey: `section_${index + 1}`,
      orderIndex: index,
      title: plan.title,
      contentSummary: plan.contentSummary,
      assessmentAfter: plan.assessmentAfter,
      baseEstimatedMinutes: Math.max(
        3,
        Math.min(6, Math.ceil(workloadMinutes + componentPlan.length * 2)),
      ),
      componentPlan,
      generationInputHash: inputHash,
      contentKind: persistedSectionContentKind(plan.contentKind),
      targets: targets.map((row) => ({
        learningTargetId: row.learningTargetId,
        role: (row.role === "supporting" ? "supporting" : "primary") as
          "supporting" | "primary",
      })),
    };
  });
  if (configuredUnitSectionPlanPersistence) {
    return configuredUnitSectionPlanPersistence.publishIfEmpty(unitId, drafts);
  }

  try {
    await client!.$transaction(async (tx) => {
      const existing = await tx.unitSection.count({ where: { unitId } });
      if (existing > 0) return;
      for (const draft of drafts) {
        await tx.unitSection.create({
          data: {
            unitId,
            stableKey: draft.stableKey,
            orderIndex: draft.orderIndex,
            title: draft.title,
            contentSummary: draft.contentSummary,
            assessmentAfter: draft.assessmentAfter,
            baseEstimatedMinutes: draft.baseEstimatedMinutes,
            componentPlan: [...draft.componentPlan],
            generationInputHash: draft.generationInputHash,
            contentKind: draft.contentKind ?? "standard",
            targets: {
              create: [...draft.targets],
            },
          },
        });
      }
    });
  } catch (error) {
    if (!(
      error instanceof Persistence.KnownRequestError && error.code === "P2002"
    )) {
      throw error;
    }
  }
  const saved = await client!.unitSection.findMany({
    where: { unitId },
    orderBy: { orderIndex: "asc" },
  });
  return saved;
}

function assessmentGroupForIndex<
  T extends { id: string; orderIndex: number; assessmentAfter: boolean },
>(sections: readonly T[], index: number): T[] {
  let startIndex = index;
  while (startIndex > 0 && !sections[startIndex - 1]!.assessmentAfter) {
    startIndex -= 1;
  }
  return sections.slice(startIndex, index + 1);
}

async function recommendedSkipSections(
  userId: string,
  sectionIds: string[],
  client: PersistenceClient,
): Promise<boolean> {
  const freshnessCutoff = new Date(
    Date.now() -
      DEFAULT_DIMENSION_INFERENCE_THRESHOLDS.revalidateAfterDays * 86_400_000,
  );
  const bindings = await client.unitSectionLearningTarget.findMany({
    where: { sectionId: { in: sectionIds } },
    include: {
      learningTarget: {
        include: {
          requirements: {
            where: { required: true },
            include: {
              cognitiveEntity: {
                include: {
                  learnerStates: {
                    where: { userId },
                    include: { dimensions: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (bindings.length === 0) return false;
  return bindings.every(
    ({ learningTarget }) =>
      learningTarget.requirements.length > 0 &&
      learningTarget.requirements.every((requirement) => {
        const state = requirement.cognitiveEntity.learnerStates[0];
        const dimension = state?.dimensions.find(
          (item) => item.dimension === requirement.dimension,
        );
        return Boolean(
          dimension &&
          (dimension.status === "demonstrated" ||
            dimension.status === "robust") &&
          dimension.estimate != null &&
          dimension.estimate >= requirement.threshold &&
          dimension.evidenceSufficiency >= 0.5 &&
          dimension.lastObservedAt != null &&
          dimension.lastObservedAt > freshnessCutoff,
        );
      }),
  );
}

export async function getUnitSectionManifest(
  userId: string,
  unitId: string,
  client?: PersistenceClient,
): Promise<UnitSectionManifest[]> {
  await ensureUnitSectionPlan(unitId, client);
  if (configuredUnitSectionPlanPersistence) {
    const source = await configuredUnitSectionPlanPersistence.findManifest({
      userId,
      unitId,
      freshnessCutoff: new Date(
        Date.now() -
          DEFAULT_DIMENSION_INFERENCE_THRESHOLDS.revalidateAfterDays *
            86_400_000,
      ),
    });
    if (!source) throw new Error("Unit not found");
    if (source.sections.length === 0) {
      if (!source.legacy) return [];
      return [
        {
          id: `legacy:${unitId}`,
          sourceSectionId: `legacy:${unitId}`,
          sectionKind: "content",
          stableKey: "legacy",
          orderIndex: 0,
          title: "完整课程",
          contentSummary: "此课程使用兼容内容格式。",
          requiredForCompletion: true,
          baseEstimatedMinutes: Math.max(
            5,
            Math.min(30, parseLearningMaterial(source.legacy).blocks?.length ?? 5),
          ),
          generationStatus: "ready",
          generationError: "",
          contentRevision: 0,
          status: "available",
          activeSeconds: 0,
          recommendSkip: false,
          virtualComponents: [],
          contentKind: "standard",
          legacy: true,
        },
      ];
    }
    const pairs = source.sections.map((section, sectionIndex) => {
      const assessmentGroup = assessmentGroupForIndex(
        source.sections,
        sectionIndex,
      );
      const persistedStatus = (section.progressStatus ??
        "available") as UnitSectionManifest["status"];
      const contentStatus: UnitSectionManifest["status"] =
        persistedStatus === "skipped"
          ? "skipped"
          : section.contentCompletedAt || persistedStatus === "completed"
            ? "completed"
            : persistedStatus;
      const testStatus: UnitSectionManifest["status"] =
        persistedStatus === "skipped"
          ? "skipped"
          : persistedStatus === "completed"
            ? "completed"
            : "available";
      const skipGroup = section.assessmentAfter ? assessmentGroup : [section];
      const eligible = skipGroup.filter((item) => item.hasSkipRequirements);
      const content = {
        id: section.id,
        sourceSectionId: section.id,
        sectionKind: "content" as const,
        stableKey: section.stableKey,
        orderIndex: section.orderIndex * 2,
        title: section.title,
        contentSummary: section.contentSummary,
        requiredForCompletion: section.requiredForCompletion,
        baseEstimatedMinutes: section.baseEstimatedMinutes,
        generationStatus: section.generationStatus,
        generationError: learnerFacingSectionGenerationError(
          section.generationStatus,
          section.generationError,
        ),
        contentRevision: section.contentRevision,
        status: contentStatus,
        activeSeconds: section.activeSeconds,
        recommendSkip:
          persistedStatus === "completed" || persistedStatus === "skipped"
            ? false
            : eligible.length > 0 &&
              eligible.every((item) => item.skipRequirementsSatisfied),
        virtualComponents: asComponentPlan(section.componentPlan),
        contentKind: persistedSectionContentKind(section.contentKind),
        derivationFormat: section.derivationFormat ?? null,
        legacy: false,
      };
      if (!section.assessmentAfter)
        return [content] satisfies UnitSectionManifest[];
      const firstSectionNumber =
        (assessmentGroup[0]?.orderIndex ?? section.orderIndex) + 1;
      const lastSectionNumber = section.orderIndex + 1;
      const test = {
        id: miniTestSectionId(section.id),
        sourceSectionId: section.id,
        sectionKind: "mini_test" as const,
        stableKey: `${section.stableKey}_mini_test`,
        orderIndex: section.orderIndex * 2 + 1,
        title:
          firstSectionNumber === lastSectionNumber
            ? `第 ${lastSectionNumber} 节 · 理解检查`
            : `第 ${firstSectionNumber}–${lastSectionNumber} 节 · 理解检查`,
        contentSummary: "用几道只覆盖本组学习小节的短题检查理解。",
        requiredForCompletion: section.requiredForCompletion,
        baseEstimatedMinutes: 5,
        generationStatus: section.testGenerationStatus,
        generationError: learnerFacingSectionGenerationError(
          section.testGenerationStatus,
          section.testGenerationError,
        ),
        contentRevision: section.contentRevision,
        status: testStatus,
        activeSeconds: 0,
        recommendSkip: false,
        virtualComponents: [],
        contentKind: "standard",
        legacy: false,
      };
      return [content, test] satisfies UnitSectionManifest[];
    });
    return pairs.flat();
  }
  if (!client)
    throw new Error("Unit section manifest persistence is not configured");
  const sections = await client.unitSection.findMany({
    where: { unitId },
    orderBy: { orderIndex: "asc" },
    include: { progress: { where: { userId } } },
  });
  if (sections.length === 0) {
    const legacy = await client.learningMaterial.findUnique({
      where: { unitId },
    });
    if (!legacy) return [];
    return [
      {
        id: `legacy:${unitId}`,
        sourceSectionId: `legacy:${unitId}`,
        sectionKind: "content",
        stableKey: "legacy",
        orderIndex: 0,
        title: "完整课程",
        contentSummary: "此课程使用兼容内容格式。",
        requiredForCompletion: true,
        baseEstimatedMinutes: Math.max(
          5,
          Math.min(30, parseLearningMaterial(legacy).blocks?.length ?? 5),
        ),
        generationStatus: "ready",
        generationError: "",
        contentRevision: 0,
        status: "available",
        activeSeconds: 0,
        recommendSkip: false,
        virtualComponents: [],
        contentKind: "standard",
        legacy: true,
      },
    ];
  }
  const pairs = await Promise.all(
    sections.map(async (section, sectionIndex) => {
      const progress = section.progress[0];
      const assessmentGroup = assessmentGroupForIndex(sections, sectionIndex);
      const persistedStatus = (progress?.status ??
        "available") as UnitSectionManifest["status"];
      const contentStatus: UnitSectionManifest["status"] =
        persistedStatus === "skipped"
          ? "skipped"
          : progress?.contentCompletedAt || persistedStatus === "completed"
            ? "completed"
            : persistedStatus;
      const testStatus: UnitSectionManifest["status"] =
        persistedStatus === "skipped"
          ? "skipped"
          : persistedStatus === "completed"
            ? "completed"
            : "available";
      const content = {
        id: section.id,
        sourceSectionId: section.id,
        sectionKind: "content" as const,
        stableKey: section.stableKey,
        orderIndex: section.orderIndex * 2,
        title: section.title,
        contentSummary: section.contentSummary,
        requiredForCompletion: section.requiredForCompletion,
        baseEstimatedMinutes: section.baseEstimatedMinutes,
        generationStatus: section.generationStatus,
        generationError: learnerFacingSectionGenerationError(
          section.generationStatus,
          section.generationError,
        ),
        contentRevision: section.contentRevision,
        status: contentStatus,
        activeSeconds: progress?.activeSeconds ?? 0,
        recommendSkip:
          progress?.status === "completed" || progress?.status === "skipped"
            ? false
            : await recommendedSkipSections(
                userId,
                section.assessmentAfter
                  ? assessmentGroup.map((item) => item.id)
                  : [section.id],
                client,
              ),
        virtualComponents: asComponentPlan(section.componentPlan),
        contentKind: persistedSectionContentKind(section.contentKind),
        derivationFormat: section.derivationFormat ?? null,
        legacy: false,
      };
      if (!section.assessmentAfter) {
        return [content] satisfies UnitSectionManifest[];
      }
      const firstSectionNumber =
        (assessmentGroup[0]?.orderIndex ?? section.orderIndex) + 1;
      const lastSectionNumber = section.orderIndex + 1;
      const test = {
        id: miniTestSectionId(section.id),
        sourceSectionId: section.id,
        sectionKind: "mini_test" as const,
        stableKey: `${section.stableKey}_mini_test`,
        orderIndex: section.orderIndex * 2 + 1,
        title:
          firstSectionNumber === lastSectionNumber
            ? `第 ${lastSectionNumber} 节 · 理解检查`
            : `第 ${firstSectionNumber}–${lastSectionNumber} 节 · 理解检查`,
        contentSummary: "用几道只覆盖本组学习小节的短题检查理解。",
        requiredForCompletion: section.requiredForCompletion,
        baseEstimatedMinutes: 5,
        generationStatus: section.testGenerationStatus,
        generationError: learnerFacingSectionGenerationError(
          section.testGenerationStatus,
          section.testGenerationError,
        ),
        contentRevision: section.contentRevision,
        status: testStatus,
        activeSeconds: 0,
        recommendSkip: false,
        virtualComponents: [],
        contentKind: "standard",
        legacy: false,
      };
      return [content, test] satisfies UnitSectionManifest[];
    }),
  );
  return pairs.flat();
}

function parsePublishedDerivation(json: string | null | undefined) {
  if (!json?.trim()) return null;
  try {
    return parseDerivationDocument(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

function sectionHasReadyTeachingContent(stored: {
  material: LearningMaterialContent | null;
  derivation: ReturnType<typeof parseDerivationDocument> | null;
  teachingDerivation?: unknown;
}) {
  return Boolean(stored.material?.introduction || stored.material?.blocks.length ||
    stored.material?.keyTakeaways.length || stored.derivation || stored.teachingDerivation);
}

function emptyLearningMaterial(): LearningMaterialContent {
  return { introduction: "", blocks: [], keyTakeaways: [] };
}

function isSectionChecksOnly(stored: {introduction: string; blocks: string; keyTakeaways: string} | null) {
  if (!stored || stored.introduction.trim()) return false;
  try {
    const blocks = JSON.parse(stored.blocks), takeaways = JSON.parse(stored.keyTakeaways);
    return Array.isArray(blocks) && blocks.some(block => block.type === "check") &&
      !takeaways.length && blocks.every(block => block.type === "check" ||
        (block.type === "heading" && SECTION_QUESTION_TITLES.has(block.text)));
  } catch { return false; }
}

function sectionHasReadyTeachingSource(section: {
  generationStatus: string;
  contentKind?: string;
  derivationJson?: string | null;
  teachingDerivationJson?: string | null;
  material: unknown;
}) {
  if (section.generationStatus !== "ready") return false;
  if (section.material) return true;
  return (
    persistedSectionContentKind(section.contentKind) === "formal_derivation" &&
    Boolean(
      String(section.derivationJson ?? "").trim() ||
        String(section.teachingDerivationJson ?? "").trim(),
    )
  );
}

function derivationContextBlocks(
  derivationJson: string | null | undefined,
): LearningMaterialContent["blocks"] {
  const document = parsePublishedDerivation(derivationJson);
  if (!document) return [];
  const blocks: LearningMaterialContent["blocks"] = [];
  const title = document.title.trim();
  if (title) {
    blocks.push({ type: "heading", level: 2, text: title });
  }
  const requirement = document.requirement?.text?.trim();
  if (requirement) {
    blocks.push({ type: "paragraph", text: requirement });
  }
  for (const step of document.steps) {
    for (const item of step.presentation?.narration ?? []) {
      const text = item.text?.trim();
      if (text) blocks.push({ type: "paragraph", text });
    }
  }
  const summary = document.completion?.summary?.trim();
  if (summary) {
    blocks.push({ type: "paragraph", text: summary });
  }
  return blocks;
}

function parsePublishedTeachingDerivation(json: string | null | undefined) {
  if (!json?.trim()) return null;
  try {
    return parseTeachingDerivationDocument(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

function teachingDerivationContextBlocks(
  teachingDerivationJson: string | null | undefined,
): LearningMaterialContent["blocks"] {
  const document = parsePublishedTeachingDerivation(teachingDerivationJson);
  if (!document) return [];
  const blocks: LearningMaterialContent["blocks"] = [];
  if (document.title.trim()) {
    blocks.push({ type: "heading", level: 2, text: document.title.trim() });
  }
  for (const step of document.steps) {
    const text = step.narration?.trim();
    if (text) blocks.push({ type: "paragraph", text });
  }
  if (document.summary?.trim()) {
    blocks.push({ type: "paragraph", text: document.summary.trim() });
  }
  return blocks;
}

async function getStoredUnitSectionContent(
  userId: string,
  unitId: string,
  sectionId: string,
  revision: number | undefined,
  client?: PersistenceClient,
): Promise<{
  sectionId: string;
  contentRevision: number;
  blockOffset: number;
  contentKind: "standard" | "formal_derivation";
  derivationFormat: string | null;
  material: LearningMaterialContent | null;
  derivation: ReturnType<typeof parseDerivationDocument> | null;
  teachingDerivation: ReturnType<typeof parseTeachingDerivationDocument> | null;
  teachingDerivationDerived: unknown;
}> {
  const resolved = persistedSectionId(sectionId);
  if (configuredUnitSectionPlanPersistence) {
    const source =
      await configuredUnitSectionPlanPersistence.findSectionContent({
        userId,
        unitId,
        sectionId: resolved.id,
      });
    if (!source) throw new Error("Unit not found");
    if (resolved.id === `legacy:${unitId}`) {
      return {
        sectionId,
        contentRevision: 0,
        blockOffset: 0,
        contentKind: "standard",
        derivationFormat: null,
        material: source.legacy
          ? groupMaterialChecksAtSectionEnd(
              parseLearningMaterial(source.legacy),
            )
          : null,
        derivation: null,
        teachingDerivation: null,
        teachingDerivationDerived: null,
      };
    }
    if (!source.sectionFound) throw new Error("Section not found");
    if (revision != null && revision !== source.contentRevision) {
      const error = new Error("Section content revision mismatch") as Error & {
        currentRevision?: number;
      };
      error.currentRevision = source.contentRevision;
      throw error;
    }
    const parsedMaterial = source.material
      ? parseLearningMaterial({
          introduction: source.material.introduction,
          sections: source.material.blocks,
          keyTakeaways: source.material.keyTakeaways,
        })
      : null;
    const split = parsedMaterial ? splitSectionMaterial(parsedMaterial) : null;
    const checksOnly = isSectionChecksOnly(source.material);
    const priorBlockCount = source.priorMaterials.reduce(
      (sum, item) =>
        sum +
        groupMaterialChecksAtSectionEnd(
          parseLearningMaterial({
            introduction: item.introduction,
            sections: item.blocks,
            keyTakeaways: item.keyTakeaways,
          }),
        ).blocks.length,
      0,
    );
    return {
      sectionId,
      contentRevision: source.contentRevision,
      blockOffset:
        resolved.kind === "mini_test"
          ? priorBlockCount + (checksOnly ? 0 : split?.content.blocks.length ?? 0)
          : priorBlockCount,
      contentKind:
        resolved.kind === "mini_test"
          ? "standard"
          : persistedSectionContentKind(source.contentKind),
      derivationFormat:
        resolved.kind === "mini_test" ? null : source.derivationFormat ?? null,
      material:
        resolved.kind === "mini_test"
          ? (split?.test ?? null)
          : !checksOnly && split?.content && (split.content.blocks.length || split.content.introduction || split.content.keyTakeaways.length)
            ? split.content : null,
      derivation:
        resolved.kind === "mini_test"
          ? null
          : (parsePublishedDerivation(source.derivationJson) ??
            (persistedSectionContentKind(source.contentKind) ===
              "formal_derivation" &&
            source.derivationFormat !== "teaching_v1"
              ? await (
                  await import("./formal-derivation-live.js")
                ).loadUnpublishedDerivationDraft(resolved.id)
              : null)),
      teachingDerivation:
        resolved.kind === "mini_test"
          ? null
          : (parsePublishedTeachingDerivation(source.teachingDerivationJson) ??
            (source.derivationFormat === "teaching_v1"
              ? await (
                  await import("./teaching-derivation-live.js")
                ).loadUnpublishedTeachingDerivationDraft(resolved.id)
              : null)),
      teachingDerivationDerived:
        resolved.kind === "mini_test"
          ? null
          : source.teachingDerivationDerivedJson
            ? (() => {
                try {
                  return JSON.parse(source.teachingDerivationDerivedJson);
                } catch {
                  return null;
                }
              })()
            : null,
    };
  }
  if (!client)
    throw new Error("Unit section content persistence is not configured");
  const unit = await client.learningUnit.findFirst({
    where: { id: unitId, goal: { userId } },
    select: { id: true },
  });
  if (!unit) throw new Error("Unit not found");
  if (resolved.id === `legacy:${unitId}`) {
    const legacy = await client.learningMaterial.findUnique({
      where: { unitId },
    });
    return {
      sectionId,
      contentRevision: 0,
      blockOffset: 0,
      contentKind: "standard",
      material: legacy
        ? groupMaterialChecksAtSectionEnd(parseLearningMaterial(legacy))
        : null,
      derivation: null,
      teachingDerivation: null,
      teachingDerivationDerived: null,
      derivationFormat: null,
    };
  }
  const section = await client.unitSection.findFirst({
    where: { id: resolved.id, unitId },
    include: { material: true },
  });
  if (!section) throw new Error("Section not found");
  if (revision != null && revision !== section.contentRevision) {
    const error = new Error("Section content revision mismatch") as Error & {
      currentRevision?: number;
    };
    error.currentRevision = section.contentRevision;
    throw error;
  }
  const priorMaterials = await client.unitSection.findMany({
    where: {
      unitId,
      orderIndex: { lt: section.orderIndex },
      generationStatus: "ready",
      material: { isNot: null },
    },
    orderBy: { orderIndex: "asc" },
    include: { material: true },
  });
  const parsedMaterial = section.material
    ? parseLearningMaterial({
        introduction: section.material.introduction,
        sections: section.material.blocks,
        keyTakeaways: section.material.keyTakeaways,
      })
    : null;
  const split = parsedMaterial ? splitSectionMaterial(parsedMaterial) : null;
  const priorBlockCount = priorMaterials.reduce(
    (sum, item) =>
      sum +
      groupMaterialChecksAtSectionEnd(
        parseLearningMaterial({
          introduction: item.material!.introduction,
          sections: item.material!.blocks,
          keyTakeaways: item.material!.keyTakeaways,
        }),
      ).blocks.length,
    0,
  );
  return {
    sectionId,
    contentRevision: section.contentRevision,
    blockOffset:
      resolved.kind === "mini_test"
        ? priorBlockCount + (split?.content.blocks.length ?? 0)
        : priorBlockCount,
    contentKind: "standard",
    material:
      resolved.kind === "mini_test"
        ? (split?.test ?? null)
        : (split?.content ?? null),
    derivation: null,
    teachingDerivation: null,
    teachingDerivationDerived: null,
    derivationFormat: null,
  };
}

export type AggregatedUnitMaterialContext = {
  material: LearningMaterialContent;
  contextSources: ContentSource[];
};

/** Resolve only references whose owner and immutable source revision still match. */
export async function getUnitSectionContent(...params: Parameters<typeof getStoredUnitSectionContent>) {
  const {resolveDisplayBuilds} = await import("../display-build/material.js");
  return resolveDisplayBuilds(await getStoredUnitSectionContent(...params), params[0]);
}

/**
 * Build the same unit-level material view used by section renderers, together
 * with the sources stored beside each authored section.
 */
async function getStoredAggregatedUnitMaterialContext(
  unitId: string,
  client?: PersistenceClient,
  options: { requireAll?: boolean } = {},
): Promise<AggregatedUnitMaterialContext | null> {
  const portableSource = configuredUnitSectionPlanPersistence
    ? await configuredUnitSectionPlanPersistence.findMaterialSource(unitId)
    : null;
  if (!portableSource && !client)
    throw new Error("Unit material persistence is not configured");
  let sections =
    portableSource?.sections ??
    (await client!.unitSection.findMany({
      where: { unitId },
      orderBy: { orderIndex: "asc" },
      include: { material: true },
    })).map((section) => ({
      requiredForCompletion: Boolean(section.requiredForCompletion),
      generationStatus: String(section.generationStatus ?? ""),
      contentKind: String(section.contentKind ?? "standard"),
      derivationJson:
        typeof section.derivationJson === "string"
          ? section.derivationJson
          : typeof section.derivation?.documentJson === "string"
            ? section.derivation.documentJson
            : null,
      teachingDerivationJson: null,
      material: section.material ?? null,
    }));
  // Reading and Display share progression. Adapt ready reading to teaching
  // context without writing it into Display's material or generation status.
  const owner = getCurrentUserId();
  const readingMaterials = new Map<string, LearningMaterialContent>();
  if (portableSource && owner) {
    sections = await Promise.all(sections.map(async section => {
      if (sectionHasReadyTeachingSource(section) || !section.id) return section;
      const reading = await readyReadingMaterial(owner, unitId, section.id);
      if (!reading) return section;
      const checks = section.material ? splitSectionMaterial(parseLearningMaterial({
        introduction: section.material.introduction, sections: section.material.blocks,
        keyTakeaways: section.material.keyTakeaways,
      })).test?.blocks ?? [] : [];
      readingMaterials.set(section.id, {...reading, blocks: [...reading.blocks, ...checks]});
      return {...section, generationStatus: "ready", material: {
        introduction: reading.introduction, blocks: JSON.stringify([...reading.blocks, ...checks]),
        keyTakeaways: JSON.stringify(reading.keyTakeaways), contextSources: section.material?.contextSources ?? "[]",
      }};
    }));
  }
  if (sections.length > 0) {
    if (
      options.requireAll &&
      sections.some(
        (section) =>
          section.requiredForCompletion &&
          !sectionHasReadyTeachingSource(section),
      )
    ) {
      return null;
    }
    const available = sections.filter(
      (section) => section.generationStatus === "ready" && section.material,
    );
    const derivationSections = sections.filter((section) =>
      sectionHasReadyTeachingSource({
        ...section,
        material: null,
      }),
    );
    if (available.length === 0 && derivationSections.length === 0) return null;
    const materials = available.map((section) =>
      readingMaterials.get(section.id) ?? groupMaterialChecksAtSectionEnd(
        parseLearningMaterial({
          introduction: section.material!.introduction,
          sections: section.material!.blocks,
          keyTakeaways: section.material!.keyTakeaways,
        }),
      ),
    );
    const derivationBlocks = derivationSections.flatMap((section) => [
      ...derivationContextBlocks(section.derivationJson),
      ...teachingDerivationContextBlocks(section.teachingDerivationJson),
    ]);
    const first = materials[0] ?? emptyLearningMaterial();
    return {
      material: {
        introduction: first.introduction,
        blocks: [
          ...materials.flatMap((material) => material.blocks),
          ...derivationBlocks,
        ],
        keyTakeaways: materials.flatMap((material) => material.keyTakeaways),
      },
      contextSources: dedupeContentSources(
        available.flatMap((section) =>
          parseMaterialContextSources(section.material!),
        ),
      ),
    };
  }
  const legacy = portableSource
    ? portableSource.legacy
    : await client!.learningMaterial.findUnique({ where: { unitId } });
  const reading = !legacy && owner ? await readyReadingMaterial(owner, unitId, unitId) : null;
  return legacy
    ? {
        material: groupMaterialChecksAtSectionEnd(
          parseLearningMaterial(legacy),
        ),
        contextSources: parseMaterialContextSources(legacy),
      }
    : reading ? {material: reading, contextSources: []} : null;
}

export async function getAggregatedUnitMaterialContext(...params: Parameters<typeof getStoredAggregatedUnitMaterialContext>) {
  const [{resolveDisplayBuilds}, {getCurrentUserId}] = await Promise.all([
    import("../display-build/material.js"), import("../user-context.js"),
  ]);
  const material = await getStoredAggregatedUnitMaterialContext(...params);
  const userId = getCurrentUserId();
  return userId ? resolveDisplayBuilds(material, userId) : material;
}

export async function getAggregatedUnitMaterial(
  unitId: string,
  client?: PersistenceClient,
  options: { requireAll?: boolean } = {},
): Promise<LearningMaterialContent | null> {
  return (
    (await getAggregatedUnitMaterialContext(unitId, client, options))
      ?.material ?? null
  );
}

function sectionRecordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = record[key];
  return value == null ? "" : String(value);
}
function sectionRecordNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : 0;
}
function sectionRecordBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const value = record[key];
  return value === true || value === 1 || value === "1" || value === "true";
}

async function generatePortableUnitSectionMiniTest(params: {
  /** Internal production entry only; never inferred from ordinary learner requests. */
  generationPurpose?: "course-production";
  userId: string;
  unitId: string;
  sectionId: string;
  onPartialMaterial?: (partial: {
    material: LearningMaterialContent;
    completeBlockCount: number;
    placeholderBlockCount?: number;
  }) => void | Promise<void>;
  signal?: AbortSignal;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
}) {
  const repository = configuredUnitSectionPlanPersistence!;
  const source = await repository.findGenerationSource(params);
  if (!source) throw new Error("Section not found");
  const section = source.section;
  const reading = await readyReadingMaterial(params.userId, params.unitId, params.sectionId);
  if (!source.material && !reading) throw new Error("Complete the learning section first");
  if (!sectionRecordBoolean(section, "assessmentAfter"))
    throw new Error("This section does not have an assessment checkpoint");
  if (sectionRecordString(section, "testGenerationStatus") === "ready")
    return section;
  const sectionIndex = source.sections.findIndex(
    (item) => sectionRecordString(item, "id") === params.sectionId,
  );
  const assessmentGroup = assessmentGroupForIndex(
    source.sections as never[],
    sectionIndex,
  ) as Readonly<Record<string, unknown>>[];
  assertMiniTestGenerationReady(assessmentGroup, params.generationPurpose);
  const token = randomUUID();
  const claimed = await claimSectionGenerationLease({
    repository,
    sectionId: params.sectionId,
    kind: "mini_test",
    token,
    signal: params.signal,
  });
  if (!claimed) return section;
  const generation = registerSectionGeneration({
    repository,
    unitId: params.unitId,
    sectionId: params.sectionId,
    kind: "mini_test",
    token,
    signal: params.signal,
  });
  try {
    if (
      !(await repository.ownsGeneration({
        sectionId: params.sectionId,
        kind: "mini_test",
        token,
      }))
    )
      throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
    const rawSq = source.unit.sq3rData
      ? sqPreviewSchema.parse(JSON.parse(String(source.unit.sq3rData)))
      : null;
    if (!rawSq) throw new Error("Unit preview is not ready");
    const groupTargetIds = new Set(
      assessmentGroup.flatMap(
        (item) =>
          (
            item.targets as Array<{ learningTargetId: string }> | undefined
          )?.map((binding) => binding.learningTargetId) ?? [],
      ),
    );
    const assessmentTargets = (
      source.assessmentTargets as import("../assessment/activities.js").UnitAssessmentTarget[]
    ).filter((target) => groupTargetIds.has(target.id));
    const localRefs = new Set(
      assessmentTargets.map((target) => target.localRef),
    );
    const scopedSq = {
      ...rawSq,
      survey: {
        ...rawSq.survey,
        outline: assessmentGroup.map((item) =>
          sectionRecordString(item, "title"),
        ),
        sectionOutline: undefined,
        sectionPlan: undefined,
        learningTargetLabels: rawSq.learningTargets
          .filter((target) => localRefs.has(target.id))
          .map((target) => target.label),
      },
      learningTargets: rawSq.learningTargets.filter((target) =>
        localRefs.has(target.id),
      ),
      questions: rawSq.questions.filter((question) =>
        question.learningTargetIds?.some((ref) => localRefs.has(ref)),
      ),
    };
    const plans = planCourseMaterialInlineChecks({
      sqJson: JSON.stringify(scopedSq),
      authorityBindings:
        inlineCheckAuthorityBindingsFromTargets(assessmentTargets),
      sectionOrderIndex: sectionRecordNumber(section, "orderIndex"),
    });
    if (plans.length === 0)
      throw new Error("This section has no quiz-eligible learning targets");
    const storedMaterial = source.material ? parseLearningMaterial({
      introduction: source.material.introduction,
      sections: source.material.blocks,
      keyTakeaways: source.material.keyTakeaways,
    }) : emptyLearningMaterial();
    const readingContexts = new Map(await Promise.all(assessmentGroup.map(async item => {
      const id = sectionRecordString(item, "id");
      return [id, id === params.sectionId ? reading : await readyReadingMaterial(params.userId, params.unitId, id)];
    })));
    const teachingMaterial = splitSectionMaterial(storedMaterial).content;
    const assessmentContext: LearningMaterialContent = {
      introduction: assessmentGroup
        .flatMap((item) => {
          const material = item.material as typeof source.material;
          return material?.introduction ? [material.introduction] : [];
        })
        .join("\n\n"),
      blocks: assessmentGroup.flatMap((item) => {
        const material = item.material as typeof source.material;
        const readingContext = readingContexts.get(sectionRecordString(item, "id"));
        if (!material && !readingContext) return [];
        const content = readingContext ?? splitSectionMaterial(
          parseLearningMaterial({
            introduction: material.introduction,
            sections: material.blocks,
            keyTakeaways: material.keyTakeaways,
          }),
        ).content;
        return [
          {
            type: "heading" as const,
            level: 2 as const,
            text: sectionRecordString(item, "title"),
          },
          ...content.blocks,
        ];
      }),
      keyTakeaways: assessmentGroup.flatMap((item) => {
        const material = item.material as typeof source.material;
        return material
          ? splitSectionMaterial(
              parseLearningMaterial({
                introduction: material.introduction,
                sections: material.blocks,
                keyTakeaways: material.keyTakeaways,
              }),
            ).content.keyTakeaways
          : [];
      }),
    };
    const language = detectContentLanguage(
      [assessmentContext.introduction, ...assessmentContext.keyTakeaways].join(
        "\n",
      ),
    );
    const goalId = sectionRecordString(source.unit, "goalId");
    const unitTitle = sectionRecordString(source.unit, "title");
    const sectionTitle = sectionRecordString(section, "title");
    const authoredChecks = await runGenerationContextScope(
      {
        subject: { userId: params.userId, goalId, unitId: params.unitId },
        query: `${unitTitle} · ${sectionTitle}: section mini-test`,
      },
      () =>
        compileCourseMaterialInlineCheckArray({
          plans,
          unitTitle: `${unitTitle} · ${sectionTitle}`,
          language,
          context: JSON.stringify(assessmentContext),
          signal: generation.signal,
          operation: "unit.section_mini_test",
          onPartialChecks: params.onPartialMaterial
            ? async (partial) =>
                params.onPartialMaterial?.({
                  material: {
                    introduction: "",
                    blocks: [
                      {
                        type: "heading",
                        level: 2,
                        text: sectionQuestionTitle(teachingMaterial),
                      },
                      ...partial.checks,
                    ],
                    keyTakeaways: [],
                  },
                  completeBlockCount: partial.completeQuestionCount,
                  placeholderBlockCount: partial.placeholderQuestionCount,
                })
            : undefined,
          meta: { goalId, unitId: params.unitId, sectionId: params.sectionId },
        }),
    );
    const checks = await verifyAndRepairMiniTest({
      checks: authoredChecks,
      unitTitle: `${unitTitle} · ${sectionTitle}`,
      objective: assessmentGroup
        .map(
          (item) =>
            `${sectionRecordString(item, "title")}: ${sectionRecordString(item, "contentSummary")}`,
        )
        .join("\n"),
      learningTargets: learningTargetContextFromSqJson(
        JSON.stringify(scopedSq),
      ),
      evidenceContext: JSON.stringify({
        sources: dedupeContentSources(
          assessmentGroup.flatMap((item) => {
            const material = item.material as typeof source.material;
            return material ? parseMaterialContextSources(material) : [];
          }),
        ),
        teachingMaterial: assessmentContext,
      }),
      signal: generation.signal,
      onVerificationStart: params.onVerificationStart,
      onVerificationComplete: params.onVerificationComplete,
      onRepairApplied: params.onRepairApplied,
      generationRunId: params.generationRunId,
    });
    const completeMaterial: LearningMaterialContent = {
      ...teachingMaterial,
      blocks: [
        ...teachingMaterial.blocks,
        {
          type: "heading",
          level: 2,
          text: sectionQuestionTitle(teachingMaterial),
        },
        ...checks,
      ],
    };
    const allBlocks = source.sections.flatMap((item) => {
      if (sectionRecordString(item, "id") === params.sectionId) return completeMaterial.blocks;
      const material = item.material as typeof source.material;
      if (
        !material ||
        (sectionRecordString(item, "generationStatus") !== "ready" &&
          sectionRecordString(item, "testGenerationStatus") !== "ready")
      )
        return [];
      return parseLearningMaterial({
        introduction: material.introduction,
        sections:
          sectionRecordString(item, "id") === params.sectionId
            ? JSON.stringify(completeMaterial.blocks)
            : material.blocks,
        keyTakeaways: material.keyTakeaways,
      }).blocks;
    });
    const tasks = await buildMaterialCheckTaskDeclarations({
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      material: { blocks: allBlocks },
      targets:
        source.assessmentTargets as import("../assessment/activities.js").UnitAssessmentTarget[],
    });
    // The portable SQLite adapter uses one connection. Stop the periodic lease
    // heartbeat before beginning the publication transaction so the two writes
    // cannot wait on each other indefinitely.
    await generation.quiesceHeartbeat();
    if (
      !(await repository.ownsGeneration({
        sectionId: params.sectionId,
        kind: "mini_test",
        token,
      }))
    )
      throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
    const result = await repository.publishGeneratedMiniTest({
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      sectionId: params.sectionId,
      token,
      blocks: JSON.stringify(completeMaterial.blocks),
      materialCheckTasks: tasks,
    });
    return {
      ...section,
      testGenerationStatus: "ready",
      contentRevision: result.contentRevision,
    };
  } catch (error) {
    await repository.failGeneration({
      sectionId: params.sectionId,
      kind: "mini_test",
      token,
      error: persistableSectionGenerationError(error),
    });
    throw error;
  } finally {
    await generation.release();
  }
}

async function generateUnitSectionMiniTest(params: {
  /** Internal production entry only; never inferred from ordinary learner requests. */
  generationPurpose?: "course-production";
  userId: string;
  unitId: string;
  sectionId: string;
  onPartialMaterial?: (partial: {
    material: LearningMaterialContent;
    completeBlockCount: number;
    placeholderBlockCount?: number;
  }) => void | Promise<void>;
  signal?: AbortSignal;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
  client: PersistenceClient;
}) {
  if (configuredUnitSectionPlanPersistence) {
    return generatePortableUnitSectionMiniTest(params);
  }
  const section = await params.client.unitSection.findFirst({
    where: {
      id: params.sectionId,
      unitId: params.unitId,
      unit: { goal: { userId: params.userId } },
    },
    include: {
      material: true,
      targets: { select: { learningTargetId: true } },
      unit: { include: { goal: true, sessionState: true } },
    },
  });
  if (!section?.material)
    throw new Error("Complete the learning section first");
  if (!section.assessmentAfter) {
    throw new Error("This section does not have an assessment checkpoint");
  }
  if (section.testGenerationStatus === "ready") return section;

  const precedingSections = await params.client.unitSection.findMany({
    where: {
      unitId: params.unitId,
      orderIndex: { lte: section.orderIndex },
    },
    orderBy: { orderIndex: "asc" },
    include: {
      material: true,
      targets: { select: { learningTargetId: true } },
      progress: {
        where: { userId: params.userId },
        select: { contentCompletedAt: true, status: true },
      },
    },
  });
  const assessmentGroup = assessmentGroupForIndex(
    precedingSections,
    precedingSections.length - 1,
  );
  assertMiniTestGenerationReady(assessmentGroup, params.generationPurpose);

  const token = randomUUID();
  const claimed = await claimSectionGenerationLease({
    client: params.client,
    sectionId: section.id,
    kind: "mini_test",
    token,
    signal: params.signal,
  });
  if (!claimed) return section;
  const generation = registerSectionGeneration({
    client: params.client,
    unitId: params.unitId,
    sectionId: section.id,
    kind: "mini_test",
    token,
    signal: params.signal,
  });

  try {
    const ownsLease = await params.client.unitSection.findFirst({
      where: {
        id: section.id,
        testGenerationStatus: "building",
        testGenerationToken: token,
      },
      select: { id: true },
    });
    if (!ownsLease) throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
    const rawSq = section.unit.sessionState?.sq3rData
      ? sqPreviewSchema.parse(JSON.parse(section.unit.sessionState.sq3rData))
      : null;
    if (!rawSq) throw new Error("Unit preview is not ready");
    const assessmentTargets = (
      await loadUnitAssessmentTargets(
        params.client,
        params.unitId,
        params.userId,
      )
    ).filter((target) =>
      assessmentGroup.some((groupSection) =>
        groupSection.targets.some(
          (binding) => binding.learningTargetId === target.id,
        ),
      ),
    );
    const localRefs = new Set(
      assessmentTargets.map((target) => target.localRef),
    );
    const scopedSq = {
      ...rawSq,
      survey: {
        ...rawSq.survey,
        outline: assessmentGroup.map((item) => item.title),
        sectionOutline: undefined,
        sectionPlan: undefined,
        learningTargetLabels: rawSq.learningTargets
          .filter((target) => localRefs.has(target.id))
          .map((target) => target.label),
      },
      learningTargets: rawSq.learningTargets.filter((target) =>
        localRefs.has(target.id),
      ),
      questions: rawSq.questions.filter((question) =>
        question.learningTargetIds?.some((ref) => localRefs.has(ref)),
      ),
    };
    const plans = planCourseMaterialInlineChecks({
      sqJson: JSON.stringify(scopedSq),
      authorityBindings:
        inlineCheckAuthorityBindingsFromTargets(assessmentTargets),
      sectionOrderIndex: section.orderIndex,
    });
    if (plans.length === 0) {
      throw new Error("This section has no quiz-eligible learning targets");
    }
    const storedMaterial = parseLearningMaterial({
      introduction: section.material.introduction,
      sections: section.material.blocks,
      keyTakeaways: section.material.keyTakeaways,
    });
    const teachingMaterial = splitSectionMaterial(storedMaterial).content;
    const assessmentContext: LearningMaterialContent = {
      introduction: assessmentGroup
        .flatMap((item) => (item.material ? [item.material.introduction] : []))
        .filter(Boolean)
        .join("\n\n"),
      blocks: assessmentGroup.flatMap((item) => {
        if (!item.material) return [];
        const content = splitSectionMaterial(
          parseLearningMaterial({
            introduction: item.material.introduction,
            sections: item.material.blocks,
            keyTakeaways: item.material.keyTakeaways,
          }),
        ).content;
        return [
          {
            type: "heading" as const,
            level: 2 as const,
            text: item.title,
          },
          ...content.blocks,
        ];
      }),
      keyTakeaways: assessmentGroup.flatMap((item) => {
        if (!item.material) return [];
        return splitSectionMaterial(
          parseLearningMaterial({
            introduction: item.material.introduction,
            sections: item.material.blocks,
            keyTakeaways: item.material.keyTakeaways,
          }),
        ).content.keyTakeaways;
      }),
    };
    const language = detectContentLanguage(
      [assessmentContext.introduction, ...assessmentContext.keyTakeaways].join(
        "\n",
      ),
    );
    const authoredChecks = await runGenerationContextScope(
      {
        subject: {
          userId: params.userId,
          goalId: section.unit.goalId,
          unitId: params.unitId,
        },
        query: `${sectionAuthoringUnitTitle(section.unit.title, section.title)}: section mini-test`,
      },
      () =>
        compileCourseMaterialInlineCheckArray({
          plans,
          unitTitle: sectionAuthoringUnitTitle(section.unit.title, section.title),
          language,
          context: JSON.stringify(assessmentContext),
          signal: generation.signal,
          operation: "unit.section_mini_test",
          onPartialChecks: params.onPartialMaterial
            ? async (partial) => {
                await params.onPartialMaterial?.({
                  material: {
                    introduction: "",
                    blocks: [
                      {
                        type: "heading",
                        level: 2,
                        text: sectionQuestionTitle(teachingMaterial),
                      },
                      ...partial.checks,
                    ],
                    keyTakeaways: [],
                  },
                  completeBlockCount: partial.completeQuestionCount,
                  placeholderBlockCount: partial.placeholderQuestionCount,
                });
              }
            : undefined,
          meta: {
            goalId: section.unit.goalId,
            unitId: params.unitId,
            sectionId: section.id,
          },
        }),
    );
    const checks = await verifyAndRepairMiniTest({
      checks: authoredChecks,
      unitTitle: sectionAuthoringUnitTitle(section.unit.title, section.title),
      objective: assessmentGroup
        .map((item) => `${item.title}: ${item.contentSummary}`)
        .join("\n"),
      learningTargets: learningTargetContextFromSqJson(
        JSON.stringify(scopedSq),
      ),
      evidenceContext: JSON.stringify({
        sources: dedupeContentSources(
          assessmentGroup.flatMap((item) =>
            item.material ? parseMaterialContextSources(item.material) : [],
          ),
        ),
        teachingMaterial: assessmentContext,
      }),
      signal: generation.signal,
      onVerificationStart: params.onVerificationStart,
      onVerificationComplete: params.onVerificationComplete,
      onRepairApplied: params.onRepairApplied,
      generationRunId: params.generationRunId,
    });
    const completeMaterial: LearningMaterialContent = {
      ...teachingMaterial,
      blocks: [
        ...teachingMaterial.blocks,
        {
          type: "heading",
          level: 2,
          text: sectionQuestionTitle(teachingMaterial),
        },
        ...checks,
      ],
    };
    const result = await params.client.$transaction(async (tx) => {
      const stillOwned = await tx.unitSection.findFirst({
        where: { id: section.id, testGenerationToken: token },
        select: { id: true },
      });
      if (!stillOwned)
        throw new Error("Mini-test generation lease was superseded");
      await tx.unitSectionMaterial.update({
        where: { sectionId: section.id },
        data: { blocks: JSON.stringify(completeMaterial.blocks) },
      });
      const storedSections = await tx.unitSection.findMany({
        where: { unitId: params.unitId, generationStatus: "ready" },
        orderBy: { orderIndex: "asc" },
        include: { material: true },
      });
      await publishMaterialCheckTasks({
        persistence: tx as unknown as PersistenceClient,
        userId: params.userId,
        goalId: section.unit.goalId,
        unitId: params.unitId,
        material: {
          blocks: storedSections.flatMap((item) =>
            item.material
              ? parseLearningMaterial({
                  introduction: item.material.introduction,
                  sections:
                    item.id === section.id
                      ? JSON.stringify(completeMaterial.blocks)
                      : item.material.blocks,
                  keyTakeaways: item.material.keyTakeaways,
                }).blocks
              : [],
          ),
        },
      });
      await tx.learningUnit.update({
        where: { id: params.unitId },
        data: { contentRevision: { increment: 1 } },
      });
      const published = await tx.unitSection.updateMany({
        where: { id: section.id, testGenerationToken: token },
        data: {
          testGenerationStatus: "ready",
          testGenerationError: "",
          testGenerationStartedAt: null,
          testGenerationToken: null,
          contentRevision: { increment: 1 },
        },
      });
      if (published.count !== 1) {
        throw new Error("Mini-test generation lease was superseded");
      }
      return tx.unitSection.findUniqueOrThrow({ where: { id: section.id } });
    });
    return result;
  } catch (error) {
    await params.client.unitSection.updateMany({
      where: { id: section.id, testGenerationToken: token },
      data: {
        testGenerationStatus: "failed",
        testGenerationError:
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : String(error),
        testGenerationStartedAt: null,
        testGenerationToken: null,
      },
    });
    throw error;
  } finally {
    await generation.release();
  }
}

async function generatePortableUnitSectionMaterial(
  params: Parameters<typeof generateUnitSectionMaterial>[0],
) {
  const repository = configuredUnitSectionPlanPersistence!;
  await ensureUnitSectionPlan(params.unitId);
  const resolved = persistedSectionId(params.sectionId);
  if (resolved.kind === "mini_test")
    return generatePortableUnitSectionMiniTest({
      ...params,
      sectionId: resolved.id,
    });
  const source = await repository.findGenerationSource({
    userId: params.userId,
    unitId: params.unitId,
    sectionId: resolved.id,
  });
  if (!source) throw new Error("Section not found");
  const section = source.section;
  const topicRewrite =
    Boolean(params.rewriteTopicId?.trim()) ||
    typeof params.rewriteTopicIndex === "number";
  const stealReadyLease = Boolean(params.force) || topicRewrite;
  if (
    (source.material ||
      source.derivationJson ||
      source.teachingDerivationJson) &&
    sectionRecordString(section, "generationStatus") === "ready" &&
    !stealReadyLease
  )
    return section;
  const token = randomUUID();
  const progressKey = sectionGenerationKey(
    params.unitId,
    resolved.id,
    "content",
  );
  const stopFollowing = params.onPartialMaterial
    ? sectionGenerationProgress.subscribe(progressKey, params.onPartialMaterial)
    : () => undefined;
  let claimed: boolean;
  try {
    claimed = await claimSectionGenerationLease({
      repository,
      sectionId: resolved.id,
      kind: "content",
      token,
      signal: params.signal,
      force: stealReadyLease,
    });
  } finally {
    stopFollowing();
  }
  if (!claimed) return section;
  const generation = registerSectionGeneration({
    repository,
    unitId: params.unitId,
    sectionId: resolved.id,
    kind: "content",
    token,
    signal: params.signal,
  });
  try {
    if (
      !(await repository.ownsGeneration({
        sectionId: resolved.id,
        kind: "content",
        token,
      }))
    )
      throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
    if (
      persistedSectionContentKind(
        sectionRecordString(section, "contentKind"),
      ) === "formal_derivation"
    ) {
      const prior = [...source.sections]
        .filter(
          (item) =>
            sectionRecordNumber(item, "orderIndex") <
              sectionRecordNumber(section, "orderIndex") &&
            sectionRecordString(item, "generationStatus") === "ready" &&
            item.material,
        )
        .sort(
          (a, b) =>
            sectionRecordNumber(b, "orderIndex") -
            sectionRecordNumber(a, "orderIndex"),
        )[0];
      const priorMaterial = prior?.material as typeof source.material;
      const previousSectionContext =
        prior && priorMaterial
          ? buildPreviousSectionContext({
              title: sectionRecordString(prior, "title"),
              contentSummary: sectionRecordString(prior, "contentSummary"),
              material: parseLearningMaterial({
                introduction: priorMaterial.introduction,
                sections: priorMaterial.blocks,
                keyTakeaways: priorMaterial.keyTakeaways,
              }),
            })
          : undefined;
      const locale =
        detectContentLanguage(
          [
            sectionRecordString(source.goal, "contentLanguage"),
            sectionRecordString(section, "title"),
            sectionRecordString(section, "contentSummary"),
          ]
            .filter(Boolean)
            .join("\n"),
        ) || "zh-Hans";
      if (
        !(await repository.ownsGeneration({
          sectionId: resolved.id,
          kind: "content",
          token,
        }))
      )
        throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
      const format = resolveDerivationFormat({
        regenerate: Boolean(params.force),
        locked: sectionRecordString(section, "derivationFormat") || null,
        hasClassicContent: Boolean(String(source.derivationJson ?? "").trim()),
        hasTeachingContent: Boolean(
          String(source.teachingDerivationJson ?? "").trim(),
        ),
      });
      if (params.derivationFormat === "teaching_v1" && format !== "teaching_v1") {
        throw new Error(
          "This section already uses a different derivation format.",
        );
      }
      const lock = await repository.lockDerivationFormat({
        sectionId: resolved.id,
        format,
        regenerationToken: params.force ? token : undefined,
      });
      if (lock === "conflict") {
        throw new Error(
          "This section already uses a different derivation format.",
        );
      }
      if (format === "teaching_v1") {
        await params.onTeachingDerivationStart?.();
        const { generateUnitTeachingDerivationSection } = await import(
          "./teaching-derivation-generation.js"
        );
        const {collectTeachingVisualCatalog} = await import("./teaching-derivation-visuals.js");
        const visualSources = source.sections.filter(item =>
          sectionRecordNumber(item, "orderIndex") < sectionRecordNumber(section, "orderIndex")
          && sectionRecordString(item, "generationStatus") === "ready" && item.material)
          .sort((a, b) => sectionRecordNumber(a, "orderIndex") - sectionRecordNumber(b, "orderIndex"));
        const catalog = collectTeachingVisualCatalog(visualSources.map(item => ({
          title: sectionRecordString(item, "title"),
          blocks: (item.material as typeof source.material).blocks,
        })));
        const result = await generateUnitTeachingDerivationSection({
          userId: params.userId,
          goalId: sectionRecordString(source.unit, "goalId"),
          unitId: params.unitId,
          sectionId: resolved.id,
          token,
          force: Boolean(params.force),
          locale,
          unitTitle: sectionRecordString(source.unit, "title"),
          sectionTitle: sectionRecordString(section, "title"),
          contentSummary: sectionRecordString(section, "contentSummary"),
          previousSectionContext,
          ...catalog,
          generationRunId: params.generationRunId,
          signal: generation.signal,
          repository,
          onPartialTeachingDerivation: params.onPartialTeachingDerivation,
          onBeforePublish: generation.quiesceHeartbeat,
        });
        await refreshUnitCourseKeyPointsSafe({
          userId: params.userId,
          goalId: sectionRecordString(source.unit, "goalId"),
          unitId: params.unitId,
          unitTitle: sectionRecordString(source.unit, "title"),
          repository,
        });
        return {
          ...section,
          generationStatus: "ready",
          contentRevision: result.contentRevision,
        };
      }
      await params.onDerivationStart?.();
      const { generateUnitFormalDerivationSection } = await import(
        "./formal-derivation-generation.js"
      );
      const result = await generateUnitFormalDerivationSection({
        userId: params.userId,
        goalId: sectionRecordString(source.unit, "goalId"),
        unitId: params.unitId,
        sectionId: resolved.id,
        token,
        force: Boolean(params.force),
        locale,
        unitTitle: sectionRecordString(source.unit, "title"),
        sectionTitle: sectionRecordString(section, "title"),
        contentSummary: sectionRecordString(section, "contentSummary"),
        previousSectionContext,
        generationRunId: params.generationRunId,
        signal: generation.signal,
        repository,
        onPartialDerivation: params.onPartialDerivation,
        onBeforePublish: generation.quiesceHeartbeat,
      });
      await refreshUnitCourseKeyPointsSafe({
        userId: params.userId,
        goalId: sectionRecordString(source.unit, "goalId"),
        unitId: params.unitId,
        unitTitle: sectionRecordString(source.unit, "title"),
        repository,
      });
      return {
        ...section,
        generationStatus: "ready",
        contentRevision: result.contentRevision,
      };
    }
    const orientationLesson = isOverviewUnitKindValue(
      source.unit.unitKind,
    )
      ? orientationLessonFromRecords({
          goal: source.goal,
          catalogSummary: sectionRecordString(section, "contentSummary"),
          liveCatalog: source.overviewCatalog as
            | Array<{ title: string; summary: string }>
            | undefined,
        })
      : undefined;
    // Overview units have no Survey; their session state may only carry the
    // "{}" row default, which must not be fed to the strict sqPreviewSchema.
    const rawSq =
      !orientationLesson && source.unit.sq3rData
        ? sqPreviewSchema.parse(JSON.parse(String(source.unit.sq3rData)))
        : null;
    if (!orientationLesson && !rawSq)
      throw new Error("Unit preview is not ready");
    const goalKind = sectionRecordString(source.goal, "goalKind");
    const localRefs = new Set(source.targetLocalRefs);
    const filteredSq = rawSq
      ? {
          ...rawSq,
          survey: {
            ...rawSq.survey,
            outline:
              goalKind === "micro"
                ? rawSq.survey.outline
                : [sectionRecordString(section, "title")],
            sectionOutline: undefined,
            sectionPlan: undefined,
            learningTargetLabels:
              goalKind === "micro"
                ? rawSq.survey.learningTargetLabels
                : rawSq.learningTargets
                    .filter((target) => localRefs.has(target.id))
                    .map((target) => target.label),
          },
          learningTargets:
            goalKind === "micro"
              ? rawSq.learningTargets
              : rawSq.learningTargets.filter((target) =>
                  localRefs.has(target.id),
                ),
          questions:
            goalKind === "micro"
              ? rawSq.questions
              : rawSq.questions.filter((question) =>
                  question.learningTargetIds?.some((ref) => localRefs.has(ref)),
                ),
          componentSelection: rawSq.componentSelection
            ? {
                ...rawSq.componentSelection,
                plannedComponents: asComponentPlan(section.componentPlan).map(
                  (component) => ({
                    id: component.id,
                    componentType: component.componentType as never,
                    description: component.description,
                  }),
                ),
              }
            : undefined,
        }
      : null;
    if (filteredSq && filteredSq.questions.length === 0)
      filteredSq.questions = rawSq!.questions.slice(0, 1);
    const prior = [...source.sections]
      .filter(
        (item) =>
          sectionRecordNumber(item, "orderIndex") <
            sectionRecordNumber(section, "orderIndex") &&
          sectionRecordString(item, "generationStatus") === "ready" &&
          item.material,
      )
      .sort(
        (a, b) =>
          sectionRecordNumber(b, "orderIndex") -
          sectionRecordNumber(a, "orderIndex"),
      )[0];
    const priorMaterial = prior?.material as typeof source.material;
    const previousSectionContext =
      prior && priorMaterial
        ? buildPreviousSectionContext({
            title: sectionRecordString(prior, "title"),
            contentSummary: sectionRecordString(prior, "contentSummary"),
            material: parseLearningMaterial({
              introduction: priorMaterial.introduction,
              sections: priorMaterial.blocks,
              keyTakeaways: priorMaterial.keyTakeaways,
            }),
          })
        : undefined;
    const sectionBoundaryContext = buildSectionBoundaryContext({
      currentSectionId: resolved.id,
      sections: source.sections.map((item) => ({
        id: sectionRecordString(item, "id"),
        orderIndex: sectionRecordNumber(item, "orderIndex"),
        title: sectionRecordString(item, "title"),
        contentSummary: sectionRecordString(item, "contentSummary"),
      })),
    });
    const goalId = sectionRecordString(source.unit, "goalId");
    const sectionTitle = sectionRecordString(section, "title");
    const unitTitle = sectionRecordString(source.unit, "title");
    const narration = await createChatNarrationCoordinator({
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      sectionId: resolved.id,
      signal: generation.signal,
      client: params.client,
      onReady: params.onNarrationAudioReady,
    });
    const generated = await streamGenerateLearningMaterialText(
      source.goal as Parameters<typeof streamGenerateLearningMaterialText>[0],
      params.unitId,
      `${unitTitle} · ${sectionTitle}`,
      sectionRecordString(section, "contentSummary") || sectionTitle,
      filteredSq ? JSON.stringify(filteredSq) : "{}",
      params.onToken,
      generation.signal,
      {
        onPartialMaterial: async (partial) => {
          narration.observe(partial.material, partial.completeBlockCount);
          await params.onPartialMaterial?.(partial);
          await sectionGenerationProgress.publish(progressKey, token, partial);
        },
        previousSectionContext,
        sectionBoundaryContext,
        sectionId: resolved.id,
        onVerificationStart: params.onVerificationStart,
        onVerificationComplete: params.onVerificationComplete,
        onRepairApplied: params.onRepairApplied,
        generationRunId: params.generationRunId,
        orientationLesson,
        force: Boolean(params.force),
        rewriteTopicId: params.rewriteTopicId,
        rewriteTopicIndex: params.rewriteTopicIndex,
        publishedMaterial: topicRewrite && source.material ? publishedMaterialForRewrite(source.material) : undefined,
      },
    );
    narration.observe(generated.material, generated.material.blocks.length);
    const preserveMiniTest = !stealReadyLease &&
      sectionRecordString(section, "generationStatus") !== "ready" &&
      sectionRecordString(section, "testGenerationStatus") === "ready" && Boolean(source.material);
    if (preserveMiniTest) {
      const checks = splitSectionMaterial(parseLearningMaterial({
        introduction: source.material.introduction, sections: source.material.blocks,
        keyTakeaways: source.material.keyTakeaways,
      })).test;
      if (checks) generated.material = {...generated.material, blocks: [...generated.material.blocks, ...checks.blocks]};
    }
    const orderedMaterials = [
      ...source.sections
        .filter(
          (item) =>
            sectionRecordString(item, "id") !== resolved.id &&
            (sectionRecordString(item, "generationStatus") === "ready" ||
              sectionRecordString(item, "testGenerationStatus") === "ready") &&
            item.material,
        )
        .map((item) => {
          const material = item.material as NonNullable<typeof source.material>;
          return {
            orderIndex: sectionRecordNumber(item, "orderIndex"),
            material: parseLearningMaterial({
              introduction: material.introduction,
              sections: material.blocks,
              keyTakeaways: material.keyTakeaways,
            }),
          };
        }),
      {
        orderIndex: sectionRecordNumber(section, "orderIndex"),
        material: generated.material,
      },
    ].sort((a, b) => a.orderIndex - b.orderIndex);
    const assessmentTargets =
      source.assessmentTargets as import("../assessment/activities.js").UnitAssessmentTarget[];
    const tasks = await buildMaterialCheckTaskDeclarations({
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      material: {
        blocks: orderedMaterials.flatMap((item) => item.material.blocks),
      },
      targets: assessmentTargets,
    });
    // MikroORM's SQLite entity manager is single-connection. Let the last
    // lease heartbeat finish before opening the publication transaction;
    // otherwise the two writes can wait on each other indefinitely after all
    // model calls have already succeeded.
    await generation.quiesceHeartbeat();
    if (
      !(await repository.ownsGeneration({
        sectionId: resolved.id,
        kind: "content",
        token,
      }))
    )
      throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
    const result = await repository.publishGeneratedContent({
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      sectionId: resolved.id,
      token,
      force: Boolean(params.force),
      preserveMiniTest,
      material: {
        introduction: generated.material.introduction,
        blocks: JSON.stringify(generated.material.blocks),
        keyTakeaways: JSON.stringify(generated.material.keyTakeaways),
        contextSources: serializeMaterialContextSources(
          generated.contextSources,
        ),
        sourceItemsJson: JSON.stringify(generated.materialSourceItems),
      },
      materialCheckTasks: tasks,
    });
    await refreshUnitLearningProgressReset(
      {
        reset: result.affectedEntityIds.length > 0,
        userId: params.userId,
        affectedEntityIds: result.affectedEntityIds,
      },
      undefined,
      params.learnerStateMemoryInvalidation,
    );
    if (params.generationPurpose !== "course-production") enrichUnitSectionImagesInBackground({
      repository,
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      unitTitle: `${unitTitle} · ${sectionTitle}`,
      sectionId: resolved.id,
      sectionContentRevision: result.contentRevision,
      contentLanguage: generated.contentLanguage,
      material: generated.material,
    });
    await refreshUnitCourseKeyPointsSafe({
      userId: params.userId,
      goalId,
      unitId: params.unitId,
      unitTitle,
      repository,
    });
    await narration.finish();
    return {
      ...section,
      generationStatus: "ready",
      contentRevision: result.contentRevision,
    };
  } catch (error) {
    await repository.failGeneration({
      sectionId: resolved.id,
      kind: "content",
      token,
      error: persistableSectionGenerationError(error),
    });
    throw error;
  } finally {
    await generation.release();
  }
}

export async function generateUnitSectionMaterial(params: {
  /** Internal production entry only; never inferred from ordinary learner requests. */
  generationPurpose?: "course-production";
  userId: string;
  unitId: string;
  sectionId: string;
  onToken?: (token: string) => void | Promise<void>;
  onPartialMaterial?: (
    partial: SectionGenerationPartial,
  ) => void | Promise<void>;
  onNarrationAudioReady?: (asset: ChatNarrationAsset) => void | Promise<void>;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  onDerivationStart?: () => void | Promise<void>;
  onTeachingDerivationStart?: () => void | Promise<void>;
  onPartialDerivation?: (
    document: import("../../../formal-derivation/src/index.js").DerivationDocumentV1,
  ) => void | Promise<void>;
  onPartialTeachingDerivation?: (
    document: import("../../../teaching-derivation/src/index.js").TeachingDerivationDocumentV1,
    derived: import("../../../teaching-derivation/src/index.js").TeachingDerivationDerivedV1 | null,
  ) => void | Promise<void>;
  derivationFormat?: "classic" | "teaching_v1" | null;
  generationRunId?: string;
  signal?: AbortSignal;
  force?: boolean;
  rewriteTopicId?: string;
  rewriteTopicIndex?: number;
  client?: PersistenceClient;
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
}) {
  if (configuredUnitSectionPlanPersistence) {
    return generatePortableUnitSectionMaterial(params);
  }
  const client = params.client;
  if (!client)
    throw new Error("Section generation persistence is not configured");
  await ensureUnitSectionPlan(params.unitId, client);
  const resolved = persistedSectionId(params.sectionId);
  if (resolved.kind === "mini_test") {
    return generateUnitSectionMiniTest({
      ...params,
      sectionId: resolved.id,
      client,
    });
  }
  const section = await client.unitSection.findFirst({
    where: {
      id: resolved.id,
      unitId: params.unitId,
      unit: { goal: { userId: params.userId } },
    },
    include: {
      material: true,
      targets: {
        include: {
          learningTarget: {
            include: {
              units: { where: { unitId: params.unitId }, take: 1 },
            },
          },
        },
      },
      unit: {
        include: {
          goal: true,
          sessionState: true,
        },
      },
    },
  });
  if (!section) throw new Error("Section not found");
  const topicRewrite =
    Boolean(params.rewriteTopicId?.trim()) ||
    typeof params.rewriteTopicIndex === "number";
  const stealReadyLease = Boolean(params.force) || topicRewrite;
  if (
    section.material &&
    section.generationStatus === "ready" &&
    !stealReadyLease
  )
    return section;
  const checkpointSection = params.force
    ? await client.unitSection.findFirst({
        where: {
          unitId: params.unitId,
          orderIndex: { gte: section.orderIndex },
          assessmentAfter: true,
        },
        orderBy: { orderIndex: "asc" },
        select: { id: true },
      })
    : null;

  const token = randomUUID();
  const progressKey = sectionGenerationKey(
    params.unitId,
    section.id,
    "content",
  );
  const stopFollowing = params.onPartialMaterial
    ? sectionGenerationProgress.subscribe(progressKey, params.onPartialMaterial)
    : () => undefined;
  let claimed: boolean;
  try {
    claimed = await claimSectionGenerationLease({
      client,
      sectionId: section.id,
      kind: "content",
      token,
      signal: params.signal,
      force: stealReadyLease,
    });
  } finally {
    stopFollowing();
  }
  if (!claimed) return section;
  const generation = registerSectionGeneration({
    client,
    unitId: params.unitId,
    sectionId: section.id,
    kind: "content",
    token,
    signal: params.signal,
  });

  try {
    const ownsLease = await client.unitSection.findFirst({
      where: {
        id: section.id,
        generationStatus: "building",
        generationToken: token,
      },
      select: { id: true },
    });
    if (!ownsLease) throw new Error(SECTION_GENERATION_STOPPED_MESSAGE);
    const orientationLesson = isOverviewUnitKindValue(section.unit.unitKind)
      ? orientationLessonFromRecords({
          goal: section.unit.goal,
          catalogSummary: section.contentSummary,
        })
      : undefined;
    // Overview units have no Survey; their session state may only carry the
    // "{}" row default, which must not be fed to the strict sqPreviewSchema.
    const rawSq =
      !orientationLesson && section.unit.sessionState?.sq3rData
        ? sqPreviewSchema.parse(
            JSON.parse(section.unit.sessionState.sq3rData),
          )
        : null;
    if (!orientationLesson && !rawSq)
      throw new Error("Unit preview is not ready");
    const localRefs = new Set(
      section.targets.flatMap((binding) =>
        binding.learningTarget.units.map((mapping) => mapping.localRef),
      ),
    );
    const filteredSq = rawSq
      ? {
          ...rawSq,
          survey: {
            ...rawSq.survey,
            outline:
              section.unit.goal.goalKind === "micro"
                ? rawSq.survey.outline
                : [section.title],
            sectionOutline: undefined,
            sectionPlan: undefined,
            learningTargetLabels:
              section.unit.goal.goalKind === "micro"
                ? rawSq.survey.learningTargetLabels
                : rawSq.learningTargets
                    .filter((target) => localRefs.has(target.id))
                    .map((target) => target.label),
          },
          learningTargets:
            section.unit.goal.goalKind === "micro"
              ? rawSq.learningTargets
              : rawSq.learningTargets.filter((target) =>
                  localRefs.has(target.id),
                ),
          questions:
            section.unit.goal.goalKind === "micro"
              ? rawSq.questions
              : rawSq.questions.filter((question) =>
                  question.learningTargetIds?.some((ref) =>
                    localRefs.has(ref),
                  ),
                ),
          componentSelection: rawSq.componentSelection
            ? {
                ...rawSq.componentSelection,
                plannedComponents: asComponentPlan(section.componentPlan).map(
                  (component) => ({
                    id: component.id,
                    componentType: component.componentType as never,
                    description: component.description,
                  }),
                ),
              }
            : undefined,
        }
      : null;
    if (filteredSq && filteredSq.questions.length === 0)
      filteredSq.questions = rawSq!.questions.slice(0, 1);
    const previousSection = await client.unitSection.findFirst({
      where: {
        unitId: params.unitId,
        orderIndex: { lt: section.orderIndex },
        generationStatus: "ready",
        material: { isNot: null },
      },
      orderBy: { orderIndex: "desc" },
      select: {
        title: true,
        contentSummary: true,
        material: true,
      },
    });
    const previousSectionContext = previousSection?.material
      ? buildPreviousSectionContext({
          title: previousSection.title,
          contentSummary: previousSection.contentSummary,
          material: parseLearningMaterial({
            introduction: previousSection.material.introduction,
            sections: previousSection.material.blocks,
            keyTakeaways: previousSection.material.keyTakeaways,
          }),
        })
      : undefined;
    const sectionBoundaryContext = buildSectionBoundaryContext({
      currentSectionId: section.id,
      sections: await client.unitSection.findMany({
        where: { unitId: params.unitId },
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          title: true,
          contentSummary: true,
        },
      }),
    });
    const narration = await createChatNarrationCoordinator({
      userId: params.userId,
      goalId: section.unit.goalId,
      unitId: params.unitId,
      sectionId: section.id,
      signal: generation.signal,
      client,
      onReady: params.onNarrationAudioReady,
    });
    const generated = await streamGenerateLearningMaterialText(
      section.unit.goal,
      params.unitId,
      `${sectionAuthoringUnitTitle(section.unit.title, section.title)}`,
      section.contentSummary || section.title,
      filteredSq ? JSON.stringify(filteredSq) : "{}",
      params.onToken,
      generation.signal,
      {
        onPartialMaterial: async (partial) => {
          narration.observe(partial.material, partial.completeBlockCount);
          await params.onPartialMaterial?.(partial);
          await sectionGenerationProgress.publish(progressKey, token, partial);
        },
        previousSectionContext,
        sectionBoundaryContext,
        sectionId: section.id,
        onVerificationStart: params.onVerificationStart,
        onVerificationComplete: params.onVerificationComplete,
        onRepairApplied: params.onRepairApplied,
        generationRunId: params.generationRunId,
        orientationLesson,
        force: Boolean(params.force),
        rewriteTopicId: params.rewriteTopicId,
        rewriteTopicIndex: params.rewriteTopicIndex,
        publishedMaterial: topicRewrite && section.material ? publishedMaterialForRewrite(section.material) : undefined,
      },
    );
    narration.observe(generated.material, generated.material.blocks.length);
    const result = await client.$transaction(async (tx) => {
      const stillOwned = await tx.unitSection.findFirst({
        where: { id: section.id, generationToken: token },
        select: { contentRevision: true },
      });
      if (!stillOwned)
        throw new Error("Section generation lease was superseded");
      const affectedEntityIds = new Set<string>();
      if (params.force) {
        const currentCheckpoint = checkpointSection
          ? await tx.unitSection.findUnique({
              where: { id: checkpointSection.id },
              include: { material: true },
            })
          : null;
        const previousAssessmentMaterial = currentCheckpoint?.material
          ? parseLearningMaterial({
              introduction: currentCheckpoint.material.introduction,
              sections: currentCheckpoint.material.blocks,
              keyTakeaways: currentCheckpoint.material.keyTakeaways,
            })
          : null;
        const checkIds = publishedMaterialCheckDefinitions(
          previousAssessmentMaterial ?? {
            introduction: "",
            blocks: [],
            keyTakeaways: [],
          },
        ).map((definition) => definition.checkId);
        if (checkIds.length > 0) {
          const taskPrefixes = checkIds.map(
            (checkId) => `assessment:material-check:${checkId}`,
          );
          const tasks = await tx.learningTask.findMany({
            where: {
              unitId: params.unitId,
              origin: "material_check",
              OR: taskPrefixes.flatMap((stableKey) => [
                { stableKey },
                { stableKey: { startsWith: `${stableKey}:v` } },
              ]),
            },
            select: { id: true },
          });
          const claims = tasks.length
            ? await tx.evidenceClaim.findMany({
                where: {
                  userId: params.userId,
                  status: "active",
                  observation: {
                    attempt: { taskId: { in: tasks.map((task) => task.id) } },
                  },
                },
                select: { id: true, cognitiveEntityId: true },
              })
            : [];
          const retractedAt = new Date();
          for (const claim of claims) {
            await tx.evidenceLifecycleEvent.create({
              data: {
                evidenceClaimId: claim.id,
                eventType: "retracted",
                reason: "unit_section_regenerated",
                actorUserId: params.userId,
                payload: {
                  unitId: params.unitId,
                  sectionId: section.id,
                  checkpointSectionId: currentCheckpoint?.id,
                },
                createdAt: retractedAt,
              },
            });
            await tx.evidenceClaim.update({
              where: { id: claim.id },
              data: { status: "retracted", validUntil: retractedAt },
            });
            affectedEntityIds.add(claim.cognitiveEntityId);
          }
          for (const cognitiveEntityId of affectedEntityIds) {
            await replayLearnerEntityState(
              tx as unknown as PersistenceClient,
              params.userId,
              cognitiveEntityId,
              retractedAt,
            );
          }
        }
        if (currentCheckpoint) {
          await tx.unitSection.update({
            where: { id: currentCheckpoint.id },
            data: {
              testGenerationStatus: "pending",
              testGenerationError: "",
              testGenerationStartedAt: null,
              testGenerationToken: null,
            },
          });
          if (
            currentCheckpoint.id !== section.id &&
            previousAssessmentMaterial &&
            currentCheckpoint.material
          ) {
            const checkpointContent = splitSectionMaterial(
              previousAssessmentMaterial,
            ).content;
            await tx.unitSectionMaterial.update({
              where: { sectionId: currentCheckpoint.id },
              data: {
                introduction: checkpointContent.introduction,
                blocks: JSON.stringify(checkpointContent.blocks),
                keyTakeaways: JSON.stringify(checkpointContent.keyTakeaways),
              },
            });
            await tx.unitSectionProgress.updateMany({
              where: {
                sectionId: currentCheckpoint.id,
                userId: params.userId,
              },
              data: {
                status: "in_progress",
                completedAt: null,
                skippedAt: null,
                skipReason: null,
              },
            });
          }
        }
        await tx.unitSectionProgress.updateMany({
          where: { sectionId: section.id, userId: params.userId },
          data: {
            status: "available",
            contentCompletedAt: null,
            completedAt: null,
            skippedAt: null,
            skipReason: null,
          },
        });
      }
      await tx.unitSectionMaterial.upsert({
        where: { sectionId: section.id },
        create: {
          sectionId: section.id,
          introduction: generated.material.introduction,
          blocks: JSON.stringify(generated.material.blocks),
          keyTakeaways: JSON.stringify(generated.material.keyTakeaways),
          contextSources: serializeMaterialContextSources(
            generated.contextSources,
          ),
          sourceItems: JSON.parse(
            JSON.stringify(generated.materialSourceItems),
          ),
        },
        update: {
          introduction: generated.material.introduction,
          blocks: JSON.stringify(generated.material.blocks),
          keyTakeaways: JSON.stringify(generated.material.keyTakeaways),
          contextSources: serializeMaterialContextSources(
            generated.contextSources,
          ),
          sourceItems: JSON.parse(
            JSON.stringify(generated.materialSourceItems),
          ),
        },
      });
      const storedSections = await tx.unitSection.findMany({
        where: { unitId: params.unitId, generationStatus: "ready" },
        orderBy: { orderIndex: "asc" },
        include: { material: true },
      });
      const orderedMaterials = [
        ...storedSections
          .filter((item) => item.id !== section.id && item.material)
          .map((item) => ({
            orderIndex: item.orderIndex,
            material: parseLearningMaterial({
              introduction: item.material!.introduction,
              sections: item.material!.blocks,
              keyTakeaways: item.material!.keyTakeaways,
            }),
          })),
        { orderIndex: section.orderIndex, material: generated.material },
      ].sort((a, b) => a.orderIndex - b.orderIndex);
      await publishMaterialCheckTasks({
        persistence: tx as unknown as PersistenceClient,
        userId: params.userId,
        goalId: section.unit.goalId,
        unitId: params.unitId,
        material: {
          blocks: orderedMaterials.flatMap((item) => item.material.blocks),
        },
      });
      await tx.learningUnit.update({
        where: { id: params.unitId },
        data: { contentRevision: { increment: 1 } },
      });
      const published = await tx.unitSection.updateMany({
        where: { id: section.id, generationToken: token },
        data: {
          generationStatus: "ready",
          generationError: "",
          generationToken: null,
          generationStartedAt: null,
          testGenerationStatus: "pending",
          testGenerationError: "",
          testGenerationStartedAt: null,
          testGenerationToken: null,
          contentRevision: { increment: 1 },
        },
      });
      if (published.count !== 1) {
        throw new Error("Section generation lease was superseded");
      }
      const updated = await tx.unitSection.findUniqueOrThrow({
        where: { id: section.id },
      });
      return { updated, affectedEntityIds: [...affectedEntityIds] };
    });

    await refreshUnitLearningProgressReset(
      {
        reset: result.affectedEntityIds.length > 0,
        userId: params.userId,
        affectedEntityIds: result.affectedEntityIds,
      },
      client,
      params.learnerStateMemoryInvalidation,
    );
    if (params.generationPurpose !== "course-production") enrichUnitSectionImagesInBackground({
      client,
      userId: params.userId,
      goalId: section.unit.goalId,
      unitId: params.unitId,
      unitTitle: sectionAuthoringUnitTitle(section.unit.title, section.title),
      sectionId: section.id,
      sectionContentRevision: result.updated.contentRevision,
      contentLanguage: generated.contentLanguage,
      material: generated.material,
    });
    await narration.finish();

    if (configuredUnitSectionPlanPersistence) {
      await refreshUnitCourseKeyPointsSafe({
        userId: params.userId,
        goalId: section.unit.goalId,
        unitId: params.unitId,
        unitTitle: section.unit.title,
        repository: configuredUnitSectionPlanPersistence,
      });
    }

    return result.updated;
  } catch (error) {
    await client.unitSection.updateMany({
      where: { id: section.id, generationToken: token },
      data: {
        generationStatus: "failed",
        generationError:
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : String(error),
        generationToken: null,
        generationStartedAt: null,
      },
    });
    throw error;
  } finally {
    await generation.release();
  }
}

export async function cancelUnitSectionGeneration(params: {
  userId: string;
  unitId: string;
  sectionId: string;
  client?: PersistenceClient;
}): Promise<{ cancelled: boolean }> {
  const resolved = persistedSectionId(params.sectionId);
  if (configuredUnitSectionPlanPersistence) {
    const result = await configuredUnitSectionPlanPersistence.cancelGeneration({
      userId: params.userId,
      unitId: params.unitId,
      sectionId: resolved.id,
      kind: resolved.kind,
      stoppedMessage: SECTION_GENERATION_STOPPED_MESSAGE,
    });
    if (result.cancelled && result.token) {
      const key = sectionGenerationKey(
        params.unitId,
        resolved.id,
        resolved.kind,
      );
      const active = activeSectionGenerations.get(key);
      if (active?.token === result.token) active.controller.abort();
    }
    return { cancelled: result.cancelled };
  }
  const client = params.client;
  if (!client)
    throw new Error("Unit section plan persistence is not configured");
  const section = await client.unitSection.findFirst({
    where: {
      id: resolved.id,
      unitId: params.unitId,
      unit: { goal: { userId: params.userId } },
    },
    select: {
      id: true,
      generationToken: true,
      testGenerationToken: true,
    },
  });
  if (!section) throw new Error("Section not found");

  const token =
    resolved.kind === "content"
      ? section.generationToken
      : section.testGenerationToken;
  const updated =
    resolved.kind === "content"
      ? await client.unitSection.updateMany({
          where: {
            id: section.id,
            generationStatus: "building",
            ...(token ? { generationToken: token } : {}),
          },
          data: {
            generationStatus: "failed",
            generationError: SECTION_GENERATION_STOPPED_MESSAGE,
            generationStartedAt: null,
            generationToken: null,
          },
        })
      : await client.unitSection.updateMany({
          where: {
            id: section.id,
            testGenerationStatus: "building",
            ...(token ? { testGenerationToken: token } : {}),
          },
          data: {
            testGenerationStatus: "failed",
            testGenerationError: SECTION_GENERATION_STOPPED_MESSAGE,
            testGenerationStartedAt: null,
            testGenerationToken: null,
          },
        });

  if (updated.count === 1 && token) {
    const key = sectionGenerationKey(params.unitId, section.id, resolved.kind);
    const active = activeSectionGenerations.get(key);
    if (active?.token === token) active.controller.abort();
  }
  return { cancelled: updated.count === 1 };
}

export async function processUnitSectionPrefetchEvent(params: {
  payloadJson: string;
}) {
  let payload: { userId?: string; unitId?: string; sectionId?: string } = {};
  try {
    payload = JSON.parse(params.payloadJson) as typeof payload;
  } catch {
    return { status: "invalid" as const };
  }
  if (!payload.userId || !payload.unitId || !payload.sectionId) {
    return { status: "invalid" as const };
  }
  // Drain pre-deployment outbox rows without authoring content. The web and
  // mobile renderers request generation only when this section becomes active.
  return { status: "disabled" as const, sectionId: payload.sectionId };
}

export async function completeUnitSection(params: {
  userId: string;
  unitId: string;
  sectionId: string;
  skip?: boolean;
  expectedUnitRevision?: number;
  expectedSectionRevision?: number;
  client?: PersistenceClient;
  sectionProgress?: UnitSectionProgressRepository;
  materialCheckCompletion?: MaterialCheckCompletionRepository;
}) {
  if (configuredUnitSectionPlanPersistence && params.sectionProgress) {
    const manifest = await getUnitSectionManifest(params.userId, params.unitId);
    const target = manifest.find((item) => item.id === params.sectionId);
    if (!target || target.legacy) throw new Error("Section not found");
    if(params.expectedSectionRevision!==undefined&&target.contentRevision!==params.expectedSectionRevision)throw new Error("LEARNING_CONTENT_CHANGED: Section revision changed");
    if (params.skip && target.sectionKind === "mini_test") {
      throw new Error("Mini-tests cannot be skipped separately");
    }
    const incompletePrior = manifest.some(
      (item) =>
        item.requiredForCompletion &&
        item.orderIndex < target.orderIndex &&
        item.status !== "completed" &&
        item.status !== "skipped",
    );
    if (incompletePrior) throw new Error("Complete previous sections first");
    if (params.skip && !target.recommendSkip) {
      throw new Error("Section is not eligible to skip");
    }

    const sourceContent = manifest.find(
      (item) =>
        item.sourceSectionId === target.sourceSectionId &&
        item.sectionKind === "content",
    );
    const miniTest = manifest.find(
      (item) =>
        item.sourceSectionId === target.sourceSectionId &&
        item.sectionKind === "mini_test",
    );
    if (!params.skip && target.sectionKind === "mini_test") {
      if (
        !sourceContent ||
        (sourceContent.status !== "completed" &&
          sourceContent.status !== "skipped")
      ) {
        throw new Error("请先完成上一学习小节");
      }
      const stored = await getUnitSectionContent(
        params.userId,
        params.unitId,
        target.id,
        undefined,
      );
      if (!stored.material) throw new Error("Section content is not ready");
      const requiredChecks = publishedMaterialCheckDefinitions(
        stored.material,
      ).map((definition) => definition.checkId);
      if (requiredChecks.length > 0) {
        if (!params.materialCheckCompletion) {
          throw new Error("Material-check persistence is not configured");
        }
        const results = await listMaterialCheckResults({
          materialCheckCompletion: params.materialCheckCompletion,
          userId: params.userId,
          unitId: params.unitId,
          checkIds: requiredChecks,
        });
        const answered = new Set(results.map((result) => result.checkId));
        if (requiredChecks.some((checkId) => !answered.has(checkId))) {
          throw new Error("请先完成本节测验");
        }
      }
    }

    if (!params.skip && target.sectionKind === "content") {
      if (target.status === "completed") return target;
      const stored = await getUnitSectionContent(
        params.userId,
        params.unitId,
        target.id,
        undefined,
      );
      if (!sectionHasReadyTeachingContent(stored) &&
          !await readyReadingMaterial(params.userId, params.unitId, target.id)) {
        throw new Error("Section content is not ready");
      }
    }

    const now = new Date();
    const awaitsMiniTest =
      !params.skip && target.sectionKind === "content" && Boolean(miniTest);
    const progress = await params.sectionProgress.completeOwned({
      userId: params.userId,
      unitId: params.unitId,
      sectionId: target.sourceSectionId,
      expectedUnitRevision:params.expectedUnitRevision,
      expectedSectionRevision:params.expectedSectionRevision,
      status: awaitsMiniTest
        ? "in_progress"
        : params.skip
          ? "skipped"
          : "completed",
      startedAt: now,
      contentCompletedAt: now,
      completedAt: awaitsMiniTest || params.skip ? null : now,
      skippedAt: params.skip ? now : null,
      skipReason: params.skip ? "sufficient_fresh_kacom_evidence" : null,
    });
    if (!awaitsMiniTest) await invalidateAgendaForUser(params.userId);
    return progress;
  }

  const client = params.client;
  if (!client)
    throw new Error("Section completion persistence is not configured");
  const resolved = persistedSectionId(params.sectionId);
  const section = await client.unitSection.findFirst({
    where: {
      id: resolved.id,
      unitId: params.unitId,
      unit: { goal: { userId: params.userId } },
    },
    select: { id: true, orderIndex: true, assessmentAfter: true },
  });
  if (!section) throw new Error("Section not found");
  if (params.skip && resolved.kind === "mini_test") {
    throw new Error("Mini-tests cannot be skipped separately");
  }
  const prior = await client.unitSection.findMany({
    where: {
      unitId: params.unitId,
      orderIndex: { lt: section.orderIndex },
    },
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      orderIndex: true,
      assessmentAfter: true,
      requiredForCompletion: true,
    },
  });
  const requiredPrior = prior.filter((item) => item.requiredForCompletion);
  if (requiredPrior.length > 0) {
    const completed = await client.unitSectionProgress.count({
      where: {
        userId: params.userId,
        sectionId: { in: requiredPrior.map((item) => item.id) },
        status: { in: ["completed", "skipped"] },
      },
    });
    if (completed !== requiredPrior.length)
      throw new Error("Complete previous sections first");
  }
  if (
    params.skip &&
    !(await recommendedSkipSections(
      params.userId,
      section.assessmentAfter
        ? assessmentGroupForIndex([...prior, section], prior.length).map(
            (item) => item.id,
          )
        : [section.id],
      client,
    ))
  ) {
    throw new Error("Section is not eligible to skip");
  }
  if (!params.skip && resolved.kind === "mini_test") {
    const currentProgress = await client.unitSectionProgress.findUnique({
      where: {
        userId_sectionId: {
          userId: params.userId,
          sectionId: section.id,
        },
      },
      select: { contentCompletedAt: true, status: true },
    });
    if (
      !currentProgress?.contentCompletedAt &&
      currentProgress?.status !== "completed"
    ) {
      throw new Error("请先完成上一学习小节");
    }
    const stored = await client.unitSectionMaterial.findUnique({
      where: { sectionId: section.id },
    });
    if (!stored) throw new Error("Section content is not ready");
    const material = parseLearningMaterial({
      introduction: stored.introduction,
      sections: stored.blocks,
      keyTakeaways: stored.keyTakeaways,
    });
    // Match the learner-facing mini-test surface (split test blocks only).
    const testMaterial = splitSectionMaterial(material).test ?? {
      introduction: "",
      blocks: [],
      keyTakeaways: [],
    };
    const requiredChecks = publishedMaterialCheckDefinitions(testMaterial).map(
      (definition) => definition.checkId,
    );
    if (requiredChecks.length > 0) {
      const results = await listMaterialCheckResults({
        persistence: client,
        userId: params.userId,
        unitId: params.unitId,
        checkIds: requiredChecks,
      });
      const answered = new Set(results.map((result) => result.checkId));
      if (requiredChecks.some((checkId) => !answered.has(checkId))) {
        throw new Error("请先完成本节测验");
      }
    }
  }
  const now = new Date();
  if (!params.skip && resolved.kind === "content") {
    const existing = await client.unitSectionProgress.findUnique({
      where: {
        userId_sectionId: { userId: params.userId, sectionId: section.id },
      },
    });
    if (existing?.status === "completed") return existing;
    const stored = await client.unitSectionMaterial.findUnique({
      where: { sectionId: section.id },
      select: { id: true },
    });
    const derivation = stored
      ? null
      : await client.unitSectionDerivation?.findUnique?.({
          where: { sectionId: section.id },
          select: { id: true },
        });
    if (!stored && !derivation) throw new Error("Section content is not ready");
    const contentProgress = params.sectionProgress
      ? await params.sectionProgress.completeOwned({
          userId: params.userId,
          unitId: params.unitId,
          sectionId: section.id,
          status: section.assessmentAfter ? "in_progress" : "completed",
          startedAt: now,
          contentCompletedAt: now,
          completedAt: section.assessmentAfter ? null : now,
          skippedAt: null,
          skipReason: null,
        })
      : await client.unitSectionProgress.upsert({
          where: {
            userId_sectionId: { userId: params.userId, sectionId: section.id },
          },
          create: {
            userId: params.userId,
            sectionId: section.id,
            status: section.assessmentAfter ? "in_progress" : "completed",
            startedAt: now,
            contentCompletedAt: now,
            completedAt: section.assessmentAfter ? null : now,
          },
          update: {
            status: section.assessmentAfter ? "in_progress" : "completed",
            startedAt: now,
            contentCompletedAt: now,
            completedAt: section.assessmentAfter ? null : now,
            skippedAt: null,
            skipReason: null,
          },
        });
    if (!section.assessmentAfter) {
      await invalidateAgendaForUser(params.userId, client);
    }
    return contentProgress;
  }
  const progress = params.sectionProgress
    ? await params.sectionProgress.completeOwned({
        userId: params.userId,
        unitId: params.unitId,
        sectionId: section.id,
        status: params.skip ? "skipped" : "completed",
        startedAt: now,
        contentCompletedAt: now,
        completedAt: params.skip ? null : now,
        skippedAt: params.skip ? now : null,
        skipReason: params.skip ? "sufficient_fresh_kacom_evidence" : null,
      })
    : await client.unitSectionProgress.upsert({
        where: {
          userId_sectionId: { userId: params.userId, sectionId: section.id },
        },
        create: {
          userId: params.userId,
          sectionId: section.id,
          status: params.skip ? "skipped" : "completed",
          startedAt: now,
          contentCompletedAt: now,
          completedAt: params.skip ? null : now,
          skippedAt: params.skip ? now : null,
          skipReason: params.skip ? "sufficient_fresh_kacom_evidence" : null,
        },
        update: {
          status: params.skip ? "skipped" : "completed",
          contentCompletedAt: now,
          completedAt: params.skip ? null : now,
          skippedAt: params.skip ? now : null,
          skipReason: params.skip ? "sufficient_fresh_kacom_evidence" : null,
        },
      });
  await invalidateAgendaForUser(params.userId, client);
  return progress;
}

export async function updateUnitTeachingPresentation(params: {
  userId: string; unitId: string; sectionId: string; expectedRevision: number;
  action: "enhance" | "restore"; onProgress?: (step: number, total: number) => void;
}) {
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1") throw new Error("Teaching presentation enhancement is desktop-only");
  if (!configuredUnitSectionPlanPersistence) throw new Error("Section persistence unavailable");
  const { enhanceTeachingPresentation } = await import("./teaching-presentation.js");
  return enhanceTeachingPresentation({ ...params, repository: configuredUnitSectionPlanPersistence });
}

export async function getPendingTeachingPresentation(params: { userId: string; unitId: string; sectionId: string }) {
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1" || !configuredUnitSectionPlanPersistence) throw new Error("Teaching presentation is desktop-only");
  const { pendingTeachingPresentation } = await import("./teaching-presentation.js");
  return pendingTeachingPresentation({ ...params, repository: configuredUnitSectionPlanPersistence });
}
export async function acceptPendingTeachingPresentation(params: { userId: string; unitId: string; sectionId: string; revision: number; hash: string }) {
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1" || !configuredUnitSectionPlanPersistence) throw new Error("Teaching presentation is desktop-only");
  const { acceptConservativeTeachingPresentation } = await import("./teaching-presentation.js");
  return acceptConservativeTeachingPresentation({ ...params, repository: configuredUnitSectionPlanPersistence });
}

/** Desktop maintenance uses the same ownership/revision checked publication boundary. */
export async function repairUnitTeachingLineage(params: {
  userId: string; unitId: string; sectionId: string;
  patch: import("../../../teaching-derivation/src/index.js").TeachingLineageRepair;
}) {
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1" || !configuredUnitSectionPlanPersistence) throw new Error("Teaching lineage repair is desktop-only");
  const { repairTeachingLineage, parseTeachingDerivationDocument } = await import("../../../teaching-derivation/src/index.js");
  const source = await configuredUnitSectionPlanPersistence.findSectionContent(params);
  if (!source?.sectionFound || !source.teachingDerivationJson || source.contentRevision !== params.patch.expectedRevision) throw new Error("Lineage content revision changed");
  const original = parseTeachingDerivationDocument(JSON.parse(source.teachingDerivationJson));
  if (!original || original.status !== 'complete') throw new Error("Complete teaching document required");
  const result = repairTeachingLineage(original, params.patch);
  const saved = await configuredUnitSectionPlanPersistence.updateTeachingPresentation({ ...params,
    expectedContentRevision: source.contentRevision, expectedDocumentJson: source.teachingDerivationJson,
    documentJson: JSON.stringify(result.document), derivedJson: JSON.stringify(result.derived),
  });
  if (!saved) throw new Error("Lineage content revision changed; original preserved");
  return { ...result, contentRevision: source.contentRevision + 1 };
}
