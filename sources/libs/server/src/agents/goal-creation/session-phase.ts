export type GoalCreationPersistedPhase =
  | "intake"
  | "goal_scope"
  | "confirmation"
  | "goal_creation"
  | "icon"
  | "planning"
  | "plan_review"
  | "module_shell"
  | "first_unit"
  | "first_unit_kacom"
  | "ready";

export function phaseFromGoalCreationCheckpoint(checkpoint: {
  pendingInterrupt?: { toolName?: string } | null;
  goalState?: {
    currentPhase?: string;
    goalId?: string;
    goalApproved?: boolean;
  };
}): GoalCreationPersistedPhase {
  const tool = checkpoint.pendingInterrupt?.toolName;
  if (tool === "show_confirmation") return "confirmation";
  if (tool === "review_goal_scope") return "goal_scope";
  if (tool === "review_plan") return "plan_review";
  const state = checkpoint.goalState;
  if (state?.currentPhase === "scoping") return "goal_scope";
  if (state?.currentPhase === "generating_icon") return "icon";
  if (state?.currentPhase === "generating_plan") return "planning";
  if (state?.currentPhase === "decomposing") return "module_shell";
  if (state?.currentPhase === "completed") return "ready";
  if (state?.goalId || state?.goalApproved) return "goal_creation";
  return "intake";
}

/** Micro sessions finish when the goal exists; lesson SQ/material is not the gate. */
export function shouldCompleteMicroGoalCreationSession(input: {
  status: string;
  goalId: string | null | undefined;
  isSmallCourse?: boolean;
  goalKind?: string | null;
}): boolean {
  if (!input.goalId?.trim()) return false;
  if (input.status === "stopped" || input.status === "completed") return false;
  return input.isSmallCourse === true || input.goalKind === "micro";
}
