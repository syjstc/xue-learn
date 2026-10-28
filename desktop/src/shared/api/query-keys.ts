/**
 * Central query-key factory.
 *
 * Keys are hierarchical so invalidation can target any level, e.g.
 *   invalidateQueries({ queryKey: queryKeys.goals.all })          → everything goal-related
 *   invalidateQueries({ queryKey: queryKeys.goals.detail(id) })   → one goal
 */
export const queryKeys = {
  learningSpaces: {
    all: ["learning-spaces"] as const,
    portfolio: () => [...queryKeys.learningSpaces.all, "portfolio"] as const,
  },
  goals: {
    all: ["goals"] as const,
    list: () => [...queryKeys.goals.all, "list"] as const,
    detail: (goalId: string) =>
      [...queryKeys.goals.all, "detail", goalId] as const,
    plan: (goalId: string) => [...queryKeys.goals.all, "plan", goalId] as const,
    foundations: (goalId: string) =>
      [...queryKeys.goals.all, "foundations", goalId] as const,
    shared: (shareId: string) =>
      [...queryKeys.goals.all, "shared", shareId] as const,
    sharedCourse: (shareId: string) =>
      [...queryKeys.goals.all, "shared", shareId, "course"] as const,
    publicShares: () => [...queryKeys.goals.all, "shared", "public"] as const,
  },
  units: {
    all: ["units"] as const,
    page: (unitId: string, goalId: string) =>
      [...queryKeys.units.all, "page", unitId, goalId] as const,
    followUps: (unitId: string) =>
      [...queryKeys.units.all, "follow-ups", unitId] as const,
    quizSets: (unitId: string) =>
      [...queryKeys.units.all, "quiz-sets", unitId] as const,
    lessonPerformanceEligibility: (unitId: string) =>
      [
        ...queryKeys.units.all,
        "lesson-performance-eligibility",
        unitId,
      ] as const,
  },
  reviews: {
    all: ["reviews"] as const,
    due: () => [...queryKeys.reviews.all, "due"] as const,
    practice: () => [...queryKeys.reviews.all, "practice"] as const,
  },
  flashcards: {
    all: ["flashcards"] as const,
    decks: () => [...queryKeys.flashcards.all, "decks"] as const,
    deckCards: (deckId: string) =>
      [...queryKeys.flashcards.all, "deck-cards", deckId] as const,
    deck: (unitId: string) =>
      [...queryKeys.flashcards.all, "deck", unitId] as const,
    due: (scope: { type: string; goalId?: string; unitId?: string }, limit: number) =>
      [
        ...queryKeys.flashcards.all,
        "due",
        scope.type,
        scope.goalId ?? "",
        scope.unitId ?? "",
        limit,
      ] as const,
    dueSummary: (scope: { type: string; goalId?: string; unitId?: string }) =>
      [
        ...queryKeys.flashcards.all,
        "due-summary",
        scope.type,
        scope.goalId ?? "",
        scope.unitId ?? "",
      ] as const,
    source: (cardId: string) =>
      [...queryKeys.flashcards.all, "source", cardId] as const,
  },
  settings: {
    all: ["settings"] as const,
    llm: (userId?: string | null) =>
      [...queryKeys.settings.all, "llm", userId ?? "anonymous"] as const,
    images: (userId?: string | null) =>
      [...queryKeys.settings.all, "images", userId ?? "anonymous"] as const,
    search: (userId?: string | null) =>
      [...queryKeys.settings.all, "search", userId ?? "anonymous"] as const,
    learningView: (userId?: string | null) =>
      [...queryKeys.settings.all, "learning-view", userId ?? "anonymous"] as const,
    memory: (userId?: string | null) =>
      [...queryKeys.settings.all, "memory", userId ?? "anonymous"] as const,
  },
  memories: {
    all: (userId?: string | null) =>
      ["memories", userId ?? "anonymous"] as const,
    list: (userId: string | null | undefined, status: string) =>
      ["memories", userId ?? "anonymous", "list", status] as const,
    candidates: (userId?: string | null) =>
      ["memories", userId ?? "anonymous", "candidates"] as const,
  },
  credits: {
    all: ["credits"] as const,
    balance: (userId?: string | null) =>
      [...queryKeys.credits.all, "balance", userId ?? "anonymous"] as const,
    ledger: (userId?: string | null) =>
      [...queryKeys.credits.all, "ledger", userId ?? "anonymous"] as const,
    usage: (userId?: string | null) =>
      [...queryKeys.credits.all, "usage", userId ?? "anonymous"] as const,
  },
  billingAdmin: {
    all: ["billing-admin"] as const,
    llmPricing: () => [...queryKeys.billingAdmin.all, "llm-pricing"] as const,
  },
  profile: {
    all: ["profile"] as const,
    learner: (userId?: string | null) =>
      [...queryKeys.profile.all, "learner", userId ?? "anonymous"] as const,
    learningState: (userId?: string | null) =>
      [...queryKeys.profile.all, "learning-state", userId ?? "anonymous"] as const,
  },
  llmLogs: {
    all: ["llm-logs"] as const,
    list: (params: string) => [...queryKeys.llmLogs.all, "list", params] as const,
  },
  agenda: {
    all: ["agenda"] as const,
    current: () => [...queryKeys.agenda.all, "current"] as const,
    settings: () => [...queryKeys.agenda.all, "settings"] as const,
  },
  projects: {
    all: ["projects"] as const,
    goal: (goalId: string) =>
      [...queryKeys.projects.all, "goal", goalId] as const,
    detail: (projectId: string) =>
      [...queryKeys.projects.all, "detail", projectId] as const,
  },
} as const;
