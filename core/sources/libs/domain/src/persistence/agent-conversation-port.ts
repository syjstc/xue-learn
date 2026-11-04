export type AgentThreadRecord = Readonly<{
  id: string;
  userId: string;
  scope: string;
  scopeId: string | null;
  status: string;
  stateJson: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AgentMessageRecord = Readonly<{
  id: string;
  threadId: string;
  role: string;
  content: string;
  toolCalls: string;
  toolCallId: string | null;
  uiPayload: string;
  metadataJson: string;
  createdAt: Date;
}>;

export type AgentThreadListRecord = AgentThreadRecord &
  Readonly<{ latestMessage: AgentMessageRecord | null }>;

export type AgentProceduralDefaultsRecord = Readonly<{
  llmProvider: string | null;
  teachingPersonaRef: string | null;
  level: string | null;
  contentLanguage: string | null;
}>;

export type AgentOwnedUnitRecord = Readonly<{
  id: string;
  goalId: string;
  title: string;
  contentRevision: number;
  goalTitle: string;
}>;

export type GoalCreationResourceRecord = Readonly<{
  id: string;
  sessionId: string;
  kind: string;
  filename: string;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  provider: string | null;
  extractedText: string;
  status: string;
  warning: string;
  error: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type GoalCreationSessionRecord = Readonly<{
  id: string;
  userId: string;
  threadId: string;
  goalId: string | null;
  activeSlot: string | null;
  status: string;
  phase: string;
  checkpointJson: string;
  currentRunId: string | null;
  firstUnitId: string | null;
  stopRequestedAt: Date | null;
  stoppedAt: Date | null;
  completedAt: Date | null;
  lastError: string;
  version: number;
  nextEventSequence: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type GoalCreationEventRecord = Readonly<{
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}>;

export type GoalCreationParentRecord = Readonly<{
  id: string;
  title: string;
  contentLanguage: string;
  goalKind: string;
  parentGoalId: string | null;
  goalRelationType: string | null;
  mapPlanJson: string;
}>;

export type GoalCreationJourneyRecord = Readonly<{
  learningMode: string;
  modules: readonly Readonly<{
    id: string;
    title: string;
    orderIndex: number;
    generationStatus: string;
    units: readonly Readonly<{
      id: string;
      title: string;
      orderIndex: number;
      cognitiveModelStatus: string;
    }>[];
  }>[];
}>;

export type GoalCreationResourceInput = Readonly<{
  kind: string;
  filename: string;
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  provider?: string | null;
  extractedText: string;
  warning?: string;
}>;

export interface AgentConversationRepository {
  searchOwnedGoals(
    input: Readonly<{
      userId: string;
      since: Date | null;
      until: Date | null;
      dateField: "createdAt" | "updatedAt";
      includeInactive: boolean;
      query: string | null;
      limit: number;
    }>,
  ): Promise<
    readonly Readonly<{
      id: string;
      title: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      unitCount: number;
      completedCount: number;
    }>[]
  >;
  listOwnedRecentActivity(
    userId: string,
    limit: number,
  ): Promise<
    Readonly<{
      goals: readonly Readonly<{
        id: string;
        title: string;
        status: string;
        updatedAt: Date;
      }>[];
      units: readonly Readonly<{
        id: string;
        title: string;
        status: string;
        goalId: string;
        goalTitle: string;
        currentStep: string;
        structuredSubStep: string;
        updatedAt: Date;
      }>[];
    }>
  >;
  searchOwnedUnits(
    input: Readonly<{
      userId: string;
      query: string | null;
      goalId: string | null;
      goalQuery: string | null;
      status: string | null;
      limit: number;
    }>,
  ): Promise<
    readonly Readonly<{
      id: string;
      title: string;
      status: string;
      unitKind: string;
      orderIndex: number;
      goalId: string;
      goalTitle: string;
      currentStep: string | null;
    }>[]
  >;
  listActiveGlobalThreads(
    userId: string,
    limit: number,
  ): Promise<readonly AgentThreadRecord[]>;
  listActiveThreads(
    userId: string,
    input: Readonly<{
      scope: string;
      scopeId?: string | null;
      limit: number;
    }>,
  ): Promise<readonly AgentThreadRecord[]>;
  createThread(
    input: Readonly<{
      userId: string;
      scope: string;
      scopeId: string | null;
      stateJson: string;
    }>,
  ): Promise<AgentThreadRecord>;
  findOrCreateScopedThread(
    input: Readonly<{
      userId: string;
      scope: string;
      scopeId: string;
      stateJson: string;
    }>,
  ): Promise<AgentThreadRecord>;
  listThreads(
    userId: string,
    scope: string | null,
    limit: number,
  ): Promise<readonly AgentThreadListRecord[]>;
  findThread(threadId: string): Promise<AgentThreadRecord | null>;
  updateThreadState(threadId: string, stateJson: string): Promise<void>;
  resetThread(threadId: string, stateJson: string): Promise<void>;
  appendMessage(
    threadId: string,
    message: Readonly<{
      role: string;
      content: string;
      toolCalls: string;
      toolCallId: string | null;
      uiPayload: string;
      metadataJson: string;
    }>,
  ): Promise<AgentMessageRecord>;
  listAllMessages(threadId: string): Promise<readonly AgentMessageRecord[]>;
  readProceduralDefaults(
    userId: string,
  ): Promise<AgentProceduralDefaultsRecord>;
  findOwnedUnit(
    userId: string,
    unitId: string,
  ): Promise<AgentOwnedUnitRecord | null>;
  findGoalCreationSessionId(threadId: string): Promise<string | null>;
  replacePendingGoalCreationResources(
    sessionId: string,
    kind: string,
    resources: readonly GoalCreationResourceInput[],
  ): Promise<void>;
  listGoalCreationResources(
    sessionId: string,
    statuses: readonly string[],
  ): Promise<readonly GoalCreationResourceRecord[]>;
  markGoalCreationResourceIngested(resourceId: string): Promise<void>;
  goalCreationWorkGate(goalId: string): Promise<"run" | "stopped">;
  readGlobalBriefing(
    userId: string,
    now: Date,
  ): Promise<
    Readonly<{
      dueCount: number;
      flashcardDueCount: number;
      activeGoalCount: number;
    }>
  >;
  listUnitLearningTargetIds(unitId: string): Promise<readonly string[]>;
  recoverInterruptedGoalCreationSessions(
    errorMessage: string,
  ): Promise<readonly string[]>;
  findGoalCreationSessionByActiveSlot(
    userId: string,
  ): Promise<GoalCreationSessionRecord | null>;
  findGoalCreationSessionById(
    sessionId: string,
  ): Promise<GoalCreationSessionRecord | null>;
  findGoalCreationSessionByGoalId(
    goalId: string,
  ): Promise<GoalCreationSessionRecord | null>;
  findGoalCreationSessionByThreadId(
    threadId: string,
  ): Promise<GoalCreationSessionRecord | null>;
  createGoalCreationSession(
    input: Readonly<{
      userId: string;
      stateJson: string;
      phase: string;
    }>,
  ): Promise<Readonly<{ session: GoalCreationSessionRecord; raced: boolean }>>;
  findFoundationParent(
    userId: string,
    goalId: string,
  ): Promise<GoalCreationParentRecord | null>;
  listFoundationRelationContexts(
    userId: string,
    parentGoalId: string,
  ): Promise<readonly string[]>;
  bindGoalCreationSessionGoal(
    input: Readonly<{
      sessionId: string;
      threadId: string;
      goalId: string;
      phase: string;
      stateJson: string;
    }>,
  ): Promise<void>;
  deleteGoalCreationSession(sessionId: string): Promise<void>;
  deleteFoundationGoal(
    input: Readonly<{
      userId: string;
      goalId: string;
      parentGoalId: string;
    }>,
  ): Promise<void>;
  listLegacyGoalCreationThreads(
    userId: string,
    limit: number,
  ): Promise<readonly AgentThreadRecord[]>;
  goalOwnedExists(userId: string, goalId: string): Promise<boolean>;
  adoptLegacyGoalCreationSession(
    input: Readonly<{
      userId: string;
      threadId: string;
      goalId: string | null;
      status: string;
      phase: string;
      checkpointJson: string;
    }>,
  ): Promise<GoalCreationSessionRecord | null>;
  listGoalCreationEvents(
    sessionId: string,
    after: number,
    limit: number,
  ): Promise<readonly GoalCreationEventRecord[]>;
  appendGoalCreationEvent(
    sessionId: string,
    event: Readonly<{ type: string; payload: unknown }>,
  ): Promise<GoalCreationEventRecord>;
  readGoalCreationJourney(goalId: string): Promise<GoalCreationJourneyRecord>;
  retryGoalCreationSession(sessionId: string, status: string): Promise<void>;
  stopGoalCreationSession(sessionId: string, stoppedAt: Date): Promise<void>;
  markGoalCreationSessionError(sessionId: string, error: string): Promise<void>;
  markGoalCreationRunStarted(threadId: string, runId: string): Promise<void>;
  syncGoalCreationSession(
    input: Readonly<{
      sessionId: string;
      goalId: string | null;
      phase: string;
      checkpointJson: string;
      status?: string;
      error?: string;
    }>,
  ): Promise<void>;
  completeGoalCreationSession(
    sessionId: string,
    firstUnitId: string,
    completedAt: Date,
  ): Promise<boolean>;
  /** Claim the first-lesson notification without completing background work. */
  markGoalCreationFirstUnitReady(sessionId: string, firstUnitId: string): Promise<boolean>;
  advanceGoalCreationSessionToFirstUnit(
    sessionId: string,
    phase: string,
  ): Promise<void>;
  countGoalUnits(goalId: string, planBoundOnly?: boolean): Promise<number>;
  listGoalOverviewBranches(
    goalId: string,
  ): Promise<readonly Readonly<{ title: string; contentSummary: string }>[]>;
  listMessages(
    input: Readonly<{
      threadId: string;
      beforeCreatedAt: Date | null;
      beforeId: string | null;
      limit: number;
    }>,
  ): Promise<
    Readonly<{ messages: readonly AgentMessageRecord[]; total: number }>
  >;
  clearThread(threadId: string, stateJson: string): Promise<void>;
  resetThreadContext(
    threadId: string,
    stateJson: string,
    systemMessage: string,
    metadataJson: string,
  ): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
}
