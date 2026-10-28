import type {
  ProjectArtifactVersionRef,
  ProjectAttemptAssistanceLevel,
  ProjectAssistanceTraceEntry,
  ProjectProcessLogEntry,
} from "./project-attempt.js";

/**
 * Closed project checks that can inspect only the persisted learner attempt.
 * These are structural observations, not claims about correctness or mastery.
 */
export type PortableProjectDeterministicRule =
  | {
      type: "artifact_present";
      deliverableKey: string;
      minVersions?: number;
    }
  | {
      type: "process_verification";
      deliverableKey?: string;
      minEntries?: number;
    }
  | {
      type: "assistance_ceiling";
      maxLevel: ProjectAttemptAssistanceLevel;
      maxEvents?: number;
    };

export class ProjectDeterministicRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDeterministicRuleValidationError";
  }
}

export type PortableProjectDeterministicEvaluation = {
  passed: boolean;
  score: 0 | 1;
  rule: PortableProjectDeterministicRule;
  observed: Record<string, unknown>;
};

const ASSISTANCE_ORDER: Record<ProjectAttemptAssistanceLevel, number> = {
  independent: 0,
  light_hint: 1,
  guided: 2,
  worked_example: 3,
  answer_revealed: 4,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validKey(value: unknown): value is string {
  return nonEmpty(value) && /^[a-z0-9][a-z0-9:_-]{1,127}$/i.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isAssistanceLevel(
  value: unknown,
): value is ProjectAttemptAssistanceLevel {
  return (
    value === "independent" ||
    value === "light_hint" ||
    value === "guided" ||
    value === "worked_example" ||
    value === "answer_revealed"
  );
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[]) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new ProjectDeterministicRuleValidationError(
      `deterministic rule contains undeclared fields: ${extras.join(", ")}`,
    );
  }
}

/** Parse the closed rule contract used by hosted and desktop-local adapters. */
export function parsePortableProjectDeterministicRule(
  value: unknown,
): PortableProjectDeterministicRule {
  if (!isRecord(value) || !nonEmpty(value.type)) {
    throw new ProjectDeterministicRuleValidationError(
      "deterministic rule must declare a supported type",
    );
  }
  if (value.type === "artifact_present") {
    assertExactKeys(value, ["type", "deliverableKey", "minVersions"]);
    if (
      !validKey(value.deliverableKey) ||
      (value.minVersions !== undefined && !positiveInteger(value.minVersions))
    ) {
      throw new ProjectDeterministicRuleValidationError(
        "artifact_present requires a deliverable key and positive minVersions",
      );
    }
    return value as PortableProjectDeterministicRule;
  }
  if (value.type === "process_verification") {
    assertExactKeys(value, ["type", "deliverableKey", "minEntries"]);
    if (
      (value.deliverableKey !== undefined && !validKey(value.deliverableKey)) ||
      (value.minEntries !== undefined && !positiveInteger(value.minEntries))
    ) {
      throw new ProjectDeterministicRuleValidationError(
        "process_verification has an invalid deliverable key or minEntries",
      );
    }
    return value as PortableProjectDeterministicRule;
  }
  if (value.type === "assistance_ceiling") {
    assertExactKeys(value, ["type", "maxLevel", "maxEvents"]);
    if (
      !isAssistanceLevel(value.maxLevel) ||
      (value.maxEvents !== undefined && !nonNegativeInteger(value.maxEvents))
    ) {
      throw new ProjectDeterministicRuleValidationError(
        "assistance_ceiling requires a valid maxLevel and non-negative maxEvents",
      );
    }
    return value as PortableProjectDeterministicRule;
  }
  throw new ProjectDeterministicRuleValidationError(
    `unsupported deterministic rule ${value.type}`,
  );
}

function artifactRefKey(
  artifact: Pick<ProjectArtifactVersionRef, "artifactId" | "version">,
) {
  return `${artifact.artifactId}@${artifact.version}`;
}

/**
 * Evaluate one closed rule. The result is deliberately only an observable
 * structural outcome; callers decide whether a trusted evaluator may turn it
 * into evidence. Learner-authored data never supplies cognition bindings.
 */
export function evaluatePortableProjectDeterministicRule(input: {
  rule: PortableProjectDeterministicRule;
  artifactVersionRefs: readonly ProjectArtifactVersionRef[];
  processLog: readonly ProjectProcessLogEntry[];
  assistanceTrace: readonly ProjectAssistanceTraceEntry[];
}): PortableProjectDeterministicEvaluation {
  const rule = parsePortableProjectDeterministicRule(input.rule);
  if (rule.type === "artifact_present") {
    const versions = new Set(
      input.artifactVersionRefs
        .filter((artifact) => artifact.deliverableKey === rule.deliverableKey)
        .map(artifactRefKey),
    );
    const minimum = rule.minVersions ?? 1;
    const passed = versions.size >= minimum;
    return {
      passed,
      score: passed ? 1 : 0,
      rule,
      observed: {
        deliverableKey: rule.deliverableKey,
        versionCount: versions.size,
        minimum,
      },
    };
  }

  if (rule.type === "process_verification") {
    const artifactDeliverable = new Map(
      input.artifactVersionRefs.map((artifact) => [
        artifactRefKey(artifact),
        artifact.deliverableKey,
      ]),
    );
    const verificationEntries = input.processLog.filter((entry) => {
      if (entry.kind !== "verification") return false;
      if (!rule.deliverableKey) return true;
      return (entry.artifactVersionRefs ?? []).some(
        (ref) => artifactDeliverable.get(ref) === rule.deliverableKey,
      );
    });
    const minimum = rule.minEntries ?? 1;
    const passed = verificationEntries.length >= minimum;
    return {
      passed,
      score: passed ? 1 : 0,
      rule,
      observed: {
        ...(rule.deliverableKey ? { deliverableKey: rule.deliverableKey } : {}),
        verificationEntryCount: verificationEntries.length,
        minimum,
        artifactReferenceConvention: "artifactId@version",
      },
    };
  }

  const highestLevel = input.assistanceTrace.reduce<ProjectAttemptAssistanceLevel>(
    (highest, entry) =>
      ASSISTANCE_ORDER[entry.level] > ASSISTANCE_ORDER[highest]
        ? entry.level
        : highest,
    "independent",
  );
  const withinLevel =
    ASSISTANCE_ORDER[highestLevel] <= ASSISTANCE_ORDER[rule.maxLevel];
  const withinCount =
    rule.maxEvents === undefined ||
    input.assistanceTrace.length <= rule.maxEvents;
  const passed = withinLevel && withinCount;
  return {
    passed,
    score: passed ? 1 : 0,
    rule,
    observed: {
      highestLevel,
      eventCount: input.assistanceTrace.length,
      maxLevel: rule.maxLevel,
      ...(rule.maxEvents === undefined ? {} : { maxEvents: rule.maxEvents }),
    },
  };
}
