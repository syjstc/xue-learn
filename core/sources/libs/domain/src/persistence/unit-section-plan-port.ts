export type UnitSectionPlanTargetRecord = Readonly<{
  learningTargetId: string;
  localRef: string;
  role: string;
  learningTarget: Readonly<{
    title: string;
    explanation: string;
    learningObjective: string;
    importance: string;
    difficulty: string;
    targetCognitiveLevel: string;
    definitionVersion: number;
  }>;
}>;

export type UnitSectionPlanSource = Readonly<{
  id: string;
  title: string;
  contentSummary: string;
  unitKind: string;
  goal: Readonly<{
    goalKind: string;
    learningMode: string;
    userId: string | null;
  }>;
  sq3rData: string | null;
  hasLearningMaterial: boolean;
  existingSections: readonly Readonly<Record<string, unknown>>[];
  learningTargets: readonly UnitSectionPlanTargetRecord[];
}>;

export type UnitSectionPlanDraft = Readonly<{
  stableKey: string;
  orderIndex: number;
  title: string;
  contentSummary: string;
  assessmentAfter: boolean;
  baseEstimatedMinutes: number;
  componentPlan: readonly unknown[];
  generationInputHash: string;
  contentKind?: "standard" | "formal_derivation";
  targets: readonly Readonly<{
    learningTargetId: string;
    role: "primary" | "supporting";
  }>[];
}>;

export type UnitMaterialSource = Readonly<{
  requiredForCompletion: boolean;
  generationStatus: string;
  contentKind?: string;
  derivationJson?: string | null;
  teachingDerivationJson?: string | null;
  teachingDerivationDerivedJson?: string | null;
  derivationFormat?: string | null;
  material: null | Readonly<{
    introduction: string;
    blocks: string;
    keyTakeaways: string;
    contextSources: string;
  }>;
}>;

export type AggregatedUnitMaterialSource = Readonly<{
  sections: readonly UnitMaterialSource[];
  legacy: null | Readonly<{
    introduction: string;
    sections: string;
    keyTakeaways: string;
    contextSources: string;
  }>;
}>;

export type UnitSectionManifestSource = Readonly<{
  sections: readonly Readonly<{
    id: string;
    stableKey: string;
    orderIndex: number;
    title: string;
    contentSummary: string;
    requiredForCompletion: boolean;
    baseEstimatedMinutes: number;
    generationStatus: string;
    generationError: string;
    testGenerationStatus: string;
    testGenerationError: string;
    contentRevision: number;
    assessmentAfter: boolean;
    componentPlan: unknown;
    contentKind?: string;
    derivationFormat?: string | null;
    progressStatus: string | null;
    activeSeconds: number;
    contentCompletedAt: Date | null;
    hasSkipRequirements: boolean;
    skipRequirementsSatisfied: boolean;
  }>[];
  legacy: AggregatedUnitMaterialSource["legacy"];
}>;

export type UnitSectionContentSource = Readonly<{
  sectionFound: boolean;
  contentRevision: number;
  orderIndex: number;
  contentKind: string;
  derivationFormat: string | null;
  material: UnitMaterialSource["material"];
  derivationJson: string | null;
  teachingDerivationJson: string | null;
  teachingDerivationDerivedJson: string | null;
  priorMaterials: readonly NonNullable<UnitMaterialSource["material"]>[];
  legacy: AggregatedUnitMaterialSource["legacy"];
}>;

export type UnitSectionGenerationSource = Readonly<{
  section: Readonly<Record<string, unknown>>;
  unit: Readonly<Record<string, unknown>>;
  goal: Readonly<Record<string, unknown>>;
  material:
    | (NonNullable<UnitMaterialSource["material"] & Readonly<{ sourceItems?: unknown }>>)
    | null;
  derivationJson: string | null;
  teachingDerivationJson: string | null;
  teachingDerivationDerivedJson: string | null;
  targetLocalRefs: readonly string[];
  targetIds: readonly string[];
  sections: readonly Readonly<Record<string, unknown>>[];
  assessmentTargets: readonly unknown[];
  overviewCatalog?: readonly Readonly<{ title: string; summary: string }>[];
}>;

export type UnitSectionPublishedMaterial = Readonly<{
  introduction: string;
  blocks: string;
  keyTakeaways: string;
  contextSources: string;
  sourceItemsJson: string;
}>;

export interface UnitSectionPlanRepository {
  updateTeachingPresentation(input: { userId: string; unitId: string; sectionId: string; expectedContentRevision: number; expectedDocumentJson: string; documentJson: string; derivedJson: string }): Promise<boolean>;
  /** Reconcile in-memory generation work interrupted by a local process restart. */
  recoverInterruptedGenerations(error: string): Promise<number>;
  deleteAll(unitId: string): Promise<number>;
  clearGenerated(unitId: string): Promise<number>;
  cancelGeneration(input: {
    userId: string;
    unitId: string;
    sectionId: string;
    kind: "content" | "mini_test";
    stoppedMessage: string;
  }): Promise<{ cancelled: boolean; token: string | null }>;
  findGenerationSource(input: {
    userId: string;
    unitId: string;
    sectionId: string;
  }): Promise<UnitSectionGenerationSource | null>;
  claimGeneration(input: {
    sectionId: string;
    kind: "content" | "mini_test";
    token: string;
    staleBefore: Date;
    force?: boolean;
    initialAttempt: boolean;
  }): Promise<"claimed" | "ready" | "building" | "failed" | "missing">;
  heartbeatGeneration(input: {
    sectionId: string;
    kind: "content" | "mini_test";
    token: string;
    at: Date;
  }): Promise<boolean>;
  ownsGeneration(input: {
    sectionId: string;
    kind: "content" | "mini_test";
    token: string;
  }): Promise<boolean>;
  failGeneration(input: {
    sectionId: string;
    kind: "content" | "mini_test";
    token: string;
    error: string;
  }): Promise<boolean>;
  publishGeneratedContent(input: {
    userId: string;
    goalId: string;
    unitId: string;
    sectionId: string;
    token: string;
    force: boolean;
    material: UnitSectionPublishedMaterial;
    materialCheckTasks: readonly import("./material-check-completion-port.js").MaterialCheckTaskDefinition[];
  }): Promise<{ contentRevision: number; affectedEntityIds: readonly string[] }>;
  publishGeneratedMiniTest(input: {
    userId: string;
    goalId: string;
    unitId: string;
    sectionId: string;
    token: string;
    blocks: string;
    materialCheckTasks: readonly import("./material-check-completion-port.js").MaterialCheckTaskDefinition[];
  }): Promise<{ contentRevision: number }>;
  publishGeneratedDerivation(input: {
    userId: string;
    goalId: string;
    unitId: string;
    sectionId: string;
    token: string;
    force: boolean;
    runId: string;
    documentJson: string;
  }): Promise<{ contentRevision: number }>;
  publishGeneratedTeachingDerivation(input: {
    userId: string;
    goalId: string;
    unitId: string;
    sectionId: string;
    token: string;
    force: boolean;
    runId: string;
    documentJson: string;
    derivedJson: string;
    parserVersion: string;
    analyzerVersion: string;
    matcherVersion: string;
    compilerVersion: string;
  }): Promise<{ contentRevision: number }>;
  lockDerivationFormat(input: {
    regenerationToken?: string;
    sectionId: string;
    format: "classic" | "teaching_v1";
  }): Promise<"locked" | "already" | "conflict">;
  persistIllustration(input: {
    unitId: string;
    sectionId: string;
    expectedContentRevision: number;
    blocks: string;
  }): Promise<boolean>;
  findKeyPointSources(unitId: string): Promise<
    readonly Readonly<{
      id: string;
      title: string;
      orderIndex: number;
      contentKind: string;
      generationStatus: string;
      keyTakeaways: string;
      blocks: string | null;
    }>[]
  >;
  saveUnitKeyTakeaways(input: {
    unitId: string;
    assignments: readonly Readonly<{
      sectionId: string;
      keyTakeaways: string;
    }>[];
    unitKeyTakeaways: string;
  }): Promise<void>;
  findSource(unitId: string): Promise<UnitSectionPlanSource | null>;
  findMaterialSource(unitId: string): Promise<AggregatedUnitMaterialSource>;
  findManifest(input: { userId: string; unitId: string; freshnessCutoff: Date }): Promise<UnitSectionManifestSource | null>;
  findSectionContent(input: { userId: string; unitId: string; sectionId: string }): Promise<UnitSectionContentSource | null>;
  publishIfEmpty(
    unitId: string,
    drafts: readonly UnitSectionPlanDraft[],
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}
