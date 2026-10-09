import { createHash } from "node:crypto";
import type { EvidenceEvaluator, EvidenceSource } from "./types.js";

type JsonObject = Record<string, unknown>;

export type DeterministicMisconceptionPattern = {
  stableKey: string;
  title: string;
  description: string;
  errorSignature: JsonObject;
  remediationGuidance: JsonObject;
};

type Scalar = string | number | boolean;

function scalar(value: unknown): Scalar | null {
  if (typeof value === "string") {
    const normalized = value.normalize("NFC").trim();
    return normalized ? normalized.slice(0, 500) : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "boolean" ? value : null;
}

function canonical(value: JsonObject): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

const DETERMINISTIC_ERROR_SOURCES = new Set<EvidenceSource>([
  "quiz",
  "diagnostic",
  "review_quiz",
  "practice",
  "project",
]);

const OBSERVED_EXPECTED_PAIRS = [
  ["userAnswerLabel", "correctAnswerLabel"],
  ["selectedKey", "expectedKey"],
  ["observedValue", "expectedValue"],
  ["actual", "expected"],
] as const;

/**
 * Derives a catalog identity only from bounded, deterministic mismatch fields.
 * Free-form rationales, LLM output, learner-authored metadata, and state-like
 * assertions are intentionally ignored.
 */
export function deriveDeterministicMisconceptionPattern(input: {
  goalId: string;
  cognitiveEntityId: string;
  cognitiveEntityTitle: string;
  definitionVersion: number;
  criterionRef: string;
  source: EvidenceSource;
  evaluator: EvidenceEvaluator;
  score: number;
  rawResult?: JsonObject;
}): DeterministicMisconceptionPattern | null {
  if (
    input.evaluator !== "deterministic" ||
    !DETERMINISTIC_ERROR_SOURCES.has(input.source) ||
    input.score >= 0.5 ||
    !input.rawResult
  ) {
    return null;
  }

  let observed: Scalar | null = null;
  let expected: Scalar | null = null;
  let signatureKind = "";
  for (const [observedKey, expectedKey] of OBSERVED_EXPECTED_PAIRS) {
    const candidateObserved = scalar(input.rawResult[observedKey]);
    const candidateExpected = scalar(input.rawResult[expectedKey]);
    if (
      candidateObserved !== null &&
      candidateExpected !== null &&
      candidateObserved !== candidateExpected
    ) {
      observed = candidateObserved;
      expected = candidateExpected;
      signatureKind = `${observedKey}:${expectedKey}`;
      break;
    }
  }
  if (observed === null || expected === null) return null;

  const errorSignature = {
    criterionRef: input.criterionRef,
    source: input.source,
    signatureKind,
    observed,
    expected,
  } satisfies JsonObject;
  const digest = createHash("sha256")
    .update(
      canonical({
        goalId: input.goalId,
        cognitiveEntityId: input.cognitiveEntityId,
        definitionVersion: input.definitionVersion,
        ...errorSignature,
      }),
    )
    .digest("hex")
    .slice(0, 40);

  return {
    stableKey: `misconception:${digest}`,
    title: `${input.cognitiveEntityTitle} · ${input.criterionRef}`,
    description:
      "A deterministic task response repeatedly maps to the same incorrect alternative.",
    errorSignature,
    remediationGuidance: {
      strategy: "contrast_explain_retest",
      criterionRef: input.criterionRef,
    },
  };
}
