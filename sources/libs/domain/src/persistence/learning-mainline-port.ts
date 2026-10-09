import type {
  MainlineSnapshot,
  MainlineResolvedPosition,
  MainlineCommand,
  MainlineDecision,
  MainlineCandidate,
} from "../learning-mainline.js";
export type MainlineDecisionRequest = {
  sessionId: string;
  goalId?: string;
  boundary?: boolean;
  timeLimitMinutes?: number;
};
export interface LearningMainlineRepository {
  resolve(
    userId: string,
    activityId: string,
  ): Promise<MainlineResolvedPosition | null>;
  snapshot(userId: string, sessionId: string): Promise<MainlineSnapshot>;
  command(userId: string, command: MainlineCommand): Promise<MainlineSnapshot>;
  decision(
    userId: string,
    request: MainlineDecisionRequest,
  ): Promise<MainlineDecision>;
  candidates(userId: string): Promise<MainlineCandidate[]>;
}
