export type GoalCreationSessionStatus =
  | "running"
  | "waiting_user"
  | "stop_requested"
  | "stopped"
  | "needs_attention"
  | "completed";

export type GoalCreationSessionPhase =
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

export type GoalCreationSession = {
  id: string;
  threadId: string;
  goalId: string | null;
  status: GoalCreationSessionStatus;
  phase: GoalCreationSessionPhase;
  flowMode?: "guided" | "automatic" | "agentic";
  version: number;
  currentRunId: string | null;
  firstUnitId: string | null;
  lastError: string | null;
  pendingInteraction: {
    toolCallId: string;
    toolName: string;
    uiKind: string;
    args: Record<string, unknown>;
  } | null;
  progress: {
    moduleCount: number;
    readyModuleCount: number;
    unitCount: number;
    readyUnitCount: number;
    firstReadyUnitId: string | null;
    firstReadyUnitTitle: string | null;
    preparedModuleCount?: number;
    publishedModuleCount?: number;
    failedModuleCount?: number;
    auditStatus?: string;
    modules: Array<{
      id: string;
      title: string;
      status: string;
      attemptCount?: number;
    }>;
  } | null;
  resources: Array<{
    id: string;
    kind: string;
    filename: string;
    status: string;
    warning: string;
    error: string;
  }>;
  actions: {
    canRetry: boolean;
    canStop: boolean;
    canDelete: boolean;
  };
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  completedAt: string | null;
};

export type GoalCreationSessionResponse = {
  created?: boolean;
  session: GoalCreationSession | null;
};

export type GoalCreationSessionEvent = {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type GoalCreationSessionEventsResponse = {
  events: GoalCreationSessionEvent[];
  cursor: number;
};

export const GOAL_CREATION_PHASE_LABEL_KEYS: Record<
  GoalCreationSessionPhase,
  string
> = {
  intake: "assistant.creationPhase.intake",
  goal_scope: "assistant.creationPhase.goalScope",
  confirmation: "assistant.creationPhase.confirmation",
  goal_creation: "assistant.creationPhase.goalCreation",
  icon: "assistant.creationPhase.icon",
  planning: "assistant.creationPhase.planning",
  plan_review: "assistant.creationPhase.planReview",
  module_shell: "assistant.creationPhase.moduleShell",
  first_unit: "assistant.creationPhase.firstUnit",
  first_unit_kacom: "assistant.creationPhase.firstUnitModel",
  ready: "assistant.creationPhase.ready",
};

export const GOAL_CREATION_PHASE_ORDER: GoalCreationSessionPhase[] = [
  "intake",
  "goal_scope",
  "confirmation",
  "goal_creation",
  "icon",
  "planning",
  "plan_review",
  "module_shell",
  "first_unit",
  "ready",
];

export const AGENTIC_GOAL_CREATION_PHASE_ORDER: GoalCreationSessionPhase[] = [
  "intake",
  "goal_scope",
  "confirmation",
  "goal_creation",
  "icon",
  "planning",
  "module_shell",
  "ready",
];

/** Session interrupt to show while the bound thread is still hydrating. */
export function goalCreationPendingToolUi(
  session: Pick<GoalCreationSession, "pendingInteraction"> | null | undefined,
) {
  const pending = session?.pendingInteraction;
  if (!pending?.toolCallId || !pending.uiKind) return null;
  return pending;
}

/** True when the learner should retry instead of waiting for background work. */
export function goalCreationNeedsRetry(
  session:
    | Pick<GoalCreationSession, "status" | "actions">
    | null
    | undefined,
): boolean {
  return Boolean(
    session &&
      session.status === "needs_attention" &&
      session.actions.canRetry,
  );
}

/** Compact actionable status for companion / status-card chrome. */
export function goalCreationShortStatus(
  session: Pick<
    GoalCreationSession,
    "status" | "phase" | "pendingInteraction" | "lastError"
  > & {
    flowMode?: GoalCreationSession["flowMode"];
  },
  t: (key: any) => string,
): string {
  if (session.status === "stopped") return t("assistant.creationStatus.stopped");
  if (session.status === "stop_requested") return t("assistant.creationStatus.stopping");
  if (session.status === "completed" || session.phase === "ready") {
    return t("assistant.creationPhase.ready");
  }
  if (session.status === "needs_attention") {
    // `lastError` is an operator diagnostic and can include provider or
    // structured-output repair details. The retryable status is the complete
    // learner-facing contract.
    return t("assistant.creationStatus.retryableError");
  }

  if (session.status === "waiting_user") {
    const uiKind = session.pendingInteraction?.uiKind ?? "";
    const toolName = session.pendingInteraction?.toolName ?? "";
    if (
      uiKind === "discovery_questions" ||
      toolName === "ask_discovery_questions" ||
      toolName === "ask_clarification"
    ) {
      return t("assistant.creationStatus.waitingAnswers");
    }
    if (uiKind === "form" || toolName === "collect_form") {
      return t("assistant.creationStatus.waitingSettings");
    }
    if (uiKind === "confirmation_card" || toolName === "show_confirmation") {
      return t("assistant.creationStatus.waitingGoalConfirmation");
    }
    if (
      uiKind === "goal_scope_roadmap_preview" ||
      toolName === "review_goal_scope"
    ) {
      return t("assistant.creationStatus.waitingScope");
    }
    if (
      session.flowMode !== "agentic" &&
      (uiKind === "plan_editor" || toolName === "review_plan")
    ) {
      return t("assistant.creationStatus.waitingPlanConfirmation");
    }
    return t("assistant.creationStatus.waitingAction");
  }

  if (session.status === "running") {
    if (session.flowMode === "agentic" && session.phase === "module_shell") {
      return t("assistant.creationStatus.preparingAllModules");
    }
    if (session.phase === "first_unit" || session.phase === "first_unit_kacom")
      return t("assistant.creationStatus.preparingFirstUnit");
    if (session.phase === "planning")
      return t("assistant.creationStatus.generatingPlan");
    if (session.phase === "icon")
      return t("assistant.creationStatus.creatingIcon");
    if (session.phase === "goal_creation")
      return t("assistant.creationStatus.savingGoal");
    if (session.phase === "goal_scope")
      return t("assistant.creationPhase.goalScope");
    if (session.phase === "module_shell")
      return t("assistant.creationStatus.creatingModules");
  }

  return t(GOAL_CREATION_PHASE_LABEL_KEYS[session.phase]);
}

/** Switch to the agent-working progress view after goal-creation confirmation. */
export function goalCreationShowsLiveFeed(
  session: Pick<
    GoalCreationSession,
    "flowMode" | "status" | "phase" | "goalId"
  >,
  options?: { goalCreationConfirmed?: boolean },
): boolean {
  if (session.flowMode === "automatic") return true;
  if (
    session.phase === "intake" ||
    session.phase === "goal_scope" ||
    session.phase === "plan_review"
  ) {
    return false;
  }
  return (
    Boolean(options?.goalCreationConfirmed) ||
    Boolean(session.goalId) ||
    session.phase === "goal_creation" ||
    session.phase === "icon" ||
    session.phase === "planning" ||
    session.phase === "module_shell" ||
    session.phase === "first_unit" ||
    session.phase === "first_unit_kacom" ||
    session.phase === "ready"
  );
}

/** Auto-open the goal page once agentic/automatic creation finishes. */
export function goalCreationAutoOpenPath(
  session:
    | Pick<GoalCreationSession, "flowMode" | "status" | "goalId">
    | null
    | undefined,
  options?: { finished?: boolean },
): string | undefined {
  if (!session?.goalId) return undefined;
  if (session.status === "stopped" || session.status === "needs_attention") {
    return undefined;
  }
  if (session.status === "completed" || options?.finished) {
    return `/goals/${session.goalId}`;
  }
  return undefined;
}
