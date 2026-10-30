import type { BoundUnitPath } from "./path-contract.js";
import type { TargetPrefixWire } from "./target-first.js";

/** Prerequisites are already authored in the approved plan. Project missing
 * entry requirements from that authority instead of asking the model to copy
 * them again. This creates target contracts only, never learner mastery. */
export function projectApprovedEntryTargets(
  prefix: TargetPrefixWire,
  external: readonly { ref: string; semanticKey?: string; kind: string }[],
  path: BoundUnitPath | undefined,
): TargetPrefixWire {
  if (!path) return prefix;
  const next = structuredClone(prefix);
  const aliases = [...external, ...next.entities];
  const nextRef = (stem: "e" | "lt", used: readonly { ref: string }[]) => {
    const refs = new Set(used.map((entry) => entry.ref));
    let index = 1;
    while (refs.has(`${stem}_${index}`)) index++;
    return `${stem}_${index}`;
  };
  for (const prerequisite of path.unit.requires) {
    const entity = path.entities.find(
      (entry) => entry.semanticKey === prerequisite.entityKey,
    );
    if (!entity)
      throw Error(`Unknown approved prerequisite ${prerequisite.entityKey}`);
    let alias = aliases.find(
      (entry) =>
        entry.semanticKey === entity.semanticKey && entry.kind === entity.kind,
    );
    const missing = prerequisite.dimensions.filter(
      (dimension) =>
        !next.learningTargets.some(
          (target) =>
            target.isEntry &&
            target.requirements.some((entry) => {
              const identity = aliases.find(
                (candidate) => candidate.ref === entry.entityRef,
              );
              return (
                identity?.semanticKey === entity.semanticKey &&
                identity.kind === entity.kind &&
                entry.dimension === dimension &&
                entry.required &&
                entry.threshold >= prerequisite.threshold
              );
            }),
        ),
    );
    if (!missing.length) continue;
    // A conflicting identity remains a validation error; never paper it over.
    if (
      aliases.some(
        (entry) =>
          entry.semanticKey === entity.semanticKey &&
          entry.kind !== entity.kind,
      )
    )
      throw Error(
        `Approved prerequisite kind changed for ${entity.semanticKey}`,
      );
    if (!alias) {
      alias = {
        ref: nextRef("e", aliases),
        semanticKey: entity.semanticKey,
        kind: entity.kind,
        title: entity.title,
      };
      next.entities.push({
        ref: alias.ref,
        semanticKey: entity.semanticKey,
        kind: entity.kind,
        title: entity.title,
      });
      aliases.push(alias);
    }
    const ref = nextRef("lt", next.learningTargets);
    const quizEvidence = missing.some(
      (dimension) => dimension === "memory" || dimension === "understanding",
    );
    next.learningTargets.push({
      ref,
      semanticKey: `${path.unit.unitRef}.entry.${entity.semanticKey}`,
      title: entity.title,
      explanation: prerequisite.rationale,
      learningObjective: entity.description,
      assessmentCriteria: [{ ref: `${ref}:c1`, text: entity.scope }],
      targetCognitiveLevel: missing.every((dimension) => dimension === "memory")
        ? "remember"
        : "understand",
      importance: quizEvidence ? "supporting" : "enrichment",
      importanceWeight: 1,
      difficulty: path.unit.difficulty,
      role: "review",
      isEntry: true,
      isExit: false,
      planningOutcomeRefs: [],
      requirements: missing.map((dimension) => ({
        entityRef: alias!.ref,
        dimension,
        required: true,
        weight: 1,
        threshold: prerequisite.threshold,
        gate: true,
      })),
    });
  }
  return next;
}
