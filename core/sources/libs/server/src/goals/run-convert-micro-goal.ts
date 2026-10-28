import { tBackend } from "../../../common/src/index.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import type { StreamTokenHandler } from "../llm/chat-stream.js";
import type { MapDslPartial } from "../llm/map-dsl.js";
import { broadenMicroGoalTitleForConversion } from "./broaden-micro-goal-title.js";
import { expandMicroGoalToFullMap } from "./convert-micro-to-full-map.js";
import { SubdivideUnitError } from "./subdivide-unit.js";
import type {
  CognitiveModelInvalidationRepository,
  LearningGoalPlanRepository,
  LegacyMapReplacementRepository,
  MicroUnitPublicationRepository,
} from "../../../domain/src/index.js";

export type ConvertMicroGoalSend = (
  event: Record<string, unknown>,
) => void | Promise<void>;

export type RunConvertMicroGoalResult = {
  goalId: string;
  unitCount: number;
  children: { id: string; title: string }[];
  title: string;
  titleChanged: boolean;
  previousTitle?: string;
};

type OriginalMicroUnit = {
  title: string;
  contentSummary: string | null;
  unitKind: string;
  difficulty: string;
  prerequisites: string;
  status: string;
};

async function restoreMicroGoal(params: {
  goalId: string;
  unitId: string;
  originalUnit: OriginalMicroUnit;
  goalSnapshot: {
    userId: string;
    title: string;
    mapPlanStatus: string;
    detailedPlanStatus: string;
    contentLanguage: string | null;
  };
  titleChanged: boolean;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
  microUnitPublication: MicroUnitPublicationRepository;
}) {
  const restored = await params.microUnitPublication.restoreOwnedMicroGoal({
    userId: params.goalSnapshot.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    originalUnit: {
      title: params.originalUnit.title,
      contentSummary:
        params.originalUnit.contentSummary || params.originalUnit.title,
      unitKind: params.originalUnit.unitKind as "lesson" | "overview",
      difficulty: params.originalUnit.difficulty,
      prerequisites: params.originalUnit.prerequisites,
      status: params.originalUnit.status,
    },
    title: params.goalSnapshot.title,
    mapPlanStatus: params.goalSnapshot.mapPlanStatus,
    detailedPlanStatus: params.goalSnapshot.detailedPlanStatus,
    contentLanguage: params.goalSnapshot.contentLanguage,
    restoreContentLanguage: params.titleChanged,
  });
  if (restored.status === "not_found") return;
  await params.cognitiveModelInvalidation.invalidate({
    goalId: params.goalId,
    reason: "micro_conversion_restored",
    force: true,
  });
}

/** Convert a micro goal into a full goal with a new top-level learning map. */
export async function runConvertMicroGoalToFull(params: {
  userId: string;
  goalId: string;
  adjustment?: string;
  send: ConvertMicroGoalSend;
  onToken?: StreamTokenHandler;
  onPartialMap?: (partial: MapDslPartial) => void | Promise<void>;
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
  learningGoalPlan: LearningGoalPlanRepository;
  legacyMapReplacement: LegacyMapReplacementRepository;
  microUnitPublication: MicroUnitPublicationRepository;
}): Promise<RunConvertMicroGoalResult> {
  const source = await params.microUnitPublication.findOwnedConversionContext(
    params.userId,
    params.goalId,
  );
  if (!source) {
    throw new SubdivideUnitError("只有轻课可以转换为普通目标", "not_found");
  }
  const { goal, unit } = source;

  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    goal.title,
  );

  await params.send({
    type: "status",
    phase: "convert",
    message: tBackend("status.generation.goal"),
  });

  const { title: broadenedTitle, changed: titleChanged } =
    await broadenMicroGoalTitleForConversion({
      userId: goal.userId,
      goalId: goal.id,
      goalTitle: goal.title,
      unitTitle: unit.title,
      contentSummary: unit.contentSummary || unit.title,
      topicOverview: goal.topicOverview,
      contentLanguage,
      signal: params.signal,
    });

  if (titleChanged) {
    await params.send({
      type: "status",
      phase: "convert",
      message: `已将学习目标标题调整为「${broadenedTitle}」`,
    });
  }

  await params.send({
    type: "status",
    phase: "convert",
    message: tBackend("status.generation.path"),
  });

  const conversionContentLanguage = titleChanged
    ? resolveGoalContentLanguage(goal.contentLanguage, broadenedTitle)
    : undefined;
  const started =
    await params.microUnitPublication.beginOwnedMicroGoalConversion({
      userId: goal.userId,
      goalId: params.goalId,
      title: broadenedTitle,
      contentLanguage: conversionContentLanguage,
    });
  if (started.status === "not_found") {
    throw new SubdivideUnitError("目标不存在", "not_found");
  }

  const originalUnit: OriginalMicroUnit = {
    title: unit.title,
    contentSummary: unit.contentSummary,
    unitKind: unit.unitKind,
    difficulty: unit.difficulty,
    prerequisites: unit.prerequisites,
    status: unit.status,
  };

  try {
    await params.assertActive?.();
    const result = await expandMicroGoalToFullMap(source, {
      broadenedTitle,
      topicOverview: goal.topicOverview,
      adjustment: params.adjustment,
      onProgress: (message) => {
        void params.send({ type: "status", phase: "map", message });
      },
      streamOptions: {
        onToken: params.onToken,
        signal: params.signal,
        onPartialMap: params.onPartialMap,
      },
      cognitiveModelInvalidation: params.cognitiveModelInvalidation,
      learningGoalPlan: params.learningGoalPlan,
      legacyMapReplacement: params.legacyMapReplacement,
    });
    await params.assertActive?.();

    return {
      goalId: params.goalId,
      unitCount: result.unitCount,
      children: result.children,
      title: broadenedTitle,
      titleChanged,
      ...(titleChanged ? { previousTitle: goal.title } : {}),
    };
  } catch (error) {
    await restoreMicroGoal({
      goalId: params.goalId,
      unitId: unit.id,
      originalUnit,
      goalSnapshot: {
        userId: goal.userId,
        title: goal.title,
        mapPlanStatus: goal.mapPlanStatus,
        detailedPlanStatus: goal.detailedPlanStatus,
        contentLanguage: goal.contentLanguage,
      },
      cognitiveModelInvalidation: params.cognitiveModelInvalidation,
      titleChanged,
      microUnitPublication: params.microUnitPublication,
    });
    throw error;
  }
}
