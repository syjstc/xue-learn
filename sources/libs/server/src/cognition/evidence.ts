import {
  COGNITIVE_DIMENSIONS,
  EVIDENCE_SOURCES,
  EVIDENCE_TASK_KINDS,
  type AssistanceLevel,
  type CognitiveDimension,
  type EvidenceClaim,
  type EvidenceLifecycleEvent,
  type EvidenceSource,
  type EvidenceTaskKind,
  isAssistanceLevel,
  isCognitiveEntityKind,
  isCognitiveDimension,
  isContextDistance,
  isEvidenceEvaluator,
  isEvidenceSource,
  isEvidenceStrength,
  isEvidenceTaskKind,
} from "./types.js";

const TASK_DIMENSIONS: Record<EvidenceTaskKind, readonly CognitiveDimension[]> =
  {
    recall: ["memory", "fluency", "independence"],
    explanation: ["memory", "understanding", "fluency", "independence"],
    routine_application: [
      "understanding",
      "application",
      "fluency",
      "independence",
    ],
    novel_application: [
      "understanding",
      "application",
      "transfer",
      "fluency",
      "independence",
    ],
    integration: [
      "understanding",
      "application",
      "transfer",
      "fluency",
      "independence",
    ],
    project: [
      "understanding",
      "application",
      "transfer",
      "fluency",
      "independence",
    ],
    teaching: ["understanding", "transfer", "fluency", "independence"],
    retention: ["memory", "stability", "fluency", "independence"],
  };

const SOURCE_TASKS: Record<EvidenceSource, readonly EvidenceTaskKind[]> = {
  quiz: [
    "recall",
    "explanation",
    "routine_application",
    "novel_application",
    "integration",
  ],
  diagnostic: [
    "recall",
    "explanation",
    "routine_application",
    "novel_application",
    "integration",
    "retention",
  ],
  review_quiz: [
    "recall",
    "explanation",
    "routine_application",
    "novel_application",
    "integration",
    "retention",
  ],
  flashcard: ["recall", "retention"],
  feynman: ["explanation", "teaching"],
  socratic: ["explanation", "routine_application", "integration"],
  practice: [
    "routine_application",
    "novel_application",
    "integration",
    "project",
    "retention",
  ],
  project: ["novel_application", "integration", "project"],
  teaching: ["teaching"],
  human_observation: EVIDENCE_TASK_KINDS,
};

const SOURCE_DIMENSIONS: Record<EvidenceSource, readonly CognitiveDimension[]> =
  {
    quiz: [
      "memory",
      "understanding",
      "application",
      "transfer",
      "fluency",
      "independence",
    ],
    diagnostic: COGNITIVE_DIMENSIONS,
    review_quiz: COGNITIVE_DIMENSIONS,
    flashcard: ["memory", "stability"],
    feynman: ["understanding", "independence"],
    socratic: ["understanding", "independence"],
    practice: [
      "understanding",
      "application",
      "transfer",
      "fluency",
      "stability",
      "independence",
    ],
    project: [
      "understanding",
      "application",
      "transfer",
      "fluency",
      "independence",
    ],
    teaching: ["understanding", "transfer", "fluency", "independence"],
    human_observation: COGNITIVE_DIMENSIONS,
  };

export const MAX_INDEPENDENCE_SCORE_BY_ASSISTANCE: Record<
  AssistanceLevel,
  number
> = {
  independent: 1,
  light_hint: 0.8,
  guided: 0.55,
  worked_example: 0.25,
  answer_revealed: 0.05,
};

export type EvidenceValidationIssue = {
  path: string;
  code:
    | "required"
    | "invalid_type"
    | "invalid_value"
    | "out_of_range"
    | "incompatible_source_task"
    | "incompatible_task_dimension"
    | "incompatible_source_dimension"
    | "missing_context"
    | "assistance_conflict";
  message: string;
};

export type EvidenceValidationResult =
  | { success: true; claim: EvidenceClaim; issues: [] }
  | { success: false; issues: EvidenceValidationIssue[] };

export class EvidenceValidationError extends Error {
  readonly issues: readonly EvidenceValidationIssue[];

  constructor(issues: readonly EvidenceValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "EvidenceValidationError";
    this.issues = issues;
  }
}

export class EvidenceLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceLifecycleError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.includes("T") &&
    Number.isFinite(Date.parse(value))
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function addRequiredString(
  issues: EvidenceValidationIssue[],
  value: unknown,
  path: string,
) {
  if (!nonEmpty(value)) {
    issues.push({
      path,
      code: "required",
      message: "must be a non-empty string",
    });
  }
}

export function allowedDimensionsForTask(
  task: EvidenceTaskKind,
): readonly CognitiveDimension[] {
  return TASK_DIMENSIONS[task];
}

export function allowedTasksForSource(
  source: EvidenceSource,
): readonly EvidenceTaskKind[] {
  return SOURCE_TASKS[source];
}

export function allowedDimensionsForSource(
  source: EvidenceSource,
): readonly CognitiveDimension[] {
  return SOURCE_DIMENSIONS[source];
}

export function validateEvidenceClaim(
  value: unknown,
): EvidenceValidationResult {
  const issues: EvidenceValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [
        {
          path: "$",
          code: "invalid_type",
          message: "must be an object",
        },
      ],
    };
  }

  addRequiredString(issues, value.id, "id");
  addRequiredString(issues, value.learnerId, "learnerId");

  const target = value.target;
  if (!isRecord(target)) {
    issues.push({
      path: "target",
      code: "required",
      message: "must be an object",
    });
  } else {
    addRequiredString(issues, target.id, "target.id");
    if (!isCognitiveEntityKind(target.kind)) {
      issues.push({
        path: "target.kind",
        code: "invalid_value",
        message: "must be a controlled cognitive entity kind",
      });
    }
    if (
      target.definitionVersion !== undefined &&
      (typeof target.definitionVersion !== "number" ||
        !Number.isInteger(target.definitionVersion) ||
        target.definitionVersion < 1)
    ) {
      issues.push({
        path: "target.definitionVersion",
        code: "out_of_range",
        message: "must be a positive integer",
      });
    }
  }

  const task = value.task;
  if (!isRecord(task)) {
    issues.push({
      path: "task",
      code: "required",
      message: "must be an object",
    });
  } else {
    addRequiredString(issues, task.id, "task.id");
    addRequiredString(issues, task.contextId, "task.contextId");
    if (!isEvidenceTaskKind(task.kind)) {
      issues.push({
        path: "task.kind",
        code: "invalid_value",
        message: "must be a controlled task kind",
      });
    }
    if (!isContextDistance(task.contextDistance)) {
      issues.push({
        path: "task.contextDistance",
        code: "invalid_value",
        message: "must be same, near, or far",
      });
    }
    if (
      task.durationMs !== undefined &&
      (typeof task.durationMs !== "number" ||
        !Number.isFinite(task.durationMs) ||
        task.durationMs <= 0)
    ) {
      issues.push({
        path: "task.durationMs",
        code: "out_of_range",
        message: "must be greater than zero",
      });
    }
    if (
      task.delayedDays !== undefined &&
      (typeof task.delayedDays !== "number" ||
        !Number.isFinite(task.delayedDays) ||
        task.delayedDays < 0)
    ) {
      issues.push({
        path: "task.delayedDays",
        code: "out_of_range",
        message: "must be zero or greater",
      });
    }
    if (task.artifactId !== undefined)
      addRequiredString(issues, task.artifactId, "task.artifactId");
    if (task.rubricId !== undefined)
      addRequiredString(issues, task.rubricId, "task.rubricId");
  }

  if (!isEvidenceSource(value.source)) {
    issues.push({
      path: "source",
      code: "invalid_value",
      message: `must be one of ${EVIDENCE_SOURCES.join(", ")}`,
    });
  }
  if (!isCognitiveDimension(value.dimension)) {
    issues.push({
      path: "dimension",
      code: "invalid_value",
      message: "must be a controlled cognitive dimension",
    });
  }
  if (!finiteInRange(value.score, 0, 1)) {
    issues.push({
      path: "score",
      code: "out_of_range",
      message: "must be between zero and one",
    });
  }
  if (!isEvidenceEvaluator(value.evaluator)) {
    issues.push({
      path: "evaluator",
      code: "invalid_value",
      message: "must be a controlled evaluator",
    });
  }
  if (!finiteInRange(value.evaluatorReliability, 0, 1)) {
    issues.push({
      path: "evaluatorReliability",
      code: "out_of_range",
      message: "must be between zero and one",
    });
  }
  if (!isEvidenceStrength(value.strength)) {
    issues.push({
      path: "strength",
      code: "invalid_value",
      message: "must be a controlled evidence strength",
    });
  }
  if (
    value.observations !== undefined &&
    (typeof value.observations !== "number" ||
      !Number.isInteger(value.observations) ||
      value.observations < 1 ||
      value.observations > 20)
  ) {
    issues.push({
      path: "observations",
      code: "out_of_range",
      message: "must be an integer from 1 to 20",
    });
  }
  if (!validIsoDate(value.observedAt)) {
    issues.push({
      path: "observedAt",
      code: "invalid_value",
      message: "must be an ISO timestamp",
    });
  }

  const assistance = value.assistance;
  if (!isRecord(assistance)) {
    issues.push({
      path: "assistance",
      code: "required",
      message: "must be an object",
    });
  } else {
    if (!isAssistanceLevel(assistance.level)) {
      issues.push({
        path: "assistance.level",
        code: "invalid_value",
        message: "must be a controlled assistance level",
      });
    }
    if (
      typeof assistance.hintCount !== "number" ||
      !Number.isInteger(assistance.hintCount) ||
      assistance.hintCount < 0
    ) {
      issues.push({
        path: "assistance.hintCount",
        code: "out_of_range",
        message: "must be a non-negative integer",
      });
    }
    if (typeof assistance.answerRevealed !== "boolean") {
      issues.push({
        path: "assistance.answerRevealed",
        code: "invalid_type",
        message: "must be boolean",
      });
    }
    if (
      assistance.level === "independent" &&
      (assistance.hintCount !== 0 || assistance.answerRevealed !== false)
    ) {
      issues.push({
        path: "assistance",
        code: "assistance_conflict",
        message: "independent evidence cannot use hints or reveal the answer",
      });
    }
    if (
      (assistance.level === "light_hint" || assistance.level === "guided") &&
      typeof assistance.hintCount === "number" &&
      assistance.hintCount < 1
    ) {
      issues.push({
        path: "assistance.hintCount",
        code: "assistance_conflict",
        message: `${assistance.level} evidence must record at least one hint`,
      });
    }
    if (
      assistance.level === "answer_revealed" &&
      assistance.answerRevealed !== true
    ) {
      issues.push({
        path: "assistance.answerRevealed",
        code: "assistance_conflict",
        message: "answer_revealed assistance must record answerRevealed=true",
      });
    }
  }

  if (
    isEvidenceSource(value.source) &&
    isRecord(task) &&
    isEvidenceTaskKind(task.kind) &&
    !SOURCE_TASKS[value.source].includes(task.kind)
  ) {
    issues.push({
      path: "task.kind",
      code: "incompatible_source_task",
      message: `${value.source} cannot produce ${task.kind} evidence`,
    });
  }
  if (
    isRecord(task) &&
    isEvidenceTaskKind(task.kind) &&
    isCognitiveDimension(value.dimension) &&
    !TASK_DIMENSIONS[task.kind].includes(value.dimension)
  ) {
    issues.push({
      path: "dimension",
      code: "incompatible_task_dimension",
      message: `${task.kind} cannot observe ${value.dimension}`,
    });
  }
  if (
    isEvidenceSource(value.source) &&
    isCognitiveDimension(value.dimension) &&
    !SOURCE_DIMENSIONS[value.source].includes(value.dimension)
  ) {
    issues.push({
      path: "dimension",
      code: "incompatible_source_dimension",
      message: `${value.source} cannot support ${value.dimension}`,
    });
  }

  if (isRecord(task) && isCognitiveDimension(value.dimension)) {
    if (value.dimension === "transfer" && task.contextDistance === "same") {
      issues.push({
        path: "task.contextDistance",
        code: "missing_context",
        message: "transfer evidence requires an explicit near or far context",
      });
    }
    if (
      value.dimension === "stability" &&
      (typeof task.delayedDays !== "number" || task.delayedDays < 1)
    ) {
      issues.push({
        path: "task.delayedDays",
        code: "missing_context",
        message: "stability evidence requires a delayed observation",
      });
    }
    if (
      value.dimension === "fluency" &&
      task.durationMs === undefined &&
      !nonEmpty(task.rubricId)
    ) {
      issues.push({
        path: "task",
        code: "missing_context",
        message: "fluency evidence requires durationMs or a fluency rubric",
      });
    }
    if (
      (task.kind === "project" || value.source === "project") &&
      (!nonEmpty(task.artifactId) || !nonEmpty(task.rubricId))
    ) {
      issues.push({
        path: "task",
        code: "missing_context",
        message: "project evidence requires artifactId and rubricId",
      });
    }
  }

  if (
    value.source === "socratic" &&
    isRecord(assistance) &&
    assistance.level === "independent"
  ) {
    issues.push({
      path: "assistance.level",
      code: "assistance_conflict",
      message:
        "Socratic correction is guided evidence, not independent evidence",
    });
  }
  if (
    value.dimension === "independence" &&
    typeof value.score === "number" &&
    isRecord(assistance) &&
    isAssistanceLevel(assistance.level) &&
    value.score > MAX_INDEPENDENCE_SCORE_BY_ASSISTANCE[assistance.level]
  ) {
    issues.push({
      path: "score",
      code: "assistance_conflict",
      message: `independence score exceeds the maximum for ${assistance.level} evidence`,
    });
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, claim: value as EvidenceClaim, issues: [] };
}

export function assertEvidenceClaim(
  value: unknown,
): asserts value is EvidenceClaim {
  const result = validateEvidenceClaim(value);
  if (!result.success) throw new EvidenceValidationError(result.issues);
}

export function recordEvidenceClaim(
  eventId: string,
  recordedAt: string,
  claim: EvidenceClaim,
): EvidenceLifecycleEvent {
  assertEvidenceClaim(claim);
  if (!nonEmpty(eventId) || !validIsoDate(recordedAt)) {
    throw new EvidenceLifecycleError(
      "record event requires an id and ISO timestamp",
    );
  }
  return { kind: "recorded", eventId, recordedAt, claim };
}

export function retractEvidenceClaim(
  eventId: string,
  recordedAt: string,
  claimId: string,
  reason: string,
): EvidenceLifecycleEvent {
  if (
    ![eventId, claimId, reason].every(nonEmpty) ||
    !validIsoDate(recordedAt)
  ) {
    throw new EvidenceLifecycleError(
      "retraction requires ids, reason, and ISO timestamp",
    );
  }
  return { kind: "retracted", eventId, recordedAt, claimId, reason };
}

export function supersedeEvidenceClaim(
  eventId: string,
  recordedAt: string,
  claimId: string,
  replacement: EvidenceClaim,
  reason: string,
): EvidenceLifecycleEvent {
  assertEvidenceClaim(replacement);
  if (
    ![eventId, claimId, reason].every(nonEmpty) ||
    !validIsoDate(recordedAt)
  ) {
    throw new EvidenceLifecycleError(
      "supersession requires ids, reason, and ISO timestamp",
    );
  }
  return {
    kind: "superseded",
    eventId,
    recordedAt,
    claimId,
    replacement,
    reason,
  };
}

export type EvidenceClaimLifecycleRecord = {
  claim: EvidenceClaim;
  status: "active" | "retracted" | "superseded";
  recordedEventId: string;
  terminalEventId?: string;
  terminalReason?: string;
  supersededBy?: string;
};

export type EvidenceReplay = {
  records: readonly EvidenceClaimLifecycleRecord[];
  activeClaims: readonly EvidenceClaim[];
};

function sameSupersessionIdentity(a: EvidenceClaim, b: EvidenceClaim): boolean {
  return (
    a.learnerId === b.learnerId &&
    a.target.id === b.target.id &&
    a.target.kind === b.target.kind &&
    a.task.id === b.task.id &&
    a.dimension === b.dimension
  );
}

/** Replay an append-only log; retraction and supersession never mutate history. */
export function replayEvidenceLifecycle(
  events: readonly EvidenceLifecycleEvent[],
): EvidenceReplay {
  const eventIds = new Set<string>();
  const records = new Map<string, EvidenceClaimLifecycleRecord>();
  const order: string[] = [];

  for (const event of events) {
    if (!nonEmpty(event.eventId) || !validIsoDate(event.recordedAt)) {
      throw new EvidenceLifecycleError(
        "every lifecycle event needs an id and ISO timestamp",
      );
    }
    if (eventIds.has(event.eventId)) {
      throw new EvidenceLifecycleError(
        `duplicate evidence event id: ${event.eventId}`,
      );
    }
    eventIds.add(event.eventId);

    if (event.kind === "recorded") {
      assertEvidenceClaim(event.claim);
      if (records.has(event.claim.id)) {
        throw new EvidenceLifecycleError(
          `duplicate evidence claim id: ${event.claim.id}`,
        );
      }
      records.set(event.claim.id, {
        claim: event.claim,
        status: "active",
        recordedEventId: event.eventId,
      });
      order.push(event.claim.id);
      continue;
    }

    const current = records.get(event.claimId);
    if (!current) {
      throw new EvidenceLifecycleError(
        `unknown evidence claim: ${event.claimId}`,
      );
    }
    if (current.status !== "active") {
      throw new EvidenceLifecycleError(
        `evidence claim ${event.claimId} is already ${current.status}`,
      );
    }
    if (!nonEmpty(event.reason)) {
      throw new EvidenceLifecycleError(`${event.kind} event requires a reason`);
    }

    if (event.kind === "retracted") {
      records.set(event.claimId, {
        ...current,
        status: "retracted",
        terminalEventId: event.eventId,
        terminalReason: event.reason,
      });
      continue;
    }

    assertEvidenceClaim(event.replacement);
    if (records.has(event.replacement.id)) {
      throw new EvidenceLifecycleError(
        `replacement claim id already exists: ${event.replacement.id}`,
      );
    }
    if (!sameSupersessionIdentity(current.claim, event.replacement)) {
      throw new EvidenceLifecycleError(
        "supersession must preserve learner, target, task, and dimension identity",
      );
    }
    records.set(event.claimId, {
      ...current,
      status: "superseded",
      terminalEventId: event.eventId,
      terminalReason: event.reason,
      supersededBy: event.replacement.id,
    });
    records.set(event.replacement.id, {
      claim: event.replacement,
      status: "active",
      recordedEventId: event.eventId,
    });
    order.push(event.replacement.id);
  }

  const ordered = order.map((claimId) => records.get(claimId)!);
  return {
    records: ordered,
    activeClaims: ordered
      .filter((record) => record.status === "active")
      .map((record) => record.claim),
  };
}
