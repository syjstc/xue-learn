/** Selected-response (MCQ / inline check) evidence dimensions. */
export const QUIZ_EVIDENCE_DIMENSIONS = ["memory", "understanding"] as const;

export type QuizEvidenceDimension = (typeof QUIZ_EVIDENCE_DIMENSIONS)[number];

export function isQuizEvidenceDimensionName(
  dimension: string,
): dimension is QuizEvidenceDimension {
  return (
    dimension === "memory" || dimension === "understanding"
  );
}

export function requirementsIncludeQuizEvidence(
  requirements: readonly { dimension: string }[],
): boolean {
  return requirements.some((requirement) =>
    isQuizEvidenceDimensionName(requirement.dimension),
  );
}

/**
 * Fail-closed KACOM contract: unit quizzes and inline checks can only write
 * memory/understanding claims. Core/supporting targets must declare at least
 * one of those dimensions (application/transfer may be additional).
 */
export function mapCognitiveDimensionAlias(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  const mapped: Record<string, string> = {
    memory: "memory",
    remember: "memory",
    recall: "memory",
    记忆: "memory",
    understanding: "understanding",
    understand: "understanding",
    理解: "understanding",
    application: "application",
    apply: "application",
    应用: "application",
    transfer: "transfer",
    迁移: "transfer",
    fluency: "fluency",
    stability: "stability",
    independence: "independence",
    analyze: "application",
    analyse: "application",
    evaluate: "understanding",
    create: "application",
  };
  return mapped[key];
}

export function ensureQuizEvidenceRequirements<
  T extends {
    importance: string;
    requirements: Array<{ dimension: string } & Record<string, unknown>>;
  },
>(targets: T[]): T[] {
  const withEvidence = targets.map((target) => {
    if (
      target.importance !== "core" &&
      target.importance !== "supporting"
    ) {
      return target;
    }
    if (requirementsIncludeQuizEvidence(target.requirements)) return target;
    const template = target.requirements[0];
    if (!template) return target;
    return {
      ...target,
      requirements: [
        ...target.requirements,
        { ...template, dimension: "understanding" },
      ],
    };
  });
  if (quizEvidenceContractIssues(withEvidence).length === 0) return withEvidence;
  if (withEvidence.length === 0) return withEvidence;
  const first = withEvidence[0]!;
  if (requirementsIncludeQuizEvidence(first.requirements)) return withEvidence;
  const template = first.requirements[0] ?? {
    dimension: "understanding",
  };
  withEvidence[0] = {
    ...first,
    requirements: [
      ...first.requirements,
      { ...template, dimension: "understanding" },
    ],
  };
  return withEvidence;
}

export function quizEvidenceContractIssues(
  targets: readonly {
    importance: string;
    requirements: readonly { dimension: string }[];
  }[],
): Array<{ index: number | null; message: string }> {
  const issues: Array<{ index: number | null; message: string }> = [];
  let anyQuizAssessable = false;

  targets.forEach((target, index) => {
    const quizOk = requirementsIncludeQuizEvidence(target.requirements);
    if (quizOk) anyQuizAssessable = true;
    if (
      (target.importance === "core" || target.importance === "supporting") &&
      !quizOk
    ) {
      issues.push({
        index,
        message:
          "Core/supporting LearningTarget must include at least one memory or understanding requirement for selected-response evidence",
      });
    }
  });

  if (!anyQuizAssessable) {
    issues.push({
      index: null,
      message:
        "Unit learning targets must declare at least one memory or understanding requirement for quiz evidence",
    });
  }

  return issues;
}
