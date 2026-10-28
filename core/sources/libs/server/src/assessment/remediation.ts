// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { PersistenceClient } from "../persistence/persistence-compat.js";

export type DiagnosticWeakTarget = {
  learningTargetId: string;
  title: string;
  score: number;
};

function remediationCopy(
  language: string,
  sourceTitle: string,
  titles: string[],
) {
  const targetList = titles.join("、");
  const inferredEnglish =
    language === "auto" &&
    !/[\u3400-\u9fff]/u.test(`${sourceTitle}${targetList}`);
  if (language === "en" || inferredEnglish) {
    return {
      title: `Targeted practice · ${sourceTitle}`,
      summary: `A focused adaptive lesson for unresolved learning targets from “${sourceTitle}”: ${titles.join(", ")}. Rebuild the missing structure, practise it in context, and gather new direct evidence.`,
    };
  }
  if (language === "zh-Hant") {
    return {
      title: `學習目標強化 · ${sourceTitle}`,
      summary: `針對「${sourceTitle}」診斷中尚未達標的學習目標進行強化：${targetList}。重建缺失結構、在情境中練習，並重新收集直接證據。`,
    };
  }
  return {
    title: `学习目标强化 · ${sourceTitle}`,
    summary: `针对“${sourceTitle}”诊断中尚未达标的学习目标进行强化：${targetList}。重建缺失结构、在情境中练习，并重新收集直接证据。`,
  };
}

function maxDifficulty(values: string[]): string {
  const rank: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  return values.reduce(
    (hardest, value) =>
      (rank[value] ?? 1) > (rank[hardest] ?? 1) ? value : hardest,
    "easy",
  );
}

/**
 * Reuses objective LearningTargets in a focused lesson. It never copies or
 * deletes TaskAttempt, Observation, EvidenceClaim, or learner state.
 */
export async function upsertDiagnosticRemediationUnit(params: {
  persistence: PersistenceClient;
  userId: string;
  sourceUnitId: string;
  attemptId: string;
  weakTargets: DiagnosticWeakTarget[];
}): Promise<string | null> {
  const weakIds = [
    ...new Set(params.weakTargets.map((target) => target.learningTargetId)),
  ];
  if (weakIds.length === 0) return null;

  const source = await params.persistence.learningUnit.findFirst({
    where: { id: params.sourceUnitId, goal: { userId: params.userId } },
    include: {
      goal: { select: { contentLanguage: true } },
      learningTargets: {
        where: { learningTargetId: { in: weakIds } },
        include: { learningTarget: true },
        orderBy: { orderIndex: "asc" },
      },
    },
  });
  if (!source || source.learningTargets.length === 0) return null;

  const copy = remediationCopy(
    source.goal.contentLanguage,
    source.title,
    source.learningTargets.map((mapping) => mapping.learningTarget.title),
  );
  const difficulty = maxDifficulty(
    source.learningTargets.map((mapping) => mapping.learningTarget.difficulty),
  );

  return params.persistence.$transaction(async (tx) => {
    let remediation = await tx.learningUnit.findUnique({
      where: { remediationSourceUnitId: source.id },
    });
    if (!remediation) {
      await tx.learningUnit.updateMany({
        where: {
          goalId: source.goalId,
          moduleId: source.moduleId,
          parentUnitId: source.parentUnitId,
          orderIndex: { gt: source.orderIndex },
        },
        data: { orderIndex: { increment: 1 } },
      });
      remediation = await tx.learningUnit.create({
        data: {
          goalId: source.goalId,
          parentUnitId: source.parentUnitId,
          unitKind: "lesson",
          title: copy.title,
          orderIndex: source.orderIndex + 1,
          difficulty,
          prerequisites: source.prerequisites,
          contentSummary: copy.summary,
          mapOrigin: "adaptive",
          status: "available",
          cognitiveModelStatus: "expanded",
          requiredForModuleCompletion: false,
          remediationSourceUnitId: source.id,
          remediationAttemptId: params.attemptId,
        },
      });
    } else {
      // Regenerate teaching artifacts only. Historical cognitive evidence is immutable.
      await tx.quizAttempt.deleteMany({ where: { unitId: remediation.id } });
      await tx.quizSet.deleteMany({ where: { unitId: remediation.id } });
      await tx.diagnosticAttempt.deleteMany({
        where: { unitId: remediation.id },
      });
      await tx.feynmanSession.deleteMany({ where: { unitId: remediation.id } });
      await tx.reviewCard.deleteMany({ where: { unitId: remediation.id } });
      await tx.flashCardDeck.deleteMany({ where: { unitId: remediation.id } });
      await tx.materialFollowUp.deleteMany({
        where: { unitId: remediation.id },
      });
      await tx.cornellNote.deleteMany({ where: { unitId: remediation.id } });
      await tx.learningMaterial.deleteMany({
        where: { unitId: remediation.id },
      });
      await tx.unitSessionState.deleteMany({
        where: { unitId: remediation.id },
      });
      remediation = await tx.learningUnit.update({
        where: { id: remediation.id },
        data: {
          title: copy.title,
          difficulty,
          prerequisites: source.prerequisites,
          contentSummary: copy.summary,
          status: "available",
          completionMethod: null,
          completionAttemptId: null,
          completedAt: null,
          remediationAttemptId: params.attemptId,
          cognitiveModelStatus: "expanded",
          moduleId: source.moduleId,
          requiredForModuleCompletion: false,
          contentRevision: { increment: 1 },
        },
      });
    }

    await tx.unitLearningTarget.deleteMany({
      where: { unitId: remediation.id },
    });
    await tx.unitLearningTarget.createMany({
      data: source.learningTargets.map((mapping, orderIndex) => ({
        unitId: remediation!.id,
        learningTargetId: mapping.learningTargetId,
        localRef: `lt_${orderIndex + 1}`,
        required: true,
        weight: mapping.weight,
        orderIndex,
        role: "review",
        isEntry: orderIndex === 0,
        isExit: orderIndex === source.learningTargets.length - 1,
      })),
    });
    return remediation.id;
  });
}

export async function resolveDiagnosticRemediationUnit(
  persistence: PersistenceClient,
  sourceUnitId: string,
  completedAt: Date,
): Promise<void> {
  await persistence.learningUnit.updateMany({
    where: {
      remediationSourceUnitId: sourceUnitId,
      status: { not: "completed" },
    },
    data: {
      status: "completed",
      completionMethod: "test_out",
      completedAt,
    },
  });
}
