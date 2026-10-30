import { createHash } from "node:crypto";
import { z } from "zod";
import {
  getLanguagePromptInstruction,
  resolveGoalContentLanguage,
} from "../llm/content-language.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import type { ContentSource } from "../rag/content-sources.js";
import type { KnowledgeActivity } from "../../../domain/src/index.js";
import { retrieveContextForUnitWithSources } from "../rag/retrieve.js";
import { retrieveOrSearchWebKnowledge } from "../search/web-knowledge.js";
import { quizEvidenceContractIssues } from "./quiz-evidence.js";
import { learningTargetLessonFitIssues } from "./target-lesson-fit.js";
import { unitPathPrompt, validateUnitPathContract, type BoundUnitPath } from "./path-contract.js";

const generatedEntityRef = z.string().regex(/^e_\d+$/);
const externalEntityRef = z.string().regex(/^x_\d+$/);
const resolvableEntityRef = z.string().regex(/^(?:e|x)_\d+$/);
const targetRef = z.string().regex(/^lt_\d+$/);
const planningOutcomeRef = z.string().regex(/^o_[1-9]\d*$/);
const cognitiveDimension = z.enum([
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
]);

const generatedEntity = z.discriminatedUnion("kind", [
  z.object({
    ref: generatedEntityRef,
    semanticKey: z.string().trim().min(1),
    kind: z.literal("atom"),
    title: z.string().trim().min(1),
    description: z.string().min(1),
    statement: z.string().min(1),
    explanation: z.string().min(1),
    boundary: z.string().min(1),
    knowledgeForm: z.enum([
      "declarative",
      "relational",
      "procedural",
      "conditional",
      "criterial",
    ]),
    assessmentHints: z.array(z.string().min(1)).min(1).max(6),
  }),
  z.object({
    ref: generatedEntityRef,
    semanticKey: z.string().trim().min(1),
    kind: z.enum(["concept", "skill", "competency"]),
    title: z.string().trim().min(1),
    description: z.string().min(1),
    objective: z.string().min(1),
    inputs: z.array(z.string().min(1)).default([]),
    outputs: z.array(z.string().min(1)).default([]),
    qualityCriteria: z.array(z.string().min(1)).min(1).max(8),
    compositionStrategy: z.string().min(1),
  }),
]);

const generatedRelation = z.object({
  fromRef: resolvableEntityRef,
  toRef: resolvableEntityRef,
  relationType: z.enum([
    "prerequisite",
    "part_of",
    "causes",
    "contrasts",
    "constrains",
    "supports",
    "enables",
  ]),
  strength: z.enum(["required", "recommended"]),
  rationale: z.string().min(1),
});

const generatedComponent = z.object({
  constructRef: generatedEntityRef,
  componentRef: resolvableEntityRef,
  requirementMode: z.enum(["required", "optional", "alternative_path"]),
  componentGroup: z.string().default(""),
  threshold: z.number().min(0).max(1).default(0.7),
  gate: z.boolean().default(false),
  weight: z.number().positive().default(1),
  rationale: z.string().min(1),
});

const generatedTarget = z.object({
  ref: targetRef,
  semanticKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  explanation: z.string().min(1),
  learningObjective: z.string().min(1),
  assessmentCriteria: z
    .array(
      z.object({
        ref: z.string().regex(/^lt_\d+:c\d+$/),
        text: z.string().min(1),
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

function hasCycle(
  refs: readonly string[],
  edges: readonly { fromRef: string; toRef: string }[],
): boolean {
  const indegree = new Map(refs.map((ref) => [ref, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    indegree.set(edge.toRef, (indegree.get(edge.toRef) ?? 0) + 1);
    outgoing.set(edge.fromRef, [
      ...(outgoing.get(edge.fromRef) ?? []),
      edge.toRef,
    ]);
  }
  const queue = [...indegree]
    .filter(([, value]) => value === 0)
    .map(([ref]) => ref);
  let visited = 0;
  while (queue.length) {
    const ref = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(ref) ?? []) {
      const value = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, value);
      if (value === 0) queue.push(next);
    }
  }
  return visited !== refs.length;
}

export const unitCognitiveModelProposalBindingSchema = z.object({
  // Review and module-exit lessons may assess only already-published entities.
  // Requiring a new entity here makes the model invent a semantic duplicate.
  entities: z.array(generatedEntity).max(18),
  relations: z.array(generatedRelation).max(240).default([]),
  components: z.array(generatedComponent).max(160).default([]),
  learningTargets: z.array(generatedTarget).min(1).max(30),
  audit: z.object({
    scopeComplete: z.boolean(),
    omissions: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
  }),
});

export const unitCognitiveModelProposalSchema =
  unitCognitiveModelProposalBindingSchema.superRefine((proposal, context) => {
    const refs = new Set(proposal.entities.map((entity) => entity.ref));
    if (refs.size !== proposal.entities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entities"],
        message: "Entity refs must be unique",
      });
    }
    const semanticEntityKeys = new Set<string>();
    proposal.entities.forEach((entity, index) => {
      const key = `${entity.kind}:${entity.semanticKey.normalize("NFC").trim().toLowerCase()}`;
      if (semanticEntityKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", index, "semanticKey"],
          message: "Entity semantic keys must be unique within each kind",
        });
      }
      semanticEntityKeys.add(key);
    });
    const targetRefs = new Set(
      proposal.learningTargets.map((target) => target.ref),
    );
    if (targetRefs.size !== proposal.learningTargets.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["learningTargets"],
        message: "Learning-target refs must be unique",
      });
    }
    const semanticTargetKeys = new Set<string>();
    proposal.learningTargets.forEach((target, index) => {
      const key = target.semanticKey.normalize("NFC").trim().toLowerCase();
      if (semanticTargetKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["learningTargets", index, "semanticKey"],
          message: "Learning-target semantic keys must be unique",
        });
      }
      semanticTargetKeys.add(key);
    });
    const relationKeys = new Set<string>();
    proposal.relations.forEach((relation, index) => {
      const hasGeneratedEndpoint =
        refs.has(relation.fromRef) || refs.has(relation.toRef);
      if (!hasGeneratedEndpoint) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relations", index],
          message:
            "A generated relation must include at least one current-unit entity",
        });
      }
      if (
        [relation.fromRef, relation.toRef].some(
          (ref) => ref.startsWith("e_") && !refs.has(ref),
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relations", index],
          message: "Generated relation aliases must resolve in entities",
        });
      }
      if (relation.fromRef === relation.toRef) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relations", index],
          message: "Self relations are not allowed",
        });
      }
      const endpoints =
        relation.relationType === "contrasts"
          ? [relation.fromRef, relation.toRef].sort()
          : [relation.fromRef, relation.toRef];
      const key = `${endpoints[0]}:${endpoints[1]}:${relation.relationType}`;
      if (relationKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relations", index],
          message: "Duplicate cognitive relation",
        });
      }
      relationKeys.add(key);
    });
    const acyclic = proposal.relations.filter(
      (relation) =>
        relation.relationType === "prerequisite" ||
        relation.relationType === "part_of",
    );
    const relationRefs = new Set([
      ...refs,
      ...acyclic.flatMap((relation) => [relation.fromRef, relation.toRef]),
    ]);
    if (hasCycle([...relationRefs], acyclic)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relations"],
        message: "prerequisite and part_of relations must be acyclic",
      });
    }
    const componentKeys = new Set<string>();
    proposal.components.forEach((component, index) => {
      const construct = proposal.entities.find(
        (entity) => entity.ref === component.constructRef,
      );
      if (component.constructRef === component.componentRef) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", index],
          message: "A construct cannot be its own component",
        });
      }
      if (
        !construct ||
        construct.kind === "atom" ||
        !resolvableEntityRef.safeParse(component.componentRef).success ||
        (component.componentRef.startsWith("e_") &&
          !refs.has(component.componentRef))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", index],
          message: "Components must connect an existing construct to an entity",
        });
      }
      if (
        component.requirementMode === "alternative_path" &&
        !component.componentGroup
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", index, "componentGroup"],
          message: "Alternative paths require a component group",
        });
      }
      const key = `${component.constructRef}:${component.componentRef}`;
      if (componentKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", index],
          message: "Duplicate construct component",
        });
      }
      componentKeys.add(key);
    });
    proposal.learningTargets.forEach((target, index) => {
      if (
        target.assessmentCriteria.some(
          (criterion, criterionIndex) =>
            criterion.ref !== `${target.ref}:c${criterionIndex + 1}`,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["learningTargets", index, "assessmentCriteria"],
          message: "Criterion refs must be sequential and target-scoped",
        });
      }
      if (
        target.requirements.some(
          (requirement) =>
            requirement.entityRef.startsWith("e_") &&
            !refs.has(requirement.entityRef),
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["learningTargets", index, "requirements"],
          message: "Generated target aliases must resolve in entities",
        });
      }
      const requirementKeys = new Set<string>();
      target.requirements.forEach((requirement, requirementIndex) => {
        const key = `${requirement.entityRef}:${requirement.dimension}`;
        if (requirementKeys.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["learningTargets", index, "requirements", requirementIndex],
            message: "Duplicate target entity/dimension requirement",
          });
        }
        requirementKeys.add(key);
      });
    });
    for (const issue of quizEvidenceContractIssues(proposal.learningTargets)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path:
          issue.index === null
            ? ["learningTargets"]
            : ["learningTargets", issue.index, "requirements"],
        message: issue.message,
      });
    }
  });

const compactGeneratedEntity = z.discriminatedUnion("k", [
  z.object({
    r: generatedEntityRef,
    sk: z.string().trim().min(1),
    k: z.literal("atom"),
    ti: z.string().trim().min(1),
    d: z.string().min(1),
    st: z.string().min(1),
    ex: z.string().min(1),
    b: z.string().min(1),
    kf: z.enum([
      "declarative",
      "relational",
      "procedural",
      "conditional",
      "criterial",
    ]),
    ah: z.array(z.string().min(1)).min(1).max(6),
  }),
  z.object({
    r: generatedEntityRef,
    sk: z.string().trim().min(1),
    k: z.enum(["concept", "skill", "competency"]),
    ti: z.string().trim().min(1),
    d: z.string().min(1),
    o: z.string().min(1),
    i: z.array(z.string().min(1)).default([]),
    u: z.array(z.string().min(1)).default([]),
    qc: z.array(z.string().min(1)).min(1).max(8),
    cs: z.string().min(1),
  }),
]);

export const unitCognitiveModelProposalCompactBindingSchema = z.object({
  e: z.array(compactGeneratedEntity).max(18),
  r: z
    .array(
      z.object({
        f: resolvableEntityRef,
        t: resolvableEntityRef,
        rt: z.enum([
          "prerequisite",
          "part_of",
          "causes",
          "contrasts",
          "constrains",
          "supports",
          "enables",
        ]),
        s: z.enum(["required", "recommended"]),
        ra: z.string().min(1),
      }),
    )
    .max(240)
    .default([]),
  c: z
    .array(
      z.object({
        c: generatedEntityRef,
        p: resolvableEntityRef,
        rm: z.enum(["required", "optional", "alternative_path"]),
        cg: z.string().default(""),
        th: z.number().min(0).max(1).default(0.7),
        g: z.boolean().default(false),
        w: z.number().positive().default(1),
        ra: z.string().min(1),
      }),
    )
    .max(160)
    .default([]),
  t: z
    .array(
      z.object({
        r: targetRef,
        sk: z.string().trim().min(1),
        ti: z.string().trim().min(1),
        ex: z.string().min(1),
        o: z.string().min(1),
        ac: z
          .array(
            z.object({
              r: z.string().regex(/^lt_\d+:c\d+$/),
              tx: z.string().min(1),
            }),
          )
          .min(1)
          .max(8),
        cl: z.enum([
          "remember",
          "understand",
          "apply",
          "analyze",
          "evaluate",
          "create",
        ]),
        im: z.enum(["core", "supporting", "enrichment"]),
        iw: z.number().int().min(1).max(5),
        df: z.enum(["easy", "medium", "hard"]),
        ro: z.enum(["primary", "supporting", "review"]),
        ie: z.boolean(),
        ix: z.boolean(),
        por: z.array(planningOutcomeRef).default([]),
        rq: z
          .array(
            z.object({
              e: resolvableEntityRef,
              d: cognitiveDimension,
              req: z.boolean(),
              w: z.number().positive(),
              th: z.number().min(0).max(1),
              g: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .min(1)
    .max(30),
  a: z.object({
    sc: z.boolean(),
    om: z.array(z.string()).default([]),
    n: z.array(z.string()).default([]),
  }),
});

/** Expand token-efficient provider output before applying all KACOM invariants. */
export const unitCognitiveModelProposalCompactSchema =
  unitCognitiveModelProposalCompactBindingSchema.transform((proposal) =>
    unitCognitiveModelProposalSchema.parse({
      entities: proposal.e.map((entity) =>
        entity.k === "atom"
          ? {
              ref: entity.r,
              semanticKey: entity.sk,
              kind: entity.k,
              title: entity.ti,
              description: entity.d,
              statement: entity.st,
              explanation: entity.ex,
              boundary: entity.b,
              knowledgeForm: entity.kf,
              assessmentHints: entity.ah,
            }
          : {
              ref: entity.r,
              semanticKey: entity.sk,
              kind: entity.k,
              title: entity.ti,
              description: entity.d,
              objective: entity.o,
              inputs: entity.i,
              outputs: entity.u,
              qualityCriteria: entity.qc,
              compositionStrategy: entity.cs,
            },
      ),
      relations: proposal.r.map((relation) => ({
        fromRef: relation.f,
        toRef: relation.t,
        relationType: relation.rt,
        strength: relation.s,
        rationale: relation.ra,
      })),
      components: proposal.c.map((component) => ({
        constructRef: component.c,
        componentRef: component.p,
        requirementMode: component.rm,
        componentGroup: component.cg,
        threshold: component.th,
        gate: component.g,
        weight: component.w,
        rationale: component.ra,
      })),
      learningTargets: proposal.t.map((target) => ({
        ref: target.r,
        semanticKey: target.sk,
        title: target.ti,
        explanation: target.ex,
        learningObjective: target.o,
        assessmentCriteria: target.ac.map((criterion) => ({
          ref: criterion.r,
          text: criterion.tx,
        })),
        targetCognitiveLevel: target.cl,
        importance: target.im,
        importanceWeight: target.iw,
        difficulty: target.df,
        role: target.ro,
        isEntry: target.ie,
        isExit: target.ix,
        planningOutcomeRefs: target.por,
        requirements: target.rq.map((requirement) => ({
          entityRef: requirement.e,
          dimension: requirement.d,
          required: requirement.req,
          weight: requirement.w,
          threshold: requirement.th,
          gate: requirement.g,
        })),
      })),
      audit: {
        scopeComplete: proposal.a.sc,
        omissions: proposal.a.om,
        notes: proposal.a.n,
      },
    }),
  );

export type UnitCognitiveModelProposal = z.infer<
  typeof unitCognitiveModelProposalSchema
>;

export type ExistingGoalCognitiveEntity = {
  id: string;
  stableKey: string;
  semanticKey?: string;
  kind: string;
  title: string;
  description: string;
  ownerCurriculumKey?: string;
};

export type ExternalCognitiveEntityReference = ExistingGoalCognitiveEntity & {
  ref: string;
  isPredecessorExit: boolean;
};

function compareStableText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * External aliases are prompt-local, deterministic for the same published
 * entity set, and never become cognitive identity. Current-unit-owned rows are
 * deliberately excluded so regeneration must redefine them with e_N refs.
 */
export function buildExternalEntityCatalog(params: {
  entities: readonly ExistingGoalCognitiveEntity[];
  currentCurriculumKey: string;
  predecessorExitEntityIds: ReadonlySet<string>;
  maximumEntities?: number;
  preferredSemanticKeys?: ReadonlySet<string>;
}): ExternalCognitiveEntityReference[] {
  const seenIds = new Set<string>();
  const seenStableKeys = new Set<string>();
  const eligible = params.entities
    .filter(
      (entity) => entity.ownerCurriculumKey !== params.currentCurriculumKey,
    )
    .sort(
      (left, right) =>
        Number(params.preferredSemanticKeys?.has(right.semanticKey ?? "")) -
          Number(params.preferredSemanticKeys?.has(left.semanticKey ?? "")) ||
        Number(params.predecessorExitEntityIds.has(right.id)) -
          Number(params.predecessorExitEntityIds.has(left.id)) ||
        compareStableText(left.stableKey, right.stableKey) ||
        compareStableText(left.kind, right.kind) ||
        compareStableText(left.id, right.id),
    )
    .slice(0, Math.max(0, params.maximumEntities ?? 42));
  for (const entity of eligible) {
    if (seenIds.has(entity.id)) {
      throw new Error(`Duplicate external cognitive entity ${entity.id}`);
    }
    if (seenStableKeys.has(entity.stableKey)) {
      throw new Error(
        `Duplicate external cognitive stable key ${entity.stableKey}`,
      );
    }
    seenIds.add(entity.id);
    seenStableKeys.add(entity.stableKey);
  }
  return eligible.map((entity, index) => ({
    ...entity,
    ref: `x_${index + 1}`,
    isPredecessorExit: params.predecessorExitEntityIds.has(entity.id),
  }));
}

/** Reject every LLM-authored alias that is not in the server-built allowlist. */
export function validateExternalEntityReferences(
  proposal: UnitCognitiveModelProposal,
  externalEntities: readonly ExternalCognitiveEntityReference[],
): void {
  const allowed = new Map<string, ExternalCognitiveEntityReference>();
  for (const entity of externalEntities) {
    if (!externalEntityRef.safeParse(entity.ref).success) {
      throw new Error(`Invalid external cognitive alias ${entity.ref}`);
    }
    if (allowed.has(entity.ref)) {
      throw new Error(`Duplicate external cognitive alias ${entity.ref}`);
    }
    allowed.set(entity.ref, entity);
  }
  const used = new Set<string>();
  const generated = new Set(proposal.entities.map((entity) => entity.ref));
  for (const relation of proposal.relations) {
    used.add(relation.fromRef);
    used.add(relation.toRef);
  }
  for (const component of proposal.components) used.add(component.componentRef);
  for (const target of proposal.learningTargets) {
    for (const requirement of target.requirements) {
      used.add(requirement.entityRef);
    }
  }
  for (const ref of used) {
    if (ref.startsWith("e_") && !generated.has(ref)) {
      throw new Error(`Unresolved generated cognitive alias ${ref}`);
    }
    if (ref.startsWith("x_") && !allowed.has(ref)) {
      throw new Error(`Unallowlisted external cognitive alias ${ref}`);
    }
  }
}

function normalizedSemanticIdentity(kind: string, semanticKey: string): string {
  return `${kind}:${semanticKey.normalize("NFC").trim().toLowerCase()}`;
}

/**
 * A reuse-only review/diagnostic is allowed to define no new cognitive
 * entities. If a provider nevertheless recreates an allowlisted identity with
 * an e_N alias, deterministically resolve that exact kind + semanticKey to the
 * server-owned x_N alias instead of failing after a successful LLM call.
 *
 * This is deliberately exact-key-only: fuzzy title matching must never merge
 * cognitive identities. Optional relations/components that would mutate only
 * external entities are dropped after the remap.
 */
export function canonicalizeAllowlistedEntityReuse(
  input: UnitCognitiveModelProposal,
  externalEntities: readonly ExternalCognitiveEntityReference[],
): UnitCognitiveModelProposal {
  const externalByIdentity = new Map<
    string,
    ExternalCognitiveEntityReference | null
  >();
  for (const external of externalEntities) {
    if (!external.semanticKey) continue;
    const key = normalizedSemanticIdentity(external.kind, external.semanticKey);
    externalByIdentity.set(key, externalByIdentity.has(key) ? null : external);
  }

  const remappedRefs = new Map<string, string>();
  for (const entity of input.entities) {
    const external = externalByIdentity.get(
      normalizedSemanticIdentity(entity.kind, entity.semanticKey),
    );
    if (external) remappedRefs.set(entity.ref, external.ref);
  }
  if (remappedRefs.size === 0) return input;

  const remap = (ref: string) => remappedRefs.get(ref) ?? ref;
  const entities = input.entities.filter(
    (entity) => !remappedRefs.has(entity.ref),
  );
  const generatedRefs = new Set(entities.map((entity) => entity.ref));

  const relationKeys = new Set<string>();
  const acyclicRelations: Array<{ fromRef: string; toRef: string }> = [];
  const relations = input.relations.flatMap((source) => {
    const relation = {
      ...source,
      fromRef: remap(source.fromRef),
      toRef: remap(source.toRef),
    };
    if (
      relation.fromRef === relation.toRef ||
      (!generatedRefs.has(relation.fromRef) &&
        !generatedRefs.has(relation.toRef))
    ) {
      return [];
    }
    const endpoints =
      relation.relationType === "contrasts"
        ? [relation.fromRef, relation.toRef].sort()
        : [relation.fromRef, relation.toRef];
    const key = `${endpoints[0]}:${endpoints[1]}:${relation.relationType}`;
    if (relationKeys.has(key)) return [];
    if (
      (relation.relationType === "prerequisite" ||
        relation.relationType === "part_of") &&
      hasCycle(
        [
          ...new Set(
            [...acyclicRelations, relation].flatMap((edge) => [
              edge.fromRef,
              edge.toRef,
            ]),
          ),
        ],
        [...acyclicRelations, relation],
      )
    ) {
      return [];
    }
    relationKeys.add(key);
    if (
      relation.relationType === "prerequisite" ||
      relation.relationType === "part_of"
    ) {
      acyclicRelations.push(relation);
    }
    return [relation];
  });

  const componentKeys = new Set<string>();
  const components = input.components.flatMap((source) => {
    // External constructs are immutable and cannot gain unit-owned components.
    if (remappedRefs.has(source.constructRef)) return [];
    const component = {
      ...source,
      componentRef: remap(source.componentRef),
    };
    if (component.constructRef === component.componentRef) return [];
    const key = `${component.constructRef}:${component.componentRef}`;
    if (componentKeys.has(key)) return [];
    componentKeys.add(key);
    return [component];
  });

  const learningTargets = input.learningTargets.map((target) => {
    const requirements = new Map<
      string,
      (typeof target.requirements)[number]
    >();
    for (const source of target.requirements) {
      const requirement = {
        ...source,
        entityRef: remap(source.entityRef),
      };
      const key = `${requirement.entityRef}:${requirement.dimension}`;
      const previous = requirements.get(key);
      requirements.set(
        key,
        previous
          ? {
              ...previous,
              required: previous.required || requirement.required,
              weight: Math.max(previous.weight, requirement.weight),
              threshold: Math.max(previous.threshold, requirement.threshold),
              gate: previous.gate || requirement.gate,
            }
          : requirement,
      );
    }
    return { ...target, requirements: [...requirements.values()] };
  });

  return unitCognitiveModelProposalSchema.parse({
    ...input,
    entities,
    relations,
    components,
    learningTargets,
  });
}

function stableSourceKey(source: ContentSource): string {
  return source.kind === "web"
    ? `web:${source.url ?? source.title}`
    : `upload:${source.filename ?? source.title}`;
}

function mergeSources(...groups: ContentSource[][]): ContentSource[] {
  const indexByKey = new Map<string, number>();
  const merged: ContentSource[] = [];
  for (const source of groups.flat()) {
    const key = stableSourceKey(source);
    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      indexByKey.set(key, merged.length);
      merged.push(source);
      continue;
    }

    // RAG returns one ContentSource per chunk. Keep one prompt source entry,
    // while retaining distinct chunk excerpts from that source.
    const existing = merged[existingIndex]!;
    const excerpt = source.excerpt?.trim();
    if (excerpt && !existing.excerpt?.includes(excerpt)) {
      merged[existingIndex] = {
        ...existing,
        excerpt: [existing.excerpt?.trim(), excerpt].filter(Boolean).join("\n"),
      };
    }
  }
  return merged;
}

function sourceBlock(sources: ContentSource[]): string {
  if (sources.length === 0) return "No external sources are available.";
  return sources
    .map(
      (source) =>
        `${source.title}\n${source.url ?? source.filename ?? ""}\n${source.excerpt ?? ""}`,
    )
    .join("\n\n");
}

export function unitCognitiveModelProposalJsonShape() {
  return '{"e":[{"r":"e_1","sk":"atomic_fact","k":"atom","ti":"...","d":"...","st":"...","ex":"...","b":"...","kf":"declarative","ah":["..."]},{"r":"e_2","sk":"composed_concept","k":"concept","ti":"...","d":"...","o":"...","i":["..."],"u":["..."],"qc":["..."],"cs":"..."}],"r":[{"f":"e_1","t":"e_2","rt":"part_of","s":"required","ra":"..."}],"c":[{"c":"e_2","p":"e_1","rm":"required","cg":"","th":0.7,"g":true,"w":1,"ra":"..."}],"t":[{"r":"lt_1","sk":"demonstrate_concept","ti":"...","ex":"...","o":"...","ac":[{"r":"lt_1:c1","tx":"..."}],"cl":"understand","im":"core","iw":5,"df":"medium","ro":"primary","ie":true,"ix":true,"por":["o_1"],"rq":[{"e":"e_2","d":"understanding","req":true,"w":1,"th":0.7,"g":true}]}],"a":{"sc":true,"om":[],"n":[]}}';
}

export type UnitCognitiveModelGenerationParams = {
  userId?: string;
  goalId: string;
  unitId?: string;
  goalTitle: string;
  goalLevel: string;
  domainTag: string;
  topicCategory: string;
  contentLanguage: string;
  currentCurriculumKey: string;
  unitTitle: string;
  contentSummary: string;
  planningOutcomes?: Array<{ ref: string; label: string }>;
  planningOutcomeRefs?: string[];
  pathContract?: BoundUnitPath;
  moduleContext?: {
    title: string;
    objective: string;
    capabilityRefs: string[];
    capabilities: Array<{
      localRef: string;
      title: string;
      objective: string;
    }>;
    remainingEntityBudget: number;
  };
  curriculumOutline: Array<{
    title: string;
    unitKind: string;
    contentSummary: string;
  }>;
  siblingScopes: Array<{ title: string; contentSummary: string }>;
  predecessorExits: Array<{
    id: string;
    stableKey: string;
    kind: string;
    title: string;
    description: string;
  }>;
  existingEntities: ExistingGoalCognitiveEntity[];
  onKnowledgeActivity?: (activity: KnowledgeActivity) => void | Promise<void>;
  signal?: AbortSignal;
};

export type PreparedUnitCognitiveModelGeneration = {
  prompt: string;
  sources: ContentSource[];
  externalEntities: ExternalCognitiveEntityReference[];
  entityBudget: number;
};

/**
 * Database/provider-free authority required to author one KACOM unit slice.
 * Callers resolve document/search context and all persisted curriculum/entity
 * authority before crossing this boundary.
 */
export type PrepareUnitCognitiveModelAuthoringInput = Omit<
  UnitCognitiveModelGenerationParams,
  "userId" | "onKnowledgeActivity" | "signal"
> & {
  sources: ContentSource[];
};

/**
 * Reconcile persisted unit bindings with the currently approved goal plan.
 * Map regeneration can leave an in-flight or legacy unit carrying positional
 * o_N refs that no longer exist. Those stale refs are not authoritative and
 * must never make the LLM contract impossible to satisfy.
 */
export function normalizeUnitPlanningOutcomeContext(
  params: UnitCognitiveModelGenerationParams,
): UnitCognitiveModelGenerationParams {
  const outcomes = params.planningOutcomes ?? [];
  const known = new Set(outcomes.map((outcome) => outcome.ref));
  const planningOutcomeRefs =
    known.size === 0
      ? []
      : [
          ...new Set(
            (params.planningOutcomeRefs ?? []).filter((ref) => known.has(ref)),
          ),
        ];
  if (
    planningOutcomeRefs.length === (params.planningOutcomeRefs ?? []).length &&
    planningOutcomeRefs.every(
      (ref, index) => ref === params.planningOutcomeRefs?.[index],
    )
  ) {
    return params;
  }
  return { ...params, planningOutcomeRefs };
}

export function unitCognitiveEntityBudget(
  params: Pick<UnitCognitiveModelGenerationParams, "moduleContext" | "pathContract">,
): number {
  const targetBudget = 4;
  // Keep each lesson compact, but do not let entities authored by earlier
  // lessons make a later lesson's contract impossible to satisfy. The module
  // total is planning guidance; the per-lesson bound is the hard generation
  // safeguard.
  return Math.min(18, Math.max(targetBudget * 3, params.pathContract?.entities.length ?? 0));
}

export function validateUnitCognitiveEntityBudget(
  proposal: { entities: readonly unknown[] },
  entityBudget: number,
): void {
  if (proposal.entities.length > entityBudget) {
    throw new Error(
      `Unit cognitive entity budget exceeded: ${proposal.entities.length}/${entityBudget}`,
    );
  }
}

/** Build the canonical one-unit KACOM prompt from already-resolved authority. */
export function prepareUnitCognitiveModelAuthoring(
  input: PrepareUnitCognitiveModelAuthoringInput,
): PreparedUnitCognitiveModelGeneration {
  const params = normalizeUnitPlanningOutcomeContext(input);
  const sources = mergeSources(input.sources);
  const language = resolveGoalContentLanguage(
    params.contentLanguage,
    `${params.goalTitle} ${params.unitTitle}`,
  );
  const targetBudget = 4;
  const entityBudget = unitCognitiveEntityBudget(params);
  const externalEntities = buildExternalEntityCatalog({
    entities: params.existingEntities.filter((entity) =>
      !params.pathContract?.otherPlannedEntityKeys.includes(entity.semanticKey ?? ""),
    ),
    currentCurriculumKey: params.currentCurriculumKey,
    predecessorExitEntityIds: new Set(
      params.predecessorExits.map((entity) => entity.id),
    ),
    maximumEntities: 60 - entityBudget,
    preferredSemanticKeys: new Set(params.pathContract?.entities.map((entity) => entity.semanticKey)),
  });
  const externalById = new Map(
    externalEntities.map((entity) => [entity.id, entity]),
  );
  const currentUnitEntities = params.existingEntities
    .filter(
      (entity) => entity.ownerCurriculumKey === params.currentCurriculumKey,
    )
    .sort(
      (left, right) =>
        compareStableText(left.stableKey, right.stableKey) ||
        compareStableText(left.id, right.id),
    )
    .slice(0, entityBudget);
  const workingExistingEntities = [...externalEntities, ...currentUnitEntities];
  const prompt = `Build the KACOM cognitive model for exactly one lesson.

Goal: ${params.goalTitle}
Level: ${params.goalLevel}
Unit: ${params.unitTitle}
Scope: ${params.contentSummary || params.unitTitle}
Goal language (global for every user-facing field in this request):
${getLanguagePromptInstruction(language)}

Approved goal outcomes:
${
  params.planningOutcomes
    ?.map((outcome) => `- ${outcome.ref}: ${outcome.label}`)
    .join("\n") || "Legacy unbound goal"
}

Outcomes assigned to this lesson:
${params.planningOutcomeRefs?.join(", ") || "None (legacy unbound lesson)"}

${unitPathPrompt(params.pathContract)}

${
  params.moduleContext
    ? `Current sequential module:
- Module: ${params.moduleContext.title}
- Observable module objective: ${params.moduleContext.objective}
- Capability refs assigned to this unit: ${params.moduleContext.capabilityRefs.join(", ")}
- Frozen module exit capabilities:
${params.moduleContext.capabilities
  .map(
    (capability) =>
      `  - ${capability.localRef}: ${capability.title} — ${capability.objective}`,
  )
  .join("\n")}
- Suggested remaining unique-entity allowance for this module: ${params.moduleContext.remainingEntityBudget}

Module-aware rules:
- This unit is one ordered step toward the module exit capabilities, not an independent topic card.
- Reuse matching existing x_N entities from earlier units/modules instead of redefining them.
- Add prerequisite, enables, or supports relations to earlier entities when the dependency is real.
- Create only the targets/entities needed by this unit and its assigned module capabilities. Prefer the suggested module allowance, but exceed it when necessary for a coherent lesson contract.
- Never preview or model a locked future module.
- Prefer a small coherent graph over exhaustive atom enumeration.`
    : ""
}

Canonical curriculum order (never reorder or rewrite it):
${params.curriculumOutline.map((unit, index) => `${index + 1}. [${unit.unitKind}] ${unit.title}`).join("\n")}

Sibling scopes to exclude:
${params.siblingScopes.map((unit) => `- ${unit.title}: ${unit.contentSummary}`).join("\n") || "None"}

Published predecessor exits (use the exact x_N alias when needed; do not recreate):
${
  externalEntities
    .filter((entity) => entity.isPredecessorExit)
    .map(
      (entity) =>
        `- ${entity.ref}; stableKey=${entity.stableKey} [${entity.kind}] ${entity.title}: ${entity.description}`,
    )
    .join("\n") || "None"
}

Existing goal entities (avoid semantic duplicates; preserve a matching semanticKey):
${
  workingExistingEntities
    .map((entity) => {
      const external = externalById.get(entity.id);
      const reference = external
        ? `externalRef=${external.ref}; use this alias instead of recreating`
        : "current-unit definition; regenerate it with an e_N ref";
      return `- ${reference}; semanticKey=${entity.semanticKey ?? entity.stableKey} [${entity.kind}] ${entity.title}`;
    })
    .join("\n") || "None"
}

Rules:
- Stay proportional to this lesson: use at most ${targetBudget} learning targets and ${entityBudget} entities, and use fewer whenever they fully cover the scope.
- Every LearningTarget title, explanation, learningObjective, and assessmentCriteria text must be written in ${language} and must assess only this lesson's scope. Never invent an unrelated subject (for example algebra on an AI/memory lesson).
- A review, cumulative practice, or diagnostic lesson may reuse only x_N entities and return zero e_N entities. Never invent a renamed entity merely to make the entity array non-empty.
- Be concise. Each free-text field is one short sentence or clause. Use one assessment hint per atom, 1-2 quality criteria per construct, and 1-2 assessment criteria per target. Do not restate the same idea across description, statement, explanation, objective, or criteria.
- Knowledge atoms are the foundation: each atom is one smallest independently stateable piece of content. It is never a lesson objective, activity, or learner state.
- Build typed relations between entities. prerequisite and part_of must be acyclic. Emit a contrasts pair once; the server supplies symmetric semantics.
- Concepts are stable structures of atoms/relations. Skills execute operations or strategies. Competencies coordinate skills under context, constraints, and feedback.
- Components declare required, optional, or grouped alternative paths. Required non-compensatory thresholds use gate=true.
- LearningTarget is a course-local teaching and assessment rule. It may require multiple entities and dimensions; it is not a cognitive entity.
- Every core or supporting LearningTarget MUST include at least one requirement with dimension memory or understanding so unit quizzes and inline checks can create selected-response evidence. Application, transfer, and operating-quality dimensions may be added in addition, never as the sole requirement set for core/supporting targets. Prefer memory on atoms and understanding on concepts/skills when both performance and selected-response evidence are needed.
- For a contract-bound lesson, every LearningTarget must include planningOutcomeRefs using only the assigned o_N refs, and their union must cover every assigned outcome. These refs are planning traceability only, never learner state.
- Include all materially necessary atoms before constructs. High-level constructs may only be demonstrated by direct task evidence later; components indicate readiness only.
- Criteria refs are exact sequential refs lt_N:c1, lt_N:c2, ... and will be enforced by the server.
- Transfer requirements are valid only for explicit far-context tasks. Do not infer learner state.
- semanticKey must be stable, concise, language-neutral where practical, and independent of title/order. Reuse a matching existing key.
- e_N aliases define current-unit entities. x_N aliases may reference only the exact allowlisted existing entities above and never create, merge, rename, or redefine them.
- Relations may use e_N or x_N endpoints, but every new relation must contain at least one e_N endpoint. Components must be owned by a current-unit construct; their member and LearningTarget requirements may use x_N.
- Each relation includes both entity aliases, its type, strength, and concise rationale. relationType must be prerequisite, part_of, causes, contrasts, constrains, supports, or enables; strength must be required or recommended.
- Each component includes its construct and component aliases, requirement mode, group, threshold, gate, weight, and concise rationale. requirementMode must be required, optional, or alternative_path.
- Enum values are exact English tokens: knowledgeForm = declarative | relational | procedural | conditional | criterial; targetCognitiveLevel = remember | understand | apply | analyze | evaluate | create; importance = core | supporting | enrichment; difficulty = easy | medium | hard; role = primary | supporting | review; requirement dimension = memory | understanding | application | transfer | fluency | stability | independence. audit.omissions and audit.notes are always JSON arrays of strings, even when there is only one item.
- External sources are context only. Do not emit citations, source indexes, source references, or grounding-confidence fields.

Sources:
${sourceBlock(sources)}`;

  return { prompt, sources, externalEntities, entityBudget };
}

/**
 * Resolve server-owned context and build the shared KACOM prompt. Streaming
 * encodings and provider-native structured output must start from this exact
 * preparation so their scope, aliases, budgets, and source catalog agree.
 */
export async function prepareUnitCognitiveModelGeneration(
  params: UnitCognitiveModelGenerationParams,
): Promise<PreparedUnitCognitiveModelGeneration> {
  const retrieved = await retrieveContextForUnitWithSources(
    params.goalId,
    params.unitTitle,
    `${params.contentSummary} concepts skills competencies prerequisites`,
    8,
  );
  let searched: ContentSource[] = [];
  if (retrieved.sources.length === 0 && params.userId) {
    try {
      searched = (
        await retrieveOrSearchWebKnowledge({
          userId: params.userId,
          goalId: params.goalId,
          query: `${params.goalTitle} ${params.unitTitle} authoritative syllabus concepts skills`,
          reason: "为新的学习目标补充当前权威资料",
          freshnessClass: "normal",
          onActivity: params.onKnowledgeActivity,
        })
      ).sources;
    } catch {
      searched = [];
    }
  }
  return prepareUnitCognitiveModelAuthoring({
    ...params,
    sources: mergeSources(retrieved.sources, searched),
  });
}

export async function generateUnitCognitiveModel(
  params: UnitCognitiveModelGenerationParams,
): Promise<{
  proposal: UnitCognitiveModelProposal;
  externalEntities: ExternalCognitiveEntityReference[];
  sources: ContentSource[];
}> {
  params = normalizeUnitPlanningOutcomeContext(params);
  const { prompt, sources, externalEntities, entityBudget } =
    await prepareUnitCognitiveModelGeneration(params);

  const generatedProposal = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: unitCognitiveModelProposalCompactSchema,
      prompt,
      options: {
        operation: "unit.cognitive_model",
        meta: { goalId: params.goalId, unitTitle: params.unitTitle },
        schemaShape: unitCognitiveModelProposalJsonShape(),
        bindingSchema: unitCognitiveModelProposalCompactBindingSchema,
      },
      contextSubject: {
        userId: params.userId,
        goalId: params.goalId,
        unitId: params.unitId,
      },
      contextQuery:
        `${params.goalTitle}: ${params.unitTitle} — ${params.contentSummary}`.slice(
          0,
          4_000,
        ),
    },
    { signal: params.signal },
  );
  const proposal = canonicalizeAllowlistedEntityReuse(
    generatedProposal,
    externalEntities,
  );
  validateUnitCognitiveEntityBudget(proposal, entityBudget);
  validateProposalPlanningOutcomeCoverage(proposal, params);
  validateUnitPathContract(proposal, externalEntities, params.pathContract);
  validateExternalEntityReferences(proposal, externalEntities);
  const lessonFit = learningTargetLessonFitIssues(proposal.learningTargets, {
    contentLanguage: params.contentLanguage,
    unitTitle: params.unitTitle,
    contentSummary: params.contentSummary,
  });
  if (lessonFit.length > 0) {
    throw new Error(lessonFit.map((issue) => issue.message).join("; "));
  }
  return { proposal, externalEntities, sources };
}

export function validateProposalPlanningOutcomeCoverage(
  proposal: UnitCognitiveModelProposal,
  params: Pick<
    UnitCognitiveModelGenerationParams,
    "planningOutcomes" | "planningOutcomeRefs"
  >,
): void {
  const assigned = new Set(params.planningOutcomeRefs ?? []);
  if (assigned.size === 0) return;
  const known = new Set(
    (params.planningOutcomes ?? []).map((outcome) => outcome.ref),
  );
  for (const ref of assigned) {
    if (!known.has(ref)) {
      throw new Error(`Unit cites unknown approved outcome ${ref}`);
    }
  }
  const covered = new Set<string>();
  for (const target of proposal.learningTargets) {
    for (const ref of target.planningOutcomeRefs) {
      if (!assigned.has(ref)) {
        throw new Error(
          `LearningTarget ${target.ref} cites unassigned outcome ${ref}`,
        );
      }
      covered.add(ref);
    }
  }
  const missing = [...assigned].filter((ref) => !covered.has(ref));
  if (missing.length) {
    throw new Error(
      `LearningTargets omit assigned outcomes: ${missing.join(", ")}`,
    );
  }
}

export function scopedStableKey(
  curriculumKey: string,
  kind: string,
  semanticKey: string,
): string {
  const normalized = semanticKey.normalize("NFC").trim().toLowerCase();
  const digest = createHash("sha256")
    .update(`${curriculumKey}\n${kind}\n${normalized}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}:${digest}`;
}
