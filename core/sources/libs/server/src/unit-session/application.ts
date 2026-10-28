export type MaterialReadingGate = {
  requiredSectionIds: string[];
  completedSectionIds: string[];
  hasMaterial: boolean;
  missingCheckIds: string[];
  scenarioTheaterOffered: boolean;
};

export type UnitSessionApplicationPort = {
  loadMaterialReadingGate(input: {
    userId: string;
    unitId: string;
  }): Promise<MaterialReadingGate>;
  setStructuredSubStep(input: {
    userId: string;
    unitId: string;
    structuredSubStep: "questions";
  }): Promise<void>;
};

export type SessionSectionStatus =
  "available" | "in_progress" | "completed" | "skipped";

export type SessionSectionProjection = {
  id: string;
  status: SessionSectionStatus;
};

/**
 * Stable, persistence-independent fields shared by GET /session adapters.
 *
 * Hosted PostgreSQL and desktop-local SQLite intentionally keep their
 * database-specific envelopes (quiz attempts, persona context, memory
 * palace, etc.) outside this projection.  The learner shell only needs this
 * deterministic progression spine to render the same navigation state.
 */
export type UnitSessionProgressProjection<
  TSection extends SessionSectionProjection = SessionSectionProjection,
> = {
  currentStep: string;
  structuredSubStep: string;
  unitStatus: string;
  isLearningDone: boolean;
  contentRevision: number;
  sections: TSection[];
  currentSectionId: string | null;
};

export function projectUnitSessionProgress<
  TSection extends SessionSectionProjection,
>(input: {
  currentStep: string;
  structuredSubStep: string;
  unitStatus: string;
  isLearningDone: boolean;
  contentRevision: number;
  sections: readonly TSection[];
}): UnitSessionProgressProjection<TSection> {
  const sections = [...input.sections];
  const currentSection = sections.find(
    (section) => section.status !== "completed" && section.status !== "skipped",
  );
  return {
    currentStep: input.currentStep,
    structuredSubStep: input.structuredSubStep,
    unitStatus: input.unitStatus,
    isLearningDone: input.isLearningDone,
    contentRevision: input.contentRevision,
    sections,
    currentSectionId: currentSection?.id ?? sections.at(-1)?.id ?? null,
  };
}

/**
 * Normalize the optional `revision` query used by both unit content routes.
 * Invalid/empty query values retain the hosted controller's compatibility
 * behavior: they mean "read the latest" rather than inventing a revision.
 */
export function normalizeUnitContentRevision(
  value: unknown,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const revision = typeof value === "number" ? value : Number(value);
  return Number.isFinite(revision) ? revision : undefined;
}

/**
 * Database-independent revision guard shared by hosted PostgreSQL and local
 * SQLite content adapters.  HTTP adapters keep ownership of localized error
 * messages and status codes; this helper only answers the authoritative
 * version question.
 */
export function unitContentRevisionMatches(input: {
  requestedRevision?: number;
  contentRevision: number;
}): boolean {
  return (
    input.requestedRevision === undefined ||
    input.requestedRevision === input.contentRevision
  );
}

/** Resolve the current navigation step used by the shared unit page. */
export function resolveUnitPageCurrentStep(input: {
  unitStatus: string;
  persistedCurrentStep?: unknown;
}): string {
  if (input.unitStatus === "completed") return "complete";
  return typeof input.persistedCurrentStep === "string" &&
    input.persistedCurrentStep.trim()
    ? input.persistedCurrentStep
    : "structured_input";
}

export type UnitSessionStreamCommand = {
  action: string;
  payload: Record<string, unknown>;
  runId?: string;
};

/**
 * Normalize the transport envelope shared by hosted and local session SSE.
 * Capability-specific action allowlists remain in each adapter; this helper
 * only makes malformed/legacy envelopes deterministic and keeps top-level
 * payload compatibility identical across transports.
 */
export function normalizeUnitSessionStreamCommand(
  body: Record<string, unknown>,
): UnitSessionStreamCommand {
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const runId =
    typeof body.runId === "string" && body.runId.trim()
      ? body.runId.trim()
      : undefined;
  const explicitPayload = body.payload;
  const payload =
    explicitPayload &&
    typeof explicitPayload === "object" &&
    !Array.isArray(explicitPayload)
      ? (explicitPayload as Record<string, unknown>)
      : Object.fromEntries(
          Object.entries(body).filter(
            ([key]) => key !== "action" && key !== "runId" && key !== "payload",
          ),
        );
  return { action, payload, ...(runId ? { runId } : {}) };
}

export type UnitSessionLearningAccess = {
  modelPhase:
    "pending" | "building" | "targets_ready" | "ready" | "failed" | "stale";
  contentMode: "none" | "draft" | "canonical";
  assessmentMode: "locked" | "ready";
  lockReason?: "model_building" | "model_failed" | "model_stale";
  activeRunId?: string;
  inputHash?: string;
  prefixHash?: string;
};

/** Keep reconnectable stream access events tied to the durable generation run. */
export function withUnitSessionActiveRun(
  access: UnitSessionLearningAccess,
  runId?: string,
): UnitSessionLearningAccess {
  const normalizedRunId = typeof runId === "string" ? runId.trim() : "";
  return normalizedRunId ? { ...access, activeRunId: normalizedRunId } : access;
}

export type SessionTouchPayload = {
  tab?: string;
  slideIndex?: number;
  hasCompletedSlides?: boolean;
  sectionSteps?: Record<string, number>;
  activeSeconds?: number;
  sectionId?: string;
  sectionContentRevision?: number;
  sectionCursor?: number;
  timeFlush?: boolean;
};

export type SectionMiniTestAnswer = number | number[] | boolean;
export type SectionMiniTestAnswers = Record<string, SectionMiniTestAnswer>;

export type UnitSessionProgressionPort<
  TSession = unknown,
  TSection extends SessionSectionProjection = SessionSectionProjection,
  TMiniTestResult = unknown,
> = {
  openSession(input: { userId: string; unitId: string }): Promise<TSession>;
  touchActivity(input: {
    userId: string;
    unitId: string;
    payload: SessionTouchPayload;
  }): Promise<{
    totalActiveSeconds: number;
    acceptedActiveSeconds: number;
  }>;
  completeSection(input: {
    userId: string;
    unitId: string;
    sectionId: string;
    skip: boolean;
  }): Promise<void>;
  listSections(input: { userId: string; unitId: string }): Promise<TSection[]>;
  setStep(input: {
    userId: string;
    unitId: string;
    step: string;
    structuredSubStep?: "done";
  }): Promise<void>;
  submitSectionMiniTest(input: {
    userId: string;
    unitId: string;
    sectionId: string;
    answers: SectionMiniTestAnswers;
  }): Promise<TMiniTestResult>;
};

export type UnitSessionProgressionErrorCode =
  | "section_id_required"
  | "unit_learning_required"
  | "invalid_step"
  | "feynman_unavailable"
  | "section_quiz_invalid"
  | "section_quiz_answers_only"
  | "all_answers_required"
  | "invalid_answer_format";

export type FeynmanEligibility =
  "available" | "feature_disabled" | "exploration_unsupported";

/**
 * Shared policy boundary for the optional Feynman evidence step.  Hosted and
 * local adapters map their own goal-kind enums into the boolean input, while
 * this function keeps feature gating and exploration exclusion identical.
 */
export function feynmanEligibility(input: {
  featureEnabled: boolean;
  exploration: boolean;
}): FeynmanEligibility {
  if (!input.featureEnabled) return "feature_disabled";
  if (input.exploration) return "exploration_unsupported";
  return "available";
}

export class UnitSessionProgressionError extends Error {
  constructor(readonly code: UnitSessionProgressionErrorCode) {
    super(code);
  }
}

export type UnitSessionProgressionCommand =
  | { action: "open" }
  | { action: "touch_activity"; payload?: Record<string, unknown> }
  | {
      action: "complete_section" | "skip_section";
      payload?: Record<string, unknown>;
    }
  | {
      action: "set_step";
      payload?: Record<string, unknown>;
      gate: {
        isLearningDone: boolean;
        feynmanEnabled?: boolean;
      };
    }
  | {
      action: "submit_section_mini_test";
      payload?: Record<string, unknown>;
    };

export function openUnitSession<TSession>(
  port: Pick<UnitSessionProgressionPort<TSession>, "openSession">,
  input: { userId: string; unitId: string },
) {
  return port.openSession(input);
}

const SESSION_NAV_STEPS = new Set([
  "structured_input",
  "active_recall",
  "feynman",
  "socratic",
  "complete",
]);

export function normalizeSessionTouchPayload(
  payload?: Record<string, unknown>,
): SessionTouchPayload {
  return {
    tab: typeof payload?.tab === "string" ? payload.tab : undefined,
    slideIndex:
      typeof payload?.slideIndex === "number" ? payload.slideIndex : undefined,
    hasCompletedSlides:
      typeof payload?.hasCompletedSlides === "boolean"
        ? payload.hasCompletedSlides
        : undefined,
    sectionSteps:
      payload?.sectionSteps &&
      typeof payload.sectionSteps === "object" &&
      !Array.isArray(payload.sectionSteps)
        ? Object.fromEntries(
            Object.entries(payload.sectionSteps as Record<string, unknown>)
              .filter(
                ([key, value]) =>
                  /^\d+$/.test(key) &&
                  typeof value === "number" &&
                  Number.isFinite(value) &&
                  value >= 0,
              )
              .map(([key, value]) => [key, Math.floor(value as number)]),
          )
        : undefined,
    activeSeconds:
      typeof payload?.activeSeconds === "number"
        ? payload.activeSeconds
        : undefined,
    sectionId:
      typeof payload?.sectionId === "string" ? payload.sectionId : undefined,
    sectionContentRevision:
      typeof payload?.sectionContentRevision === "number"
        ? payload.sectionContentRevision
        : undefined,
    sectionCursor:
      typeof payload?.sectionCursor === "number"
        ? payload.sectionCursor
        : undefined,
    timeFlush:
      typeof payload?.timeFlush === "boolean" ? payload.timeFlush : undefined,
  };
}

export function parseSectionMiniTestSubmission(
  payload?: Record<string, unknown>,
): { sectionId: string; answers: SectionMiniTestAnswers } {
  const sectionId =
    typeof payload?.sectionId === "string" ? payload.sectionId.trim() : "";
  if (!sectionId) {
    throw new UnitSessionProgressionError("section_quiz_invalid");
  }
  if (!sectionId.startsWith("mini-test:")) {
    throw new UnitSessionProgressionError("section_quiz_answers_only");
  }
  const rawAnswers = payload?.answers;
  if (
    !rawAnswers ||
    typeof rawAnswers !== "object" ||
    Array.isArray(rawAnswers)
  ) {
    throw new UnitSessionProgressionError("all_answers_required");
  }
  const answers: SectionMiniTestAnswers = {};
  for (const [checkId, value] of Object.entries(
    rawAnswers as Record<string, unknown>,
  )) {
    if (!checkId.trim()) continue;
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) && value.every((item) => Number.isInteger(item)))
    ) {
      answers[checkId] = value as SectionMiniTestAnswer;
      continue;
    }
    throw new UnitSessionProgressionError("invalid_answer_format");
  }
  return { sectionId, answers };
}

/**
 * Portable dispatcher for deterministic, already-authored unit-session
 * progression. Authoring/generation remains outside this boundary; database
 * adapters own persistence while this function owns payload and transition
 * semantics.
 */
export async function dispatchUnitSessionProgressionCommand<
  TSession,
  TSection extends SessionSectionProjection,
  TMiniTestResult,
>(
  port: UnitSessionProgressionPort<TSession, TSection, TMiniTestResult>,
  input: { userId: string; unitId: string },
  command: UnitSessionProgressionCommand,
): Promise<
  | TSession
  | { ok: true; totalActiveSeconds: number; acceptedActiveSeconds: number }
  | { sections: TSection[]; currentSectionId: string | null }
  | { currentStep: string }
  | TMiniTestResult
> {
  switch (command.action) {
    case "open":
      return openUnitSession(port, input);
    case "touch_activity": {
      const result = await port.touchActivity({
        ...input,
        payload: normalizeSessionTouchPayload(command.payload),
      });
      return { ok: true, ...result };
    }
    case "complete_section":
    case "skip_section": {
      const sectionId = String(command.payload?.sectionId ?? "");
      if (!sectionId) {
        throw new UnitSessionProgressionError("section_id_required");
      }
      await port.completeSection({
        ...input,
        sectionId,
        skip: command.action === "skip_section",
      });
      const sections = await port.listSections(input);
      return {
        sections,
        currentSectionId:
          sections.find(
            (section) =>
              section.status !== "completed" && section.status !== "skipped",
          )?.id ?? null,
      };
    }
    case "set_step": {
      if (!command.gate.isLearningDone) {
        throw new UnitSessionProgressionError("unit_learning_required");
      }
      const step = String(command.payload?.step ?? "");
      if (!SESSION_NAV_STEPS.has(step)) {
        throw new UnitSessionProgressionError("invalid_step");
      }
      if (step === "feynman" && command.gate.feynmanEnabled !== true) {
        throw new UnitSessionProgressionError("feynman_unavailable");
      }
      await port.setStep({
        ...input,
        step,
        ...(step === "structured_input"
          ? { structuredSubStep: "done" as const }
          : {}),
      });
      return { currentStep: step };
    }
    case "submit_section_mini_test": {
      const submission = parseSectionMiniTestSubmission(command.payload);
      return port.submitSectionMiniTest({ ...input, ...submission });
    }
  }
}

export type MaterialReadingConflict =
  "unit_sections_required" | "material_required" | "material_checks_required";

export class MaterialReadingTransitionError extends Error {
  constructor(
    readonly code: MaterialReadingConflict,
    readonly details: { missingCheckIds?: string[] } = {},
  ) {
    super(code);
  }
}

export type UnitSessionAssessmentGateOptions = {
  /**
   * Standalone micro/exploration lessons do not use the hosted sequential
   * section-completion gate.  Callers still pass the same facts so the
   * material/check policy remains shared.
   */
  requireSections?: boolean;
  requireMaterial?: boolean;
  requireChecks?: boolean;
};

/**
 * Validate the material-readiness facts required before an assessment can
 * start.  The hosted session POST and the local SQLite compatibility
 * controller both gather these facts from their database adapter; this
 * function owns the order and conflict codes so a different database cannot
 * accidentally make active recall available early.
 *
 * A nullable error is returned instead of throwing so HTTP adapters can keep
 * their existing localized status/message mapping.  `finishMaterialReading`
 * below throws the same error directly for its transition boundary.
 */
export function validateUnitSessionAssessmentGate(
  gate: Pick<
    MaterialReadingGate,
    | "requiredSectionIds"
    | "completedSectionIds"
    | "hasMaterial"
    | "missingCheckIds"
  >,
  options: UnitSessionAssessmentGateOptions = {},
): MaterialReadingTransitionError | null {
  const requireSections = options.requireSections !== false;
  const requireMaterial = options.requireMaterial !== false;
  const requireChecks = options.requireChecks !== false;

  if (
    requireSections &&
    gate.requiredSectionIds.some(
      (sectionId) => !new Set(gate.completedSectionIds).has(sectionId),
    )
  ) {
    return new MaterialReadingTransitionError("unit_sections_required");
  }
  if (requireMaterial && !gate.hasMaterial) {
    return new MaterialReadingTransitionError("material_required");
  }
  if (requireChecks && gate.missingCheckIds.length > 0) {
    return new MaterialReadingTransitionError("material_checks_required", {
      missingCheckIds: gate.missingCheckIds,
    });
  }
  return null;
}

export function assertUnitSessionAssessmentReady(
  gate: Pick<
    MaterialReadingGate,
    | "requiredSectionIds"
    | "completedSectionIds"
    | "hasMaterial"
    | "missingCheckIds"
  >,
  options?: UnitSessionAssessmentGateOptions,
) {
  const error = validateUnitSessionAssessmentGate(gate, options);
  if (error) throw error;
}

/**
 * Authoritative transition from lesson material to the guiding-question phase.
 * Persistence adapters supply facts and commit the state change; both hosted
 * PostgreSQL and desktop-local SQLite must execute this same rule.
 */
export async function finishMaterialReading(
  port: UnitSessionApplicationPort,
  input: { userId: string; unitId: string },
) {
  const gate = await port.loadMaterialReadingGate(input);
  assertUnitSessionAssessmentReady(gate);

  await port.setStructuredSubStep({
    ...input,
    structuredSubStep: "questions",
  });
  return {
    structuredSubStep: "questions" as const,
    scenarioTheaterOffered: gate.scenarioTheaterOffered,
  };
}
