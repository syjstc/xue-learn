import type {
  LearningBranch,
  LearningPosition,
  LearningTrajectoryEvent,
  LearningTrajectorySnapshot,
  LearningVisit,
} from "../learning-trajectory.js";

export type LearningTrajectoryContext = {
  unitId: string;
  goalId: string;
  unitTitle: string;
  goalTitle: string;
  locale: string;
  contentRevision: number;
  unitKind: string;
  sections: Array<{
    id: string;
    title: string;
    revision: number;
    blocks: unknown[];
    introduction: string;
    courseRole: string;
  }>;
  legacy: { introduction: string; blocks: unknown[] } | null;
};
export type LearningBranchDraft = Pick<
  LearningBranch,
  | "id"
  | "sourceThreadId"
  | "sourceEventId"
  | "origin"
  | "purpose"
  | "kind"
  | "title"
  | "reason"
  | "returnGoal"
  | "topics"
>;
export interface LearningTrajectoryRepository {
  context(
    userId: string,
    unitId: string,
  ): Promise<LearningTrajectoryContext | null>;
  snapshot(input: {
    userId: string;
    unitId?: string;
    cursor?: string;
    limit: number;
  }): Promise<LearningTrajectorySnapshot>;
  visit(userId: string, id: string): Promise<LearningVisit | null>;
  branch(userId: string, id: string): Promise<LearningBranch | null>;
  reserve(
    userId: string,
    draft: LearningBranchDraft,
  ): Promise<{ branch: LearningBranch; created: boolean }>;
  claim(
    userId: string,
    id: string,
    revision: number,
  ): Promise<LearningBranch | null>;
  checkpoint(
    userId: string,
    id: string,
    token: string,
    transcript: unknown[],
  ): Promise<boolean>;
  publish(input: {
    userId: string;
    id: string;
    token: string;
    introduction: string;
    blocks: unknown[];
    transcript: unknown[];
  }): Promise<boolean>;
  changeBranch(input: {
    userId: string;
    id: string;
    revision: number;
    action: "cancel" | "dismiss" | "defer" | "resume";
  }): Promise<LearningBranch | null>;
  fail(userId: string, id: string, token: string, error: string): Promise<void>;
  linkPlannedGoal(
    userId: string,
    id: string,
    plannedGoalId: string,
  ): Promise<boolean>;
  enter(input: {
    userId: string;
    branchId: string;
    visitId: string;
    sessionId: string;
    returnPosition: LearningPosition;
  }): Promise<LearningVisit>;
  updateVisit(input: {
    userId: string;
    id: string;
    revision: number;
    action: "position" | "pause" | "return";
    position?: LearningPosition;
  }): Promise<LearningVisit | null>;
  appendEvent(
    userId: string,
    event: Omit<LearningTrajectoryEvent, "createdAt">,
  ): Promise<boolean>;
  recoverInterrupted(): Promise<void>;
}
