import type { ModuleObjectiveCapability } from "../../../domain/src/module-objective-authority.js";
import { readModulePathContext } from "./learning-path.js";

/**
 * The approved path already authored the complete lesson skeleton. Materialize
 * it without another LLM round; detailed KACOM definitions/content stay lazy.
 */
export function projectPathModule(
  brief: unknown,
  contentLanguage: string,
  diagnostics?: string,
) {
  const context = readModulePathContext(brief);
  if (!context) return undefined;
  if (diagnostics?.trim()) {
    let findings: unknown = diagnostics;
    try {
      findings = JSON.parse(diagnostics);
    } catch {
      // Older workers can store a plain diagnostic string.
    }
    if (findings && !(Array.isArray(findings) && findings.length === 0)) {
      throw new Error(
        `The approved capability path needs revision: ${diagnostics}`,
      );
    }
  }
  const { contract, entities } = context;
  const byKey = new Map(entities.map((entity) => [entity.semanticKey, entity]));
  const describe = (key: string) => {
    const entity = byKey.get(key);
    if (!entity)
      throw new Error(`Path contract refers to missing KACOM identity ${key}`);
    return entity;
  };
  const zh = contentLanguage.startsWith("zh");
  const labels = zh
    ? ["需要的基础", "本单元新增能力", "适用范围", "检验方式", "衔接说明"]
    : [
        "Prerequisites",
        "New capability",
        "Scope",
        "Verification",
        "Connection",
      ];
  const capabilities = contract.provides.map((output) => {
    const entity = describe(output.entityKey);
    return {
      title: entity.title,
      objective: entity.description,
      semanticKey: entity.semanticKey,
      entityKind: entity.kind,
      threshold: output.threshold,
      dimensions: output.dimensions,
      criticalCompletionGate: true,
      cognitiveLevel: output.dimensions.includes("transfer")
        ? "analyze"
        : output.dimensions.includes("application")
          ? "apply"
          : output.dimensions.includes("understanding")
            ? "understand"
            : "remember",
      difficulty: contract.units.some((unit) => unit.difficulty === "hard")
        ? "hard"
        : "medium",
      assessmentCriteria: [
        entity.description,
        ...contract.assessment.criteria,
      ].slice(0, 5),
    } satisfies ModuleObjectiveCapability;
  });
  const units = contract.units.map((unit) => ({
    title: unit.title,
    contentSummary: [
      unit.summary,
      unit.requires.length
        ? `${labels[0]}: ${unit.requires.map((entry) => describe(entry.entityKey).title).join("; ")}.`
        : "",
      `${labels[1]}: ${unit.provides.map((entry) => describe(entry.entityKey).description).join("; ")}.`,
      `${labels[2]}: ${[...new Set(unit.provides.map((entry) => describe(entry.entityKey).scope))].join("; ")}.`,
      `${labels[3]}: ${unit.assessment.task} ${unit.assessment.criteria.join("; ")}`,
      `${labels[4]}: ${unit.rationale}`,
    ]
      .filter(Boolean)
      .join("\n"),
    difficulty: unit.difficulty,
    milestoneRole: unit.milestoneRole,
    capabilityRefs: unit.supports.map((key) => {
      const index = contract.provides.findIndex(
        (entry) => entry.entityKey === key,
      );
      if (index < 0) throw new Error(`Unknown module exit ${key}`);
      return `mc_${index + 1}`;
    }),
    knowledgeSequence: {
      requiredKnowledge: unit.requires.map(
        (entry) => describe(entry.entityKey).description,
      ),
      taughtKnowledge: unit.provides.map(
        (entry) => describe(entry.entityKey).description,
      ),
      dependsOnUnits: [
        ...new Set(
          unit.requires.flatMap((entry) => {
            const index = contract.units.findIndex(
              (previous) => previous.unitRef === entry.source,
            );
            return index < 0 ? [] : [index + 1];
          }),
        ),
      ],
      foundationsToTeachFirst: [],
    },
  }));
  return {
    capabilities,
    structure: { units, coverageRationale: contract.rationale },
  };
}
