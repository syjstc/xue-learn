import { createHash } from "node:crypto";
import { normalizeTopicCategory } from "../../../common/src/index.js";
import {
  runStructuredOutput,
  type StructuredOutputOptions,
} from "../llm/structured-output.js";
import {
  describeRepairSlot,
  normalizeExactDuplicates,
  normalizeGeneratedJsonValue,
  runSinglePositionalRepair,
  type PositionalRepairSlot,
  type PositionalRepairRunner,
  zodIssueCategories,
} from "../llm/structured-recovery.js";
import { patchActiveLlmRecoveryMetadata } from "../llm/logger.js";
import {
  buildValidationReport,
  KACOM_SUFFIX_HINTS,
} from "../llm/validation-report.js";
import { runMergedGenerationContextScope } from "../generation/kernel.js";
import { z } from "zod";
import { validateUnitPathContract } from "./path-contract.js";
import { projectApprovedEntryTargets } from "./path-entry-targets.js";
import {
  canonicalizeAllowlistedEntityReuse,
  prepareUnitCognitiveModelGeneration,
  normalizeUnitPlanningOutcomeContext,
  unitCognitiveModelProposalSchema,
  validateProposalPlanningOutcomeCoverage,
  validateExternalEntityReferences,
  validateUnitCognitiveEntityBudget,
  type PreparedUnitCognitiveModelGeneration,
  type UnitCognitiveModelGenerationParams,
  type UnitCognitiveModelProposal,
} from "./generation.js";
import {
  ensureQuizEvidenceRequirements,
  mapCognitiveDimensionAlias,
  quizEvidenceContractIssues,
} from "./quiz-evidence.js";
import {
  learningTargetLessonFitIssues,
  lessonFitRepairInstruction,
} from "./target-lesson-fit.js";

const generatedEntityRef = z.string().regex(/^e_\d+$/);
const resolvableEntityRef = z.string().regex(/^(?:e|x)_\d+$/);
const targetRef = z.string().regex(/^lt_\d+$/);
const planningOutcomeRef = z.string().regex(/^o_[1-9]\d*$/);
const entityKind = z.enum(["atom", "concept", "skill", "competency"]);
const cognitiveDimension = z.enum([
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
]);
const knowledgeForm = z.enum([
  "declarative",
  "relational",
  "procedural",
  "conditional",
  "criterial",
]);
const relationType = z.enum([
  "prerequisite",
  "part_of",
  "causes",
  "contrasts",
  "constrains",
  "supports",
  "enables",
]);

const targetEntityStubSchema = z.object({
  ref: generatedEntityRef,
  semanticKey: z.string().trim().min(1),
  kind: entityKind,
  title: z.string().trim().min(1),
});

const targetContractSchema = z.object({
  ref: targetRef,
  semanticKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  learningObjective: z.string().trim().min(1),
  assessmentCriteria: z
    .array(
      z.object({
        ref: z.string().regex(/^lt_\d+:c\d+$/),
        text: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(8),
  targetCognitiveLevel: z.enum([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
  ]),
  importance: z.enum(["core", "supporting", "enrichment"]),
  importanceWeight: z.number().int().min(1).max(5),
  difficulty: z.enum(["easy", "medium", "hard"]),
  role: z.enum(["primary", "supporting", "review"]),
  isEntry: z.boolean(),
  isExit: z.boolean(),
  planningOutcomeRefs: z.array(planningOutcomeRef).default([]),
  requirements: z
    .array(
      z.object({
        entityRef: resolvableEntityRef,
        dimension: cognitiveDimension,
        required: z.boolean(),
        weight: z.number().positive(),
        threshold: z.number().min(0).max(1),
        gate: z.boolean(),
      }),
    )
    .min(1),
});

function targetContractRepairSchema(params: {
  ref?: string;
  requireQuizEvidence: boolean;
}) {
  const schema =
    params.ref && /^lt_\d+$/.test(params.ref)
      ? targetContractSchema.extend({ ref: z.literal(params.ref) })
      : targetContractSchema;
  return schema.superRefine((target, context) => {
    const quizEvidenceRequired =
      params.requireQuizEvidence ||
      target.importance === "core" ||
      target.importance === "supporting";
    if (!quizEvidenceRequired) return;
    if (
      target.requirements.some(
        (requirement) =>
          requirement.dimension === "memory" ||
          requirement.dimension === "understanding",
      )
    ) {
      return;
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requirements"],
      message:
        "The repaired LearningTarget must include at least one memory or understanding requirement for selected-response evidence",
    });
  });
}

export const unitCognitiveModelTargetPrefixBindingSchema = z.object({
  entities: z.array(targetEntityStubSchema).max(18),
  learningTargets: z.array(targetContractSchema).min(1).max(30),
});

const atomDetailSchema = z.object({
  ref: generatedEntityRef,
  description: z.string().min(1),
  statement: z.string().min(1),
  explanation: z.string().min(1),
  boundary: z.string().min(1),
  knowledgeForm,
  assessmentHints: z.array(z.string().min(1)).min(1).max(6),
});

const constructDetailSchema = z.object({
  ref: generatedEntityRef,
  kind: z.enum(["concept", "skill", "competency"]),
  description: z.string().min(1),
  objective: z.string().min(1),
  inputs: z.array(z.string().min(1)),
  outputs: z.array(z.string().min(1)),
  qualityCriteria: z.array(z.string().min(1)).min(1).max(8),
  compositionStrategy: z.string().min(1),
});

const relationSchema = z.object({
  fromRef: resolvableEntityRef,
  toRef: resolvableEntityRef,
  relationType,
  strength: z.enum(["required", "recommended"]),
  rationale: z.string().min(1),
});

const componentSchema = z.object({
  constructRef: generatedEntityRef,
  componentRef: resolvableEntityRef,
  requirementMode: z.enum(["required", "optional", "alternative_path"]),
  componentGroup: z.string(),
  threshold: z.number().min(0).max(1),
  gate: z.boolean(),
  weight: z.number().positive(),
  rationale: z.string().min(1),
});

export const unitCognitiveModelTargetSuffixBindingSchema = z.object({
  // Keep the two detail variants in separate homogeneous arrays. Several
  // OpenAI-compatible providers flatten discriminated-union tool schemas and
  // then emit atom fields for constructs (or omit knowledgeForm entirely).
  // The frozen prefix already owns the kind, so a mixed entity array adds no
  // useful information and makes provider-native binding less reliable.
  atomDetails: z.array(atomDetailSchema).max(80),
  constructDetails: z.array(constructDetailSchema).max(80),
  relations: z.array(relationSchema).max(240),
  components: z.array(componentSchema).max(160),
  audit: z.object({
    scopeComplete: z.boolean(),
    omissions: z.array(z.string()),
    notes: z.array(z.string()),
  }),
});

/**
 * Keep the provider-visible function definition identical for both target-first
 * turns. OpenAI-compatible prompt caches include the tool catalog before the
 * messages, so using the smaller phase-specific schemas made the suffix miss
 * even though its prompt began with the same prepared unit context.
 *
 * The server still validates only the authoritative phase schema below. The
 * unused half is deliberately represented by empty arrays (and a neutral
 * audit during phase 1) so strict providers can use one required-field schema.
 */
export const unitCognitiveModelTargetFirstBindingSchema = z.object({
  entities: z.array(targetEntityStubSchema).max(18),
  // Phase 2 must carry an empty list, so the transport cannot inherit the
  // phase-1 min(1). The authoritative prefix validator still enforces it.
  learningTargets: z.array(targetContractSchema).max(30),
  atomDetails: unitCognitiveModelTargetSuffixBindingSchema.shape.atomDetails,
  constructDetails:
    unitCognitiveModelTargetSuffixBindingSchema.shape.constructDetails,
  relations: unitCognitiveModelTargetSuffixBindingSchema.shape.relations,
  components: unitCognitiveModelTargetSuffixBindingSchema.shape.components,
  audit: unitCognitiveModelTargetSuffixBindingSchema.shape.audit,
});

export type UnitCognitiveModelEntityStub = {
  ref: string;
  semanticKey: string;
  kind: "atom" | "concept" | "skill" | "competency";
  title: string;
};

export type UnitCognitiveModelTargetContract = Readonly<{
  version: 1;
  entities: ReadonlyArray<Readonly<UnitCognitiveModelEntityStub>>;
  learningTargets: ReadonlyArray<
    Readonly<UnitCognitiveModelProposal["learningTargets"][number]>
  >;
}>;

export type UnitCognitiveModelTargetsReady = {
  contract: UnitCognitiveModelTargetContract;
  prefixHash: string;
};

type ExternalEntities =
  PreparedUnitCognitiveModelGeneration["externalEntities"];
type StructuredOutputRunner = typeof runStructuredOutput;
export type TargetPrefixWire = z.infer<
  typeof unitCognitiveModelTargetPrefixBindingSchema
>;
type TargetSuffixWire = z.infer<
  typeof unitCognitiveModelTargetSuffixBindingSchema
>;

type EntityDetailWire =
  | (z.infer<typeof atomDetailSchema> & { kind: "atom" })
  | z.infer<typeof constructDetailSchema>;

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

export function normalizeTargetPrefixCandidate(candidate: unknown): unknown {
  const normalized = normalizeGeneratedJsonValue(candidate);
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  )
    return normalized;
  const root = { ...(normalized as Record<string, unknown>) };
  const targets = Array.isArray(root.learningTargets)
    ? root.learningTargets.slice(0, 30).map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const target = { ...(raw as Record<string, unknown>) };
        // Providers occasionally copy the adjacent role enum into importance
        // (for example role=review, importance=review). These aliases have one
        // unambiguous importance counterpart and are safe to normalize before
        // required-value repair; unknown labels still fail closed.
        if (target.importance === "primary") target.importance = "core";
        if (target.importance === "review") target.importance = "enrichment";
        target.importanceWeight = clampNumber(
          target.importanceWeight,
          1,
          5,
          true,
        );
        if (Array.isArray(target.assessmentCriteria)) {
          const targetRef =
            typeof target.ref === "string" && /^lt_\d+$/.test(target.ref)
              ? target.ref
              : `lt_${index + 1}`;
          target.assessmentCriteria = target.assessmentCriteria
            .slice(0, 8)
            .map((criterion, criterionIndex) => {
              if (
                !criterion ||
                typeof criterion !== "object" ||
                Array.isArray(criterion)
              ) {
                return criterion;
              }
              return {
                ...(criterion as Record<string, unknown>),
                ref: `${targetRef}:c${criterionIndex + 1}`,
              };
            });
        }
        if (Array.isArray(target.requirements)) {
          target.requirements = target.requirements.map((rawRequirement) => {
            if (
              !rawRequirement ||
              typeof rawRequirement !== "object" ||
              Array.isArray(rawRequirement)
            )
              return rawRequirement;
            const requirement = {
              ...(rawRequirement as Record<string, unknown>),
            };
            const mapped = mapCognitiveDimensionAlias(requirement.dimension);
            if (mapped) requirement.dimension = mapped;
            requirement.weight = clampNumber(requirement.weight, 0.01, 100);
            requirement.threshold = clampNumber(requirement.threshold, 0, 1);
            return requirement;
          });
        }
        return target;
      })
    : root.learningTargets;
  if (Array.isArray(targets)) {
    root.learningTargets = ensureQuizEvidenceRequirements(
      targets.filter(
        (target): target is Record<string, unknown> =>
          Boolean(target) && typeof target === "object" && !Array.isArray(target),
      ) as Array<{
        importance: string;
        requirements: Array<{ dimension: string } & Record<string, unknown>>;
      }>,
    );
  } else {
    root.learningTargets = targets;
  }

  if (Array.isArray(root.entities)) {
    const entities = normalizeExactDuplicates(root.entities).items;
    if (entities.length <= 80) {
      root.entities = entities;
      return root;
    }
    const requiredRefs = new Set(
      Array.isArray(targets)
        ? targets.flatMap((target) => {
            if (!target || typeof target !== "object" || Array.isArray(target))
              return [];
            const requirements = (target as Record<string, unknown>)
              .requirements;
            return Array.isArray(requirements)
              ? requirements.flatMap((requirement) => {
                  const ref =
                    requirement &&
                    typeof requirement === "object" &&
                    !Array.isArray(requirement)
                      ? (requirement as Record<string, unknown>).entityRef
                      : undefined;
                  return typeof ref === "string" && ref.startsWith("e_")
                    ? [ref]
                    : [];
                })
              : [];
          })
        : [],
    );
    const referenced = entities.filter(
      (entity) =>
        entity &&
        typeof entity === "object" &&
        !Array.isArray(entity) &&
        requiredRefs.has(String((entity as Record<string, unknown>).ref ?? "")),
    );
    const retained = new Set(referenced);
    root.entities = [
      ...referenced,
      ...entities.filter((entity) => !retained.has(entity)),
    ].slice(0, 80);
  }
  return root;
}

function normalizeTargetSuffixCandidate(
  candidate: unknown,
  contract: UnitCognitiveModelTargetContract,
  externalEntities: ExternalEntities,
): unknown {
  const normalized = normalizeGeneratedJsonValue(candidate);
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  )
    return normalized;
  const root = { ...(normalized as Record<string, unknown>) };
  const expectedAtomRefs = new Set(
    contract.entities
      .filter((entity) => entity.kind === "atom")
      .map((entity) => entity.ref),
  );
  const expectedConstructRefs = new Set(
    contract.entities
      .filter((entity) => entity.kind !== "atom")
      .map((entity) => entity.ref),
  );
  const retainExpectedUniqueDetails = (
    values: unknown[],
    expectedRefs: ReadonlySet<string>,
  ) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const ref = (value as Record<string, unknown>).ref;
      if (typeof ref !== "string" || !expectedRefs.has(ref) || seen.has(ref))
        return false;
      seen.add(ref);
      return true;
    });
  };
  if (Array.isArray(root.atomDetails)) {
    const details = root.atomDetails.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const detail = { ...(value as Record<string, unknown>) };
      if (Array.isArray(detail.assessmentHints))
        detail.assessmentHints = detail.assessmentHints.slice(0, 6);
      return detail;
    });
    root.atomDetails = retainExpectedUniqueDetails(
      normalizeExactDuplicates(details).items,
      expectedAtomRefs,
    ).slice(0, 80);
  }
  if (Array.isArray(root.constructDetails)) {
    const details = root.constructDetails.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const detail = { ...(value as Record<string, unknown>) };
      if (Array.isArray(detail.qualityCriteria))
        detail.qualityCriteria = detail.qualityCriteria.slice(0, 8);
      return detail;
    });
    root.constructDetails = retainExpectedUniqueDetails(
      normalizeExactDuplicates(details).items,
      expectedConstructRefs,
    ).slice(0, 80);
  }
  const knownRefs = new Set([
    ...contract.entities.map((entity) => entity.ref),
    ...externalEntities.map((entity) => entity.ref),
  ]);
  const currentRefs = new Set(contract.entities.map((entity) => entity.ref));
  if (Array.isArray(root.relations)) {
    const seen = new Set<string>();
    const acyclicEdges = new Map<string, Set<string>>();
    const wouldCreateCycle = (fromRef: string, toRef: string) => {
      const pending = [toRef];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (current === fromRef) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...(acyclicEdges.get(current) ?? []));
      }
      return false;
    };
    root.relations = root.relations
      .flatMap((value) => {
        const parsed = relationSchema.safeParse(value);
        if (!parsed.success) return [];
        const relation = parsed.data;
        const endpoints =
          relation.relationType === "contrasts"
            ? [relation.fromRef, relation.toRef].sort()
            : [relation.fromRef, relation.toRef];
        const key = `${endpoints[0]}:${endpoints[1]}:${relation.relationType}`;
        if (
          relation.fromRef === relation.toRef ||
          !knownRefs.has(relation.fromRef) ||
          !knownRefs.has(relation.toRef) ||
          (!currentRefs.has(relation.fromRef) &&
            !currentRefs.has(relation.toRef)) ||
          seen.has(key)
        )
          return [];
        if (
          (relation.relationType === "prerequisite" ||
            relation.relationType === "part_of") &&
          wouldCreateCycle(relation.fromRef, relation.toRef)
        )
          return [];
        seen.add(key);
        if (
          relation.relationType === "prerequisite" ||
          relation.relationType === "part_of"
        ) {
          const outgoing =
            acyclicEdges.get(relation.fromRef) ?? new Set<string>();
          outgoing.add(relation.toRef);
          acyclicEdges.set(relation.fromRef, outgoing);
        }
        return [relation];
      })
      .slice(0, 240);
  }
  const constructRefs = new Set(
    contract.entities
      .filter((entity) => entity.kind !== "atom")
      .map((entity) => entity.ref),
  );
  if (Array.isArray(root.components)) {
    const seen = new Set<string>();
    root.components = root.components
      .flatMap((value) => {
        const mechanical =
          value && typeof value === "object" && !Array.isArray(value)
            ? {
                ...(value as Record<string, unknown>),
                threshold: clampNumber(
                  (value as Record<string, unknown>).threshold,
                  0,
                  1,
                ),
                weight: clampNumber(
                  (value as Record<string, unknown>).weight,
                  0.01,
                  100,
                ),
              }
            : value;
        const parsed = componentSchema.safeParse(mechanical);
        if (!parsed.success) return [];
        const component = parsed.data;
        const key = `${component.constructRef}:${component.componentRef}`;
        if (
          component.constructRef === component.componentRef ||
          !constructRefs.has(component.constructRef) ||
          !knownRefs.has(component.componentRef) ||
          (component.requirementMode === "alternative_path" &&
            !component.componentGroup.trim()) ||
          seen.has(key)
        )
          return [];
        seen.add(key);
        return [component];
      })
      .slice(0, 160);
  }
  if (
    root.audit &&
    typeof root.audit === "object" &&
    !Array.isArray(root.audit)
  ) {
    const audit = { ...(root.audit as Record<string, unknown>) };
    if (audit.omissions === null) audit.omissions = [];
    if (audit.notes === null) audit.notes = [];
    root.audit = audit;
  }
  return root;
}

function suffixEntityDetails(suffix: TargetSuffixWire): EntityDetailWire[] {
  return [
    ...suffix.atomDetails.map((detail) => ({
      ...detail,
      kind: "atom" as const,
    })),
    ...suffix.constructDetails,
  ];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function stablePrefixHash(contract: UnitCognitiveModelTargetContract): string {
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

function addCustomIssue(
  context: z.core.$RefinementCtx<unknown>,
  message: string,
  path: PropertyKey[] = [],
): void {
  context.addIssue({ code: "custom", message, path });
}

function validateTargetPrefix(
  prefix: TargetPrefixWire,
  allowedExternalRefs: ReadonlySet<string>,
  context: z.core.$RefinementCtx<TargetPrefixWire>,
): void {
  const entityRefs = new Set<string>();
  const entityKeys = new Set<string>();
  prefix.entities.forEach((entity, index) => {
    if (entityRefs.has(entity.ref)) {
      addCustomIssue(context, `Duplicate entity ref ${entity.ref}`, [
        "entities",
        index,
        "ref",
      ]);
    }
    entityRefs.add(entity.ref);
    const key = `${entity.kind}:${entity.semanticKey.normalize("NFC").trim().toLowerCase()}`;
    if (entityKeys.has(key)) {
      addCustomIssue(
        context,
        `Duplicate entity semantic key ${entity.semanticKey}`,
        ["entities", index, "semanticKey"],
      );
    }
    entityKeys.add(key);
  });

  const targetRefs = new Set<string>();
  const targetKeys = new Set<string>();
  prefix.learningTargets.forEach((target, targetIndex) => {
    if (targetRefs.has(target.ref)) {
      addCustomIssue(context, `Duplicate learning-target ref ${target.ref}`, [
        "learningTargets",
        targetIndex,
        "ref",
      ]);
    }
    targetRefs.add(target.ref);
    const targetKey = target.semanticKey.normalize("NFC").trim().toLowerCase();
    if (targetKeys.has(targetKey)) {
      addCustomIssue(
        context,
        `Duplicate learning-target semantic key ${target.semanticKey}`,
        ["learningTargets", targetIndex, "semanticKey"],
      );
    }
    targetKeys.add(targetKey);

    target.assessmentCriteria.forEach((criterion, criterionIndex) => {
      if (criterion.ref !== `${target.ref}:c${criterionIndex + 1}`) {
        addCustomIssue(
          context,
          `Learning-target ${target.ref} criteria must be sequential`,
          [
            "learningTargets",
            targetIndex,
            "assessmentCriteria",
            criterionIndex,
            "ref",
          ],
        );
      }
    });

    const requirementKeys = new Set<string>();
    target.requirements.forEach((requirement, requirementIndex) => {
      const key = `${requirement.entityRef}:${requirement.dimension}`;
      if (requirementKeys.has(key)) {
        addCustomIssue(
          context,
          `Duplicate learning-target requirement ${key}`,
          ["learningTargets", targetIndex, "requirements", requirementIndex],
        );
      }
      requirementKeys.add(key);
      if (
        requirement.entityRef.startsWith("e_") &&
        !entityRefs.has(requirement.entityRef)
      ) {
        addCustomIssue(
          context,
          `Unresolved target-first entity alias ${requirement.entityRef}`,
          [
            "learningTargets",
            targetIndex,
            "requirements",
            requirementIndex,
            "entityRef",
          ],
        );
      }
      if (
        requirement.entityRef.startsWith("x_") &&
        !allowedExternalRefs.has(requirement.entityRef)
      ) {
        addCustomIssue(
          context,
          `Unallowlisted target-first external alias ${requirement.entityRef}`,
          [
            "learningTargets",
            targetIndex,
            "requirements",
            requirementIndex,
            "entityRef",
          ],
        );
      }
    });
  });

  for (const issue of quizEvidenceContractIssues(prefix.learningTargets)) {
    addCustomIssue(
      context,
      issue.message,
      issue.index === null
        ? ["learningTargets"]
        : ["learningTargets", issue.index, "requirements"],
    );
  }
}

function targetPrefixToContract(
  prefix: TargetPrefixWire,
): UnitCognitiveModelTargetContract {
  return {
    version: 1,
    entities: prefix.entities.map((entity) => ({
      ref: entity.ref,
      semanticKey: entity.semanticKey,
      kind: entity.kind,
      title: entity.title,
    })),
    learningTargets: prefix.learningTargets.map((target) => ({
      ref: target.ref,
      semanticKey: target.semanticKey,
      title: target.title,
      explanation: target.explanation,
      learningObjective: target.learningObjective,
      assessmentCriteria: target.assessmentCriteria.map((criterion) => ({
        ref: criterion.ref,
        text: criterion.text,
      })),
      targetCognitiveLevel: target.targetCognitiveLevel,
      importance: target.importance,
      importanceWeight: target.importanceWeight,
      difficulty: target.difficulty,
      role: target.role,
      isEntry: target.isEntry,
      isExit: target.isExit,
      planningOutcomeRefs: target.planningOutcomeRefs,
      requirements: target.requirements.map((requirement) => ({
        entityRef: requirement.entityRef,
        dimension: requirement.dimension,
        required: requirement.required,
        weight: requirement.weight,
        threshold: requirement.threshold,
        gate: requirement.gate,
      })),
    })),
  };
}

export function unitCognitiveModelTargetPrefixSchema(
  allowedExternalRefs: ReadonlySet<string>,
  assignedPlanningOutcomeRefs: ReadonlySet<string> = new Set(),
) {
  return z.preprocess(
    normalizeTargetPrefixCandidate,
    targetPrefixWireSchema(
      allowedExternalRefs,
      assignedPlanningOutcomeRefs,
    ).transform(targetPrefixToContract),
  );
}

function targetPrefixWireSchema(
  allowedExternalRefs: ReadonlySet<string>,
  assignedPlanningOutcomeRefs: ReadonlySet<string> = new Set(),
) {
  return unitCognitiveModelTargetPrefixBindingSchema.superRefine(
    (prefix, context) => {
      validateTargetPrefix(prefix, allowedExternalRefs, context);
      if (assignedPlanningOutcomeRefs.size === 0) return;
      const covered = new Set<string>();
      prefix.learningTargets.forEach((target, targetIndex) => {
        target.planningOutcomeRefs.forEach((ref, refIndex) => {
          if (!assignedPlanningOutcomeRefs.has(ref)) {
            addCustomIssue(
              context,
              `Learning-target ${target.ref} cites unassigned outcome ${ref}`,
              ["learningTargets", targetIndex, "planningOutcomeRefs", refIndex],
            );
          }
          covered.add(ref);
        });
      });
      for (const ref of assignedPlanningOutcomeRefs) {
        if (!covered.has(ref)) {
          addCustomIssue(
            context,
            `Learning targets omit assigned outcome ${ref}`,
            ["learningTargets"],
          );
        }
      }
    },
  );
}

export function freezeUnitCognitiveModelTargetPrefix(
  contractInput: UnitCognitiveModelTargetContract,
): UnitCognitiveModelTargetsReady {
  const contract = deepFreeze(structuredClone(contractInput));
  return deepFreeze({ contract, prefixHash: stablePrefixHash(contract) });
}

function assembleProposalUnchecked(
  contract: UnitCognitiveModelTargetContract,
  suffix: TargetSuffixWire,
): UnitCognitiveModelProposal {
  const detailByRef = new Map(
    suffixEntityDetails(suffix).map((detail) => [detail.ref, detail]),
  );
  const entities = contract.entities.map((stub) => {
    const detail = detailByRef.get(stub.ref)!;
    if (detail.kind === "atom") {
      return {
        ...stub,
        kind: "atom" as const,
        description: detail.description,
        statement: detail.statement,
        explanation: detail.explanation,
        boundary: detail.boundary,
        knowledgeForm: detail.knowledgeForm,
        assessmentHints: detail.assessmentHints,
      };
    }
    return {
      ...stub,
      kind: stub.kind as "concept" | "skill" | "competency",
      description: detail.description,
      objective: detail.objective,
      inputs: detail.inputs,
      outputs: detail.outputs,
      qualityCriteria: detail.qualityCriteria,
      compositionStrategy: detail.compositionStrategy,
    };
  });

  return {
    entities,
    learningTargets: contract.learningTargets.map((target) =>
      structuredClone(target),
    ),
    relations: suffix.relations,
    components: suffix.components,
    audit: {
      scopeComplete: suffix.audit.scopeComplete,
      omissions: suffix.audit.omissions,
      notes: suffix.audit.notes,
    },
  };
}

function validateTargetSuffix(
  suffix: TargetSuffixWire,
  contract: UnitCognitiveModelTargetContract,
  externalEntities: ExternalEntities,
  context: z.core.$RefinementCtx<TargetSuffixWire>,
): void {
  const stubs = new Map(
    contract.entities.map((entity) => [entity.ref, entity]),
  );
  const detailRefs = new Set<string>();
  let detailsValid = true;

  const details = suffixEntityDetails(suffix);
  details.forEach((detail, index) => {
    const detailPath =
      detail.kind === "atom" ? "atomDetails" : "constructDetails";
    const detailIndex =
      detail.kind === "atom" ? index : index - suffix.atomDetails.length;
    if (detailRefs.has(detail.ref)) {
      detailsValid = false;
      addCustomIssue(context, `Duplicate entity detail ${detail.ref}`, [
        detailPath,
        detailIndex,
        "ref",
      ]);
    }
    detailRefs.add(detail.ref);
    const stub = stubs.get(detail.ref);
    if (!stub) {
      detailsValid = false;
      addCustomIssue(
        context,
        `Entity detail references unknown alias ${detail.ref}`,
        [detailPath, detailIndex, "ref"],
      );
    } else if (detail.kind !== stub.kind) {
      detailsValid = false;
      addCustomIssue(
        context,
        `Entity detail kind does not match frozen stub ${detail.ref}`,
        [detailPath, detailIndex, detail.kind === "atom" ? "ref" : "kind"],
      );
    }
  });

  contract.entities.forEach((entity) => {
    if (!detailRefs.has(entity.ref)) {
      detailsValid = false;
      addCustomIssue(context, `Missing entity detail ${entity.ref}`, [
        entity.kind === "atom" ? "atomDetails" : "constructDetails",
      ]);
    }
  });
  if (details.length !== contract.entities.length) detailsValid = false;
  if (!detailsValid) return;

  const candidate = assembleProposalUnchecked(contract, suffix);
  const parsed = unitCognitiveModelProposalSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        ...issue,
        path: ["proposal", ...issue.path],
      });
    }
    return;
  }
  try {
    validateExternalEntityReferences(parsed.data, externalEntities);
  } catch (error) {
    addCustomIssue(
      context,
      error instanceof Error ? error.message : String(error),
      ["proposal"],
    );
  }
}

export function unitCognitiveModelTargetSuffixSchema(
  contract: UnitCognitiveModelTargetContract,
  externalEntities: ExternalEntities,
) {
  return z.preprocess(
    (candidate) =>
      normalizeTargetSuffixCandidate(candidate, contract, externalEntities),
    targetSuffixWireSchema(contract, externalEntities).transform((suffix) =>
      unitCognitiveModelProposalSchema.parse(
        assembleProposalUnchecked(contract, suffix),
      ),
    ),
  );
}

function targetSuffixWireSchema(
  contract: UnitCognitiveModelTargetContract,
  externalEntities: ExternalEntities,
) {
  return unitCognitiveModelTargetSuffixBindingSchema.superRefine(
    (suffix, context) =>
      validateTargetSuffix(suffix, contract, externalEntities, context),
  );
}

export function composeUnitCognitiveModelTargetStages(
  contract: UnitCognitiveModelTargetContract,
  suffixInput: unknown,
  externalEntities: ExternalEntities = [],
): UnitCognitiveModelProposal {
  const proposal = unitCognitiveModelTargetSuffixSchema(
    contract,
    externalEntities,
  ).parse(suffixInput);
  validateExternalEntityReferences(proposal, externalEntities);
  return proposal;
}

function targetPrefixJsonShape(): string {
  return '{"entities":[{"ref":"e_1","semanticKey":"atomic_fact","kind":"atom","title":"..."},{"ref":"e_2","semanticKey":"composed_skill","kind":"skill","title":"..."}],"learningTargets":[{"ref":"lt_1","semanticKey":"demonstrate_skill","title":"...","explanation":"...","learningObjective":"...","assessmentCriteria":[{"ref":"lt_1:c1","text":"..."}],"targetCognitiveLevel":"apply","importance":"core","importanceWeight":5,"difficulty":"medium","role":"primary","isEntry":true,"isExit":true,"planningOutcomeRefs":["o_1"],"requirements":[{"entityRef":"e_1","dimension":"memory","required":true,"weight":1,"threshold":0.7,"gate":false},{"entityRef":"e_2","dimension":"application","required":true,"weight":1,"threshold":0.7,"gate":true}]}]}';
}

function targetSuffixJsonShape(
  contract: UnitCognitiveModelTargetContract,
): string {
  const atoms = contract.entities
    .filter((entity) => entity.kind === "atom")
    .map((entity) => ({
      ref: entity.ref,
      description: "...",
      statement: "...",
      explanation: "...",
      boundary: "...",
      knowledgeForm: "declarative",
      assessmentHints: ["..."],
    }));
  const constructs = contract.entities
    .filter((entity) => entity.kind !== "atom")
    .map((entity) => ({
      ref: entity.ref,
      kind: entity.kind,
      description: "...",
      objective: "...",
      inputs: ["..."],
      outputs: ["..."],
      qualityCriteria: ["..."],
      compositionStrategy: "...",
    }));
  const relationExample =
    contract.entities.length > 1
      ? [
          {
            fromRef: contract.entities[0]!.ref,
            toRef: contract.entities[1]!.ref,
            relationType: "supports",
            strength: "required",
            rationale: "...",
          },
        ]
      : [];
  return JSON.stringify({
    atomDetails: atoms,
    constructDetails: constructs,
    relations: relationExample,
    components: [],
    audit: { scopeComplete: true, omissions: [], notes: [] },
  });
}

export function targetPrefixPrompt(basePrompt: string): string {
  return `${basePrompt}

Generate phase 1 of the target-first cognitive model as one JSON object.
Populate only current-unit entity identity stubs and complete LearningTarget contracts. Do not populate descriptions, entity details, relations, components, citations, source indexes, source references, grounding fields, or extra keys beyond the required neutral transport fields described below.
For a review, cumulative practice, or diagnostic that only assesses allowlisted x_N identities, return entities as an empty array and reference those x_N aliases directly. Never recreate an existing identity with e_N merely to make entities non-empty.
Every criterion and requirement is part of the frozen contract, so make it complete and internally consistent now.
The shared two-phase transport also requires atomDetails, constructDetails, relations, and components; set all four to empty arrays in this phase. Set audit to {"scopeComplete":true,"omissions":[],"notes":[]}.`;
}

export function targetSuffixPrompt(
  basePrompt: string,
  contract: UnitCognitiveModelTargetContract,
): string {
  return `${basePrompt}

Generate phase 2 of the target-first cognitive model as one JSON object.
The following prefix is validated and immutable. Emit exactly one detail for each entity ref using the exact frozen kind. Do not redefine identity fields or learning targets: the shared two-phase transport requires entities and learningTargets, so set both to empty arrays in this phase. Complete the relations, components, and audit without citations, source indexes, source references, grounding fields, or extra keys.
Put atom details only in atomDetails and concept/skill/competency details only in constructDetails. Use every frozen alias exactly once and invent no aliases. Every required text field must contain meaningful non-empty text, especially boundary and compositionStrategy. Atom statement is a factual proposition; knowledgeForm is the separate exact English enum token. Components may be owned only by these frozen constructs: ${
    contract.entities
      .filter((entity) => entity.kind !== "atom")
      .map((entity) => entity.ref)
      .join(", ") || "none (return components as an empty array)"
  }.

Frozen prefix:
${JSON.stringify(contract)}`;
}

type KacomRepair = {
  slot: PositionalRepairSlot<unknown>;
  apply: (root: Record<string, unknown>, value: unknown) => void;
};
type KacomRecoveryResult<T> = {
  value: T;
  repairedValueCount: number;
  issueCategories: string[];
  usedSynthesis?: boolean;
  structuredIssues?: ReturnType<typeof buildValidationReport>["issues"];
};

function lessonFitIssuesForPrefixTargets(
  targets: unknown[],
  params: UnitCognitiveModelGenerationParams,
): Array<{ index: number; message: string }> {
  const parsed = targets.flatMap((value, index) => {
    const result = targetContractSchema.safeParse(value);
    return result.success
      ? [
          {
            index,
            target: {
              title: result.data.title,
              explanation: result.data.explanation,
              learningObjective: result.data.learningObjective,
              assessmentCriteria: result.data.assessmentCriteria,
            },
          },
        ]
      : [];
  });
  return learningTargetLessonFitIssues(
    parsed.map(({ target }) => target),
    {
      contentLanguage: params.contentLanguage,
      unitTitle: params.unitTitle,
      contentSummary: params.contentSummary,
    },
  ).map((issue) => ({
    index: parsed[issue.index]?.index ?? issue.index,
    message: issue.message,
  }));
}

async function recoverTargetPrefix(
  candidate: unknown,
  allowedExternalRefs: ReadonlySet<string>,
  params: UnitCognitiveModelGenerationParams,
  meta: Record<string, unknown>,
  repairRunner?: PositionalRepairRunner,
): Promise<KacomRecoveryResult<TargetPrefixWire>> {
  let normalized = normalizeTargetPrefixCandidate(candidate);
  const assignedPlanningOutcomeRefs = new Set(params.planningOutcomeRefs ?? []);
  const schema = targetPrefixWireSchema(
    allowedExternalRefs,
    assignedPlanningOutcomeRefs,
  );
  const initial = schema.safeParse(normalized);
  const earlyLessonFit = initial.success
    ? learningTargetLessonFitIssues(initial.data.learningTargets, {
        contentLanguage: params.contentLanguage,
        unitTitle: params.unitTitle,
        contentSummary: params.contentSummary,
      })
    : [];
  if (initial.success && earlyLessonFit.length === 0) {
    return { value: initial.data, repairedValueCount: 0, issueCategories: [] };
  }
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    const [root] = await runSinglePositionalRepair({
      operation: "cognitive_model.unit_generate.target_first.prefix",
      slots: [
        {
          description:
            "Replace the unusable root with the complete descriptive KACOM prefix object.",
          currentValue: normalized,
          schema,
          expectedShape: targetPrefixJsonShape(),
        },
      ],
      meta,
      topicCategory: normalizeTopicCategory(params.topicCategory, "general"),
      signal: params.signal,
      runner: repairRunner,
    });
    const repairedRoot = schema.parse(normalizeTargetPrefixCandidate(root));
    const rootLessonFit = learningTargetLessonFitIssues(
      repairedRoot.learningTargets,
      {
        contentLanguage: params.contentLanguage,
        unitTitle: params.unitTitle,
        contentSummary: params.contentSummary,
      },
    );
    if (rootLessonFit.length > 0) {
      throw new Error(rootLessonFit.map((issue) => issue.message).join("; "));
    }
    return {
      value: repairedRoot,
      repairedValueCount: 1,
      issueCategories: ["invalid_value"],
    };
  }

  const root = structuredClone(normalized as Record<string, unknown>);
  const entities = Array.isArray(root.entities) ? root.entities : [];
  const targets = Array.isArray(root.learningTargets)
    ? root.learningTargets
    : [];
  const generatedRequirementRefs = entities.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const ref = (value as Record<string, unknown>).ref;
    return typeof ref === "string" && /^e_\d+$/.test(ref) ? [ref] : [];
  });
  if (generatedRequirementRefs.length === 0 && allowedExternalRefs.size === 0)
    generatedRequirementRefs.push("e_1");
  const allowedRequirementRefs = [
    ...new Set([...generatedRequirementRefs, ...allowedExternalRefs]),
  ].sort();
  const requirementRefInstruction = `Every requirements[].entityRef must be one of these entity aliases (never an lt_* LearningTarget ref): ${allowedRequirementRefs.join(", ")}.`;
  const entityIndexes = new Set<number>();
  const targetIndexes = new Set<number>();
  const quizEvidenceTargetIndexes = new Set<number>();
  const lessonFitTargetIndexes = new Set<number>();
  const lessonFitHint = lessonFitRepairInstruction({
    contentLanguage: params.contentLanguage,
    unitTitle: params.unitTitle,
    contentSummary: params.contentSummary,
  });
  entities.forEach((value, index) => {
    if (!targetEntityStubSchema.safeParse(value).success)
      entityIndexes.add(index);
  });
  targets.forEach((value, index) => {
    const parsedTarget = targetContractSchema.safeParse(value);
    if (
      !parsedTarget.success ||
      parsedTarget.data.planningOutcomeRefs.some(
        (ref) => !assignedPlanningOutcomeRefs.has(ref),
      )
    )
      targetIndexes.add(index);
  });
  if (initial.success) {
    for (const issue of earlyLessonFit) {
      targetIndexes.add(issue.index);
      lessonFitTargetIndexes.add(issue.index);
    }
  } else {
    initial.error.issues.forEach((issue) => {
      const [group, index] = issue.path;
      if (group === "entities" && typeof index === "number")
        entityIndexes.add(index);
      if (group === "learningTargets" && typeof index === "number") {
        targetIndexes.add(index);
        if (issue.message.includes("memory or understanding requirement")) {
          quizEvidenceTargetIndexes.add(index);
        }
      }
    });
    for (const issue of lessonFitIssuesForPrefixTargets(targets, params)) {
      targetIndexes.add(issue.index);
      lessonFitTargetIndexes.add(issue.index);
    }
  }
  const parsedTargets = targets.flatMap((value, index) => {
    const parsed = targetContractSchema.safeParse(value);
    return parsed.success ? [{ index, target: parsed.data }] : [];
  });
  const quizIssues = quizEvidenceContractIssues(
    parsedTargets.map(({ target }) => target),
  );
  for (const issue of quizIssues) {
    if (issue.index !== null) {
      const originalIndex = parsedTargets[issue.index]?.index;
      if (originalIndex !== undefined) {
        targetIndexes.add(originalIndex);
        quizEvidenceTargetIndexes.add(originalIndex);
      }
      continue;
    }
    const fallback =
      parsedTargets.find(
        ({ target }) =>
          target.importance === "core" || target.importance === "supporting",
      ) ?? parsedTargets[0];
    if (fallback) {
      targetIndexes.add(fallback.index);
      quizEvidenceTargetIndexes.add(fallback.index);
    }
  }

  const repairs: KacomRepair[] = [];
  [...entityIndexes]
    .sort((a, b) => a - b)
    .forEach((index) => {
      const current = entities[index];
      const currentRef =
        current && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, unknown>).ref
          : undefined;
      const entityRepairSchema =
        typeof currentRef === "string" && /^e_\d+$/.test(currentRef)
          ? targetEntityStubSchema.extend({ ref: z.literal(currentRef) })
          : targetEntityStubSchema;
      repairs.push({
        slot: {
          description: `Correct required KACOM entity stub ${index + 1}; keep stable refs used by valid targets.${
            typeof currentRef === "string" && /^e_\d+$/.test(currentRef)
              ? ` Preserve exact ref ${currentRef}.`
              : ""
          }`,
          currentValue: current,
          schema: entityRepairSchema,
        },
        apply: (value, repaired) => {
          const list = Array.isArray(value.entities) ? value.entities : [];
          list[index] = repaired;
          value.entities = list;
        },
      });
    });
  [...targetIndexes]
    .sort((a, b) => a - b)
    .forEach((index) => {
      const current = targets[index];
      const currentRef =
        current && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, unknown>).ref
          : undefined;
      const requireQuizEvidence = quizEvidenceTargetIndexes.has(index);
      const requireLessonFit = lessonFitTargetIndexes.has(index);
      repairs.push({
        slot: {
          description: `Correct required LearningTarget ${index + 1}, including criteria, requirements, and resolvable frozen entity refs.${
            typeof currentRef === "string" && /^lt_\d+$/.test(currentRef)
              ? ` Preserve exact ref ${currentRef}.`
              : ""
          }${
            requireQuizEvidence
              ? " Include at least one requirements[] item whose dimension is exactly memory or understanding; application, transfer, fluency, stability, and independence cannot be the sole requirement dimensions."
              : ""
          }${requireLessonFit ? ` ${lessonFitHint}` : ""} ${requirementRefInstruction}`,
          currentValue: current,
          schema: targetContractRepairSchema({
            ref: typeof currentRef === "string" ? currentRef : undefined,
            requireQuizEvidence,
          }),
        },
        apply: (value, repaired) => {
          const list = Array.isArray(value.learningTargets)
            ? value.learningTargets
            : [];
          list[index] = repaired;
          value.learningTargets = list;
        },
      });
    });
  if (entities.length === 0 && allowedExternalRefs.size === 0) {
    repairs.push({
      slot: {
        description: "Add the missing required KACOM entity identity stub e_1.",
        schema: targetEntityStubSchema,
      },
      apply: (value, repaired) => {
        value.entities = [repaired];
      },
    });
  }
  if (targets.length === 0) {
    repairs.push({
      slot: {
        description: `Add the missing required complete LearningTarget lt_1. ${requirementRefInstruction}`,
        schema: targetContractRepairSchema({
          ref: "lt_1",
          requireQuizEvidence: true,
        }),
      },
      apply: (value, repaired) => {
        value.learningTargets = [repaired];
      },
    });
  }
  if (assignedPlanningOutcomeRefs.size > 0) {
    const covered = new Set(
      targets.flatMap((value) => {
        const parsedTarget = targetContractSchema.safeParse(value);
        return parsedTarget.success
          ? parsedTarget.data.planningOutcomeRefs.filter((ref) =>
              assignedPlanningOutcomeRefs.has(ref),
            )
          : [];
      }),
    );
    for (const ref of assignedPlanningOutcomeRefs) {
      if (covered.has(ref)) continue;
      repairs.push({
        slot: {
          description: `Add one complete LearningTarget that materially assesses assigned goal outcome ${ref}. Set planningOutcomeRefs to include ${ref}. ${requirementRefInstruction}`,
          schema: targetContractRepairSchema({
            requireQuizEvidence: false,
          }),
        },
        apply: (value, repaired) => {
          const list = Array.isArray(value.learningTargets)
            ? value.learningTargets
            : [];
          value.learningTargets = [...list, repaired];
        },
      });
    }
  }
  if (repairs.length === 0) {
    if (!initial.success) throw initial.error;
    throw new Error(
      earlyLessonFit.map((issue) => issue.message).join("; ") ||
        "Learning targets do not fit this lesson",
    );
  }
  const values = await runSinglePositionalRepair({
    operation: "cognitive_model.unit_generate.target_first.prefix",
    slots: repairs.map((repair) => repair.slot),
    meta,
    topicCategory: normalizeTopicCategory(params.topicCategory, "general"),
    signal: params.signal,
    runner: repairRunner,
  });
  repairs.forEach((repair, index) => repair.apply(root, values[index]));
  normalized = normalizeTargetPrefixCandidate(root);
  const repaired = schema.parse(normalized);
  const remainingLessonFit = learningTargetLessonFitIssues(
    repaired.learningTargets,
    {
      contentLanguage: params.contentLanguage,
      unitTitle: params.unitTitle,
      contentSummary: params.contentSummary,
    },
  );
  if (remainingLessonFit.length > 0) {
    throw new Error(
      remainingLessonFit.map((issue) => issue.message).join("; "),
    );
  }
  return {
    value: repaired,
    repairedValueCount: repairs.length,
    issueCategories: initial.success
      ? ["lesson_fit"]
      : zodIssueCategories(initial.error),
  };
}

async function recoverTargetSuffix(
  candidate: unknown,
  contract: UnitCognitiveModelTargetContract,
  externalEntities: ExternalEntities,
  params: UnitCognitiveModelGenerationParams,
  meta: Record<string, unknown>,
  repairRunner?: PositionalRepairRunner,
): Promise<KacomRecoveryResult<TargetSuffixWire>> {
  let normalized = normalizeTargetSuffixCandidate(
    candidate,
    contract,
    externalEntities,
  );
  const schema = targetSuffixWireSchema(contract, externalEntities);
  let initial = schema.safeParse(normalized);
  if (initial.success)
    return { value: initial.data, repairedValueCount: 0, issueCategories: [] };
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    const [root] = await runSinglePositionalRepair({
      operation: "cognitive_model.unit_generate.target_first.suffix",
      slots: [
        {
          description:
            "Replace the unusable root with the complete descriptive KACOM suffix for the frozen prefix.",
          currentValue: normalized,
          schema,
          expectedShape: targetSuffixJsonShape(contract),
        },
      ],
      meta,
      topicCategory: normalizeTopicCategory(params.topicCategory, "general"),
      signal: params.signal,
      runner: repairRunner,
    });
    return {
      value: schema.parse(
        normalizeTargetSuffixCandidate(root, contract, externalEntities),
      ),
      repairedValueCount: 1,
      issueCategories: ["invalid_value"],
    };
  }

  const root = structuredClone(normalized as Record<string, unknown>);
  const relationDrops = new Set<number>();
  const componentDrops = new Set<number>();
  initial.error.issues.forEach((issue) => {
    const [proposal, group, index] = issue.path;
    if (proposal !== "proposal" || typeof index !== "number") return;
    if (group === "relations") relationDrops.add(index);
    if (group === "components") componentDrops.add(index);
  });
  if (relationDrops.size > 0 && Array.isArray(root.relations)) {
    root.relations = root.relations.filter(
      (_value, index) => !relationDrops.has(index),
    );
  }
  if (componentDrops.size > 0 && Array.isArray(root.components)) {
    root.components = root.components.filter(
      (_value, index) => !componentDrops.has(index),
    );
  }
  if (relationDrops.size > 0 || componentDrops.size > 0) {
    normalized = normalizeTargetSuffixCandidate(
      root,
      contract,
      externalEntities,
    );
    initial = schema.safeParse(normalized);
    if (initial.success)
      return {
        value: initial.data,
        repairedValueCount: 0,
        issueCategories: [],
      };
  }

  const normalizedRoot = structuredClone(normalized as Record<string, unknown>);
  const atomDetails = Array.isArray(normalizedRoot.atomDetails)
    ? normalizedRoot.atomDetails
    : [];
  const constructDetails = Array.isArray(normalizedRoot.constructDetails)
    ? normalizedRoot.constructDetails
    : [];
  const repairs: KacomRepair[] = [];
  const detailRef = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).ref
      : undefined;
  const expectedAtoms = contract.entities.filter(
    (entity) => entity.kind === "atom",
  );
  const expectedConstructs = contract.entities.filter(
    (entity) => entity.kind !== "atom",
  );

  const addDetailRepairs = (
    values: unknown[],
    expected: UnitCognitiveModelEntityStub[],
    key: "atomDetails" | "constructDetails",
    detailSchema: z.ZodType<unknown>,
  ) => {
    const expectedByRef = new Map(
      expected.map((entity) => [entity.ref, entity]),
    );
    const schemaForEntity = (entity: UnitCognitiveModelEntityStub) =>
      key === "atomDetails"
        ? atomDetailSchema.extend({ ref: z.literal(entity.ref) })
        : constructDetailSchema.extend({
            ref: z.literal(entity.ref),
            kind: z.literal(entity.kind as "concept" | "skill" | "competency"),
          });
    values.forEach((value, index) => {
      const ref = detailRef(value);
      const parsed = detailSchema.safeParse(value);
      if (parsed.success && typeof ref === "string" && expectedByRef.has(ref))
        return;
      const entity =
        typeof ref === "string" ? expectedByRef.get(ref) : undefined;
      if (!entity) return;
      repairs.push({
        slot: {
          description: describeRepairSlot(
            `Correct ${key} item ${index + 1} for frozen ${entity.kind} "${entity.title}" (semanticKey: ${entity.semanticKey}); use exact ref ${entity.ref} and kind ${entity.kind}. Fill every required descriptive string and required list with meaningful domain-specific content, never empty placeholders.`,
            schemaForEntity(entity),
            value,
            KACOM_SUFFIX_HINTS,
          ),
          currentValue: value,
          schema: schemaForEntity(entity),
        },
        apply: (rootValue, repaired) => {
          const list = Array.isArray(rootValue[key]) ? rootValue[key] : [];
          list[index] = repaired;
          rootValue[key] = list;
        },
      });
    });
    const present = new Set(
      values.flatMap((value) => {
        const ref = detailRef(value);
        return typeof ref === "string" ? [ref] : [];
      }),
    );
    expected.forEach((entity) => {
      if (present.has(entity.ref)) return;
      repairs.push({
        slot: {
          description: `Add the missing required ${key} detail for frozen ${entity.kind} "${entity.title}" (semanticKey: ${entity.semanticKey}), using exact ref ${entity.ref}. Fill every required descriptive string and required list with meaningful domain-specific content, never empty placeholders.`,
          schema: schemaForEntity(entity),
        },
        apply: (rootValue, repaired) => {
          const list = Array.isArray(rootValue[key]) ? rootValue[key] : [];
          list.push(repaired);
          rootValue[key] = list;
        },
      });
    });
  };
  addDetailRepairs(atomDetails, expectedAtoms, "atomDetails", atomDetailSchema);
  addDetailRepairs(
    constructDetails,
    expectedConstructs,
    "constructDetails",
    constructDetailSchema,
  );
  const auditSchema = unitCognitiveModelTargetSuffixBindingSchema.shape.audit;
  if (!auditSchema.safeParse(normalizedRoot.audit).success) {
    repairs.push({
      slot: {
        description: describeRepairSlot(
          "Correct the required suffix audit summary without changing the frozen prefix.",
          auditSchema,
          normalizedRoot.audit,
          KACOM_SUFFIX_HINTS,
        ),
        currentValue: normalizedRoot.audit,
        schema: auditSchema,
      },
      apply: (rootValue, repaired) => {
        rootValue.audit = repaired;
      },
    });
  }
  if (repairs.length === 0) {
    const synthesized = synthesizeMissingKacomDetails(
      normalizedRoot,
      contract,
    );
    const parsed = schema.safeParse(
      normalizeTargetSuffixCandidate(synthesized, contract, externalEntities),
    );
    if (parsed.success) {
      return {
        value: parsed.data,
        repairedValueCount: 0,
        issueCategories: zodIssueCategories(initial.error),
        usedSynthesis: true,
        structuredIssues: buildValidationReport(
          initial.error,
          candidate,
          KACOM_SUFFIX_HINTS,
        ).issues,
      };
    }
    throw initial.error;
  }
  let values: unknown[];
  try {
    values = await runSinglePositionalRepair({
      operation: "cognitive_model.unit_generate.target_first.suffix",
      slots: repairs.map((repair) => repair.slot),
      meta,
      topicCategory: normalizeTopicCategory(params.topicCategory, "general"),
      signal: params.signal,
      runner: repairRunner,
    });
  } catch {
    const synthesized = synthesizeMissingKacomDetails(
      normalizedRoot,
      contract,
    );
    return {
      value: schema.parse(
        normalizeTargetSuffixCandidate(
          synthesized,
          contract,
          externalEntities,
        ),
      ),
      repairedValueCount: 0,
      issueCategories: zodIssueCategories(initial.error),
      usedSynthesis: true,
      structuredIssues: buildValidationReport(
        initial.error,
        candidate,
        KACOM_SUFFIX_HINTS,
      ).issues,
    };
  }
  repairs.forEach((repair, index) =>
    repair.apply(normalizedRoot, values[index]),
  );
  const afterRepair = normalizeTargetSuffixCandidate(
    normalizedRoot,
    contract,
    externalEntities,
  );
  const repairedParse = schema.safeParse(afterRepair);
  if (repairedParse.success) {
    return {
      value: repairedParse.data,
      repairedValueCount: repairs.length,
      issueCategories: zodIssueCategories(initial.error),
    };
  }
  const synthesized = synthesizeMissingKacomDetails(
    asRecord(afterRepair) ?? normalizedRoot,
    contract,
  );
  return {
    value: schema.parse(
      normalizeTargetSuffixCandidate(synthesized, contract, externalEntities),
    ),
    repairedValueCount: repairs.length,
    issueCategories: zodIssueCategories(initial.error),
    usedSynthesis: true,
    structuredIssues: buildValidationReport(
      repairedParse.error,
      afterRepair,
      KACOM_SUFFIX_HINTS,
    ).issues,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function synthesizeMissingKacomDetails(
  root: Record<string, unknown>,
  contract: UnitCognitiveModelTargetContract,
): Record<string, unknown> {
  const next = { ...root };
  const atomRefs = new Set(
    (Array.isArray(next.atomDetails) ? next.atomDetails : []).flatMap((item) => {
      const ref = asRecord(item)?.ref;
      return typeof ref === "string" ? [ref] : [];
    }),
  );
  const constructRefs = new Set(
    (Array.isArray(next.constructDetails) ? next.constructDetails : []).flatMap(
      (item) => {
        const ref = asRecord(item)?.ref;
        return typeof ref === "string" ? [ref] : [];
      },
    ),
  );
  const atoms = Array.isArray(next.atomDetails) ? [...next.atomDetails] : [];
  const constructs = Array.isArray(next.constructDetails)
    ? [...next.constructDetails]
    : [];
  const warnings: string[] = [];
  for (const entity of contract.entities) {
    if (entity.kind === "atom" && !atomRefs.has(entity.ref)) {
      atoms.push({
        ref: entity.ref,
        description: entity.title,
        statement: entity.title,
        explanation: entity.title,
        boundary: entity.title,
        knowledgeForm: "declarative",
        assessmentHints: [entity.title],
      });
      warnings.push(`Synthesized missing atom detail ${entity.ref}`);
    }
    if (entity.kind !== "atom" && !constructRefs.has(entity.ref)) {
      constructs.push({
        ref: entity.ref,
        kind: entity.kind,
        description: entity.title,
        objective: entity.title,
        inputs: [entity.title],
        outputs: [entity.title],
        qualityCriteria: [entity.title],
        compositionStrategy: entity.title,
      });
      warnings.push(`Synthesized missing construct detail ${entity.ref}`);
    }
  }
  next.atomDetails = atoms;
  next.constructDetails = constructs;
  const audit = asRecord(next.audit) ?? {
    scopeComplete: false,
    omissions: [],
    notes: [],
  };
  next.audit = {
    ...audit,
    scopeComplete: audit.scopeComplete === true,
    omissions: Array.isArray(audit.omissions) ? audit.omissions : [],
    notes: [
      ...(Array.isArray(audit.notes) ? audit.notes : []),
      ...warnings,
    ].slice(0, 20),
  };
  return next;
}

export async function generatePreparedUnitCognitiveModelTargetFirst(
  prepared: PreparedUnitCognitiveModelGeneration,
  params: UnitCognitiveModelGenerationParams,
  handlers: {
    onTargetsReady?: (
      value: UnitCognitiveModelTargetsReady,
    ) => void | Promise<void>;
  } = {},
  runner: StructuredOutputRunner = runStructuredOutput,
  repairRunner?: PositionalRepairRunner,
): Promise<UnitCognitiveModelProposal> {
  const allowedExternalRefs = new Set(
    prepared.externalEntities.map((entity) => entity.ref),
  );
  const topicCategory = normalizeTopicCategory(params.topicCategory, "general");
  const commonMeta = {
    goalId: params.goalId,
    unitTitle: params.unitTitle,
    formatVersion: 2,
  };
  const prefixOptions: StructuredOutputOptions = {
    operation: "cognitive_model.unit_generate.target_first.prefix",
    meta: { ...commonMeta, stage: "prefix" },
    topicCategory,
    schemaShape: targetPrefixJsonShape(),
    // The exact same provider-visible tool schema is used by both turns. This
    // lets the suffix reuse the prepared unit prompt cached by the prefix.
    bindingSchema: unitCognitiveModelTargetFirstBindingSchema,
  };
  const prefixCandidate = await runMergedGenerationContextScope(
    {
      subject: {},
      invocation: undefined,
    },
    () =>
      runner(z.unknown(), targetPrefixPrompt(prepared.prompt), prefixOptions, {
        signal: params.signal,
      }),
  );
  let prefixRecovery = await recoverTargetPrefix(
    prefixCandidate,
    allowedExternalRefs,
    params,
    prefixOptions.meta ?? {},
    repairRunner,
  );
  if (params.pathContract) {
    // The approved plan owns prerequisite identities/dimensions/thresholds.
    // Keep the strict schema/path checks after this deterministic projection.
    prefixRecovery = {
      ...prefixRecovery,
      value: projectApprovedEntryTargets(prefixRecovery.value, prepared.externalEntities, params.pathContract),
    };
    const boundSchema = targetPrefixWireSchema(
      allowedExternalRefs, new Set(params.planningOutcomeRefs ?? []),
    ).superRefine((value, context) => {
      try {
        validateUnitPathContract(targetPrefixToContract(value), prepared.externalEntities, params.pathContract);
      } catch (error) {
        context.addIssue({ code: "custom", message: String(error) });
      }
    });
    if (!boundSchema.safeParse(prefixRecovery.value).success) {
      const [repaired] = await runSinglePositionalRepair({
        operation: "cognitive_model.unit_generate.target_first.prefix",
        slots: [{
          description: `Repair the full prefix to satisfy the approved KACOM contract: ${JSON.stringify(params.pathContract)}. Preserve the semantic keys, kinds and required entry/exit dimensions and thresholds. External aliases: ${JSON.stringify(prepared.externalEntities.map(({ ref, semanticKey, kind }) => ({ ref, semanticKey, kind })))}`,
          currentValue: prefixRecovery.value,
          schema: boundSchema,
          expectedShape: targetPrefixJsonShape(),
        }],
        meta: prefixOptions.meta ?? {},
        topicCategory, signal: params.signal, runner: repairRunner,
      });
      prefixRecovery = {
        ...prefixRecovery,
        value: boundSchema.parse(normalizeTargetPrefixCandidate(repaired)),
        repairedValueCount: prefixRecovery.repairedValueCount + 1,
        issueCategories: [...prefixRecovery.issueCategories, "invalid_value"],
      };
    }
  }
  const normalizedPrefixCandidate =
    normalizeTargetPrefixCandidate(prefixCandidate);
  await patchActiveLlmRecoveryMetadata({
    normalizedCount:
      JSON.stringify(prefixCandidate) ===
      JSON.stringify(normalizedPrefixCandidate)
        ? 0
        : 1,
    repairCount: prefixRecovery.repairedValueCount > 0 ? 1 : 0,
    repairedValueCount: prefixRecovery.repairedValueCount,
    droppedCount: 0,
    fallbackCount: 0,
    issueCategories: prefixRecovery.issueCategories,
  });
  const contract = targetPrefixToContract(prefixRecovery.value);
  validateUnitCognitiveEntityBudget(
    { entities: prefixRecovery.value.entities },
    prepared.entityBudget,
  );
  validateProposalPlanningOutcomeCoverage(
    {
      entities: [],
      relations: [],
      components: [],
      learningTargets: contract.learningTargets.map((target) =>
        structuredClone(target),
      ),
      audit: { scopeComplete: true, omissions: [], notes: [] },
    } as UnitCognitiveModelProposal,
    params,
  );
  validateUnitPathContract(contract, prepared.externalEntities, params.pathContract);
  const ready = freezeUnitCognitiveModelTargetPrefix(contract);
  await handlers.onTargetsReady?.(ready);

  const suffixOptions: StructuredOutputOptions = {
    operation: "cognitive_model.unit_generate.target_first.suffix",
    meta: {
      ...commonMeta,
      stage: "suffix",
      prefixHash: ready.prefixHash,
    },
    topicCategory,
    schemaShape: targetSuffixJsonShape(ready.contract),
    // Keep the provider-visible schema byte-stable across lessons. Exact
    // counts, refs, and kinds remain authoritative in targetSuffixWireSchema
    // after generation; putting contract-specific array lengths in the
    // transport schema invalidates provider prompt caches for every unit.
    bindingSchema: unitCognitiveModelTargetFirstBindingSchema,
  };
  const suffixCandidate = await runMergedGenerationContextScope(
    {
      subject: {},
      invocation: undefined,
    },
    () =>
      runner(
        z.unknown(),
        targetSuffixPrompt(prepared.prompt, ready.contract),
        suffixOptions,
        {
          signal: params.signal,
        },
      ),
  );
  const suffixRecovery = await recoverTargetSuffix(
    suffixCandidate,
    ready.contract,
    prepared.externalEntities,
    params,
    suffixOptions.meta ?? {},
    repairRunner,
  );
  const normalizedSuffixCandidate = normalizeTargetSuffixCandidate(
    suffixCandidate,
    ready.contract,
    prepared.externalEntities,
  );
  const suffix = suffixRecovery.value;
  const sourceSuffix =
    suffixCandidate &&
    typeof suffixCandidate === "object" &&
    !Array.isArray(suffixCandidate)
      ? (suffixCandidate as Record<string, unknown>)
      : {};
  const sourceOptionalCount =
    (Array.isArray(sourceSuffix.relations)
      ? sourceSuffix.relations.length
      : 0) +
    (Array.isArray(sourceSuffix.components)
      ? sourceSuffix.components.length
      : 0);
  await patchActiveLlmRecoveryMetadata({
    normalizedCount:
      JSON.stringify(suffixCandidate) ===
      JSON.stringify(normalizedSuffixCandidate)
        ? 0
        : 1,
    repairCount: suffixRecovery.repairedValueCount > 0 ? 1 : 0,
    repairedValueCount: suffixRecovery.repairedValueCount,
    droppedCount: Math.max(
      0,
      sourceOptionalCount - suffix.relations.length - suffix.components.length,
    ),
    fallbackCount: suffixRecovery.usedSynthesis ? 1 : 0,
    issueCategories: suffixRecovery.issueCategories,
    structuredIssues: suffixRecovery.structuredIssues,
  });
  const proposal = canonicalizeAllowlistedEntityReuse(
    unitCognitiveModelProposalSchema.parse(
      assembleProposalUnchecked(ready.contract, suffix),
    ),
    prepared.externalEntities,
  );
  validateUnitCognitiveEntityBudget(proposal, prepared.entityBudget);
  validateExternalEntityReferences(proposal, prepared.externalEntities);
  validateUnitPathContract(proposal, prepared.externalEntities, params.pathContract);
  return proposal;
}

export async function generateUnitCognitiveModelTargetFirst(
  params: UnitCognitiveModelGenerationParams,
  handlers: {
    onTargetsReady?: (
      value: UnitCognitiveModelTargetsReady,
    ) => void | Promise<void>;
  } = {},
): Promise<{
  proposal: UnitCognitiveModelProposal;
  externalEntities: ExternalEntities;
  sources: PreparedUnitCognitiveModelGeneration["sources"];
}> {
  return runMergedGenerationContextScope(
    {
      subject: {
        userId: params.userId,
        goalId: params.goalId,
        unitId: params.unitId,
      },
      query:
        `${params.goalTitle}: ${params.unitTitle} — ${params.contentSummary}`.slice(
          0,
          4_000,
        ),
    },
    async () => {
      const normalizedParams = normalizeUnitPlanningOutcomeContext(params);
      const prepared =
        await prepareUnitCognitiveModelGeneration(normalizedParams);
      const proposal = await generatePreparedUnitCognitiveModelTargetFirst(
        prepared,
        normalizedParams,
        handlers,
      );
      return {
        proposal,
        externalEntities: prepared.externalEntities,
        sources: prepared.sources,
      };
    },
  );
}
