export const COGNITIVE_DIMENSIONS = [
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
] as const;

export type CognitiveDimension = (typeof COGNITIVE_DIMENSIONS)[number];

export type ModuleEntryFoundationBrief = Readonly<{
  ref: string;
  title: string;
  rationale: string;
  criticality: "critical" | "recommended";
  verificationDimensions: readonly (
    "memory" | "understanding" | "application"
  )[];
}>;

export type ModuleObjectiveCapability = Readonly<{
  title: string;
  objective: string;
  assessmentCriteria: readonly string[];
  dimensions: readonly CognitiveDimension[];
  criticalCompletionGate: boolean;
  cognitiveLevel:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  difficulty: "easy" | "medium" | "hard";
}>;

export type ModuleObjectiveUnit = Readonly<{
  unitId: string;
  curriculumKey: string;
  capabilityRefs: readonly string[];
  milestoneRole: "introduce" | "practice" | "integrate" | "verify";
}>;

export type PreparedModuleObjectiveAuthority = Readonly<{
  schemaVersion: 1;
  moduleCurriculumKey: string;
  coverageRationale: string;
  entities: readonly Readonly<{
    stableKey: string;
    kind: "atom" | "competency";
    title: string;
    description: string;
    payload: Record<string, unknown>;
  }>[];
  targets: readonly Readonly<{
    stableKey: string;
    title: string;
    requirements: readonly Readonly<{
      entityStableKey: string;
      dimension: CognitiveDimension;
      required: boolean;
      threshold: number;
      gate: boolean;
      weight: number;
      rationale: string;
    }>[];
    payload: Record<string, unknown>;
  }>[];
  moduleMappings: readonly Readonly<{
    targetStableKey: string;
    localRef: string;
    required: boolean;
    weight: number;
    orderIndex: number;
    role: "entry" | "exit";
  }>[];
  unitCapabilityAssignments: readonly Readonly<{
    unitId: string;
    targetStableKey: string;
    capabilityRef: string;
    milestoneRole: "introduce" | "practice" | "integrate" | "verify";
    orderIndex: number;
  }>[];
  relations: readonly Readonly<{
    stableKey: string;
    fromEntityStableKey: string;
    toEntityStableKey: string;
    relationType: "prerequisite";
    required: boolean;
    strength: number;
    rationale: string;
  }>[];
  structuralAudit: Readonly<{
    passed: true;
    capabilityCount: number;
    criticalCapabilityCount: number;
    foundationCount: number;
    unitCount: number;
    coveredCapabilityRefs: readonly string[];
  }>;
}>;

export function normalizeModuleEntryFoundationBriefs(
  value: unknown,
): ModuleEntryFoundationBrief[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const rationale =
      typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    if (!title || !rationale) return [];
    const dimensions = Array.isArray(raw.verificationDimensions)
      ? raw.verificationDimensions.filter(
          (
            dimension,
          ): dimension is "memory" | "understanding" | "application" =>
            dimension === "memory" ||
            dimension === "understanding" ||
            dimension === "application",
        )
      : [];
    return [
      {
        ref: `ef_${index + 1}`,
        title,
        rationale,
        criticality:
          raw.criticality === "recommended" ? "recommended" : "critical",
        verificationDimensions:
          dimensions.length > 0 ? [...new Set(dimensions)] : ["understanding"],
      },
    ];
  });
}

export function moduleEntryEntityStableKey(
  moduleCurriculumKey: string,
  index: number,
): string {
  return `module:${required(moduleCurriculumKey, "moduleCurriculumKey")}:entry:${index + 1}`;
}

export function moduleEntryTargetStableKey(
  moduleCurriculumKey: string,
  index: number,
): string {
  return `module:${required(moduleCurriculumKey, "moduleCurriculumKey")}:entry-target:${index + 1}`;
}

export function moduleCapabilityEntityStableKey(
  moduleCurriculumKey: string,
  index: number,
): string {
  return `module:${required(moduleCurriculumKey, "moduleCurriculumKey")}:capability:${index + 1}`;
}

export function moduleCapabilityTargetStableKey(
  moduleCurriculumKey: string,
  index: number,
): string {
  return `module:${required(moduleCurriculumKey, "moduleCurriculumKey")}:target:${index + 1}`;
}

export function prepareModuleObjectiveAuthority(input: {
  moduleCurriculumKey: string;
  entryFoundationBriefs: unknown;
  capabilities: readonly ModuleObjectiveCapability[];
  units: readonly ModuleObjectiveUnit[];
  coverageRationale: string;
}): PreparedModuleObjectiveAuthority {
  const moduleCurriculumKey = required(
    input.moduleCurriculumKey,
    "moduleCurriculumKey",
  );
  const coverageRationale = required(
    input.coverageRationale,
    "coverageRationale",
  );
  if (input.capabilities.length < 3 || input.capabilities.length > 8) {
    throw new Error("Mastery module must contain 3-8 capabilities");
  }
  const unitRecords = input.units ?? [];
  if (unitRecords.length < 1 || unitRecords.length > 20) {
    throw new Error("Mastery module must contain 1-20 lessons");
  }

  const capabilities = input.capabilities.map((capability, index) => {
    const dimensions = Array.isArray(capability.dimensions)
      ? [...new Set(capability.dimensions)]
      : [];
    if (
      !required(capability.title, `capabilities[${index}].title`) ||
      !required(capability.objective, `capabilities[${index}].objective`) ||
      !Array.isArray(capability.assessmentCriteria) ||
      capability.assessmentCriteria.length === 0 ||
      !Array.isArray(capability.dimensions) ||
      dimensions.length === 0 ||
      dimensions.some((dimension) => !COGNITIVE_DIMENSIONS.includes(dimension))
    ) {
      throw new Error(`Invalid module capability mc_${index + 1}`);
    }
    return {
      ...capability,
      assessmentCriteria: capability.assessmentCriteria.map((criterion) =>
        required(criterion, `capabilities[${index}].assessmentCriteria`),
      ),
      dimensions,
    };
  });
  if (!capabilities.some((capability) => capability.criticalCompletionGate)) {
    throw new Error("Mastery module requires a critical completion gate");
  }
  const allowedRefs = new Set(
    capabilities.map((_capability, index) => `mc_${index + 1}`),
  );
  const coveredRefs = new Set<string>();
  const units = unitRecords.map((unit, index) => {
    required(unit.unitId, `units[${index}].unitId`);
    required(unit.curriculumKey, `units[${index}].curriculumKey`);
    const capabilityRefs = [...new Set(unit.capabilityRefs)];
    if (capabilityRefs.length < 1 || capabilityRefs.length > 4) {
      throw new Error("Every mastery lesson must cover 1-4 capabilities");
    }
    for (const ref of capabilityRefs) {
      if (!allowedRefs.has(ref)) {
        throw new Error(`Unknown module capability ref: ${ref}`);
      }
      coveredRefs.add(ref);
    }
    return { ...unit, capabilityRefs };
  });
  if ([...allowedRefs].some((ref) => !coveredRefs.has(ref))) {
    throw new Error("Mastery module structure omits capability coverage");
  }
  const foundations = normalizeModuleEntryFoundationBriefs(
    input.entryFoundationBriefs,
  );

  const entryEntities = foundations.map((foundation, index) => ({
    stableKey: moduleEntryEntityStableKey(moduleCurriculumKey, index),
    kind: "atom" as const,
    title: foundation.title,
    description: foundation.rationale,
    payload: {
      source: "module.entry_foundation",
      planningRef: foundation.ref,
      unverifiedPlanningAssumption: true,
      verificationDimensions: foundation.verificationDimensions,
    },
  }));
  const capabilityEntities = capabilities.map((capability, index) => ({
    stableKey: moduleCapabilityEntityStableKey(moduleCurriculumKey, index),
    kind: "competency" as const,
    title: capability.title,
    description: capability.objective,
    payload: {
      source: "module.capabilities",
      semanticKey: `capability:${index + 1}`,
      assessmentCriteria: capability.assessmentCriteria,
      cognitiveLevel: capability.cognitiveLevel,
      difficulty: capability.difficulty,
    },
  }));
  const entryTargets = foundations.map((foundation, index) => {
    const entityStableKey = moduleEntryEntityStableKey(
      moduleCurriculumKey,
      index,
    );
    return {
      stableKey: moduleEntryTargetStableKey(moduleCurriculumKey, index),
      title: foundation.title,
      requirements: foundation.verificationDimensions.map((dimension) => ({
        entityStableKey,
        dimension,
        required: foundation.criticality === "critical",
        threshold: 0.7,
        gate: foundation.criticality === "critical",
        weight: 1,
        rationale: foundation.rationale,
      })),
      payload: {
        explanation: foundation.rationale,
        learningObjective: `Independently demonstrate the entry foundation: ${foundation.title}`,
        assessmentCriteria: [
          { ref: `entry_${index + 1}:c1`, text: foundation.rationale },
        ],
        importance:
          foundation.criticality === "critical" ? "core" : "supporting",
        importanceWeight: foundation.criticality === "critical" ? 5 : 2,
        difficulty: "medium",
        targetCognitiveLevel: foundation.verificationDimensions.includes(
          "application",
        )
          ? "apply"
          : foundation.verificationDimensions.includes("understanding")
            ? "understand"
            : "remember",
        origin: "curated",
      },
    };
  });
  const capabilityTargets = capabilities.map((capability, index) => ({
    stableKey: moduleCapabilityTargetStableKey(moduleCurriculumKey, index),
    title: capability.title,
    requirements: capability.dimensions.map((dimension) => ({
      entityStableKey: moduleCapabilityEntityStableKey(
        moduleCurriculumKey,
        index,
      ),
      dimension,
      required: true,
      threshold: 0.7,
      gate: capability.criticalCompletionGate,
      weight: 1,
      rationale: capability.criticalCompletionGate
        ? "Critical module exit diagnostic gate"
        : "Weighted module exit capability",
    })),
    payload: {
      explanation: capability.objective,
      learningObjective: capability.objective,
      assessmentCriteria: capability.assessmentCriteria.map(
        (text, criterionIndex) => ({
          ref: `lt_${index + 1}:c${criterionIndex + 1}`,
          text,
        }),
      ),
      importance: capability.criticalCompletionGate ? "core" : "supporting",
      importanceWeight: capability.criticalCompletionGate ? 5 : 3,
      difficulty: capability.difficulty,
      targetCognitiveLevel: capability.cognitiveLevel,
      origin: "canonical",
    },
  }));
  const moduleMappings = [
    ...foundations.map((foundation, index) => ({
      targetStableKey: moduleEntryTargetStableKey(moduleCurriculumKey, index),
      localRef: `entry_${index + 1}`,
      required: foundation.criticality === "critical",
      weight: foundation.criticality === "critical" ? 1 : 0.5,
      orderIndex: index,
      role: "entry" as const,
    })),
    ...capabilities.map((_capability, index) => ({
      targetStableKey: moduleCapabilityTargetStableKey(
        moduleCurriculumKey,
        index,
      ),
      localRef: `lt_${index + 1}`,
      required: true,
      weight: 1,
      orderIndex: foundations.length + index,
      role: "exit" as const,
    })),
  ];
  const unitCapabilityAssignments = units.flatMap((unit) =>
    unit.capabilityRefs.map((ref, orderIndex) => {
      const capabilityIndex = Number(ref.slice(3)) - 1;
      return {
        unitId: unit.unitId,
        targetStableKey: moduleCapabilityTargetStableKey(
          moduleCurriculumKey,
          capabilityIndex,
        ),
        capabilityRef: ref,
        milestoneRole: unit.milestoneRole,
        orderIndex,
      };
    }),
  );
  const relations = foundations.flatMap((foundation, foundationIndex) =>
    capabilities.map((_capability, capabilityIndex) => ({
      stableKey: `module:${moduleCurriculumKey}:entry:${foundationIndex + 1}:capability:${capabilityIndex + 1}:prerequisite`,
      fromEntityStableKey: moduleEntryEntityStableKey(
        moduleCurriculumKey,
        foundationIndex,
      ),
      toEntityStableKey: moduleCapabilityEntityStableKey(
        moduleCurriculumKey,
        capabilityIndex,
      ),
      relationType: "prerequisite" as const,
      required: foundation.criticality === "critical",
      strength: foundation.criticality === "critical" ? 1 : 0.6,
      rationale: "Verified entry readiness for the module capability",
    })),
  );

  return {
    schemaVersion: 1,
    moduleCurriculumKey,
    coverageRationale,
    entities: [...entryEntities, ...capabilityEntities],
    targets: [...entryTargets, ...capabilityTargets],
    moduleMappings,
    unitCapabilityAssignments,
    relations,
    structuralAudit: {
      passed: true,
      capabilityCount: capabilities.length,
      criticalCapabilityCount: capabilities.filter(
        (capability) => capability.criticalCompletionGate,
      ).length,
      foundationCount: foundations.length,
      unitCount: units.length,
      coveredCapabilityRefs: [...coveredRefs].sort(),
    },
  };
}

export type PreparedMasteryLesson = Readonly<{
  title: string;
  contentSummary: string;
  difficulty: "easy" | "medium" | "hard";
  capabilityRefs: readonly string[];
  milestoneRole: ModuleObjectiveUnit["milestoneRole"];
}>;

export type PreparedMasteryPublication = Readonly<{
  authority: PreparedModuleObjectiveAuthority;
  units: readonly PreparedMasteryLesson[];
  foundations: readonly Readonly<{
    title: string;
    rationale: string;
    objective: string;
    criteria: readonly Readonly<{ ref: string; text: string }>[];
    assessmentHints: readonly string[];
    importance: "core" | "supporting";
    importanceWeight: number;
    difficulty: "medium";
    cognitiveLevel: "remember" | "understand" | "apply";
    origin: "curated";
    critical: boolean;
    entityAuthority: PreparedModuleObjectiveAuthority["entities"][number];
    targetAuthority: PreparedModuleObjectiveAuthority["targets"][number];
    mapping: PreparedModuleObjectiveAuthority["moduleMappings"][number];
    provenance: Readonly<{
      source: "module.entry_foundation";
      moduleCurriculumKey: string;
      planningRef: string;
      unverifiedPlanningAssumption: true;
    }>;
  }>[];
  capabilities: readonly Readonly<{
    title: string;
    objective: string;
    rationale: string;
    criteria: readonly Readonly<{ ref: string; text: string }>[];
    importance: "core" | "supporting";
    importanceWeight: number;
    difficulty: ModuleObjectiveCapability["difficulty"];
    cognitiveLevel: ModuleObjectiveCapability["cognitiveLevel"];
    entityAuthority: PreparedModuleObjectiveAuthority["entities"][number];
    targetAuthority: PreparedModuleObjectiveAuthority["targets"][number];
    mapping: PreparedModuleObjectiveAuthority["moduleMappings"][number];
    provenance: Readonly<{
      source: "module.capabilities";
      moduleCurriculumKey: string;
      ownerCurriculumKey: string;
      semanticKey: string;
    }>;
  }>[];
}>;

export function mapPreparedMasteryPublication(input: {
  moduleCurriculumKey: string;
  entryFoundationBriefs: unknown;
  capabilities: readonly ModuleObjectiveCapability[];
  units: readonly PreparedMasteryLesson[];
  coverageRationale: string;
}): PreparedMasteryPublication {
  const foundations = normalizeModuleEntryFoundationBriefs(
    input.entryFoundationBriefs,
  );
  const authority = prepareModuleObjectiveAuthority({
    moduleCurriculumKey: input.moduleCurriculumKey,
    entryFoundationBriefs: input.entryFoundationBriefs,
    capabilities: input.capabilities,
    units: input.units.map((unit, index) => ({
      unitId: `prepared:${index + 1}`,
      curriculumKey: `${input.moduleCurriculumKey}:lesson:${index + 1}`,
      capabilityRefs: unit.capabilityRefs,
      milestoneRole: unit.milestoneRole,
    })),
    coverageRationale: input.coverageRationale,
  });
  return {
    authority,
    units: input.units,
    foundations: foundations.map((foundation, index) => {
      const localRef = `entry_${index + 1}`;
      const mapping = requiredMapping(authority, localRef);
      return {
        title: foundation.title,
        rationale: foundation.rationale,
        objective: `Independently demonstrate the entry foundation: ${foundation.title}`,
        criteria: [{ ref: `${localRef}:c1`, text: foundation.rationale }],
        assessmentHints: [
          `Verify ${foundation.verificationDimensions.join(", ")}`,
        ],
        importance:
          foundation.criticality === "critical" ? "core" : "supporting",
        importanceWeight: foundation.criticality === "critical" ? 5 : 2,
        difficulty: "medium" as const,
        cognitiveLevel: foundation.verificationDimensions.includes(
          "application",
        )
          ? ("apply" as const)
          : foundation.verificationDimensions.includes("understanding")
            ? ("understand" as const)
            : ("remember" as const),
        origin: "curated" as const,
        critical: foundation.criticality === "critical",
        entityAuthority: authority.entities[index]!,
        targetAuthority: authority.targets[index]!,
        mapping,
        provenance: {
          source: "module.entry_foundation" as const,
          moduleCurriculumKey: authority.moduleCurriculumKey,
          planningRef: foundation.ref,
          unverifiedPlanningAssumption: true as const,
        },
      };
    }),
    capabilities: input.capabilities.map((capability, index) => {
      const localRef = `lt_${index + 1}`;
      const authorityIndex = foundations.length + index;
      const mapping = requiredMapping(authority, localRef);
      return {
        title: capability.title,
        objective: capability.objective,
        rationale: "Required module exit capability",
        criteria: capability.assessmentCriteria.map((text, criterionIndex) => ({
          ref: `${localRef}:c${criterionIndex + 1}`,
          text,
        })),
        importance: capability.criticalCompletionGate ? "core" : "supporting",
        importanceWeight: capability.criticalCompletionGate ? 5 : 3,
        difficulty: capability.difficulty,
        cognitiveLevel: capability.cognitiveLevel,
        entityAuthority: authority.entities[authorityIndex]!,
        targetAuthority: authority.targets[authorityIndex]!,
        mapping,
        provenance: {
          source: "module.capabilities" as const,
          moduleCurriculumKey: authority.moduleCurriculumKey,
          ownerCurriculumKey: authority.moduleCurriculumKey,
          semanticKey: `capability:${index + 1}`,
        },
      };
    }),
  };
}

function requiredMapping(
  authority: PreparedModuleObjectiveAuthority,
  localRef: string,
): PreparedModuleObjectiveAuthority["moduleMappings"][number] {
  const mapping = authority.moduleMappings.find(
    (value) => value.localRef === localRef,
  );
  if (!mapping) throw new Error(`Missing module mapping for ${localRef}`);
  return mapping;
}

function required(value: string | null | undefined, field: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`${field} is required`);
  return result;
}
