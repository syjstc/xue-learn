/** A position is a bookmark, never evidence of mastery. All ticks use VideoTick. */
export type LearningPosition = {
  version: 1;
  unitId: string;
  sectionId?: string;
  topicId?: string;
  topicTitle?: string;
  blockIdentity?: string;
  blockIndex?: number;
  contentRevision?: number;
  anchorText?: string;
  scrollOffset?: number;
  mode: "reading" | "classroom";
  /** Renderer bookmark only; never a completion or assessment result. */
  readingPage?: { renderer: "godot"; identity: string };
  classroom?: {
    projectId: string;
    sourceHash: string;
    sceneId: string;
    beatId?: string;
    tick: number;
  };
};
export type LearningBranchPurpose = "foundation" | "clarification" | "interest";
export type LearningBranchStatus =
  "preparing" | "ready" | "failed" | "cancelled" | "dismissed" | "proposed";
export type LearningBranch = {
  id: string;
  unitId: string;
  goalId: string;
  sectionId: string | null;
  sourceThreadId: string | null;
  sourceEventId: string;
  origin: LearningPosition;
  purpose: LearningBranchPurpose;
  kind: "topic" | "section" | "goal";
  title: string;
  reason: string;
  returnGoal: string;
  topics: string[];
  status: LearningBranchStatus;
  deferred: boolean;
  revision: number;
  generationToken: string | null;
  transcript: unknown[];
  plannedGoalId: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
};
export type LearningVisit = {
  id: string;
  unitId: string;
  branchId: string;
  sessionId: string;
  state: "active" | "paused" | "returned";
  returnPosition: LearningPosition;
  position: LearningPosition | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type LearningTrajectoryEventKind =
  | "question"
  | "suggestion"
  | "entered"
  | "paused"
  | "returned"
  | "check"
  | "understood"
  | "content_finished"
  | "deferred"
  | "dismissed";
export type LearningTrajectoryEvent = {
  id: string;
  unitId: string;
  branchId: string | null;
  visitId: string | null;
  threadId: string | null;
  kind: LearningTrajectoryEventKind;
  text: string;
  /** Server-observed check results only. Never populated by a navigation client. */
  evidence: {
    correct?: boolean;
    question?: string;
    answer?: string;
    sourceId?: string;
  } | null;
  position: LearningPosition | null;
  createdAt: string;
};
export type LearningGuidancePreferences = {
  autoSaveSupplements: boolean;
  proactiveGuidance: boolean;
};
export const DEFAULT_LEARNING_GUIDANCE_PREFERENCES: LearningGuidancePreferences =
  {
    autoSaveSupplements: true,
    proactiveGuidance: true,
  };
export type LearningTrajectorySnapshot = {
  branches: LearningBranch[];
  visits: LearningVisit[];
  events: LearningTrajectoryEvent[];
  nextCursor: string | null;
};

/** Identity excludes array indices: inserting/reordering another block cannot retarget it. */
export function learningContentIdentity(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object")
      return `{${Object.entries(v)
        .filter(([k]) => k !== "id" && k !== "figureId")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, c]) => `${k}:${canonical(c)}`)
        .join(",")}}`;
    return JSON.stringify(v) ?? "null";
  };
  let a = 2166136261,
    b = 5381;
  for (const ch of canonical(value)) {
    a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ ch.charCodeAt(0);
  }
  return `content-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
export function resolveLearningBlock(
  blocks: readonly unknown[],
  position: LearningPosition,
): { blockIndex: number | null; exact: boolean } {
  if (position.blockIdentity) {
    const matches = blocks.flatMap((b, i) =>
      learningContentIdentity(b) === position.blockIdentity ? [i] : [],
    );
    if (matches.length === 1) return { blockIndex: matches[0], exact: true };
  }
  if (position.topicId || position.topicTitle) {
    const matches = blocks.flatMap((b, i) => {
      const v = b as { type?: string; topicId?: string; text?: string };
      return v?.type === "heading" &&
        (position.topicId
          ? (v.topicId ?? learningContentIdentity(v)) === position.topicId
          : v.text === position.topicTitle)
        ? [i]
        : [];
    });
    if (matches.length === 1) return { blockIndex: matches[0], exact: false };
  }
  return { blockIndex: null, exact: false };
}
