import { GOAL_DIRECTED_TEACHING_POLICY } from "../goal-creation/teaching-policy.js";
import { z } from "zod";
import { requireGenerationRunPersistence } from "../generation/run-persistence.js";

import {
  interactiveBlockSchema,
  curriculumModulePlanSchema,
  goalMapPlanSchema,
  sqPreviewSchema,
  strictLearningMaterialSchema,
  type InteractiveBlock,
  type LearningMaterialContent,
  type GoalMapPlan,
  type QuizQuestion,
  type SqPreview,
  quizQuestionSchema,
} from "../llm/schemas.js";
import {
  runSinglePositionalRepair,
  type PositionalRepairSlot,
} from "../llm/structured-recovery.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { withExplicitLlmSelection } from "../providers/llm/index.js";
import {
  getContentVerificationSettings,
  type ContentVerificationMode,
} from "./settings.js";
import {
  assertNarratedMaterialBlocks,
  isNarratedMaterialSequence,
  narratedTokensFromBlocks,
} from "../llm/narrated-material-sequence.js";

export const contentVerificationIssueCodes = [
  "factual_error",
  "unsupported_claim",
  "internal_contradiction",
  "wrong_answer",
  "misaligned_scope",
  "unsafe_content",
  "coverage_gap",
  "duplicate_scope",
  "dependency_error",
  "untaught_prerequisite",
  "target_level_downgrade",
  "insufficient_practice",
] as const;

export const contentVerificationIssueSchema = z.object({
  index: z.number().int().min(0),
  issueCode: z.enum(contentVerificationIssueCodes),
  reason: z.string().trim().min(1).max(800),
  evidence: z.string().trim().min(1).max(1_200),
  sourceRef: z.string().trim().min(1).max(500).optional(),
});

export type ContentVerificationIssue = z.infer<
  typeof contentVerificationIssueSchema
>;
export type ContentVerificationArtifactKind =
  "survey" | "material" | "mini_test" | "assessment" | "goal_plan";
export type ContentVerificationResult =
  "passed" | "repaired" | "shadow_issues" | "skipped_error";

type IndexedBlock = {
  index: number;
  kind: string;
  content: unknown;
};

type EditableIndexedBlock<TArtifact> = IndexedBlock & {
  learnerContent: unknown;
  repairSlot(issue: ContentVerificationIssue): PositionalRepairSlot<unknown>;
  apply(artifact: TArtifact, replacement: unknown): TArtifact;
};

export type ContentVerificationPatch = {
  index: number;
  kind: string;
  content: unknown;
};

export class ContentVerificationError extends Error {
  constructor(
    readonly artifactKind: ContentVerificationArtifactKind,
    readonly issues: ContentVerificationIssue[],
  ) {
    super(
      `${artifactKind} verification failed for block indexes: ${issues
        .map((issue) => issue.index)
        .join(", ")}`,
    );
    this.name = "ContentVerificationError";
  }
}

const MAX_BATCH_BLOCKS = 12;
const MAX_BATCH_CHARS = 12_000;
const MAX_EVIDENCE_CHARS = 6_000;
const MAX_OUTLINE_CHARS = 8_000;
const MAX_ARTIFACT_EXCERPT_CHARS = 120;

function clip(value: string, max: number): string {
  const normalized = value.trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max)}\n...[truncated]`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).slice(0, 8_000);
}

function mergeIssueText(values: readonly string[], max: number): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .join(" Also: ")
    .slice(0, max);
}

function normalizeBatchIssues(
  issues: ContentVerificationIssue[],
  allowed: ReadonlySet<number>,
) {
  const byIndex = new Map<number, ContentVerificationIssue>();
  let droppedCount = 0;
  for (const issue of issues) {
    if (!allowed.has(issue.index)) {
      droppedCount += 1;
      continue;
    }
    const current = byIndex.get(issue.index);
    if (!current) {
      byIndex.set(issue.index, issue);
      continue;
    }
    droppedCount += 1;
    byIndex.set(issue.index, {
      ...current,
      reason: mergeIssueText([current.reason, issue.reason], 800),
      evidence: mergeIssueText([current.evidence, issue.evidence], 1_200),
      sourceRef:
        current.sourceRef || issue.sourceRef
          ? mergeIssueText(
              [current.sourceRef ?? "", issue.sourceRef ?? ""],
              500,
            )
          : undefined,
    });
  }
  return {
    items: [...byIndex.values()],
    normalizedCount: droppedCount,
    droppedCount,
  };
}

function normalizeVerificationIssue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const issue = value as Record<string, unknown>;
  return {
    ...issue,
    ...(typeof issue.reason === "string"
      ? { reason: issue.reason.trim().slice(0, 800) }
      : {}),
    ...(typeof issue.evidence === "string"
      ? { evidence: issue.evidence.trim().slice(0, 1_200) }
      : {}),
    ...(typeof issue.sourceRef === "string"
      ? { sourceRef: issue.sourceRef.trim().slice(0, 500) }
      : {}),
  };
}

/** Learner-visible target semantics only; excludes durable/server identities. */
export function learningTargetContextFromSqJson(sqJson: string): string {
  try {
    const parsed = sqPreviewSchema.parse(JSON.parse(sqJson));
    return JSON.stringify(
      parsed.learningTargets.map((target) => ({
        label: target.label,
        explanation: target.explanation,
        learningObjective: target.learningObjective,
        assessmentCriteria: target.assessmentCriteria,
        importance: target.importance,
        difficulty: target.difficulty,
        targetCognitiveLevel: target.targetCognitiveLevel,
      })),
    );
  } catch {
    return "";
  }
}

function compactArtifactOutline(
  blocks: readonly IndexedBlock[],
  excerptChars = 280,
): string {
  return JSON.stringify(
    blocks.map((block) => ({
      index: block.index,
      kind: block.kind,
      excerpt: safeJson(block.content).slice(0, excerptChars),
    })),
  );
}

function batches(blocks: readonly IndexedBlock[]): IndexedBlock[][] {
  const result: IndexedBlock[][] = [];
  let current: IndexedBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    const size = safeJson(block).length;
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_BLOCKS || chars + size > MAX_BATCH_CHARS)
    ) {
      result.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += size;
  }
  if (current.length > 0) result.push(current);
  return result;
}

const AUTHORITY_KEY =
  /(^id$|Id$|Ids$|Ref$|Refs$|^type$|^kind$|^questionType$|^checkId$|^criterionRef$|^evidenceDimension$|^contextDistance$)/;

function stripAuthorityFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAuthorityFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      AUTHORITY_KEY.test(key)
        ? []
        : [[key, stripAuthorityFields(child)] as const],
    ),
  );
}

function preserveAuthorityFields(
  original: unknown,
  replacement: unknown,
): unknown {
  if (Array.isArray(original) && Array.isArray(replacement)) {
    return replacement.map((value, index) =>
      index < original.length
        ? preserveAuthorityFields(original[index], value)
        : value,
    );
  }
  if (
    !original ||
    typeof original !== "object" ||
    Array.isArray(original) ||
    !replacement ||
    typeof replacement !== "object" ||
    Array.isArray(replacement)
  ) {
    return replacement;
  }
  const source = original as Record<string, unknown>;
  const candidate = replacement as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...candidate };
  for (const [key, value] of Object.entries(source)) {
    if (AUTHORITY_KEY.test(key)) {
      merged[key] = value;
    } else if (key in candidate) {
      merged[key] = preserveAuthorityFields(value, candidate[key]);
    }
  }
  return merged;
}

function materialBlockRepairSchema(original: InteractiveBlock) {
  return z.preprocess(
    (replacement) => preserveAuthorityFields(original, replacement),
    interactiveBlockSchema.superRefine((block, ctx) => {
      if (block.type !== original.type) {
        ctx.addIssue({
          code: "custom",
          path: ["type"],
          message: `replacement type must remain ${original.type}`,
        });
      }
    }),
  );
}

export function indexSurveyBlocks(
  survey: SqPreview,
): EditableIndexedBlock<SqPreview>[] {
  const result: EditableIndexedBlock<SqPreview>[] = [];
  const sectionOutline = survey.survey.sectionOutline;
  const sectionPlan = survey.survey.sectionPlan;
  const sectionCount =
    sectionOutline?.length ??
    sectionPlan?.length ??
    survey.survey.outline.length;
  for (let position = 0; position < sectionCount; position += 1) {
    const section = sectionOutline?.[position] ?? sectionPlan?.[position];
    const content = section
      ? { title: section.title, scope: section.scope }
      : {
          title: survey.survey.outline[position] ?? "",
          scope: survey.survey.outline[position] ?? "",
        };
    const schema = z.object({
      title: z.string().trim().min(1),
      scope: z.string().trim().min(1),
    });
    result.push({
      index: result.length,
      kind: "survey_section",
      content,
      learnerContent: content,
      repairSlot: (issue) => ({
        description: `Repair this Survey section. ${issue.issueCode}: ${issue.reason}`,
        context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
        currentValue: content,
        schema,
      }),
      apply: (artifact, replacement) => {
        const value = schema.parse(replacement);
        const outline = [...artifact.survey.outline];
        if (artifact.survey.sectionOutline) {
          outline[position] = value.title;
        }
        const outlines = artifact.survey.sectionOutline
          ? artifact.survey.sectionOutline.map((item, index) =>
              index === position
                ? { ...item, title: value.title, scope: value.scope }
                : item,
            )
          : undefined;
        const sections = artifact.survey.sectionPlan
          ? artifact.survey.sectionPlan.map((item, index) =>
              index === position
                ? { ...item, title: value.title, scope: value.scope }
                : item,
            )
          : undefined;
        return sqPreviewSchema.parse({
          ...artifact,
          survey: {
            ...artifact.survey,
            outline,
            ...(outlines ? { sectionOutline: outlines } : {}),
            ...(sections ? { sectionPlan: sections } : {}),
          },
        });
      },
    });
  }
  survey.questions.forEach((question, position) => {
    const schema = z.object({ text: z.string().trim().min(1) });
    result.push({
      index: result.length,
      kind: "survey_question",
      content: { text: question.text },
      learnerContent: { text: question.text },
      repairSlot: (issue) => ({
        description: `Repair this guiding question. ${issue.issueCode}: ${issue.reason}`,
        context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
        currentValue: { text: question.text },
        schema,
      }),
      apply: (artifact, replacement) => {
        const value = schema.parse(replacement);
        const questions = artifact.questions.map((item, index) =>
          index === position ? { ...item, text: value.text } : item,
        );
        return sqPreviewSchema.parse({ ...artifact, questions });
      },
    });
  });
  return result;
}

export function indexMaterialBlocks(
  material: LearningMaterialContent,
): EditableIndexedBlock<LearningMaterialContent>[] {
  const result: EditableIndexedBlock<LearningMaterialContent>[] = [];
  const stringSchema = z.string().trim().min(1);
  result.push({
    index: 0,
    kind: "material_introduction",
    content: material.introduction,
    learnerContent: material.introduction,
    repairSlot: (issue) => ({
      description: `Repair the lesson introduction. ${issue.issueCode}: ${issue.reason}`,
      context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
      currentValue: material.introduction,
      schema: stringSchema,
    }),
    apply: (artifact, replacement) =>
      strictLearningMaterialSchema.parse({
        ...artifact,
        introduction: stringSchema.parse(replacement),
      }),
  });
  material.blocks.forEach((block, position) => {
    const schema = materialBlockRepairSchema(block);
    result.push({
      index: result.length,
      kind: `material_${block.type}`,
      content: stripAuthorityFields(block),
      learnerContent: block,
      repairSlot: (issue) => ({
        description: `Repair this ${block.type} lesson block without changing its type. ${issue.issueCode}: ${issue.reason}`,
        context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
        currentValue: stripAuthorityFields(block),
        schema,
      }),
      apply: (artifact, replacement) => {
        const blocks = [...artifact.blocks];
        blocks[position] = schema.parse(replacement);
        return strictLearningMaterialSchema.parse({ ...artifact, blocks });
      },
    });
  });
  material.keyTakeaways.forEach((takeaway, position) => {
    result.push({
      index: result.length,
      kind: "material_takeaway",
      content: takeaway,
      learnerContent: takeaway,
      repairSlot: (issue) => ({
        description: `Repair this key takeaway. ${issue.issueCode}: ${issue.reason}`,
        context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
        currentValue: takeaway,
        schema: stringSchema,
      }),
      apply: (artifact, replacement) => {
        const keyTakeaways = artifact.keyTakeaways.map((item, index) =>
          index === position ? stringSchema.parse(replacement) : item,
        );
        return strictLearningMaterialSchema.parse({
          ...artifact,
          keyTakeaways,
        });
      },
    });
  });
  return result;
}

export function indexMiniTestBlocks(
  checks: readonly Extract<InteractiveBlock, { type: "check" }>[],
): EditableIndexedBlock<Extract<InteractiveBlock, { type: "check" }>[]>[] {
  return checks.map((check, position) => {
    const schema = materialBlockRepairSchema(check).transform(
      (value) => value as Extract<InteractiveBlock, { type: "check" }>,
    );
    return {
      index: position,
      kind: `mini_test_${check.questionType ?? "legacy"}`,
      content: stripAuthorityFields(check),
      learnerContent: check,
      repairSlot: (issue) => ({
        description: `Repair this mini-test question without changing its question type or assessment bindings. ${issue.issueCode}: ${issue.reason}`,
        context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
        currentValue: stripAuthorityFields(check),
        schema,
      }),
      apply: (artifact, replacement) => {
        const result = [...artifact];
        result[position] = schema.parse(replacement);
        return result;
      },
    };
  });
}

function assessmentQuestionRepairSchema(original: QuizQuestion) {
  return quizQuestionSchema
    .superRefine((question, ctx) => {
      if (question.type !== original.type) {
        ctx.addIssue({
          code: "custom",
          path: ["type"],
          message: `replacement type must remain ${original.type}`,
        });
      }
    })
    .transform((replacement) =>
      quizQuestionSchema.parse(preserveAuthorityFields(original, replacement)),
    );
}

export function indexAssessmentQuestions(
  questions: readonly QuizQuestion[],
): EditableIndexedBlock<QuizQuestion[]>[] {
  return questions.map((question, position) => {
    const schema = assessmentQuestionRepairSchema(question);
    return {
      index: position,
      kind: `assessment_${question.type}`,
      content: stripAuthorityFields(question),
      learnerContent: question,
      repairSlot: (issue) => ({
        description: `Repair this assessment question without changing its type or server-owned evidence bindings. ${issue.issueCode}: ${issue.reason}`,
        context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}`,
        currentValue: stripAuthorityFields(question),
        schema,
      }),
      apply: (artifact, replacement) => {
        const result = [...artifact];
        result[position] = schema.parse(replacement);
        return result;
      },
    };
  });
}

export function indexGoalPlanModules(
  plan: GoalMapPlan,
): EditableIndexedBlock<GoalMapPlan>[] {
  const planModules = plan.modules ?? [];
  return planModules.map((module, position) => ({
    index: position,
    kind: "goal_plan_module",
    content: module,
    learnerContent: module,
    repairSlot: (issue) => ({
      description: `Repair only module ${position + 1} of this ordered goal blueprint. Preserve the confirmed goal and neighboring module boundaries. ${issue.issueCode}: ${issue.reason}`,
      context: `${issue.evidence}${issue.sourceRef ? `\nSource: ${issue.sourceRef}` : ""}\nComplete ordered blueprint: ${JSON.stringify(planModules)}`,
      currentValue: module,
      schema: curriculumModulePlanSchema,
    }),
    apply: (artifact, replacement) => {
      const modules = (artifact.modules ?? []).map((item, index) =>
        index === position
          ? curriculumModulePlanSchema.parse(replacement)
          : item,
      );
      return goalMapPlanSchema.parse({ ...artifact, modules });
    },
  }));
}

async function verifyBlocks(params: {
  artifactKind: ContentVerificationArtifactKind;
  blocks: readonly IndexedBlock[];
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  signal?: AbortSignal;
  selection: Awaited<
    ReturnType<typeof getContentVerificationSettings>
  >["selection"];
}): Promise<ContentVerificationIssue[]> {
  const allIssues: ContentVerificationIssue[] = [];
  const artifactOutline = clip(
    compactArtifactOutline(params.blocks, MAX_ARTIFACT_EXCERPT_CHARS),
    MAX_OUTLINE_CHARS,
  );
  for (const batch of batches(params.blocks)) {
    params.signal?.throwIfAborted();
    const allowed = new Set(batch.map((block) => block.index));
    const resultSchema = z
      .array(contentVerificationIssueSchema)
      .max(batch.length)
      .superRefine((issues, ctx) => {
        const seen = new Set<number>();
        issues.forEach((issue, position) => {
          if (!allowed.has(issue.index)) {
            ctx.addIssue({
              code: "custom",
              path: [position, "index"],
              message: "index is not in this batch",
            });
          }
          if (seen.has(issue.index)) {
            ctx.addIssue({
              code: "custom",
              path: [position, "index"],
              message: "duplicate failing index",
            });
          }
          seen.add(issue.index);
        });
      });
    const verificationPolicy =
      params.artifactKind === "goal_plan"
        ? `Check every ordered module stub for alignment with the confirmed goal, evidence support, coherent dependency on earlier modules, complete goal-level coverage, duplicate scope, internal contradiction, and safety.
Use coverage_gap, duplicate_scope, or dependency_error when those planning defects apply. Treat future module details as intentionally absent: do not request lesson titles, cognitive entities, targets, assessments, or content.`
        : "Check every supplied learner-visible block for factual correctness, evidence support, internal consistency, answer correctness, lesson scope alignment, and safety.";
    const issues = await withExplicitLlmSelection(params.selection, () =>
      runValidatedStructuredGeneration<
        ContentVerificationIssue,
        never,
        ContentVerificationIssue[]
      >(
        {
          mode: "item-array",
          operation:
            params.artifactKind === "goal_plan"
              ? "goal.curriculum.plan.deep_synthesis"
              : `${params.artifactKind}.content_verify`,
          prompt: `${GOAL_DIRECTED_TEACHING_POLICY}\n${verificationPolicy}
Return an empty array when all blocks are correct. Return only failures from the supplied batch. Use only these indexes: ${[...allowed].join(", ")}. Return at most one item per failing index; combine multiple defects for the same block into one item. Do not criticize style or request optional improvements.
Externally checkable claims require support in the supplied evidence; agreement with prior model text is not evidence.
Judge each current block in the context of the complete artifact outline. Do not report incomplete exposition merely because it continues in another block. However, prerequisite order is strict: a definition, symbol, theorem or method taught only AFTER its first substantive use is untaught_prerequisite. A preview is allowed only when it is not needed for an explanation, solution or assessment. Report a lowered exit level as target_level_downgrade and missing goal-required worked applications as insufficient_practice. Blocks outside the current batch are context only and must never be returned as failures.

Unit: ${params.unitTitle}
Objective: ${clip(params.objective, 1_500)}
Learning targets: ${clip(params.learningTargets, 3_000)}
Complete artifact outline (context only): ${artifactOutline}
Batch outline: ${clip(compactArtifactOutline(batch), MAX_OUTLINE_CHARS)}
Evidence: ${clip(params.evidenceContext, MAX_EVIDENCE_CHARS) || "No supporting source evidence was supplied."}
Blocks with global server-owned indexes: ${JSON.stringify(batch)}`,
          itemSchema: contentVerificationIssueSchema,
          resultSchema,
          assemble: (items) => items,
          recoveryPolicy: {
            normalizeItem: normalizeVerificationIssue,
            normalize: (items) => normalizeBatchIssues(items, allowed),
          },
          repairContext: `Allowed indexes: ${[...allowed].join(", ")}. Return only failing indexes with issueCode, concise reason, evidence, and optional sourceRef.`,
          maxRepairAttempts: 1,
          meta: {
            platformFunded: true,
            verificationArtifact: params.artifactKind,
            verificationBlockCount: batch.length,
            redactLogs: false,
          },
        },
        { signal: params.signal },
      ),
    );
    allIssues.push(...issues);
  }
  return allIssues.sort((left, right) => left.index - right.index);
}

async function repairArtifact<TArtifact>(params: {
  artifact: TArtifact;
  blocks: readonly EditableIndexedBlock<TArtifact>[];
  issues: readonly ContentVerificationIssue[];
  artifactKind: ContentVerificationArtifactKind;
  signal?: AbortSignal;
}): Promise<TArtifact> {
  const byIndex = new Map(
    params.blocks.map((block) => [block.index, block] as const),
  );
  const selected = params.issues.map((issue) => {
    const block = byIndex.get(issue.index);
    if (!block)
      throw new ContentVerificationError(params.artifactKind, [
        ...params.issues,
      ]);
    return { block, issue };
  });
  const replacements = await runSinglePositionalRepair({
    operation: `${params.artifactKind}.content_repair`,
    slots: selected.map(({ block, issue }) => block.repairSlot(issue)),
    signal: params.signal,
    meta: {
      verificationRepair: true,
      verificationArtifact: params.artifactKind,
      repairedBlockCount: selected.length,
    },
  });
  let artifact = params.artifact;
  selected.forEach(({ block }, index) => {
    artifact = block.apply(artifact, replacements[index]);
  });
  return artifact;
}

async function verifyAndRepair<TArtifact>(params: {
  artifactKind: ContentVerificationArtifactKind;
  artifact: TArtifact;
  blocks: EditableIndexedBlock<TArtifact>[];
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  signal?: AbortSignal;
  modeOverride?: ContentVerificationMode;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
  allowVerifierFailureFallback?: boolean;
  reindex: (artifact: TArtifact) => EditableIndexedBlock<TArtifact>[];
}): Promise<TArtifact> {
  const settings = await getContentVerificationSettings();
  const mode = params.modeOverride ?? settings.mode;
  if (mode === "off" || params.blocks.length === 0) return params.artifact;
  await params.onVerificationStart?.();
  if (!settings.configured) {
    if (mode === "shadow") return params.artifact;
    if (params.allowVerifierFailureFallback) {
      console.error(
        `[content-verification] ${params.artifactKind} verifier ${settings.provider}/${settings.model} is not configured; preserving the authored artifact`,
      );
      await params.onVerificationComplete?.("skipped_error");
      return params.artifact;
    }
    throw new Error(
      `Content verifier ${settings.provider}/${settings.model} is not configured`,
    );
  }
  const recordAudit = async (
    status: string,
    issues: readonly ContentVerificationIssue[],
    repairedCount = 0,
  ) => {
    if (!params.generationRunId) return;
    try {
      await requireGenerationRunPersistence().appendContentVerificationAudit({
        runId: params.generationRunId,
        artifactKind: params.artifactKind,
        mode,
        status,
        provider: settings.provider,
        model: settings.model,
        blockCount: params.blocks.length,
        repairedCount,
        issuesJson: JSON.stringify(issues),
        createdAt: new Date(),
      });
    } catch (error) {
      console.error(
        "[content-verification] failed to persist private audit metadata",
        error,
      );
    }
  };
  const verify = (artifactBlocks: readonly IndexedBlock[]) =>
    verifyBlocks({
      ...params,
      blocks: artifactBlocks,
      selection: settings.selection,
    });
  let firstIssues: ContentVerificationIssue[];
  try {
    firstIssues = await verify(params.blocks);
  } catch (error) {
    params.signal?.throwIfAborted();
    if (!params.allowVerifierFailureFallback) throw error;
    console.error(
      `[content-verification] ${params.artifactKind} verifier failed; preserving the authored artifact`,
      error,
    );
    await recordAudit("skipped_error", []);
    await params.onVerificationComplete?.("skipped_error");
    return params.artifact;
  }
  if (firstIssues.length === 0) {
    await recordAudit("passed", []);
    await params.onVerificationComplete?.("passed");
    return params.artifact;
  }
  if (mode === "shadow") {
    await recordAudit("shadow_issues", firstIssues);
    await params.onVerificationComplete?.("shadow_issues");
    return params.artifact;
  }
  const hasTeachingOrderFailure = firstIssues.some((issue) =>
    [
      "untaught_prerequisite",
      "target_level_downgrade",
      "insufficient_practice",
      "dependency_error",
    ].includes(issue.issueCode),
  );
  let repaired: TArtifact;
  try {
    repaired = await repairArtifact({
      artifact: params.artifact,
      blocks: params.blocks,
      issues: firstIssues,
      artifactKind: params.artifactKind,
      signal: params.signal,
    });
  } catch (error) {
    params.signal?.throwIfAborted();
    if (!params.allowVerifierFailureFallback || hasTeachingOrderFailure)
      throw error;
    console.error(
      `[content-verification] ${params.artifactKind} repair failed; preserving the authored artifact`,
      error,
    );
    await recordAudit("skipped_error", firstIssues);
    await params.onVerificationComplete?.("skipped_error");
    return params.artifact;
  }
  const repairedBlocks = params.reindex(repaired);
  let secondIssues: ContentVerificationIssue[];
  try {
    secondIssues = await verify(repairedBlocks);
  } catch (error) {
    params.signal?.throwIfAborted();
    if (!params.allowVerifierFailureFallback || hasTeachingOrderFailure)
      throw error;
    console.error(
      `[content-verification] ${params.artifactKind} re-verification failed; preserving the repaired artifact`,
      error,
    );
    await recordAudit("skipped_error", firstIssues, firstIssues.length);
    await params.onVerificationComplete?.("skipped_error");
    return repaired;
  }
  if (secondIssues.length > 0) {
    if (
      secondIssues.some((issue) =>
        [
          "untaught_prerequisite",
          "target_level_downgrade",
          "insufficient_practice",
          "dependency_error",
        ].includes(issue.issueCode),
      )
    ) {
      throw new ContentVerificationError(params.artifactKind, secondIssues);
    }
    if (params.allowVerifierFailureFallback) {
      console.error(
        `[content-verification] ${params.artifactKind} still has verifier findings after repair; preserving the structurally valid repaired artifact`,
        secondIssues,
      );
      await recordAudit(
        "repaired_with_issues",
        secondIssues,
        firstIssues.length,
      );
      const repairedByIndex = new Map(
        repairedBlocks.map(
          (block) =>
            [
              block.index,
              { kind: block.kind, content: block.learnerContent },
            ] as const,
        ),
      );
      await params.onRepairApplied?.(
        firstIssues.map((issue) => ({
          index: issue.index,
          kind: repairedByIndex.get(issue.index)?.kind ?? "unknown",
          content: repairedByIndex.get(issue.index)?.content,
        })),
      );
      await params.onVerificationComplete?.("skipped_error");
      return repaired;
    }
    await recordAudit("rejected", secondIssues, firstIssues.length);
    throw new ContentVerificationError(params.artifactKind, secondIssues);
  }
  await recordAudit("repaired", firstIssues, firstIssues.length);
  const repairedByIndex = new Map(
    repairedBlocks.map(
      (block) =>
        [
          block.index,
          { kind: block.kind, content: block.learnerContent },
        ] as const,
    ),
  );
  await params.onRepairApplied?.(
    firstIssues.map((issue) => ({
      index: issue.index,
      kind: repairedByIndex.get(issue.index)?.kind ?? "unknown",
      content: repairedByIndex.get(issue.index)?.content,
    })),
  );
  await params.onVerificationComplete?.("repaired");
  return repaired;
}

export async function verifyAndRepairGoalPlan(params: {
  plan: GoalMapPlan;
  goalTitle: string;
  confirmedGoal: string;
  evidenceContext: string;
  signal?: AbortSignal;
  modeOverride?: ContentVerificationMode;
  generationRunId?: string;
}): Promise<GoalMapPlan> {
  const plan = goalMapPlanSchema.parse(params.plan);
  return verifyAndRepair({
    artifactKind: "goal_plan",
    artifact: plan,
    blocks: indexGoalPlanModules(plan),
    unitTitle: `Goal blueprint: ${params.goalTitle}`,
    objective: params.confirmedGoal,
    learningTargets: plan.whatYouWillLearn.join("\n"),
    evidenceContext: params.evidenceContext,
    signal: params.signal,
    modeOverride: params.modeOverride,
    generationRunId: params.generationRunId,
    allowVerifierFailureFallback: true,
    reindex: indexGoalPlanModules,
  });
}

export async function verifyAndRepairSurvey(params: {
  survey: SqPreview;
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  signal?: AbortSignal;
  modeOverride?: ContentVerificationMode;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
}): Promise<SqPreview> {
  const survey = sqPreviewSchema.parse(params.survey);
  const blocks = indexSurveyBlocks(survey);
  return verifyAndRepair({
    ...params,
    artifactKind: "survey",
    artifact: survey,
    blocks,
    reindex: indexSurveyBlocks,
  });
}

export async function verifyAndRepairLearningMaterial(params: {
  material: LearningMaterialContent;
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  signal?: AbortSignal;
  modeOverride?: ContentVerificationMode;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
}): Promise<LearningMaterialContent> {
  const material = strictLearningMaterialSchema.parse(params.material);
  const preserveNarratedSequence = isNarratedMaterialSequence(
    narratedTokensFromBlocks(material.blocks),
  );
  const blocks = indexMaterialBlocks(material);
  const verified = await verifyAndRepair({
    ...params,
    artifactKind: "material",
    artifact: material,
    blocks,
    allowVerifierFailureFallback: true,
    reindex: indexMaterialBlocks,
  });
  if (preserveNarratedSequence) {
    assertNarratedMaterialBlocks(verified.blocks);
  }
  return verified;
}

export async function verifyAndRepairMiniTest(params: {
  checks: Extract<InteractiveBlock, { type: "check" }>[];
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  signal?: AbortSignal;
  modeOverride?: ContentVerificationMode;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
}): Promise<Extract<InteractiveBlock, { type: "check" }>[]> {
  const checks = params.checks.map(
    (check) =>
      interactiveBlockSchema.parse(check) as Extract<
        InteractiveBlock,
        { type: "check" }
      >,
  );
  const blocks = indexMiniTestBlocks(checks);
  return verifyAndRepair({
    ...params,
    artifactKind: "mini_test",
    artifact: checks,
    blocks,
    reindex: indexMiniTestBlocks,
  });
}

export async function verifyAndRepairAssessmentQuestions(params: {
  questions: QuizQuestion[];
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  signal?: AbortSignal;
  modeOverride?: ContentVerificationMode;
  onVerificationStart?: () => void | Promise<void>;
  onVerificationComplete?: (
    result: ContentVerificationResult,
  ) => void | Promise<void>;
  onRepairApplied?: (
    patches: ContentVerificationPatch[],
  ) => void | Promise<void>;
  generationRunId?: string;
}): Promise<QuizQuestion[]> {
  const questions = params.questions.map((question) =>
    quizQuestionSchema.parse(question),
  );
  const blocks = indexAssessmentQuestions(questions);
  return verifyAndRepair({
    ...params,
    artifactKind: "assessment",
    artifact: questions,
    blocks,
    reindex: indexAssessmentQuestions,
  });
}
