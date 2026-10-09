export const PROJECT_PROCESS_KINDS = [
  "decision",
  "action",
  "verification",
  "revision",
  "note",
] as const;

export const PROJECT_ASSISTANCE_KINDS = [
  "hint",
  "question",
  "example",
  "feedback",
  "answer",
] as const;

export type ProjectAttemptAssistanceLevel =
  | "independent"
  | "light_hint"
  | "guided"
  | "worked_example"
  | "answer_revealed";

export type PortableProjectDeliverable = {
  key: string;
  required: boolean;
};

export type ProjectArtifactVersionRef = {
  artifactId: string;
  deliverableKey: string;
  version: number;
  createdAt: string;
  uri?: string;
  checksum?: string;
  mediaType?: string;
};

export type ProjectProcessLogEntry = {
  sequence: number;
  occurredAt: string;
  kind: (typeof PROJECT_PROCESS_KINDS)[number];
  summary: string;
  artifactVersionRefs?: readonly string[];
  metadata?: Record<string, unknown>;
};

export type ProjectAssistanceTraceEntry = {
  sequence: number;
  occurredAt: string;
  source: "ai" | "human" | "system";
  kind: (typeof PROJECT_ASSISTANCE_KINDS)[number];
  level: ProjectAttemptAssistanceLevel;
  contentRef?: string;
};

export type PortableProjectAttemptPayload = {
  artifactVersionRefs: readonly ProjectArtifactVersionRef[];
  processLog: readonly ProjectProcessLogEntry[];
  assistanceTrace: readonly ProjectAssistanceTraceEntry[];
  response?: Record<string, unknown>;
  durationMs?: number;
  status?: "started" | "submitted" | "evaluated" | "abandoned";
  startedAt?: Date;
  submittedAt?: Date;
  completedAt?: Date;
};

export type LearnerProjectAttemptSubmission = {
  idempotencyKey: string;
  artifactVersionRefs: readonly ProjectArtifactVersionRef[];
  processLog: readonly ProjectProcessLogEntry[];
  assistanceTrace: readonly ProjectAssistanceTraceEntry[];
  durationMs?: number;
};

export class ProjectAttemptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectAttemptValidationError";
  }
}

type JsonObject = Record<string, unknown>;

const ASSISTANCE_ORDER: Record<ProjectAttemptAssistanceLevel, number> = {
  independent: 0,
  light_hint: 1,
  guided: 2,
  worked_example: 3,
  answer_revealed: 4,
};

const RESERVED_LEARNER_ASSERTION_TOKENS = new Set([
  "entity",
  "target",
  "requirement",
  "dimension",
  "score",
  "outcome",
  "evidence",
  "claim",
  "estimate",
  "state",
  "mastery",
  "rubric",
  "evaluator",
  "reliability",
  "inference",
]);
const RESERVED_LEARNER_ASSERTION_PREFIXES = [
  "entity",
  "evidence",
  "mastery",
  "rubric",
  "evaluator",
  "inference",
] as const;
const RESERVED_LEARNER_ASSERTION_SUFFIXES = [
  "target",
  "requirement",
  "dimension",
  "score",
  "outcome",
  "claim",
  "estimate",
  "state",
  "reliability",
] as const;

function invalid(message: string): never {
  throw new ProjectAttemptValidationError(message);
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validKey(value: unknown): value is string {
  return nonEmpty(value) && /^[a-z0-9][a-z0-9:_-]{1,127}$/i.test(value);
}

function validIsoDate(value: unknown): value is string {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isAssistanceLevel(
  value: unknown,
): value is ProjectAttemptAssistanceLevel {
  return includes(
    [
      "independent",
      "light_hint",
      "guided",
      "worked_example",
      "answer_revealed",
    ] as const,
    value,
  );
}

function assertExactKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    invalid(`${path} contains undeclared fields: ${unexpected.join(", ")}`);
  }
}

function assertionKeyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isReservedLearnerAssertionKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return (
    assertionKeyTokens(key).some((token) =>
      RESERVED_LEARNER_ASSERTION_TOKENS.has(token),
    ) ||
    RESERVED_LEARNER_ASSERTION_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    ) ||
    RESERVED_LEARNER_ASSERTION_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix),
    )
  );
}

function assertNoReservedLearnerAssertions(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoReservedLearnerAssertions(item, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (isReservedLearnerAssertionKey(key)) {
      invalid(`${path} contains reserved learner assertion field ${key}`);
    }
    assertNoReservedLearnerAssertions(nested, `${path}.${key}`);
  }
}

/**
 * Portable learner boundary shared by hosted and desktop-local runtimes.
 * Learners cannot submit evaluator, evidence, state, or mastery assertions.
 */
export function parseLearnerProjectAttemptSubmission(
  value: unknown,
): LearnerProjectAttemptSubmission {
  if (!isRecord(value)) {
    invalid("project attempt submission must be an object");
  }
  assertExactKeys(
    value,
    [
      "idempotencyKey",
      "artifactVersionRefs",
      "processLog",
      "assistanceTrace",
      "durationMs",
    ],
    "project attempt submission",
  );
  if (
    !nonEmpty(value.idempotencyKey) ||
    !Array.isArray(value.artifactVersionRefs) ||
    !Array.isArray(value.processLog) ||
    !Array.isArray(value.assistanceTrace)
  ) {
    invalid(
      "project attempt submission requires identity, artifacts, process, and assistance traces",
    );
  }
  for (const [index, artifact] of value.artifactVersionRefs.entries()) {
    if (!isRecord(artifact)) {
      invalid(`artifactVersionRefs[${index}] must be an object`);
    }
    assertExactKeys(
      artifact,
      [
        "artifactId",
        "deliverableKey",
        "version",
        "createdAt",
        "uri",
        "checksum",
        "mediaType",
      ],
      `artifactVersionRefs[${index}]`,
    );
  }
  for (const [index, entry] of value.processLog.entries()) {
    if (!isRecord(entry)) invalid(`processLog[${index}] must be an object`);
    assertExactKeys(
      entry,
      [
        "sequence",
        "occurredAt",
        "kind",
        "summary",
        "artifactVersionRefs",
        "metadata",
      ],
      `processLog[${index}]`,
    );
    if (entry.metadata !== undefined) {
      assertNoReservedLearnerAssertions(
        entry.metadata,
        `processLog[${index}].metadata`,
      );
    }
  }
  for (const [index, entry] of value.assistanceTrace.entries()) {
    if (!isRecord(entry)) {
      invalid(`assistanceTrace[${index}] must be an object`);
    }
    assertExactKeys(
      entry,
      ["sequence", "occurredAt", "source", "kind", "level", "contentRef"],
      `assistanceTrace[${index}]`,
    );
  }
  return value as LearnerProjectAttemptSubmission;
}

function assistanceFromTrace(trace: readonly ProjectAssistanceTraceEntry[]) {
  let level: ProjectAttemptAssistanceLevel = "independent";
  let hintCount = 0;
  for (const entry of trace) {
    if (ASSISTANCE_ORDER[entry.level] > ASSISTANCE_ORDER[level]) {
      level = entry.level;
    }
    if (
      entry.kind === "hint" ||
      entry.level === "light_hint" ||
      entry.level === "guided"
    ) {
      hintCount += 1;
    }
  }
  return {
    level,
    hintCount,
    answerRevealed: level === "answer_revealed",
  };
}

/** Validates observable project-attempt structure, never learner-authored evidence. */
export function validateProjectAttemptPayload(
  payload: PortableProjectAttemptPayload,
  deliverables: readonly PortableProjectDeliverable[],
) {
  if (!isRecord(payload) || !Array.isArray(deliverables)) {
    invalid(
      "project attempt payload and deliverables must be structured values",
    );
  }
  const status = payload.status ?? "started";
  if (
    !["started", "submitted", "evaluated", "abandoned"].includes(status) ||
    !Array.isArray(payload.artifactVersionRefs) ||
    !Array.isArray(payload.processLog) ||
    !Array.isArray(payload.assistanceTrace) ||
    (payload.response !== undefined && !isRecord(payload.response)) ||
    (payload.durationMs !== undefined && !positiveInteger(payload.durationMs))
  ) {
    invalid("project attempt payload is malformed");
  }
  const deliverableByKey = new Map(
    deliverables.map((deliverable) => [deliverable.key, deliverable]),
  );
  const artifactKeys = new Set<string>();
  const coveredDeliverables = new Set<string>();
  for (const artifact of payload.artifactVersionRefs) {
    if (!isRecord(artifact)) invalid("artifact version must be an object");
    const key = `${artifact.artifactId}@${artifact.version}`;
    if (
      !validKey(artifact.artifactId) ||
      !validKey(artifact.deliverableKey) ||
      !deliverableByKey.has(artifact.deliverableKey) ||
      !positiveInteger(artifact.version) ||
      !validIsoDate(artifact.createdAt) ||
      (artifact.uri !== undefined && !nonEmpty(artifact.uri)) ||
      (artifact.checksum !== undefined &&
        (!nonEmpty(artifact.checksum) ||
          !/^[a-f0-9]{64}$/i.test(artifact.checksum))) ||
      (artifact.mediaType !== undefined && !nonEmpty(artifact.mediaType)) ||
      artifactKeys.has(key)
    ) {
      invalid(`artifact version ${key} is invalid, duplicated, or undeclared`);
    }
    artifactKeys.add(key);
    coveredDeliverables.add(artifact.deliverableKey);
  }
  if (
    (status === "submitted" || status === "evaluated") &&
    deliverables.some(
      (deliverable) =>
        deliverable.required && !coveredDeliverables.has(deliverable.key),
    )
  ) {
    invalid("submitted project attempt is missing a required deliverable");
  }
  if (
    (status === "submitted" || status === "evaluated") &&
    payload.processLog.length === 0
  ) {
    invalid("submitted project attempt requires a process log");
  }
  let previousProcessAt = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of payload.processLog.entries()) {
    if (!isRecord(entry)) invalid(`processLog[${index}] must be an object`);
    const occurredAt = validIsoDate(entry.occurredAt)
      ? Date.parse(entry.occurredAt)
      : Number.NaN;
    if (
      entry.sequence !== index + 1 ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousProcessAt ||
      !includes(PROJECT_PROCESS_KINDS, entry.kind) ||
      !nonEmpty(entry.summary) ||
      (entry.artifactVersionRefs !== undefined &&
        (!Array.isArray(entry.artifactVersionRefs) ||
          entry.artifactVersionRefs.some(
            (ref: unknown) => !nonEmpty(ref) || !artifactKeys.has(ref),
          ))) ||
      (entry.metadata !== undefined && !isRecord(entry.metadata))
    ) {
      invalid(
        `processLog[${index}] is invalid or references an unknown artifact version`,
      );
    }
    previousProcessAt = occurredAt;
  }
  let previousAssistanceAt = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of payload.assistanceTrace.entries()) {
    if (!isRecord(entry))
      invalid(`assistanceTrace[${index}] must be an object`);
    const occurredAt = validIsoDate(entry.occurredAt)
      ? Date.parse(entry.occurredAt)
      : Number.NaN;
    if (
      entry.sequence !== index + 1 ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousAssistanceAt ||
      (entry.source !== "ai" &&
        entry.source !== "human" &&
        entry.source !== "system") ||
      !includes(PROJECT_ASSISTANCE_KINDS, entry.kind) ||
      !isAssistanceLevel(entry.level) ||
      (entry.contentRef !== undefined && !nonEmpty(entry.contentRef))
    ) {
      invalid(`assistanceTrace[${index}] is invalid`);
    }
    previousAssistanceAt = occurredAt;
  }
  return {
    status,
    artifactKeys: [...artifactKeys],
    assistance: assistanceFromTrace(payload.assistanceTrace),
  };
}
