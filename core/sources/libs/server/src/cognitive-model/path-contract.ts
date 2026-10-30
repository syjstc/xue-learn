import {
  learningPathContractSchema,
  type PathEntity,
  type PathUnitContract,
} from "../../../domain/src/learning-path-contract.js";

export type BoundUnitPath = {
  entities: PathEntity[];
  unit: PathUnitContract;
  planningOutcomeRefs: string[];
  otherPlannedEntityKeys: string[];
};

/** Only canonical lesson titles materialized from the approved plan are bound. */
export function resolveBoundUnitPath(
  plan: { modules?: Array<{ title: string }>; learningPath?: unknown } | null,
  moduleTitle: string | undefined,
  unitTitle: string,
): BoundUnitPath | undefined {
  if (!plan?.learningPath || !moduleTitle) return undefined;
  const path = learningPathContractSchema.parse(plan.learningPath);
  const moduleIndex = plan.modules?.findIndex((module) => module.title === moduleTitle) ?? -1;
  if (moduleIndex < 0) throw new Error("The lesson's module is missing from its approved capability path.");
  const module = path.modules[moduleIndex]!;
  const unit = module.units.find((entry) => entry.title === unitTitle);
  // Remediation/review lessons are separate, adaptive additions to the skeleton.
  if (!unit) return undefined;
  const keys = new Set([...unit.requires, ...unit.provides].map((entry) => entry.entityKey));
  const supported = new Set(unit.supports);
  return {
    entities: path.entities.filter((entity) => keys.has(entity.semanticKey)),
    unit,
    planningOutcomeRefs: path.goal.outcomes
      .filter((outcome) => outcome.requires.some((entry) => supported.has(entry.entityKey)))
      .map((outcome) => outcome.outcomeRef),
    otherPlannedEntityKeys: path.entities
      .filter((entity) => !keys.has(entity.semanticKey)).map((entity) => entity.semanticKey),
  };
}

export function unitPathPrompt(path: BoundUnitPath | undefined): string {
  if (!path) return "";
  return `
Approved KACOM lesson contract (authoritative):
${JSON.stringify({ entities: path.entities, unit: path.unit, planningOutcomeRefs: path.planningOutcomeRefs })}
Preserve every listed semanticKey, kind, scope, and required dimension/threshold.
For EVERY requires dimension, include a required requirement in an isEntry target.
For EVERY provides dimension, include a required requirement in an isExit target.
Use the existing x_N alias for a matching published identity, otherwise define it with e_N.
Entry targets describe assumed prerequisites, never a claim that this learner has mastered them.
Do not replace a contracted identity with a synonym. Extra supporting atoms are allowed.
Supporting a later module output does not authorize assessing it early; assess only this unit's declared provides.
The assessment task, criteria, assistance and context constrain this lesson's teaching and checks.
`;
}

type ModelSlice = {
  entities: readonly { ref: string; semanticKey: string; kind: string }[];
  learningTargets: readonly {
    isEntry: boolean;
    isExit: boolean;
    requirements: readonly {
      entityRef: string;
      dimension: string;
      required: boolean;
      threshold: number;
    }[];
  }[];
};

/** Runs before targets become readable AND before the complete graph publishes. */
export function validateUnitPathContract(
  proposal: ModelSlice,
  external: readonly { ref: string; semanticKey?: string; kind: string }[],
  path: BoundUnitPath | undefined,
): void {
  if (!path) return;
  const catalog = new Map(path.entities.map((entity) => [entity.semanticKey, entity]));
  const aliases = new Map([...external, ...proposal.entities].map((entity) => [entity.ref, entity]));
  for (const entity of proposal.entities) {
    if (path.otherPlannedEntityKeys.includes(entity.semanticKey)) {
      throw new Error(`KACOM path ${path.unit.unitRef} introduces another lesson's identity ${entity.semanticKey}.`);
    }
    const planned = catalog.get(entity.semanticKey);
    if (planned && planned.kind !== entity.kind) {
      throw new Error(`KACOM path kind changed for ${entity.semanticKey}: expected ${planned.kind}.`);
    }
  }
  for (const [side, requirements] of [
    ["isEntry", path.unit.requires],
    ["isExit", path.unit.provides],
  ] as const) {
    for (const requirement of requirements) {
      const entity = catalog.get(requirement.entityKey);
      if (!entity) throw new Error(`Unknown KACOM path identity ${requirement.entityKey}.`);
      for (const dimension of requirement.dimensions) {
        const covered = proposal.learningTargets.some((target) =>
          target[side] && target.requirements.some((candidate) => {
            const resolved = aliases.get(candidate.entityRef);
            return resolved?.semanticKey === entity.semanticKey &&
              resolved.kind === entity.kind &&
              candidate.dimension === dimension &&
              candidate.required && candidate.threshold >= requirement.threshold;
          }),
        );
        if (!covered) {
          throw new Error(`KACOM path ${path.unit.unitRef} omits ${side} ${entity.semanticKey}/${dimension} at ${requirement.threshold}.`);
        }
      }
    }
  }
}
