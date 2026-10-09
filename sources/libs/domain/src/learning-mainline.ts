import type { LearningPosition } from "./learning-trajectory.js";

export const MAINLINE_POLICY_VERSION = "mainline.v1";
export const MAINLINE_POLICY = {
  cooldownMs: 30 * 60_000,
  sessionLimit: 2,
  expiresMs: 5 * 60_000,
} as const;
export type MainlineActivity = {
  id: string;
  goalId: string;
  unitId: string;
  title: string;
  kind: "lesson" | "supplement" | "review";
  branchId?: string;
  visitId?: string;
  reviewSource?: "course" | "flashcards";
  sourceActivityId: string | null;
  returnActivityId: string | null;
  sessionId: string;
  state: "active" | "paused" | "ended";
  position: LearningPosition;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type MainlineFocus = {
  sessionId: string;
  activityId: string | null;
  revision: number;
};
export type MainlinePreference = {
  goalId: string;
  newLearning: "active" | "paused";
  reviews: boolean;
  priority: number;
  revision: number;
};
export type MainlineSnapshot = {
  focus: MainlineFocus;
  activities: MainlineActivity[];
  preferences: MainlinePreference[];
};
export type MainlineCandidate = {
  id: string;
  goalId: string;
  unitId: string;
  title: string;
  kind: "lesson" | "review";
  executable: boolean;
  preparing?: boolean;
  order: number;
  reviewSource?: "course" | "flashcards";
  prerequisiteUnitIds?: string[];
  /** Same discrete urgency scale; scheduler raw scores never cross this boundary. */
  urgency: number;
  verifiedRelated: boolean;
  estimatedMinutes: number | null;
};
export type MainlineDecision = {
  policyVersion: string;
  snapshotVersion: string;
  expiresAt: string;
  primary: MainlineCandidate | null;
  optional: MainlineCandidate | null;
  reason:
    | "current"
    | "next"
    | "return"
    | "preparing"
    | "review"
    | "other_goal"
    | "none";
};
export function selectMainline(input: {
  candidates: readonly MainlineCandidate[];
  preferences: readonly MainlinePreference[];
  currentGoalId?: string;
  currentUnitId?: string;
  currentPreparing?: boolean;
  returnCandidate?: MainlineCandidate;
  explicitCandidateId?: string;
  boundary: boolean;
  shownCount: number;
  cooldownUntil: number;
  now: number;
  timeLimitMinutes?: number;
}): Pick<MainlineDecision, "primary" | "optional" | "reason"> {
  const prefs = new Map(input.preferences.map((p) => [p.goalId, p]));
  const seen = new Set<string>();
  const available = input.candidates.filter((c) => {
    const pref = prefs.get(c.goalId);
    const allowed =
      c.executable &&
      !seen.has(c.id) &&
      (c.kind === "review"
        ? pref?.reviews !== false
        : pref?.newLearning !== "paused");
    seen.add(c.id);
    return allowed;
  });
  const withinBudget = (c: MainlineCandidate) =>
    input.timeLimitMinutes == null ||
    (c.estimatedMinutes != null &&
      c.estimatedMinutes <= input.timeLimitMinutes);
  const reviews = available
    .filter((c) => c.kind === "review" && withinBudget(c))
    .sort(
      (a, b) =>
        Number(b.verifiedRelated) - Number(a.verifiedRelated) ||
        b.urgency - a.urgency ||
        (a.estimatedMinutes ?? Infinity) - (b.estimatedMinutes ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
  const lessons = available
    .filter((c) => c.kind === "lesson")
    .sort(
      (a, b) =>
        (prefs.get(b.goalId)?.priority ?? 0) -
          (prefs.get(a.goalId)?.priority ?? 0) ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
    );
  let primary =
    available.find((c) => c.id === input.explicitCandidateId) ??
    available.find(
      (c) =>
        c.goalId === input.currentGoalId &&
        c.unitId === input.currentUnitId &&
        c.kind === "lesson",
    ) ??
    null;
  let reason: MainlineDecision["reason"] = primary ? "current" : "none";
  if (!primary && input.returnCandidate?.executable) {
    primary = input.returnCandidate;
    reason = "return";
  }
  if (!primary) {
    primary = lessons.find((c) => c.goalId === input.currentGoalId) ?? null;
    if (primary) reason = "next";
  }
  if (!primary && input.currentPreparing)
    return { primary: null, optional: null, reason: "preparing" };
  if (!primary) {
    primary = reviews[0] ?? lessons[0] ?? null;
    reason = !primary
      ? "none"
      : primary.kind === "review"
        ? "review"
        : "other_goal";
  }
  const canSuggest =
    input.boundary &&
    input.shownCount < MAINLINE_POLICY.sessionLimit &&
    input.now >= input.cooldownUntil;
  const optional = canSuggest
    ? (reviews.find(
        (c) => c.id !== primary?.id && c.unitId !== input.currentUnitId,
      ) ?? null)
    : null;
  return { primary, optional, reason };
}
export type MainlineCommand = {
  commandId: string;
  sessionId: string;
  expectedRevision: number;
  action:
    | "start"
    | "resume"
    | "position"
    | "pause"
    | "return"
    | "preference"
    | "shown"
    | "later"
    | "today";
  activityId?: string;
  activityRevision?: number;
  goalId?: string;
  unitId?: string;
  kind?: MainlineActivity["kind"];
  branchId?: string;
  position?: LearningPosition;
  preference?: {
    newLearning: "active" | "paused";
    reviews: boolean;
    priority: number;
    revision: number;
  };
  candidateId?: string;
  snapshotVersion?: string;
  timezone?: string;
  timeLimitMinutes?: number;
  reviewSource?: "course" | "flashcards";
};

export type MainlineResolvedPosition = {
  activityId: string;
  goalId: string | null;
  position: LearningPosition | null;
  exact: boolean;
  fallback: "position" | "goal" | "goals";
};
