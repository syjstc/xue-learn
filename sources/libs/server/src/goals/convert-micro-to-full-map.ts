import { tBackend } from "../../../common/src/index.js";
import { gatherGoalPathContext } from "./goal-path-context.js";
import { decomposeGoalStream } from "../llm/decompose.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import type { StreamTokenHandler } from "../llm/chat-stream.js";
import type { MapDslPartial } from "../llm/map-dsl.js";
import { goalHasRagDocuments } from "../rag/retrieve.js";
import { appendLearnerProfileToPromptOptions } from "../persona/learner-profile.js";
import { mergeRegenerationAdjustment } from "../llm/generation-options.js";
import { persistDecomposeResult } from "./persist-decompose.js";
import { refreshDetailedPlanForGoal } from "./refresh-detailed-plan.js";
import { SubdivideUnitError } from "./subdivide-unit.js";
import type {
  CognitiveModelInvalidationRepository,
  LearningGoalPlanRepository,
  LegacyMapReplacementRepository,
  OwnedMicroGoalConversionContext,
} from "../../../domain/src/index.js";

export type ExpandMicroGoalProgress = (message: string) => void;

export type ExpandMicroGoalStreamOptions = {
  onToken?: StreamTokenHandler;
  onPartialMap?: (partial: MapDslPartial) => void | Promise<void>;
  signal?: AbortSignal;
};

export type ExpandMicroGoalToFullMapResult = {
  unitCount: number;
  children: { id: string; title: string }[];
};

export function buildMicroConvertMapHint(params: {
  lessonTitle: string;
  lessonSummary: string;
}): string {
  return [
    "Micro lesson conversion context:",
    `- Original micro lesson (include one matching unit in the generated map): "${params.lessonTitle}"`,
    `- Lesson scope: ${params.lessonSummary}`,
  ].join("\n");
}

/** Replace a micro goal with a full top-level learning map for the broadened topic. */
export async function expandMicroGoalToFullMap(
  source: OwnedMicroGoalConversionContext,
  params: {
    broadenedTitle: string;
    topicOverview?: string | null;
    adjustment?: string;
    cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
    learningGoalPlan: LearningGoalPlanRepository;
    legacyMapReplacement: LegacyMapReplacementRepository;
    onProgress?: ExpandMicroGoalProgress;
    streamOptions?: ExpandMicroGoalStreamOptions;
  },
): Promise<ExpandMicroGoalToFullMapResult> {
  const { goal, unit } = source;
  if (unit.childCount > 0) {
    throw new SubdivideUnitError(
      "该轻课已扩展，请从总地图查看学习单元",
      "already_module",
    );
  }

  const originalLessonTitle = unit.title;
  const originalLessonSummary = unit.contentSummary || unit.title;

  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    params.broadenedTitle,
  );

  params.onProgress?.(tBackend("status.generation.collectingPathReferences"));
  const hasRag = await goalHasRagDocuments(goal.id);
  const { context, pathSource } = await gatherGoalPathContext({
    goalId: goal.id,
    title: params.broadenedTitle,
    hasUpload: hasRag,
    allowWebSearch: !hasRag,
    searchPurpose: "map",
  });

  const generationOptions = await appendLearnerProfileToPromptOptions(
    goal.userId,
    mergeRegenerationAdjustment(
      [
        goal.generationOptions,
        params.topicOverview?.trim()
          ? `Topic overview: ${params.topicOverview.trim()}`
          : null,
        buildMicroConvertMapHint({
          lessonTitle: originalLessonTitle,
          lessonSummary: originalLessonSummary,
        }),
      ]
        .filter(Boolean)
        .join("\n"),
      params.adjustment,
      "User expansion preferences for micro-to-full map",
    ),
  );

  params.onProgress?.(tBackend("status.generation.generatingMap"));
  const result = await decomposeGoalStream({
    title: params.broadenedTitle,
    level: goal.level,
    context,
    pathSource,
    contentLanguage,
    generationOptions,
    onToken: params.streamOptions?.onToken,
    onPartialMap: params.streamOptions?.onPartialMap,
    signal: params.streamOptions?.signal,
  });

  params.onProgress?.(
    tBackend("status.generation.mapWriting", { count: result.units.length }),
  );

  const { units } = await persistDecomposeResult({
    userId: goal.userId,
    goalId: goal.id,
    title: params.broadenedTitle,
    level: goal.level,
    pathSource,
    contentLanguage,
    goalKind: "full",
    mapPlanStatus: "pending",
    mapSummaryStatus: "skipped",
    result,
    cognitiveModelInvalidation: params.cognitiveModelInvalidation,
    legacyMapReplacement: params.legacyMapReplacement,
  });

  void refreshDetailedPlanForGoal({
    goalId: goal.id,
    userId: goal.userId,
    learningGoalPlan: params.learningGoalPlan,
  }).catch(() => {
    // Keep the updated map usable; users can retry plan generation from the plan page.
  });

  return {
    unitCount: units.length,
    children: units.map((child) => ({
      id: child.id,
      title: child.title,
    })),
  };
}
