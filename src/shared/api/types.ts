import type { GoalMapPlan } from "@xue-learn/core/api";
import type { components } from "@xue-learn/core/api/types";
import type { UnitContentGenStatus } from "@/shared/domain/unit-content-status";
import type { LearningMaterialContent, SqPreview } from "@xue-learn/core/schemas";

export type GoalMapSummary = {
  refinedTitle?: string;
  topicOverview: string;
  assumptions?: string[];
};

export type LastLearnedUnit = {
  id: string;
  title: string;
  status: string;
  learnedAt: string;
};

export type NextLearningUnit = Omit<LastLearnedUnit, "learnedAt">;

export type GoalKind = "full" | "micro";

export type GoalListItem = {
  id: string;
  title: string;
  level: string;
  goalKind: GoalKind;
  pathSource: string;
  createdAt: string;
  updatedAt: string;
  unitCount: number;
  completedCount: number;
  progressPercent?: number;
  progressUnits?: number;
  documentCount: number;
  iconSvg?: string;
  iconTint?: string;
  lastLearnedUnit?: LastLearnedUnit | null;
  nextLearningUnit?: NextLearningUnit | null;
  totalLearningSeconds?: number;
  shareVisibility?: "public" | "pending" | "off";
  activeShareId?: string | null;
  pendingShareId?: string | null;
};

export type PublicSharedCourseListItem = {
  shareId: string;
  goalId: string;
  title: string;
  level: string;
  goalKind: GoalKind;
  topicOverview: string;
  iconSvg?: string;
  iconTint?: string;
  lessonCount: number;
  publishedAt: string;
  featuredOrder: number | null;
  manifestUrl: string;
  manifestChecksum?: string | null;
  manifestBytes?: number | null;
  schemaVersion: number;
};

export type SharedGoalPreview = {
  id: string;
  sourceGoalId?: string;
  title: string;
  level: string;
  goalKind: GoalKind;
  pathSource: string;
  topicOverview?: string;
  unitCount: number;
  lessonCount: number;
  iconSvg?: string;
  iconTint?: string;
  shareVisibility?: "public" | "pending" | "off";
  publishedAt?: string;
  manifestUrl?: string | null;
  manifestChecksum?: string | null;
  schemaVersion?: number;
};

export type SharedCourseModuleSection = {
  kind: "module";
  index: string;
  title: string;
  contentSummary: string;
};

export type SharedCourseLessonSection = {
  kind: "lesson";
  unitId: string;
  moduleId?: string | null;
  index: string;
  title: string;
  contentSummary: string;
  material: LearningMaterialContent | null;
  learningTargets?: Array<{
    stableKey: string;
    localRef: string;
    title: string;
    explanation: string;
    learningObjective: string;
    assessmentCriteria: string[];
    required: boolean;
    weight: number;
    orderIndex: number;
  }>;
};

export type SharedCourseSection =
  SharedCourseModuleSection | SharedCourseLessonSection;

export type SharedGoalCourse = {
  goal: {
    id: string;
    title: string;
    level: string;
    goalKind: GoalKind;
    topicOverview: string;
    iconSvg?: string;
    iconTint?: string;
  };
  modules?: Array<{
    id: string;
    orderIndex: number;
    title: string;
    summary: string;
    objective: string;
  }>;
  sections: SharedCourseSection[];
};

export type GoalUnit = {
  id: string;
  moduleId?: string | null;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  prerequisites: string;
  contentSummary?: string;
  note?: string;
  mapOrigin?: string;
  mapEdited?: boolean;
  linkedGoalId?: string | null;
  supportKind?: "prerequisite_bridge" | null;
  supportForUnitId?: string | null;
  contentRevision?: number;
  completionMethod?: "learned" | "test_out" | null;
  completionAttemptId?: string | null;
  completedAt?: string | null;
  contentStatus?: {
    hasMaterial?: boolean;
    hasSq?: boolean;
  };
  sessionState?: {
    currentStep?: string | null;
    sq3rData?: string;
    graphState?: string;
    updatedAt?: string;
  } | null;
  learningMaterial?:
    { sections: string; introduction: string } | { hasContent: true } | null;
  /** Client-side cache overlay; avoids refetching goal detail for content-gen flags. */
  contentGen?: UnitContentGenStatus;
};

export type GoalOverviewUnit = {
  id: string;
  title: string;
  summary: string;
  keyConcepts: string[];
  branchIncludes: string[];
  checkQuestion: string;
  material: LearningMaterialContent | null;
  orderIndex: number;
  completedAt: string | null;
};

export type GoalOverviewCourse = {
  title: string;
  summary: string;
  units: GoalOverviewUnit[];
};

export type UploadedGoalDocument = {
  id: string;
  filename: string;
  createdAt: string;
  sourceType?: string;
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  provider?: string | null;
  title?: string | null;
  warning?: string | null;
  subtitleStatus?: string | null;
  hasOriginal?: boolean;
  contentType?: string | null;
  byteSize?: number | null;
  storageKey?: string | null;
};

export type GoalDetail = {
  id: string;
  title: string;
  goalKind: GoalKind;
  learningMode?: "exploration" | "mastery";
  masteryTransition?: {
    status: "idle" | "queued" | "building" | "failed";
    retryable: boolean;
    error: string | null;
  };
  pathSource: string;
  topicOverview?: string;
  overviewCourseStatus?: string;
  creationSession?: {
    id: string;
    status: string;
    phase: string;
    firstUnitId: string | null;
    updatedAt: string;
  } | null;
  overviewCourse?: GoalOverviewCourse | null;
  generationOptions?: string;
  uploadedDocuments?: UploadedGoalDocument[];
  units: GoalUnit[];
  totalLearningSeconds?: number;
  lastLearnedUnit?: LastLearnedUnit | null;
  shareVisibility?: "public" | "pending" | "off";
  activeShareId?: string | null;
  pendingShareId?: string | null;
  curriculumVersion?: number;
  modules?: GoalModule[];
  currentModuleId?: string | null;
  journeyProgress?: {
    completedModuleCount: number;
    totalModuleCount: number;
    progressPercent: number;
  };
  foundationGoals?: FoundationGoalSummary[];
  parentGoal?: { id: string; title: string } | null;
};

export type FoundationGoalSummary = {
  id: string;
  title: string;
  status: string;
  generationStatus: "preparing" | "ready" | "failed";
  prerequisiteItems: string[];
  learningMode: "exploration" | "mastery";
  /** Capability-hidden when this runtime cannot safely build mastery KACOM. */
  canUpgradeToMastery?: boolean;
  masteryTransition: {
    status: "idle" | "queued" | "building" | "failed";
    retryable: boolean;
    error: string | null;
  };
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
};

export type FoundationGoalsResponse = {
  prerequisites: string[];
  uncoveredPrerequisites: string[];
  foundationGoals: FoundationGoalSummary[];
};

export type GoalModule = {
  id: string;
  curriculumKey: string;
  planRef: string;
  orderIndex: number;
  title: string;
  summary: string;
  objective: string;
  plannedOutcomes: string[];
  entryFoundationBriefs?: Array<{
    ref: string;
    title: string;
    rationale: string;
    criticality: "critical" | "recommended";
    verificationDimensions: Array<"memory" | "understanding" | "application">;
  }>;
  entryFoundationStatus?: string;
  entryFoundationError?: string | null;
  exitCapabilityBriefs: string[];
  unitPlanningBrief: {
    scopeSize: "compact" | "standard" | "large";
    rationale: string;
    progression: string[];
  };
  estimatedUnitCount: number;
  unlockStatus: "locked" | "unlocked" | "completed";
  generationStatus: "pending" | "building" | "ready" | "failed";
  status: "locked" | "generating" | "active" | "completed" | "failed";
  generationError?: string | null;
  completionMethod?: "units" | "test_out" | null;
  completedRequiredUnits: number;
  requiredUnitCount: number;
  /** Lesson units already persisted (structure ready). */
  structureUnitCount?: number;
  /** Lessons with building/expanded cognitive model — safe to open. */
  readyUnitCount?: number;
  firstReadyUnitId?: string | null;
  /** Full lesson outline prepared before entering the goal page. */
  unitOutline?: Array<{
    id: string | null;
    title: string;
    contentSummary: string;
    difficulty: string;
    orderIndex: number;
  }>;
  learningMode?: "exploration" | "mastery";
  requiresCognitiveModel?: boolean;
};

export type GoalModuleDetail = GoalModule & {
  entryReadiness: {
    status:
      | "not_applicable"
      | "check_recommended"
      | "ready"
      | "bridge_needed"
      | "revalidate";
    checkAvailable: boolean;
    bridgeUnitId: string | null;
    foundations: Array<{
      learningTargetId: string;
      title: string;
      critical: boolean;
      estimate: number | null;
      evidenceSufficiency: number;
      reason:
        | "unverified"
        | "insufficient_evidence"
        | "below_threshold"
        | "revalidate"
        | null;
      ready: boolean;
    }>;
  };
  capabilities: Array<{
    id: string;
    localRef: string;
    title: string;
    objective: string;
    required: boolean;
  }>;
  units: Array<
    GoalUnit & {
      cognitiveModelStatus?: string | null;
      learnable?: boolean;
      difficulty?: string;
      moduleCapabilityRefs?: unknown;
      moduleMilestoneRole?: string | null;
      requiredForModuleCompletion?: boolean;
      skippedAt?: string | null;
      nextReviewAt?: string | null;
      reviewIntervalDays?: number | null;
      sections?: UnitSectionManifest[];
    }
  >;
};

export type UnitSectionManifest = {
  id: string;
  sourceSectionId: string;
  sectionKind: "content" | "mini_test";
  stableKey: string;
  orderIndex: number;
  title: string;
  contentSummary: string;
  requiredForCompletion: boolean;
  baseEstimatedMinutes: number;
  generationStatus: "pending" | "building" | "ready" | "failed";
  generationError: string;
  contentRevision: number;
  status: "available" | "in_progress" | "completed" | "skipped";
  activeSeconds: number;
  recommendSkip: boolean;
  contentKind?: "standard" | "formal_derivation";
  derivationFormat?: "classic" | "teaching_v1" | null;
  virtualComponents: Array<{
    id: string;
    title: string;
    componentType: string;
    description: string;
    anchor: string;
  }>;
  legacy: boolean;
};

export type GoalPlanResponse = {
  title: string;
  level: string;
  goalKind: GoalKind;
  learningMode?: "exploration" | "mastery";
  parentGoalId?: string | null;
  goalRelationType?: string | null;
  planningMode?: "fast" | "deep" | "docs_first";
  hasMap: boolean;
  incompleteMapModuleCount?: number;
  contentLanguage?: string;
  mapSummaryStatus?: string;
  summary?: GoalMapSummary | null;
  mapPlanStatus: string;
  detailedPlanStatus?: string;
  topicOverview: string | null;
  plan: GoalMapPlan | null;
  documentCount?: number;
  generationOptions?: string;
};

/** /api/units/:id/page */
export type UnitPageData = {
  unit: {
    id: string;
    title: string;
    goalId: string;
    parentUnitId: string | null;
    contentSummary: string;
    unitKind: string;
    status: string;
    sessionState?: { currentStep: string } | null;
    learningSteps?: Array<{
      ref: string;
      title: string;
      contentSummary: string;
      difficulty: string;
      learningTargetIds: string[];
    }>;
    sections?: UnitSectionManifest[];
  };
  goal: {
    id: string;
    title: string;
    goalKind: GoalKind;
    learningMode?: "exploration" | "mastery";
    domainTag: string;
  };
  isModule: boolean;
  canForceSubdivide: boolean;
};

/** /api/reviews/* */
export type CognitiveReviewTask = components["schemas"]["CognitiveReviewTask"];
export type DueCognitiveReviewResponse =
  components["schemas"]["DueCognitiveReviewResponse"];

export type PracticeUnit = {
  id: string;
  title: string;
  status: string;
  goal: { id: string; title: string };
};
