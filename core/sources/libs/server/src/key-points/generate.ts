import { z } from "zod";
import type { UnitSectionPlanRepository } from "../../../domain/src/index.js";
import {
  StructuredGenerationError,
  runValidatedStructuredGeneration,
} from "../llm/validated-structured-generation.js";
import { getPlanContextForGoal } from "../graph/unit-session.js";
import {
  runUnitAuthoringHistoryBoundCall,
  unitAuthoringAgentEnabled,
} from "../unit-authoring/runner.js";
import { UNIT_KEY_POINTS_JSON_SHAPE } from "../llm/schema-shapes.js";
import {
  buildKeyPointsHistoryContinuationPrompt,
  buildKeyPointsStandalonePrompt,
  distributeKeyPoints,
  keyPointsFromCommitArgs,
  UNIT_KEY_POINTS_OPERATION,
  unitKeyPointsResultSchema,
} from "./authoring.js";
import {
  formatKeyPointCatalog,
  isStandardContentSection,
  unitNeedsCourseKeyPoints,
  type UnitKeyPointSectionSource,
} from "./catalog.js";

function keyPointsHistoryResultSchema(sectionCount: number) {
  return z.preprocess(
    keyPointsFromCommitArgs,
    unitKeyPointsResultSchema(sectionCount),
  );
}

export async function ensureUnitCourseKeyPoints(input: {
  userId: string;
  goalId: string;
  unitId: string;
  unitTitle: string;
  repository: UnitSectionPlanRepository;
}): Promise<boolean> {
  if (
    typeof input.repository.findKeyPointSources !== "function" ||
    typeof input.repository.saveUnitKeyTakeaways !== "function"
  ) {
    return false;
  }
  const sections = await input.repository.findKeyPointSources(input.unitId);
  const content = sections.filter(isStandardContentSection);
  if (!unitNeedsCourseKeyPoints(sections) || content.length === 0) {
    return false;
  }
  const catalog = formatKeyPointCatalog(content);
  const plan = await getPlanContextForGoal(input.goalId);
  const resultSchema = unitKeyPointsResultSchema(content.length);
  const styleBlock = plan.styleBlock();
  const languageBlock = plan.languageBlock();
  const userId = input.userId.trim() || plan.userId?.trim();
  let authored: { points: string[] } | null = null;
  if (userId && unitAuthoringAgentEnabled()) {
    try {
      authored = await runUnitAuthoringHistoryBoundCall({
        userId,
        goalId: input.goalId,
        unitId: input.unitId,
        operation: UNIT_KEY_POINTS_OPERATION,
        expectedTool: "commit_key_points",
        prompt: buildKeyPointsHistoryContinuationPrompt({
          unitTitle: input.unitTitle,
          sectionCount: content.length,
          languageBlock,
          styleBlock,
          catalog,
        }),
        resultSchema: keyPointsHistoryResultSchema(content.length),
        branchKind: "notes",
        meta: {
          goalId: input.goalId,
          unitTitle: input.unitTitle,
          unitId: input.unitId,
          topicCategory: plan.topicCategory,
          goalTitle: plan.goalTitle,
        },
      });
    } catch (error) {
      // The history branch has already exhausted its bounded tool repairs.
      // A model that answers in prose or selects another commit can still
      // author validated key points through the standalone provider adapter.
      // Do not retry authorization, cancellation, transport or persistence errors.
      if (
        !(error instanceof StructuredGenerationError) ||
        error.operation !== UNIT_KEY_POINTS_OPERATION ||
        error.stage !== "tool-call" ||
        !error.issues.some((issue) =>
          issue.includes("must call exactly one commit_key_points"),
        )
      ) {
        throw error;
      }
    }
  }
  if (!authored) {
    authored = await runValidatedStructuredGeneration({
      mode: "object",
      schema: resultSchema,
      prompt: buildKeyPointsStandalonePrompt({
        unitTitle: input.unitTitle,
        sectionCount: content.length,
        goalBlock: plan.goalBlock(),
        languageBlock,
        styleBlock,
        catalog,
      }),
      options: {
        operation: UNIT_KEY_POINTS_OPERATION,
        topicCategory: plan.topicCategory,
        meta: {
          goalId: input.goalId,
          unitTitle: input.unitTitle,
          unitId: input.unitId,
          goalTitle: plan.goalTitle,
        },
        schemaShape: UNIT_KEY_POINTS_JSON_SHAPE,
      },
      contextSubject: { goalId: input.goalId, unitId: input.unitId },
      contextQuery: input.unitTitle,
      contextInvocation: {
        unitTitle: input.unitTitle,
        sectionCount: content.length,
        goalBlock: plan.goalBlock(),
        languageBlock,
        styleBlock,
        catalog,
      },
    });
  }
  const assignments = distributeKeyPoints(authored.points, content.length).map(
    (points, index) => ({
      sectionId: content[index]!.id,
      keyTakeaways: JSON.stringify(points),
    }),
  );
  await input.repository.saveUnitKeyTakeaways({
    unitId: input.unitId,
    assignments,
    unitKeyTakeaways: JSON.stringify(authored.points),
  });
  return true;
}

export async function refreshUnitCourseKeyPointsSafe(
  input: Parameters<typeof ensureUnitCourseKeyPoints>[0],
): Promise<void> {
  try {
    await ensureUnitCourseKeyPoints(input);
  } catch (error) {
    console.error("unit.key_points failed", error);
  }
}

export function snapshotNeedsCourseKeyPoints(
  sections: readonly {
    contentKind?: string;
    generationStatus?: string;
    blocks?: readonly unknown[];
    keyTakeaways?: readonly string[];
  }[],
): boolean {
  const mapped: UnitKeyPointSectionSource[] = sections.map((section, index) => ({
    id: String(index),
    title: "",
    orderIndex: index,
    contentKind: String(section.contentKind ?? "standard"),
    generationStatus: String(section.generationStatus ?? ""),
    keyTakeaways: JSON.stringify(section.keyTakeaways ?? []),
    blocks:
      Array.isArray(section.blocks) && section.blocks.length > 0
        ? JSON.stringify(section.blocks)
        : null,
  }));
  return unitNeedsCourseKeyPoints(mapped);
}
