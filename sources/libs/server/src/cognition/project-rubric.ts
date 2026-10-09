// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { createHash } from "node:crypto";
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import {
  evaluatePortableProjectDeterministicRule,
  type PortableProjectDeterministicRule,
} from "../../../domain/src/index.js";
import { recordUnverifiedTaskObservationCandidate } from "./persistence.js";
import {
  parseProjectDeterministicRule,
  projectCriterionCatalog,
  ProjectValidationError,
  recordProjectObservation,
  startProjectTaskAttempt,
  validateProjectAttemptPayload,
  type ProjectArtifactVersionRef,
  type ProjectAssistanceTraceEntry,
  type ProjectDeliverableDefinition,
  type ProjectDeterministicRule,
  type ProjectProcessLogEntry,
} from "./projects.js";

const DETERMINISTIC_RUBRIC_VERSION = 1 as const;

type JsonObject = Record<string, unknown>;

export type DeterministicProjectRuleResult = {
  passed: boolean;
  score: 0 | 1;
  rule: ProjectDeterministicRule;
  observed: JsonObject;
};

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function ruleRunId(
  attemptId: string,
  requirementId: string,
  rule: ProjectDeterministicRule,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalValue({
          version: DETERMINISTIC_RUBRIC_VERSION,
          attemptId,
          requirementId,
          rule,
        }),
      ),
    )
    .digest("hex");
  return `project-rule-v${DETERMINISTIC_RUBRIC_VERSION}:${digest}`;
}

function artifactRefKey(
  artifact: Pick<ProjectArtifactVersionRef, "artifactId" | "version">,
): string {
  return `${artifact.artifactId}@${artifact.version}`;
}

/**
 * Runs one closed rule against a validated, persisted attempt. The result is
 * only an observable rubric outcome; it contains no entity, dimension, claim,
 * or learner-state choice.
 */
export function evaluateProjectDeterministicRule(input: {
  rule: ProjectDeterministicRule;
  artifactVersionRefs: readonly ProjectArtifactVersionRef[];
  processLog: readonly ProjectProcessLogEntry[];
  assistanceTrace: readonly ProjectAssistanceTraceEntry[];
}): DeterministicProjectRuleResult {
  const rule = parseProjectDeterministicRule(input.rule);
  const result = evaluatePortableProjectDeterministicRule({
    rule: rule as PortableProjectDeterministicRule,
    artifactVersionRefs: input.artifactVersionRefs,
    processLog: input.processLog,
    assistanceTrace: input.assistanceTrace,
  });
  return { ...result, rule };
}

/**
 * Post-submission structural checker. Its inputs are learner-authored, so a
 * pass is persisted only as an unverified Observation with zero reliability.
 * It never creates an EvidenceClaim or advances LearnerState/attempt status.
 */
export async function runDeclaredDeterministicProjectRubric(
  persistence: PersistenceClient,
  input: { userId: string; attemptId: string },
) {
  const attempt = await persistence.taskAttempt.findUnique({
    where: { id: input.attemptId },
    include: {
      task: {
        include: {
          requirements: { orderBy: [{ orderIndex: "asc" }, { id: "asc" }] },
        },
      },
    },
  });
  if (
    !attempt ||
    attempt.userId !== input.userId ||
    attempt.task.taskType !== "project" ||
    (attempt.task.projectRole !== "root" &&
      attempt.task.projectRole !== "milestone") ||
    (attempt.status !== "submitted" && attempt.status !== "evaluated")
  ) {
    throw new ProjectValidationError(
      "not_found",
      "submitted project attempt not found",
    );
  }

  const deliverables = attempt.task.deliverableDefinitions;
  if (!Array.isArray(deliverables)) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project task has invalid deliverable definitions",
    );
  }
  validateProjectAttemptPayload(
    {
      artifactVersionRefs:
        attempt.artifactVersionRefs as unknown as ProjectArtifactVersionRef[],
      processLog: attempt.processLog as unknown as ProjectProcessLogEntry[],
      assistanceTrace:
        attempt.assistanceTrace as unknown as ProjectAssistanceTraceEntry[],
      status: attempt.status as "submitted" | "evaluated",
    },
    deliverables as unknown as ProjectDeliverableDefinition[],
  );
  const artifactVersionRefs =
    attempt.artifactVersionRefs as unknown as ProjectArtifactVersionRef[];
  const processLog = attempt.processLog as unknown as ProjectProcessLogEntry[];
  const assistanceTrace =
    attempt.assistanceTrace as unknown as ProjectAssistanceTraceEntry[];
  const criteria = projectCriterionCatalog(
    attempt.task.constraintDefinitions,
    attempt.task.deliverableDefinitions,
  );

  const observations = [];
  for (const requirement of attempt.task.requirements) {
    const rubric = isRecord(requirement.rubricCriterion)
      ? requirement.rubricCriterion
      : null;
    const criterionRef =
      rubric && typeof rubric.ref === "string" ? rubric.ref : null;
    const criterion = criterionRef ? criteria.get(criterionRef) : undefined;
    if (!criterion?.evaluators.includes("deterministic")) continue;
    const rule = parseProjectDeterministicRule(criterion.deterministicRule);
    const evaluated = evaluateProjectDeterministicRule({
      rule,
      artifactVersionRefs,
      processLog,
      assistanceTrace,
    });
    const routed = await recordUnverifiedTaskObservationCandidate(persistence, {
      userId: input.userId,
      attemptId: attempt.id,
      candidate: {
        requirementId: requirement.id,
        score: evaluated.score,
        evaluatorRunId: ruleRunId(attempt.id, requirement.id, rule),
        rawResult: {
          ruleVersion: DETERMINISTIC_RUBRIC_VERSION,
          passed: evaluated.passed,
          observed: evaluated.observed,
        },
        metadata: {
          runner: "project_structural_check",
          ruleType: rule.type,
        },
        observedAt: attempt.submittedAt ?? undefined,
      },
      evaluator: {
        evaluatorType: "deterministic",
        evaluatorRef: `unverified-project-structure:v${DETERMINISTIC_RUBRIC_VERSION}:${rule.type}`,
      },
    });
    observations.push({
      requirementId: requirement.id,
      criterionRef,
      ruleType: rule.type,
      passed: evaluated.passed,
      score: evaluated.score,
      replayed: routed.replayed,
    });
  }

  return {
    attemptStatus: attempt.status as "submitted" | "evaluated",
    completedAt: attempt.completedAt,
    observations,
  };
}

export const PROJECT_EVALUATOR_AUTHORITY_REGISTRY = {
  admin_human_v1: {
    type: "human",
    ref: "authority:admin-human-rubric:v1",
    evaluatorReliability: 0.95,
    groundingReliability: 1,
    evidenceStrength: "strong",
  },
  grounded_artifact_llm_v1: {
    type: "llm",
    ref: "authority:grounded-artifact-llm:v1",
    evaluatorReliability: 0.8,
    groundingReliability: 0.9,
    evidenceStrength: "moderate",
  },
} as const;

export type ProjectEvaluatorAuthorityKey =
  keyof typeof PROJECT_EVALUATOR_AUTHORITY_REGISTRY;

export function resolveProjectEvaluatorAuthority(
  authorityKey: ProjectEvaluatorAuthorityKey,
) {
  const authority = PROJECT_EVALUATOR_AUTHORITY_REGISTRY[authorityKey];
  if (!authority) {
    throw new ProjectValidationError(
      "undeclared_evaluator",
      "project evaluator authority is not registered",
    );
  }
  return authority;
}

function assistanceEntries(value: unknown): ProjectAssistanceTraceEntry[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is ProjectAssistanceTraceEntry =>
          isRecord(entry) &&
          typeof entry.occurredAt === "string" &&
          typeof entry.source === "string" &&
          typeof entry.kind === "string" &&
          typeof entry.level === "string",
      )
    : [];
}

/**
 * Creates a server-derived root attempt once every milestone's latest attempt
 * has authoritative evidence and is evaluated. The root remains submitted
 * until its own coordination and transfer criteria are reviewed.
 */
export async function ensureProjectRootAttemptFromMilestones(
  persistence: PersistenceClient,
  input: { userId: string; completedAttemptId: string },
) {
  const completedAttempt = await persistence.taskAttempt.findUnique({
    where: { id: input.completedAttemptId },
    select: {
      id: true,
      userId: true,
      status: true,
      task: {
        select: { projectRole: true, parentTaskId: true },
      },
    },
  });
  if (
    !completedAttempt ||
    completedAttempt.userId !== input.userId ||
    completedAttempt.status !== "evaluated"
  ) {
    return { status: "not_ready" as const };
  }
  if (
    completedAttempt.task.projectRole !== "milestone" ||
    !completedAttempt.task.parentTaskId
  ) {
    return { status: "not_applicable" as const };
  }

  const root = await persistence.learningTask.findUnique({
    where: { id: completedAttempt.task.parentTaskId },
    include: {
      milestones: {
        where: { status: "active", projectRole: "milestone" },
        orderBy: { milestoneOrder: "asc" },
        include: {
          attempts: {
            where: { userId: input.userId },
            orderBy: { attemptNumber: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (
    !root ||
    root.status !== "active" ||
    root.taskType !== "project" ||
    root.projectRole !== "root" ||
    root.milestones.length === 0 ||
    root.milestones.some(
      (milestone) => milestone.attempts[0]?.status !== "evaluated",
    )
  ) {
    return { status: "not_ready" as const };
  }

  const milestoneAttempts = root.milestones.map((milestone) => ({
    milestone,
    attempt: milestone.attempts[0]!,
  }));
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        rootTaskId: root.id,
        blueprintHash: root.projectBlueprintHash,
        attempts: milestoneAttempts.map(({ milestone, attempt }) => ({
          milestoneId: milestone.id,
          attemptId: attempt.id,
          attemptNumber: attempt.attemptNumber,
        })),
      }),
    )
    .digest("hex");
  const timestamps = milestoneAttempts.flatMap(({ attempt }) => [
    attempt.completedAt?.getTime(),
    attempt.submittedAt?.getTime(),
    attempt.startedAt.getTime(),
  ]);
  const submittedAt = new Date(
    Math.max(
      ...timestamps.filter((value): value is number => value !== undefined),
    ),
  );
  const startedAt = new Date(
    Math.min(
      ...milestoneAttempts.map(({ attempt }) => attempt.startedAt.getTime()),
    ),
  );
  const portfolioArtifact: ProjectArtifactVersionRef = {
    artifactId: `capstone:${root.id}:${digest.slice(0, 24)}`,
    deliverableKey: "capstone_portfolio",
    version: 1,
    createdAt: submittedAt.toISOString(),
    checksum: digest,
  };
  const portfolioRef = artifactRefKey(portfolioArtifact);
  const assistanceTrace = milestoneAttempts
    .flatMap(({ attempt }) => assistanceEntries(attempt.assistanceTrace))
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    )
    .map((entry, index) => ({ ...entry, sequence: index + 1 }));
  const processLog: ProjectProcessLogEntry[] = milestoneAttempts.map(
    ({ milestone, attempt }, index) => ({
      sequence: index + 1,
      occurredAt: (
        attempt.completedAt ??
        attempt.submittedAt ??
        attempt.startedAt
      ).toISOString(),
      kind: "verification",
      summary: `Server aggregated evaluated milestone ${milestone.stableKey} attempt ${attempt.id}.`,
      artifactVersionRefs: [portfolioRef],
      metadata: {
        sourceMilestoneTaskId: milestone.id,
        sourceAttemptId: attempt.id,
      },
    }),
  );
  processLog.sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );
  processLog.forEach((entry, index) => {
    entry.sequence = index + 1;
  });

  const rootAttempt = await startProjectTaskAttempt(persistence, {
    taskId: root.id,
    userId: input.userId,
    idempotencyKey: `project-root-aggregate:${root.id}:${input.userId}:${digest}`,
    payload: {
      artifactVersionRefs: [portfolioArtifact],
      processLog,
      assistanceTrace,
      response: {
        aggregationVersion: 1,
        milestoneAttemptIds: milestoneAttempts.map(({ attempt }) => attempt.id),
      },
      status: "submitted",
      startedAt,
      submittedAt,
    },
  });
  const structural = await runDeclaredDeterministicProjectRubric(persistence, {
    userId: input.userId,
    attemptId: rootAttempt.attempt.id,
  });
  return {
    status: "submitted" as const,
    rootAttempt: rootAttempt.attempt,
    replayed: rootAttempt.replayed,
    structuralObservations: structural.observations,
  };
}

/** Routes an evaluator result only after resolving fixed trust policy server-side. */
export async function recordAuthoritativeProjectObservation(
  persistence: PersistenceClient,
  input: {
    authorityKey: ProjectEvaluatorAuthorityKey;
    actorRef: string;
    userId: string;
    attemptId: string;
    requirementId: string;
    score: number;
    evaluatorRunId: string;
    rawResult?: JsonObject;
    metadata?: JsonObject;
    observedAt?: Date;
  },
) {
  if (!input.actorRef.trim()) {
    throw new ProjectValidationError(
      "undeclared_evaluator",
      "authoritative project evaluation requires an actor reference",
    );
  }
  const authority = resolveProjectEvaluatorAuthority(input.authorityKey);
  const declaredRequirement = await persistence.taskRequirement.findFirst({
    where: {
      id: input.requirementId,
      task: {
        attempts: {
          some: { id: input.attemptId, userId: input.userId },
        },
      },
    },
    select: { rubricCriterion: true },
  });
  const declaredRubric = declaredRequirement?.rubricCriterion;
  const rubricVersion =
    isRecord(declaredRubric) &&
    Number.isInteger(declaredRubric.definitionVersion) &&
    Number(declaredRubric.definitionVersion) > 0
      ? Number(declaredRubric.definitionVersion)
      : null;
  if (!rubricVersion) {
    throw new ProjectValidationError(
      "undeclared_evaluator",
      "authoritative project evaluation requires a versioned persisted rubric criterion",
    );
  }
  const authoritySlotDigest = createHash("sha256")
    .update(
      JSON.stringify({
        authorityKey: input.authorityKey,
        attemptId: input.attemptId,
        requirementId: input.requirementId,
        rubricVersion,
      }),
    )
    .digest("hex");
  const result = await recordProjectObservation(persistence, {
    userId: input.userId,
    attemptId: input.attemptId,
    requirementId: input.requirementId,
    score: input.score,
    evaluatorRunId: `project-authority-slot:v1:${authoritySlotDigest}`,
    evaluator: authority,
    rawResult: input.rawResult,
    metadata: {
      ...(input.metadata ?? {}),
      evaluatorAuthorityKey: input.authorityKey,
      evaluatorActorRef: input.actorRef,
      callerEvaluatorRunId: input.evaluatorRunId,
      authorityRubricVersion: rubricVersion,
    },
    observedAt: input.observedAt,
  });
  const rootAggregation =
    result.attemptStatus === "evaluated"
      ? await ensureProjectRootAttemptFromMilestones(persistence, {
          userId: input.userId,
          completedAttemptId: input.attemptId,
        })
      : { status: "not_ready" as const };
  return { ...result, rootAggregation };
}
