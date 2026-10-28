import { tBackend } from "../../../../../common/src/index.js";
import { createSseStream, sseResponse } from "../../../llm/sse.js";
import { type CanonicalSqlearningTarget } from "../../../graph/canonical-sq.js";
import {
  expandUnitCognitiveModel,
  getUnitConceptMap as getUnitConceptMapProjection,
  getUnitLearningTargetsV2,
  waitForUnitLearningTargetsPublication,
  type UnitCognitiveModelTargetsReady,
} from "../../../cognitive-model/index.js";
import { recordBackendError } from "../../../observability/index.js";
import { cognitiveModelPersistence } from "../../../cognitive-model/persistence.js";
import type {
  CognitiveModelGenerationRunRepository,
  CognitiveModelPublicationFinalizationRepository,
  CognitiveModelPublicationRepository,
  ProjectBlueprintRepository,
  CognitiveModelPresentationReadRepository,
  LearnerStateProjectionReadRepository,
  LearnerStateMemoryInvalidationRepository,
  UnitDeliveryReadRepository,
  KnowledgeActivity,
} from "../../../../../domain/src/index.js";

export function provisionalSqTargets(
  ready: UnitCognitiveModelTargetsReady,
): CanonicalSqlearningTarget[] {
  return ready.contract.learningTargets.map((target) => ({
    id: `draft:${ready.prefixHash}:${target.ref}`,
    localRef: target.ref,
    title: target.title,
    description: target.explanation,
    explanation: target.explanation,
    learningObjective: target.learningObjective,
    assessmentCriteria: target.assessmentCriteria.map(
      (criterion) => criterion.text,
    ),
    requirements: target.requirements.map((requirement) => ({
      entityId: requirement.entityRef,
    })),
    importance: target.importance,
    importanceWeight: target.importanceWeight,
    difficulty: target.difficulty,
    targetCognitiveLevel: target.targetCognitiveLevel,
    rationale: target.explanation,
    isEntry: target.isEntry,
    isExit: target.isExit,
  }));
}

export async function getLearningTargets(
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  presentationRead?: CognitiveModelPresentationReadRepository,
  stateRead?: LearnerStateProjectionReadRepository,
) {
  if (!(await unitRead.findLearningAccess({ userId, unitId }))) {
    throw new Error("Unit not found");
  }
  return getUnitLearningTargetsV2(undefined, unitId, {
    userId,
    presentationRead,
    stateRead,
  });
}

const CONCEPT_RELATION_KEYS = {
  prerequisite: "label.cognition.relation.prerequisite",
  part_of: "label.cognition.relation.partOf",
  causes: "label.cognition.relation.causes",
  contrasts: "label.cognition.relation.contrasts",
  constrains: "label.cognition.relation.constrains",
  supports: "label.cognition.relation.supports",
  enables: "label.cognition.relation.enables",
} as const;

export async function getUnitConceptMap(
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  presentationRead?: CognitiveModelPresentationReadRepository,
) {
  if (!(await unitRead.findLearningAccess({ userId, unitId }))) {
    throw new Error("Unit not found");
  }
  const map = await getUnitConceptMapProjection(
    undefined,
    unitId,
    presentationRead,
  );
  return {
    ...map,
    edges: map.edges.map((edge) => ({
      ...edge,
      relationLabel: tBackend(CONCEPT_RELATION_KEYS[edge.relationType]),
    })),
  };
}

export async function learningTargetExpansionStream(
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  generationRun?: CognitiveModelGenerationRunRepository,
  publication?: CognitiveModelPublicationRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  projectBlueprint?: ProjectBlueprintRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
) {
  if (!(await unitRead.findLearningAccess({ userId, unitId }))) {
    throw new Error("Unit not found");
  }
  const persistence = cognitiveModelPersistence();
  if (!persistence) throw new Error("Cognitive-model persistence is unavailable");
  return sseResponse(
    createSseStream(async (send) => {
      send({
        type: "status",
        phase: "cognitive_model",
        message: tBackend("status.generation.learningTargets"),
      });
      const result = await expandUnitCognitiveModel(null, unitId, {
        onKnowledgeActivity: async (activity) => {
          send({ type: "knowledge_activity", activity });
        },
        onTargetsReady: async (ready) => {
          send({
            type: "learning_access",
            access: {
              modelPhase: "targets_ready",
              contentMode: "draft",
              assessmentMode: "locked",
              lockReason: "model_building",
              prefixHash: ready.prefixHash,
            },
          });
        },
        generationRun,
        publication,
        publicationFinalization,
        projectBlueprint,
        learnerStateMemoryInvalidation,
      });
      const { learningTargets } = await getUnitLearningTargetsV2(
        undefined,
        unitId,
        {
          userId,
          presentationRead: persistence.presentationRead,
          stateRead: persistence.stateRead,
        },
      );
      send({ type: "done", ...result, learningTargets });
    }),
  );
}

export async function ensureExpandedLearningTargets(
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  signal?: AbortSignal,
  generationRun?: CognitiveModelGenerationRunRepository,
  publication?: CognitiveModelPublicationRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  projectBlueprint?: ProjectBlueprintRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
) {
  if (!(await unitRead.findLearningAccess({ userId, unitId }))) {
    throw new Error("Unit not found");
  }
  const persistence = cognitiveModelPersistence();
  if (!persistence) throw new Error("Cognitive-model persistence is unavailable");
  await expandUnitCognitiveModel(null, unitId, {
    signal,
    generationRun,
    publication,
    publicationFinalization,
    projectBlueprint,
    learnerStateMemoryInvalidation,
  });
  const { learningTargets } = await getUnitLearningTargetsV2(undefined, unitId, {
    userId,
    presentationRead: persistence.presentationRead,
    stateRead: persistence.stateRead,
  });
  return learningTargets;
}

export async function getLearningTargetsForEarlyTeaching(
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  inputHash: string,
  signal?: AbortSignal,
  onKnowledgeActivity?: (activity: KnowledgeActivity) => void | Promise<void>,
  generationRun?: CognitiveModelGenerationRunRepository,
  publication?: CognitiveModelPublicationRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  projectBlueprint?: ProjectBlueprintRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<{
  learningTargets: CanonicalSqlearningTarget[];
  finalized: boolean;
  inputHash: string;
  prefixHash?: string;
  completion: Promise<CanonicalSqlearningTarget[]>;
}> {
  if (!(await unitRead.findLearningAccess({ userId, unitId }))) {
    throw new Error("Unit not found");
  }
  const persistence = cognitiveModelPersistence();
  if (!persistence) throw new Error("Cognitive-model persistence is unavailable");
  let resolvePrefix:
    ((ready: UnitCognitiveModelTargetsReady) => void) | undefined;
  const prefix = new Promise<UnitCognitiveModelTargetsReady>((resolve) => {
    resolvePrefix = resolve;
  });
  const expansion = expandUnitCognitiveModel(null, unitId, {
    // KACOM is reusable background work. Disconnecting the SQ stream should
    // not discard an already-started model build.
    onTargetsReady: async (ready) => resolvePrefix?.(ready),
    onKnowledgeActivity,
    generationRun,
    publication,
    publicationFinalization,
    projectBlueprint,
    learnerStateMemoryInvalidation,
  });
  const completion = expansion.then(async () => {
    const { learningTargets } = await waitForUnitLearningTargetsPublication(
      undefined,
      unitId,
      inputHash,
      {
        userId,
        expansionLease: persistence.expansionLease,
        presentationRead: persistence.presentationRead,
        stateRead: persistence.stateRead,
      },
    );
    return learningTargets;
  });
  const first = await Promise.race([
    prefix.then((ready) => ({ kind: "prefix" as const, ready })),
    completion.then((learningTargets) => ({
      kind: "published" as const,
      learningTargets,
    })),
  ]);
  if (signal?.aborted)
    throw signal.reason ?? new Error("SQ generation aborted");
  if (first.kind === "published") {
    return {
      learningTargets: first.learningTargets,
      finalized: true,
      inputHash,
      completion,
    };
  }
  // Keep the suffix/publish promise observed after returning the prefix.
  void completion.catch((error) => {
    console.error(
      `[learning] background KACOM expansion failed unit=${unitId}`,
      error instanceof Error ? error.message : error,
    );
    void recordBackendError(
      {
        source: "internal",
        service: "learning-service",
        error,
        operation: "background-kacom-expansion",
      },
    );
  });
  return {
    learningTargets: provisionalSqTargets(first.ready),
    finalized: false,
    inputHash,
    prefixHash: first.ready.prefixHash,
    completion,
  };
}
