import type {
  TeachingPersona,
  TeachingPersonaInstructions,
} from "../../domain/src/index.js";

export type LocalTeachingPersona = Readonly<TeachingPersona>;
export type LocalTeachingPersonaInstructions =
  Readonly<TeachingPersonaInstructions>;
export type LocalTeachingPersonaDraft = Readonly<{
  name: string;
  avatarCode: TeachingPersona["avatarCode"];
  tagline: string;
  learnerAddress: string;
  instructions: TeachingPersonaInstructions;
}>;
export type LocalTeachingPersonaCatalog = Readonly<{
  current: LocalTeachingPersona;
  globalRef: string;
  goalPersonaRef: string | null;
  builtin: LocalTeachingPersona[];
  custom: LocalTeachingPersona[];
  capabilities: Readonly<{
    globalSelection: true;
    customCrud: true;
    goalOverride: true;
    promptApplication: true;
    preview: false;
  }>;
}>;

export type LocalProfile = Readonly<{
  ownerId: string;
  displayName: string;
  locale: string;
  profile: Record<string, unknown>;
  onboardingCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}>;

export type LocalSpace = Readonly<{
  id: string;
  name: string;
  purpose: string;
  position: number;
  goalCount: number;
  createdAt: number;
  updatedAt: number;
}>;

export type LocalLearningSpaceItem = Readonly<{
  id: string;
  spaceId: string;
  itemType: "goal" | "planned_goal";
  goalId: string | null;
  plannedTitle: string;
  rationale: string;
  suggestedGoalKind: "full" | "micro";
  source: string;
  sortIndex: number;
  goal: LocalGoalSummary | null;
}>;

export type LocalLearningSpaceRelation = Readonly<{
  id: string;
  fromItemId: string;
  toItemId: string;
  relationType: "prerequisite" | "supports" | "follow_up" | "related";
  source: string;
}>;

export type LocalLearningSpaceDetail = Readonly<{
  id: string;
  name: string;
  purpose: string;
  sortIndex: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  items: LocalLearningSpaceItem[];
  relations: LocalLearningSpaceRelation[];
}>;

export type LocalLearningSpacePortfolio = Readonly<{
  fingerprint: string;
  spaces: LocalLearningSpaceDetail[];
  unorganizedGoals: LocalGoalSummary[];
}>;

export type LocalGoalSummary = Readonly<{
  id: string;
  spaceId: string | null;
  title: string;
  description: string;
  learningMode: "mastery" | "exploration";
  planningMode: "fast" | "deep" | "docs_first";
  kind: "goal" | "micro_course" | "foundation_support";
  /** Persisted authoring language used by goal-scoped learner content. */
  contentLanguage:
    | "zh-Hans"
    | "zh-Hant"
    | "en"
    | "ja"
    | "ko"
    | "es"
    | "fr"
    | "de"
    | "other";
  /** Goal override; null means the learner-level persona is inherited. */
  teachingPersonaRef: string | null;
  /** Desktop-local is always the private local path source. */
  pathSource: "local";
  status: "draft" | "active" | "completed" | "archived";
  progress: number;
  nextUnitId: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type LocalUnitQuizSetSummary = Readonly<{
  id: string;
  createdAt: string;
  questionCount: number;
  typeCounts: Readonly<{
    mcq: number;
    mcq_multi: number;
    true_false: number;
  }>;
  preview: string;
  attemptCount: number;
  bestScore: number | null;
  latestScore: number | null;
  latestAttemptAt: string | null;
}>;

export type LocalUnitSessionMetadata = Readonly<{
  contentLanguage: LocalGoalSummary["contentLanguage"];
  teachingPersonaRef: string | null;
  pathSource: "local";
  quizSets: readonly LocalUnitQuizSetSummary[];
}>;

export type LocalUnit = Readonly<{
  id: string;
  moduleId: string;
  goalId: string;
  title: string;
  summary: string;
  position: number;
  status: "pending" | "available" | "in_progress" | "completed" | "failed";
  /** Server-owned completion provenance used by the hosted unit-page DTO. */
  completionMethod: "learned" | "test_out" | null;
  material: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
  completedAt: number | null;
}>;

export type LocalAgendaItem = Readonly<{
  id: string;
  kind: "learn" | "review";
  title: string;
  goalId: string | null;
  unitId: string | null;
  /** The first unfinished section when the hosted planner scheduled a section slice. */
  sectionId?: string | null;
  sectionTitle?: string | null;
  reviewCardId: string | null;
  /** Hosted planner metadata retained in the local revision intent. */
  reviewDueAt?: string | null;
  priority?: number;
  explanation?: string;
  explanationCode?: string;
  sortIndex?: number;
  scheduledFor: number;
  durationMinutes: number;
  completedAt: number | null;
  /** Hosted agenda intent projections. These are deterministic local facts,
   * never learner-authored mastery claims. */
  cognitiveEntityIds?: readonly string[];
  targetState?: Readonly<Record<string, unknown>>;
  expectedEvidence?: Readonly<Record<string, unknown>>;
}>;

export type LocalPersonalSnapshot = Readonly<{
  profile: LocalProfile;
  settings: Record<string, unknown>;
  spaces: LocalSpace[];
  goals: LocalGoalSummary[];
  agenda: LocalAgendaItem[];
  reviewDueCount: number;
}>;

/**
 * A canonical, owner-scoped hit from the local document index.  The text and
 * revision identifiers come from the durable document/revision/chunk rows;
 * callers must not manufacture source metadata when this list is empty.
 */
export type LocalDocumentSearchHit = Readonly<{
  chunkId: string;
  documentId: string;
  revisionId: string;
  revision: number;
  goalId: string | null;
  name: string;
  sourceType: "upload" | "url" | "folder";
  sourceUri: string;
  contentHash: string;
  ordinal: number;
  content: string;
  score: number;
}>;

export type LocalMemoryItem = Readonly<{
  id: string;
  kind: "personal_fact" | "preference" | "constraint" | "episode";
  summary: string;
  stableKey: string;
  authority: "learner_declared" | "conversation_derived" | "trusted_workflow";
  status: "active" | "superseded" | "archived";
  confidence: number;
  importance: number;
  scope: {
    productId: string;
    domain: string;
    scopeType: "user" | "goal" | "thread";
    scopeId: string | null;
  };
  evidence: Array<{
    id: string;
    sourceType: "message" | "workflow" | "manual";
    excerpt: string;
    occurredAt: string;
  }>;
  asOf: string;
  createdAt: string;
  updatedAt: string;
}>;

export interface PersonalLearningStore {
  bootstrap(): Promise<LocalPersonalSnapshot>;
  updateProfile(input: {
    displayName?: string;
    locale?: string;
    profile?: Record<string, unknown>;
    completeOnboarding?: boolean;
  }): Promise<LocalProfile>;
  updateLearnerSettings(
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  listMemoryItems(
    status: LocalMemoryItem["status"],
  ): Promise<LocalMemoryItem[]>;
  createMemoryItem(input: {
    kind: Exclude<LocalMemoryItem["kind"], "episode">;
    summary: string;
  }): Promise<LocalMemoryItem>;
  updateMemoryItem(id: string, summary: string): Promise<LocalMemoryItem>;
  archiveMemoryItem(id: string): Promise<LocalMemoryItem>;
  listTeachingPersonas(goalId?: string): Promise<LocalTeachingPersonaCatalog>;
  resolveTeachingPersona(goalId?: string): Promise<LocalTeachingPersona>;
  selectTeachingPersona(personaRef: string): Promise<LocalTeachingPersona>;
  selectGoalTeachingPersona(
    goalId: string,
    personaRef: string | null,
  ): Promise<{ persona: LocalTeachingPersona; inherited: boolean }>;
  createTeachingPersona(
    input: LocalTeachingPersonaDraft,
  ): Promise<LocalTeachingPersona>;
  updateTeachingPersona(
    id: string,
    input: Partial<LocalTeachingPersonaDraft>,
  ): Promise<LocalTeachingPersona>;
  deleteTeachingPersona(id: string): Promise<{ ok: true }>;
  createSpace(input: { name: string; purpose?: string }): Promise<LocalSpace>;
  learningSpacePortfolio(): Promise<LocalLearningSpacePortfolio>;
  readSpace(spaceId: string): Promise<LocalLearningSpaceDetail>;
  updateSpace(
    spaceId: string,
    input: { name?: string; purpose?: string },
  ): Promise<LocalLearningSpaceDetail>;
  deleteSpace(spaceId: string): Promise<{ ok: true }>;
  reorderSpaces(orderedSpaceIds: string[]): Promise<{ ok: true }>;
  createPlannedGoal(
    spaceId: string,
    input: {
      title: string;
      rationale?: string;
      suggestedGoalKind?: "full" | "micro";
    },
  ): Promise<LocalLearningSpaceItem>;
  updatePlannedGoal(
    itemId: string,
    input: {
      title?: string;
      rationale?: string;
      suggestedGoalKind?: "full" | "micro";
    },
  ): Promise<LocalLearningSpaceItem>;
  removeSpaceItem(
    itemId: string,
  ): Promise<{ ok: true; goalPreserved: boolean }>;
  moveGoalToSpace(input: {
    goalId: string;
    spaceId: string | null;
    includeFoundationGoalIds?: string[];
  }): Promise<{ ok: true; goalIds: string[]; spaceId: string | null }>;
  reorderSpaceItems(
    spaceId: string,
    orderedItemIds: string[],
  ): Promise<{ ok: true }>;
  createSpaceRelation(
    spaceId: string,
    input: {
      fromItemId: string;
      toItemId: string;
      relationType: LocalLearningSpaceRelation["relationType"];
    },
  ): Promise<LocalLearningSpaceRelation>;
  deleteSpaceRelation(relationId: string): Promise<{ ok: true }>;
  createGoal(input: {
    title: string;
    description?: string;
    spaceId?: string | null;
    targetSpaceItemId?: string;
    learningMode?: "mastery" | "exploration";
    planningMode?: "fast" | "deep" | "docs_first";
    kind?: "goal" | "micro_course" | "foundation_support";
  }): Promise<LocalGoalSummary>;
  listFoundationGoals(goalId: string): Promise<LocalGoalSummary[]>;
  deleteGoal(goalId: string): Promise<{ ok: true }>;
  readGoal(
    goalId: string,
  ): Promise<LocalGoalSummary & { modules: Array<Record<string, unknown>> }>;
  readUnit(unitId: string): Promise<LocalUnit>;
  saveSession(
    unitId: string,
    state: Record<string, unknown>,
    activeSeconds?: number,
  ): Promise<LocalUnit>;
  completeUnit(
    unitId: string,
    result?: { score: number; feynmanPassed: boolean },
  ): Promise<LocalUnit>;
  setOverviewUnitCompletion(
    goalId: string,
    unitId: string,
    completed: boolean,
  ): Promise<LocalUnit>;
  listDocuments(goalId?: string): Promise<Array<Record<string, unknown>>>;
  searchDocuments(input: {
    goalId?: string;
    query: string;
    limit?: number;
  }): Promise<LocalDocumentSearchHit[]>;
  addDocument(input: {
    name: string;
    sourceType: "upload" | "url" | "folder";
    sourceUri?: string;
    textContent: string;
    goalId?: string | null;
  }): Promise<Record<string, unknown>>;
  deleteDocument(
    documentId: string,
    goalId?: string,
  ): Promise<{ ok: true; name: string }>;
  /** Read the last published agenda without rebuilding it. */
  readPublishedAgenda(): Promise<LocalAgendaItem[]>;
  refreshAgenda(now?: number): Promise<LocalAgendaItem[]>;
}
