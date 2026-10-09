import type {
  UnitLabContentReadRecord,
  UnitLabSessionReadRecord,
} from "./unit-lab-port.js";

export type UnitDeliveryPageRecord = Readonly<{
  id: string;
  title: string;
  goalId: string;
  parentUnitId: string | null;
  contentSummary: string;
  difficulty: string;
  unitKind: string;
  status: string;
  completionMethod: string | null;
  currentStep: string | null;
  decompositionSteps: unknown;
  childCount: number;
  depth: number;
  goalTitle: string;
  goalKind: string;
  learningMode: string;
  domainTag: string;
  contentLanguage: string;
  level: string;
  generationOptions: string;
  topicCategory: string;
  mapPlanJson: string;
  cognitiveModelInputHash: string;
  userId: string;
}>;

export type UnitDeliveryAccessRecord = Readonly<{
  id: string;
  goalId: string;
  cognitiveModelStatus: string;
  cognitiveModelBuildInputHash: string | null;
  goalKind: string;
  learningMode: string;
  goalCognitiveModelStatus: string;
  goalCognitiveModelInputHash: string;
  goalCognitiveModelPublishedHash: string | null;
  moduleUnlockStatus: string | null;
  moduleGenerationStatus: string | null;
  canonicalTargetCount: number;
  hasCanonicalContent: boolean;
}>;

export type UnitDeliveryContentRecord = Readonly<{
  id: string;
  goalId: string;
  contentRevision: number;
  contentLanguage: string;
  goalTitle: string;
  sq3rData: string | null;
  graphState: string | null;
  decompositionSteps: unknown;
  learningMaterial: null | Readonly<{
    introduction: string;
    sections: string;
    keyTakeaways: string;
    contextSources: string;
  }>;
}>;

export type UnitDeliverySessionRecord = Readonly<{
  access: UnitDeliveryAccessRecord;
  status: string;
  contentRevision: number;
  goalTitle: string;
  contentLanguage: string;
  teachingPersonaRef: string | null;
  pathSource: string;
  session: null | Readonly<{
    currentStep: string;
    structuredSubStep: string;
    graphState: string;
    sq3rData: string;
  }>;
  learningMaterial: UnitDeliveryContentRecord["learningMaterial"];
  cornellNote: null | Readonly<{ notes: string; cues: string; summary: string }>;
}>;

export type UnitScenarioContentReadRecord = Readonly<{ goalId: string; status: string; recommended: boolean; recommendation: string; revision: number; definitionJson: unknown; generationError: string }>;
export type UnitScenarioSessionReadRecord = Readonly<{
  status: string;
  revision: number;
  completedOnce: boolean;
  currentSceneStatus: string | null;
  activeRun: null | Readonly<{ id: string; theaterRevision: number; runVersion: number; status: string; currentSceneId: string | null; metersJson: unknown; pathJson: unknown; endingId: string | null; startedAt: Date; completedAt: Date | null }>;
}>;

/** Owner-scoped read projection for learner unit delivery screens. */
export interface UnitDeliveryReadRepository {
  findPage(input: { userId: string; unitId: string }): Promise<UnitDeliveryPageRecord | null>;
  findLearningAccess(input: { userId: string; unitId: string }): Promise<UnitDeliveryAccessRecord | null>;
  findContent(input: { userId: string; unitId: string }): Promise<UnitDeliveryContentRecord | null>;
  findSession(input: { userId: string; unitId: string }): Promise<UnitDeliverySessionRecord | null>;
  listMaterialCheckAttempts(input: { userId: string; unitId: string; stableKeyPrefixes: readonly string[] }): Promise<readonly Readonly<{ response: unknown; submittedAt: Date | null }>[]>;
  findScenarioContent(input: { userId: string; unitId: string }): Promise<UnitScenarioContentReadRecord | null>;
  findScenarioSession(input: { userId: string; unitId: string }): Promise<UnitScenarioSessionReadRecord | null>;
  findLabContent(input: { userId: string; unitId: string }): Promise<UnitLabContentReadRecord | null>;
  findLabSession(input: { userId: string; unitId: string }): Promise<UnitLabSessionReadRecord | null>;
}
