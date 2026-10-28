import type { components, operations } from "@xue-learn/core/api/types";

export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type ProjectMilestoneSummary =
  components["schemas"]["ProjectMilestoneSummary"];
export type ProjectDetail =
  components["schemas"]["ProjectDetailResponse"]["project"];
export type ProjectMilestoneDetail =
  components["schemas"]["ProjectMilestoneDetail"];
export type ProjectAttempt = components["schemas"]["ProjectAttempt"];
export type ProjectAttemptSummary =
  components["schemas"]["ProjectAttemptSummary"];
export type ProjectArtifactVersionRef =
  components["schemas"]["ProjectArtifactVersionRef"];
export type ProjectProcessLogEntry =
  components["schemas"]["ProjectProcessLogEntry"];
export type ProjectAssistanceTraceEntry =
  components["schemas"]["ProjectAssistanceTraceEntry"];
export type ProjectMilestoneAttemptRequest =
  components["schemas"]["ProjectMilestoneAttemptRequest"];
export type ProjectAttemptResponse =
  components["schemas"]["ProjectAttemptResponse"];
export type ProjectListResponse =
  operations["listGoalProjects"]["responses"][200]["content"]["application/json"];
export type ProjectDetailResponse =
  operations["getProjectDetail"]["responses"][200]["content"]["application/json"];

export type ProjectArtifactDraft = {
  artifactId: string;
  deliverableKey: string;
  version: number | string;
  createdAt?: string;
  uri?: string;
  checksum?: string;
  mediaType?: string;
};

export type ProjectProcessDraft = {
  occurredAt?: string;
  kind: ProjectProcessLogEntry["kind"];
  summary: string;
  artifactVersionRefs?: string[];
};

export type ProjectAssistanceDraft = {
  occurredAt?: string;
  source: ProjectAssistanceTraceEntry["source"];
  kind: ProjectAssistanceTraceEntry["kind"];
  level: ProjectAssistanceTraceEntry["level"];
  contentRef?: string;
};

export type ProjectMilestoneSubmissionDraft = {
  idempotencyKey: string;
  artifacts: ProjectArtifactDraft[];
  process: ProjectProcessDraft[];
  assistance: ProjectAssistanceDraft[];
  durationMs?: number;
};

export class ProjectSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectSubmissionError";
  }
}

export function projectArtifactVersionRef(artifactId: string, version: number) {
  return `${artifactId}@${version}`;
}

const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,127}$/;
const CHECKSUM_PATTERN = /^[a-fA-F0-9]{64}$/;
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

function assertionKeyTokens(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isReservedLearnerAssertionKey(key: string) {
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

function assertLearnerFactsOnly(value: unknown, path = "submission") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertLearnerFactsOnly(item, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (isReservedLearnerAssertionKey(key)) {
      throw new ProjectSubmissionError(
        `${path}.${key} 是服务端评估字段，学习者提交中不能包含`,
      );
    }
    assertLearnerFactsOnly(nested, `${path}.${key}`);
  }
}

function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  path: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectSubmissionError(`${path}格式无效`);
  }
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (extra) {
    throw new ProjectSubmissionError(`${path}.${extra}不是允许的提交字段`);
  }
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectSubmissionError(`${label}不能为空`);
  }
  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoDate(value: unknown, fallback: string, label: string) {
  const candidate = optionalText(value) ?? fallback;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    throw new ProjectSubmissionError(`${label}不是有效时间`);
  }
  return date.toISOString();
}

export function buildProjectMilestoneAttemptRequest(
  draft: ProjectMilestoneSubmissionDraft,
  options?: { now?: () => Date },
): ProjectMilestoneAttemptRequest {
  assertLearnerFactsOnly(draft);
  assertExactKeys(
    draft,
    ["idempotencyKey", "artifacts", "process", "assistance", "durationMs"],
    "submission",
  );
  if (
    !Array.isArray(draft.artifacts) ||
    !Array.isArray(draft.process) ||
    !Array.isArray(draft.assistance)
  ) {
    throw new ProjectSubmissionError("作品、过程和帮助记录必须是列表");
  }
  draft.artifacts.forEach((artifact, index) =>
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
      `submission.artifacts[${index}]`,
    ),
  );
  draft.process.forEach((entry, index) =>
    assertExactKeys(
      entry,
      ["occurredAt", "kind", "summary", "artifactVersionRefs"],
      `submission.process[${index}]`,
    ),
  );
  draft.assistance.forEach((entry, index) =>
    assertExactKeys(
      entry,
      ["occurredAt", "source", "kind", "level", "contentRef"],
      `submission.assistance[${index}]`,
    ),
  );
  const now = (options?.now ?? (() => new Date()))().toISOString();
  const idempotencyKey = requiredText(draft.idempotencyKey, "提交标识");
  const knownArtifactVersionRefs = new Set<string>();

  const artifactVersionRefs = draft.artifacts.map((artifact, index) => {
    const artifactId = requiredText(
      artifact.artifactId,
      `第 ${index + 1} 个作品编号`,
    );
    const deliverableKey = requiredText(
      artifact.deliverableKey,
      `第 ${index + 1} 个交付项标识`,
    );
    if (!REFERENCE_PATTERN.test(artifactId)) {
      throw new ProjectSubmissionError(
        `第 ${index + 1} 个作品编号只能使用字母、数字、冒号、下划线或短横线`,
      );
    }
    if (!REFERENCE_PATTERN.test(deliverableKey)) {
      throw new ProjectSubmissionError(`第 ${index + 1} 个交付项标识格式无效`);
    }
    const version = Number(artifact.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new ProjectSubmissionError(
        `第 ${index + 1} 个作品版本必须是大于 0 的整数`,
      );
    }
    const artifactVersionRef = projectArtifactVersionRef(artifactId, version);
    if (knownArtifactVersionRefs.has(artifactVersionRef)) {
      throw new ProjectSubmissionError(
        `第 ${index + 1} 个作品版本与前面的记录重复`,
      );
    }
    knownArtifactVersionRefs.add(artifactVersionRef);
    const checksum = optionalText(artifact.checksum);
    if (checksum && !CHECKSUM_PATTERN.test(checksum)) {
      throw new ProjectSubmissionError(
        `第 ${index + 1} 个作品校验值必须是 64 位十六进制文本`,
      );
    }
    return {
      artifactId,
      deliverableKey,
      version,
      createdAt: isoDate(
        artifact.createdAt,
        now,
        `第 ${index + 1} 个作品创建时间`,
      ),
      ...(optionalText(artifact.uri)
        ? { uri: optionalText(artifact.uri) }
        : {}),
      ...(checksum ? { checksum } : {}),
      ...(optionalText(artifact.mediaType)
        ? { mediaType: optionalText(artifact.mediaType) }
        : {}),
    } satisfies ProjectArtifactVersionRef;
  });

  if (!draft.process.length) {
    throw new ProjectSubmissionError("请至少记录一条完成过程");
  }
  const processLog = draft.process.map((entry, index) => {
    const referencedArtifacts = Array.from(
      new Set(
        (entry.artifactVersionRefs ?? [])
          .map((value) => optionalText(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const unknownReference = referencedArtifacts.find(
      (reference) => !knownArtifactVersionRefs.has(reference),
    );
    if (unknownReference) {
      throw new ProjectSubmissionError(
        `第 ${index + 1} 条过程引用了未提交的作品版本 ${unknownReference}`,
      );
    }
    return {
      sequence: index + 1,
      occurredAt: isoDate(entry.occurredAt, now, `第 ${index + 1} 条过程时间`),
      kind: entry.kind,
      summary: requiredText(entry.summary, `第 ${index + 1} 条过程说明`),
      ...(referencedArtifacts.length
        ? { artifactVersionRefs: referencedArtifacts }
        : {}),
    } satisfies ProjectProcessLogEntry;
  });

  const assistanceTrace = draft.assistance.map((entry, index) => ({
    sequence: index + 1,
    occurredAt: isoDate(entry.occurredAt, now, `第 ${index + 1} 条帮助时间`),
    source: entry.source,
    kind: entry.kind,
    level: entry.level,
    ...(optionalText(entry.contentRef)
      ? { contentRef: optionalText(entry.contentRef) }
      : {}),
  })) satisfies ProjectAssistanceTraceEntry[];

  const durationMs = draft.durationMs;
  if (
    durationMs !== undefined &&
    (!Number.isInteger(durationMs) || durationMs < 1)
  ) {
    throw new ProjectSubmissionError("用时必须是大于 0 的整数毫秒数");
  }

  return {
    idempotencyKey,
    artifactVersionRefs,
    processLog,
    assistanceTrace,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

type DefinitionRecord = Record<string, unknown>;

function definitionText(
  definition: DefinitionRecord,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = definition[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function projectDefinitionKey(
  definition: DefinitionRecord,
  index: number,
) {
  const proposed =
    definitionText(definition, [
      "deliverableKey",
      "constraintKey",
      "stableKey",
      "key",
      "id",
    ]) ?? `deliverable_${index + 1}`;
  const normalized = proposed
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
  return REFERENCE_PATTERN.test(normalized)
    ? normalized
    : `deliverable_${index + 1}`;
}

export function projectDefinitionLabel(
  definition: DefinitionRecord,
  index: number,
  fallback = "交付项",
) {
  return (
    definitionText(definition, ["title", "label", "name"]) ??
    `${fallback} ${index + 1}`
  );
}

export function projectDefinitionDescription(definition: DefinitionRecord) {
  return definitionText(definition, [
    "description",
    "instructions",
    "summary",
    "criterion",
    "value",
  ]);
}

export function projectAttemptStatusLabel(
  status: ProjectAttemptSummary["status"] | undefined,
) {
  switch (status) {
    case "started":
      return "进行中";
    case "submitted":
      return "已提交，等待评估";
    case "evaluated":
      return "已完成评估";
    case "abandoned":
      return "已放弃";
    default:
      return "尚未开始";
  }
}

export function createProjectSubmissionIdempotencyKey(
  projectId: string,
  milestoneId: string,
) {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `project:${projectId}:${milestoneId}:${nonce}`;
}
