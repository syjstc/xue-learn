export type UnitSubdivisionMode = "structural" | "steps";
export type UnitSubdivisionReason = "eligible" | "already_split" | "learning_started" | "module_limit" | "no_targets" | "max_depth";
export type UnitSubdivisionMapping = Readonly<{ learningTargetId: string; required: boolean; weight: number; orderIndex: number; role: string; isEntry: boolean; isExit: boolean; moduleCapabilityRefs: unknown; moduleRole: string }>;
export type UnitSubdivisionStep = Readonly<{ ref: string; title: string; contentSummary: string; difficulty: string; learningTargetIds: string[] }>;
export type UnitSubdivisionStatusRecord = Readonly<{ unitId: string; goalId: string; userId: string; title: string; contentSummary: string; goalTitle: string; contentLanguage: string; generationOptions: string; cognitiveModelVersion: number; currentMode: UnitSubdivisionMode | null; structuralEligible: boolean; structuralReason: UnitSubdivisionReason; recommendedMode: UnitSubdivisionMode; hasStructuralSubmap: boolean; hasStepSubmap: boolean; childUnits: Array<{ id: string; title: string }>; steps: UnitSubdivisionStep[]; mappings: UnitSubdivisionMapping[] }>;
export type UnitSubdivisionMutationResult = Readonly<{ status: "applied"; goalId: string; userId: string; mode: UnitSubdivisionMode; parentUnitId: string; children: Array<{ id: string; title: string }>; steps: UnitSubdivisionStep[] }> | Readonly<{ status: "not_found" | "already_module" | "unsafe_activity" | "module_limit" | "no_targets" | "no_children" }>;
export interface UnitSubdivisionRepository {
  getStatus(unitId: string, userId?: string): Promise<UnitSubdivisionStatusRecord | null>;
  saveSteps(input: Readonly<{ unitId: string; children: Array<{ title: string; difficulty: string; contentSummary: string }>; adjustment: string }>): Promise<UnitSubdivisionMutationResult>;
  applyStructural(input: Readonly<{ unitId: string; children: Array<{ title: string; difficulty: string; contentSummary: string }>; replaceExisting: boolean }>): Promise<UnitSubdivisionMutationResult>;
  remove(unitId: string): Promise<UnitSubdivisionMutationResult>;
}
