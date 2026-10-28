export type SyncMergePolicy =
  | "leased_replace"
  | "immutable_union"
  | "monotonic_projection"
  | "versioned_note"
  | "derived_rebuild"
  | "device_local";

export type SyncTableRule = Readonly<{
  policy: SyncMergePolicy;
  scope:
    | "workspace"
    | "goal_id"
    | "goal_column"
    | "goal_via_unit"
    | "goal_via_module"
    | "local";
}>;

const rules = {
  User: { policy: "leased_replace", scope: "workspace" },
  LearningProfile: { policy: "leased_replace", scope: "workspace" },
  LearnerPlanningSettings: { policy: "leased_replace", scope: "workspace" },
  // Preferences and provider/model selections are portable workspace state.
  // Provider credentials are not stored in SQLite; Electron keeps them in the
  // device-local OS-encrypted credential vault.
  UserSettings: { policy: "leased_replace", scope: "workspace" },
  TeachingPersona: { policy: "leased_replace", scope: "workspace" },
  TeachingSkill: { policy: "leased_replace", scope: "workspace" },
  TeachingSkillVersion: { policy: "leased_replace", scope: "workspace" },
  TeachingSkillFile: { policy: "leased_replace", scope: "workspace" },
  LearningSpace: { policy: "leased_replace", scope: "workspace" },
  LearningSpaceItem: { policy: "leased_replace", scope: "workspace" },
  LearningSpaceItemRelation: { policy: "leased_replace", scope: "workspace" },
  LearningGoal: { policy: "leased_replace", scope: "goal_id" },
  GoalLearningSystemBinding: { policy: "leased_replace", scope: "goal_column" },
  GoalTeachingSkillBinding: { policy: "leased_replace", scope: "goal_column" },
  LearningModule: { policy: "leased_replace", scope: "goal_column" },
  LearningUnit: { policy: "leased_replace", scope: "goal_column" },
  LearningMaterial: { policy: "leased_replace", scope: "goal_via_unit" },
  LearningActivity: { policy: "leased_replace", scope: "workspace" },
  LearningFocus: { policy: "device_local", scope: "local" },
  LearningMainlineEvent: { policy: "immutable_union", scope: "workspace" },
  LearningGoalPreference: { policy: "leased_replace", scope: "workspace" },
  LearningBranch: { policy: "leased_replace", scope: "goal_via_unit" },
  LearningVisit: { policy: "leased_replace", scope: "goal_via_unit" },
  LearningTrajectoryEvent: { policy: "immutable_union", scope: "goal_via_unit" },
  MaterialFollowUp: { policy: "immutable_union", scope: "goal_via_unit" },
  UnitDecomposition: { policy: "leased_replace", scope: "goal_via_unit" },
  UnitSection: { policy: "leased_replace", scope: "goal_via_unit" },
  UnitSectionLearningTarget: { policy: "leased_replace", scope: "workspace" },
  UnitSectionMaterial: { policy: "leased_replace", scope: "workspace" },
  UnitSectionDerivation: { policy: "leased_replace", scope: "workspace" },
  UnitSectionTeachingDerivation: { policy: "leased_replace", scope: "workspace" },
  LearningTarget: { policy: "leased_replace", scope: "goal_column" },
  LearningTargetRequirement: { policy: "leased_replace", scope: "workspace" },
  UnitLearningTarget: { policy: "leased_replace", scope: "goal_via_unit" },
  ModuleLearningTarget: { policy: "leased_replace", scope: "goal_via_module" },
  CognitiveEntity: { policy: "leased_replace", scope: "goal_column" },
  KnowledgeAtom: { policy: "leased_replace", scope: "workspace" },
  CognitiveConstruct: { policy: "leased_replace", scope: "workspace" },
  CognitiveRelation: { policy: "leased_replace", scope: "workspace" },
  ConstructComponent: { policy: "leased_replace", scope: "workspace" },
  CognitiveModelRevision: { policy: "leased_replace", scope: "goal_column" },
  LearningTask: { policy: "leased_replace", scope: "goal_via_unit" },
  TaskRequirement: { policy: "leased_replace", scope: "workspace" },
  GoalCreationSession: { policy: "leased_replace", scope: "workspace" },
  GoalCreationSessionResource: { policy: "leased_replace", scope: "workspace" },
  GoalCreationSessionEvent: { policy: "immutable_union", scope: "workspace" },
  ModuleStructureDraft: { policy: "leased_replace", scope: "goal_column" },
  UploadedDocument: { policy: "leased_replace", scope: "goal_column" },
  CornellNote: { policy: "versioned_note", scope: "goal_via_unit" },
  AgentThread: { policy: "leased_replace", scope: "workspace" },
  AgentMessage: { policy: "immutable_union", scope: "workspace" },
  QuizSet: { policy: "leased_replace", scope: "goal_via_unit" },
  QuizAttempt: { policy: "immutable_union", scope: "goal_via_unit" },
  DiagnosticAttempt: { policy: "immutable_union", scope: "workspace" },
  TaskAttempt: { policy: "immutable_union", scope: "goal_via_unit" },
  TaskObservation: { policy: "immutable_union", scope: "workspace" },
  EvidenceClaim: { policy: "immutable_union", scope: "workspace" },
  EvidenceLifecycleEvent: { policy: "immutable_union", scope: "workspace" },
  FeynmanSession: { policy: "immutable_union", scope: "goal_via_unit" },
  FlashCardDeck: { policy: "leased_replace", scope: "goal_via_unit" },
  FlashCard: { policy: "leased_replace", scope: "workspace" },
  FlashCardReview: { policy: "immutable_union", scope: "workspace" },
  UnitSessionState: { policy: "monotonic_projection", scope: "goal_via_unit" },
  UnitSectionProgress: { policy: "monotonic_projection", scope: "workspace" },
  ReviewCard: { policy: "monotonic_projection", scope: "goal_via_unit" },
  LearnerDailyActivity: { policy: "monotonic_projection", scope: "workspace" },
  LearnerDimensionState: { policy: "derived_rebuild", scope: "workspace" },
  LearnerEntityState: { policy: "derived_rebuild", scope: "workspace" },
  LearnerStateRevision: { policy: "derived_rebuild", scope: "workspace" },
  LearnerStateMemory: { policy: "derived_rebuild", scope: "workspace" },
  LearnerGapHypothesis: { policy: "derived_rebuild", scope: "workspace" },
  MisconceptionPattern: { policy: "derived_rebuild", scope: "workspace" },
  AgendaItem: { policy: "derived_rebuild", scope: "local" },
  AgendaRevision: { policy: "derived_rebuild", scope: "local" },
  AgendaDigestDelivery: { policy: "device_local", scope: "local" },
  RagChunk: { policy: "derived_rebuild", scope: "local" },
  // SQLite FTS5 owns the virtual table and its shadow tables. They are rebuilt
  // from RagChunk and must never be captured or applied as synchronized rows.
  RagChunkFts: { policy: "derived_rebuild", scope: "local" },
  RagChunkFts_config: { policy: "derived_rebuild", scope: "local" },
  RagChunkFts_content: { policy: "derived_rebuild", scope: "local" },
  RagChunkFts_data: { policy: "derived_rebuild", scope: "local" },
  RagChunkFts_docsize: { policy: "derived_rebuild", scope: "local" },
  RagChunkFts_idx: { policy: "derived_rebuild", scope: "local" },
  RagChunk__localEmbeddingIndex: { policy: "derived_rebuild", scope: "local" },
  LocalEmbeddingIndexState: { policy: "device_local", scope: "local" },
  LocalModelPricing: { policy: "device_local", scope: "local" },
  LocalTokenUsageDaily: { policy: "device_local", scope: "local" },
  ChatNarrationAudio: { policy: "device_local", scope: "local" },
  AiGenerationRun: { policy: "device_local", scope: "local" },
  AiGenerationRunEvent: { policy: "device_local", scope: "local" },
  FormalDerivationRun: { policy: "device_local", scope: "local" },
  TeachingDerivationRun: { policy: "device_local", scope: "local" },
  TeachingDerivationStep: { policy: "device_local", scope: "local" },
  FormalDerivationStep: { policy: "device_local", scope: "local" },
  FormalDerivationCheckpoint: { policy: "device_local", scope: "local" },
  EventOutbox: { policy: "device_local", scope: "local" },
  DomainEventOutbox: { policy: "device_local", scope: "local" },
  DomainEventDelivery: { policy: "device_local", scope: "local" },
  LlmRequestLog: { policy: "device_local", scope: "local" },
  ApiRequestLog: { policy: "device_local", scope: "local" },
  BackendErrorGroup: { policy: "device_local", scope: "local" },
  GlobalGenerationSettings: { policy: "device_local", scope: "local" },
  DeepPlanningResearchLease: { policy: "device_local", scope: "local" },
  GlobalLlmRoute: { policy: "device_local", scope: "local" },
  LlmPricingConfig: { policy: "device_local", scope: "local" },
  ContentVerificationAudit: { policy: "device_local", scope: "local" },
  LearningTargetWebSource: { policy: "device_local", scope: "local" },
  WebKnowledgeRevision: { policy: "device_local", scope: "local" },
  WebKnowledgeSource: { policy: "device_local", scope: "local" },
  LearningSystemAvailability: { policy: "device_local", scope: "local" },
  UnitScenarioTheater: { policy: "leased_replace", scope: "goal_via_unit" },
  ScenarioTheaterScene: { policy: "leased_replace", scope: "workspace" },
  ScenarioTheaterRun: { policy: "immutable_union", scope: "goal_via_unit" },
  UnitLab: { policy: "leased_replace", scope: "goal_via_unit" },
  UnitLabVisit: { policy: "leased_replace", scope: "goal_via_unit" },
  MemoryRecord: { policy: "leased_replace", scope: "workspace" },
  MemoryEvidence: { policy: "immutable_union", scope: "workspace" },
  MemoryRevision: { policy: "immutable_union", scope: "workspace" },
  MemoryCandidate: { policy: "device_local", scope: "local" },
  MemoryFormationCursor: { policy: "device_local", scope: "local" },
  MemoryDeletionAudit: { policy: "immutable_union", scope: "workspace" },
  MemoryPalaceRoom: { policy: "device_local", scope: "local" },
  MemoryPalaceTip: { policy: "device_local", scope: "local" },
  ElectronLearningSchemaAdoption: { policy: "device_local", scope: "local" },
  PersonalSyncState: { policy: "device_local", scope: "local" },
  PersonalSyncCommit: { policy: "device_local", scope: "local" },
  PersonalSyncRowChange: { policy: "device_local", scope: "local" },
  PersonalSyncCursor: { policy: "device_local", scope: "local" },
  PersonalSyncAcknowledgement: { policy: "device_local", scope: "local" },
  PersonalSyncTombstone: { policy: "device_local", scope: "local" },
  PersonalSyncConflict: { policy: "device_local", scope: "local" },
  PersonalSyncSnapshot: { policy: "device_local", scope: "local" },
  PersonalSyncLeaseCache: { policy: "device_local", scope: "local" },
  PersonalSyncDeviceCounter: { policy: "device_local", scope: "local" },
  PersonalSyncDevice: { policy: "device_local", scope: "local" },
} as const satisfies Record<string, SyncTableRule>;

export const personalSyncTableManifest: Readonly<
  Record<string, SyncTableRule>
> = Object.freeze(rules);

const ignoredTables = new Set(["mikro_orm_migrations", "sqlite_sequence"]);

export function assertPersonalSyncTableCoverage(
  tableNames: readonly string[],
  options: {validatedLegacyTables?: readonly string[]} = {},
): void {
  const missing = tableNames
    .filter((name) => !name.startsWith("sqlite_"))
    .filter((name) => !ignoredTables.has(name))
    .filter((name) => !personalSyncTableManifest[name])
    .filter((name) => !options.validatedLegacyTables?.includes(name))
    .sort();
  if (missing.length)
    throw new Error(
      `Personal sync table manifest is missing: ${missing.join(", ")}`,
    );
}
