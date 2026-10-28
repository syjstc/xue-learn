import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { tBackend } from "../../../../../../common/src/index.js";
import type {
  AssessmentTargetRepository,
  LearnerStateMemoryInvalidationRepository,
  SocraticEvidenceRepository,
  UnitSessionStateRepository,
} from "../../../../../../domain/src/index.js";
import { parseSessionGraphState } from "../../../../graph/review-mode.js";
import {
  bootstrapSocraticThreadQuestion,
  ensureSocraticThreads,
  graphStateWithSocraticThreads,
  pickActiveSocraticThread,
  processSocraticTurn,
  replaceSocraticThread,
  socraticSessionPayload,
} from "../../../../graph/socratic-threads.js";
import { persistSocraticCorrection } from "../../../../unit-session/socratic-correction.js";
import type { SocraticCorrectionState } from "../../../../unit-session/socratic-correction.js";
import { generateDrills } from "../../../../graph/unit-session.js";

export async function bootstrapSocraticForSession(
  sessionState: UnitSessionStateRepository,
  userId: string,
  unitId: string,
  goalId: string,
  unitTitle: string,
  graphState: ReturnType<typeof parseSessionGraphState>,
  options?: {
    activeThreadId?: string;
    socraticTurn?: number;
    /** Generate the first assistant question for an empty active thread. */
    bootstrapQuestion?: boolean;
    stream?: {
      send: (
        event:
          | { type: "message"; delta: string; role?: "assistant" }
          | { type: "thinking" },
      ) => void | Promise<void>;
      signal?: AbortSignal;
    };
  },
) {
  const { threads: ensuredThreads, activeThreadId: defaultActiveId } =
    ensureSocraticThreads(graphState);
  const activeId = options?.activeThreadId ?? defaultActiveId;
  let threads = ensuredThreads;
  let activeThread = pickActiveSocraticThread(threads, activeId);
  if (!activeThread) {
    return socraticSessionPayload(threads, activeId);
  }

  if (
    options?.bootstrapQuestion &&
    activeThread.messages.length === 0 &&
    !activeThread.done
  ) {
    const boot = await bootstrapSocraticThreadQuestion({
      goalId,
      unitId,
      unitTitle,
      graphState,
      thread: activeThread,
      weakTags: graphState.weakTags ?? [],
      stream: options?.stream,
    });
    threads = replaceSocraticThread(threads, activeThread.id, boot.thread);
    activeThread = boot.thread;
  }

  const socraticTurn = Math.max(options?.socraticTurn ?? 0, activeThread.turn);
  await persistSocraticCorrection({
    graphState: graphState as SocraticCorrectionState,
    threads,
    activeThreadId: activeThread.id,
    socraticTurn,
    persistence: {
      saveSocraticCorrection: async (input) => {
        await sessionState.updateOwned({
          userId,
          unitId,
          patch: {
            currentStep: input.currentStep,
            socraticTurn: input.socraticTurn,
            graphState: JSON.stringify(input.graphState),
          },
        });
      },
    },
  });

  return socraticSessionPayload(threads, activeThread.id);
}

export async function applySocraticTurnResult(
  sessionState: UnitSessionStateRepository,
  userId: string,
  unitId: string,
  graphState: ReturnType<typeof parseSessionGraphState>,
  threads: ReturnType<typeof ensureSocraticThreads>["threads"],
  activeThread: NonNullable<ReturnType<typeof pickActiveSocraticThread>>,
  result: Awaited<ReturnType<typeof processSocraticTurn>>,
) {
  const nextThreads = replaceSocraticThread(
    threads,
    activeThread.id,
    result.thread,
  );

  await persistSocraticCorrection({
    graphState: graphState as SocraticCorrectionState,
    threads: nextThreads,
    activeThreadId: activeThread.id,
    socraticTurn: result.thread.turn,
    persistence: {
      saveSocraticCorrection: async (input) => {
        await sessionState.updateOwned({
          userId,
          unitId,
          patch: {
            socraticTurn: input.socraticTurn,
            graphState: JSON.stringify(input.graphState),
            currentStep: input.currentStep,
          },
        });
      },
    },
  });
  const payload = socraticSessionPayload(nextThreads, activeThread.id);
  return result.done ? { ...payload, question: result.question } : payload;
}

/**
 * Evidence is a secondary, fail-closed projection of a completed learning
 * turn. A stale target binding or an evidence-store failure must never discard
 * the learner's conversation or prevent the next turn.
 */
export async function recordSocraticEvidenceBestEffort(params: {
  userId: string;
  goalId: string;
  unitId: string;
  threadId: string;
  turn: number;
  learningTargetRef?: string;
  criterionRef?: string;
  answer: string;
  resolved: boolean;
  terminatedByLimit: boolean;
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
  socraticEvidence?: SocraticEvidenceRepository;
  assessmentTarget?: AssessmentTargetRepository;
}): Promise<void> {
  if (!params.learningTargetRef || !params.criterionRef) return;

  try {
    if (!params.socraticEvidence || !params.assessmentTarget) {
      throw new Error("Socratic evidence persistence is not configured");
    }
    const targets = await params.assessmentTarget.findForUnit({
      userId: params.userId,
      unitId: params.unitId,
    });
    let result: { observationCount: number; skippedReason?: string };
      const target = targets.find(
        (candidate) =>
          candidate.localRef.toLowerCase() ===
          params.learningTargetRef!.toLowerCase(),
      );
      if (!target) {
        result = {
          observationCount: 0,
          skippedReason: "unknown_learning_target",
        };
      } else if (
        !target.assessmentCriteria.some(
          (criterion) => criterion.ref === params.criterionRef,
        )
      ) {
        result = { observationCount: 0, skippedReason: "undeclared_criterion" };
      } else {
        const understandingRequirements = target.requirements.filter(
          (requirement) => requirement.dimension === "understanding",
        );
        if (understandingRequirements.length === 0) {
          result = {
            observationCount: 0,
            skippedReason: "undeclared_understanding",
          };
        } else {
          const declarationHash = createHash("sha256")
            .update(
              JSON.stringify({
                unitId: params.unitId,
                targetId: target.id,
                criterionRef: params.criterionRef,
                entities: understandingRequirements.map(
                  (requirement) => requirement.cognitiveEntityId,
                ),
              }),
            )
            .digest("hex")
            .slice(0, 24);
          const independenceEntities = new Map(
            understandingRequirements.map((requirement) => [
              requirement.cognitiveEntityId,
              requirement,
            ]),
          );
          result = await params.socraticEvidence.record({
            userId: params.userId,
            goalId: params.goalId,
            unitId: params.unitId,
            threadId: params.threadId,
            turn: params.turn,
            answer: params.answer,
            resolved: params.resolved,
            terminatedByLimit: params.terminatedByLimit,
            task: {
              stableKey: `assessment:socratic:${declarationHash}`,
              targetId: target.id,
              title: `Guided correction · ${target.title}`,
              instructions: target.learningObjective,
              definitionVersion: 1,
              requirements: [
                ...understandingRequirements.map((requirement, orderIndex) => ({
                  cognitiveEntityId: requirement.cognitiveEntityId,
                  learningTargetId: target.id,
                  dimension: "understanding" as const,
                  criterionRef: params.criterionRef!,
                  definitionVersion: requirement.entityDefinitionVersion,
                  required: requirement.required,
                  weight: requirement.weight,
                  orderIndex,
                  rubricCriterion: {
                    ref: params.criterionRef!,
                    definitionVersion: requirement.entityDefinitionVersion,
                  },
                })),
                ...[...independenceEntities.values()].map(
                  (requirement, index) => ({
                    cognitiveEntityId: requirement.cognitiveEntityId,
                    dimension: "independence" as const,
                    criterionRef: "system:assistance_independence:v1",
                    definitionVersion: requirement.entityDefinitionVersion,
                    required: false,
                    weight: 1,
                    orderIndex: understandingRequirements.length + index,
                    rubricCriterion: {
                      text: "Degree of independent performance without guided prompts",
                    },
                  }),
                ),
              ],
            },
          });
        }
      }
    if (result.observationCount > 0) {
      const { invalidateLearnerStateMemory } =
        await import("../../../../learner-state-memory/index.js");
      await invalidateLearnerStateMemory(
        params.userId,
        "socratic_evidence_recorded",
        undefined,
        params.learnerStateMemoryInvalidation,
      );
    }
    if (result.skippedReason) {
      console.warn(
        `[learning] skipped Socratic evidence unit=${params.unitId} thread=${params.threadId} reason=${result.skippedReason}`,
      );
    }
  } catch (error) {
    console.error(
      `[learning] Socratic evidence failed without blocking the turn unit=${params.unitId} thread=${params.threadId}`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function finishSocraticSession(
  sessionState: UnitSessionStateRepository,
  userId: string,
  unitId: string,
  goalId: string,
  unitTitle: string,
  graphState: ReturnType<typeof parseSessionGraphState>,
) {
  const { threads, activeThreadId } = ensureSocraticThreads(graphState);
  if (threads.some((thread) => !thread.done)) {
    throw new BadRequestException(
      tBackend("error.learning.completeCorrectionsFirst"),
    );
  }
  const drills = await generateDrills(
    goalId,
    unitTitle,
    graphState.weakTags ?? [],
  );
  const nextGraph = {
    ...graphStateWithSocraticThreads(graphState, threads, activeThreadId),
    drills,
  };
  await sessionState.updateOwned({
    userId,
    unitId,
    patch: {
      graphState: JSON.stringify(nextGraph),
      currentStep: "active_recall",
    },
  });
  return {
    ...socraticSessionPayload(threads, activeThreadId),
    drills: drills.questions,
    nextStep: "active_recall",
  };
}
