import {
  planAdaptiveAssessment,
  type AdaptiveAssessmentTarget,
  type AssessmentBlueprint,
  type AssessmentEvidenceKey,
  type AssessmentScope,
  type ExistingRequirementEvidence,
} from "./adaptive-blueprint.js";

export type AdaptiveAssessmentPurpose = "mastery" | "readiness";

export type PreparedAdaptiveAssessmentItem = {
  id: string;
  taskId: null;
  type:
    | "selected_response"
    | "constructed_response"
    | "performance_case"
    | "integrated_challenge"
    | "synthesis_challenge"
    | "delayed_retention";
  primaryLearningTargetId: string;
  relatedLearningTargetIds: string[];
  primaryCognitiveEntityId: string;
  evidenceDimension: string;
  criterionRef: string;
  evidencePurpose: string;
  estimatedMinutes: number;
  responseType: "selected" | "text" | "structured";
  prompt: string;
  sections?: Array<"decision" | "output" | "verification" | "reflection">;
  generationRequired?: boolean;
  availableNow: boolean;
};

export type PreparedAdaptiveAssessmentPlan = {
  purpose: AdaptiveAssessmentPurpose;
  blueprint: AssessmentBlueprint;
  items: PreparedAdaptiveAssessmentItem[];
  nextEvidenceAction: {
    itemKind: string;
    purpose: string;
    learningTargetId: string;
    cognitiveEntityId: string;
    dimension: string;
  } | null;
};

/**
 * Provider- and persistence-independent adaptive assessment read model.
 * Callers remain responsible for loading authoritative targets/evidence and for
 * binding writable items to immutable server-owned tasks.
 */
export function prepareAdaptiveAssessmentPlan(params: {
  scope: AssessmentScope;
  purpose?: AdaptiveAssessmentPurpose;
  targets: readonly AdaptiveAssessmentTarget[];
  existingEvidence?: ReadonlyMap<
    AssessmentEvidenceKey,
    ExistingRequirementEvidence
  >;
  timeBudgetMinutes?: number;
}): PreparedAdaptiveAssessmentPlan {
  const purpose = params.purpose ?? "mastery";
  if (purpose === "readiness" && params.scope !== "module") {
    throw new Error("Readiness assessment is module-scoped");
  }
  const blueprint = planAdaptiveAssessment({
    scope: params.scope,
    targets: params.targets,
    existingEvidence: params.existingEvidence,
    timeBudgetMinutes: params.timeBudgetMinutes,
  });
  const titleById = new Map(
    params.targets.map((target) => [target.id, target.title]),
  );
  const items = blueprint.slots.map((slot) => {
    const effectiveItemKind =
      purpose === "readiness" && slot.itemKind === "selected_response"
        ? ("constructed_response" as const)
        : slot.itemKind;
    const title = titleById.get(slot.learningTargetId) ?? "该学习目标";
    const relatedLearningTargetIds = params.targets
      .filter((target) => target.id !== slot.learningTargetId)
      .sort(
        (left, right) =>
          right.importanceWeight - left.importanceWeight ||
          left.id.localeCompare(right.id),
      )
      .slice(
        0,
        slot.itemKind === "integrated_challenge" ||
          slot.itemKind === "synthesis_challenge"
          ? 3
          : 0,
      )
      .map((target) => target.id);
    const relatedTitles = relatedLearningTargetIds
      .map((targetId) => titleById.get(targetId))
      .filter((value): value is string => Boolean(value));
    const structured = [
      "performance_case",
      "integrated_challenge",
      "synthesis_challenge",
    ].includes(effectiveItemKind);
    const responseType =
      effectiveItemKind === "selected_response"
        ? ("selected" as const)
        : structured
          ? ("structured" as const)
          : ("text" as const);
    const prompt =
      effectiveItemKind === "constructed_response"
        ? `请用自己的话解释“${title}”，并给出一个适用边界、反例或判断理由。`
        : structured
          ? `请在一个不同于教材示例的情境中完成“${title}”${
              relatedTitles.length
                ? `，并协调运用这些相关能力：${relatedTitles.join("、")}`
                : ""
            }。依次提交你的决策或行动、产出、验证方法与反思。`
          : effectiveItemKind === "delayed_retention"
            ? `请在不查看资料的情况下回忆并说明“${title}”。`
            : `生成一道只验证“${title}”中该实体与维度的独立选择题。`;
    return {
      id: slot.id,
      taskId: null,
      type: effectiveItemKind,
      primaryLearningTargetId: slot.learningTargetId,
      relatedLearningTargetIds,
      primaryCognitiveEntityId: slot.cognitiveEntityId,
      evidenceDimension: slot.dimension,
      criterionRef: slot.criterionRef,
      evidencePurpose: slot.purpose,
      estimatedMinutes: slot.estimatedMinutes,
      responseType,
      prompt,
      ...(structured
        ? {
            sections: [
              "decision",
              "output",
              "verification",
              "reflection",
            ] as const,
          }
        : {}),
      ...(effectiveItemKind === "selected_response"
        ? { generationRequired: true }
        : {}),
      availableNow: effectiveItemKind !== "delayed_retention",
    } satisfies PreparedAdaptiveAssessmentItem;
  });
  const next = blueprint.slots[0];
  return {
    purpose,
    blueprint,
    items,
    nextEvidenceAction: next
      ? {
          itemKind: next.itemKind,
          purpose: next.purpose,
          learningTargetId: next.learningTargetId,
          cognitiveEntityId: next.cognitiveEntityId,
          dimension: next.dimension,
        }
      : null,
  };
}
