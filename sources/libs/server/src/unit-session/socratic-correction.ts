/** Portable Socratic wrong-answer correction state machine. */

export type SocraticCorrectionMessage = {
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

export type SocraticCorrectionThreadSource = "quiz" | "feynman" | "general";

export type SocraticCorrectionThread = {
  id: string;
  label: string;
  questionText?: string;
  mistakeHint?: string;
  quizQuestionIndex?: number;
  learningTargetRef?: string;
  criterionRef?: string;
  source: SocraticCorrectionThreadSource;
  messages: SocraticCorrectionMessage[];
  done: boolean;
  turn: number;
  updatedAt: string;
};

export type SocraticQuizQuestion = {
  question: string;
  learningTargetIds?: readonly string[];
  primaryLearningTargetId?: string;
  criterionRef?: string;
};

export type SocraticQuizGrade = {
  index: number;
  status: "correct" | "partial" | "incorrect";
  userAnswerLabel: string;
  correctAnswerLabel?: string;
};

export type SocraticFeynmanFeedback = {
  passed: boolean;
  blindSpots: readonly string[];
  suggestions: readonly string[];
  criterionScores: readonly {
    learningTargetId: string;
    criterionRef: string;
    score: number;
  }[];
};

export type SocraticCorrectionState = {
  quiz?: {
    questions?: readonly SocraticQuizQuestion[];
    interleaved?: readonly SocraticQuizQuestion[];
  };
  quizResults?: readonly SocraticQuizGrade[];
  feynmanFeedback?: SocraticFeynmanFeedback;
  weakTags?: readonly string[];
  socraticThreads?: SocraticCorrectionThread[];
  activeSocraticThreadId?: string;
  [key: string]: unknown;
};

export type SocraticCorrectionEnvironment = {
  createId(): string;
  now(): string;
};

export type PreparedSocraticAuthoringRequest = {
  unitTitle: string;
  weakTags: string[];
  turn: number;
  lastAnswer?: string;
  priorContext?: string;
};

export type SocraticAuthoringOutput = {
  question: string;
  done: boolean;
  resolved: boolean;
  terminatedByLimit: boolean;
  errorType?: "careless" | "concept" | "prerequisite";
};

export type SocraticCorrectionAuthorPort = {
  authorSocraticTurn(
    request: PreparedSocraticAuthoringRequest,
  ): Promise<unknown>;
};

export type SocraticCorrectionPersistencePort = {
  saveSocraticCorrection(input: {
    graphState: SocraticCorrectionState;
    activeThreadId: string;
    socraticTurn: number;
    currentStep: "socratic";
  }): Promise<void>;
};

export type SocraticCorrectionErrorCode =
  | "empty_answer"
  | "no_conversation"
  | "conversation_ended"
  | "invalid_author_output";

export class SocraticCorrectionError extends Error {
  constructor(readonly code: SocraticCorrectionErrorCode) {
    super(code);
  }
}

function createMessage(
  environment: Pick<SocraticCorrectionEnvironment, "now">,
  role: SocraticCorrectionMessage["role"],
  content: string,
): SocraticCorrectionMessage {
  return { role, content, createdAt: environment.now() };
}

export function pickActiveSocraticCorrectionThread(
  threads: readonly SocraticCorrectionThread[],
  activeId?: string,
): SocraticCorrectionThread | undefined {
  if (threads.length === 0) return undefined;
  if (activeId) {
    const found = threads.find((thread) => thread.id === activeId);
    if (found) return found;
  }
  return threads.find((thread) => !thread.done) ?? threads[0];
}

function quizQuestionsFromState(
  graphState: SocraticCorrectionState,
): readonly SocraticQuizQuestion[] {
  return [
    ...(graphState.quiz?.questions ?? []),
    ...(graphState.quiz?.interleaved ?? []),
  ];
}

function questionLabel(index: number, question?: SocraticQuizQuestion): string {
  if (!question?.question) return `第 ${index + 1} 题`;
  const text = question.question.replace(/\s+/g, " ").trim();
  const preview = text.length > 28 ? `${text.slice(0, 28)}…` : text;
  return `第 ${index + 1} 题 · ${preview}`;
}

function formatQuizMistakeLine(result: SocraticQuizGrade): string {
  const line = `Learner answered "${result.userAnswerLabel}"`;
  return result.correctAnswerLabel
    ? `${line}; expected "${result.correctAnswerLabel}"`
    : line;
}

export function buildSocraticCorrectionPriorContext(
  graphState: SocraticCorrectionState,
): string | undefined {
  const parts: string[] = [];
  const wrong = (graphState.quizResults ?? []).filter(
    (result) => result.status !== "correct",
  );
  if (wrong.length > 0) {
    parts.push("Quiz mistakes:");
    for (const result of wrong) {
      const line = `- Q${result.index + 1}: learner answered "${result.userAnswerLabel}"`;
      parts.push(
        result.correctAnswerLabel
          ? `${line}; expected "${result.correctAnswerLabel}"`
          : line,
      );
    }
  }

  const feedback = graphState.feynmanFeedback;
  if (feedback && !feedback.passed) {
    if (feedback.blindSpots.length > 0) {
      parts.push(`Feynman blind spots: ${feedback.blindSpots.join("; ")}`);
    }
    if (feedback.suggestions.length > 0) {
      parts.push(`Feynman suggestions: ${feedback.suggestions.join("; ")}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function buildSocraticCorrectionThreadContext(
  graphState: SocraticCorrectionState,
  thread: SocraticCorrectionThread,
): string | undefined {
  const parts: string[] = [];
  if (thread.quizQuestionIndex != null) {
    const result = (graphState.quizResults ?? []).find(
      (item) => item.index === thread.quizQuestionIndex,
    );
    const question =
      quizQuestionsFromState(graphState)[thread.quizQuestionIndex];
    if (question) {
      parts.push(`Focus quiz question ${thread.quizQuestionIndex + 1}:`);
      parts.push(`Stem: ${question.question}`);
      if (question.learningTargetIds?.length) {
        parts.push(
          `Knowledge points: ${question.learningTargetIds.join(", ")}`,
        );
      }
      if (result) parts.push(formatQuizMistakeLine(result));
    }
  } else if (thread.source === "feynman") {
    const feedback = graphState.feynmanFeedback;
    if (feedback && !feedback.passed) {
      if (feedback.blindSpots.length > 0) {
        parts.push(`Feynman blind spots: ${feedback.blindSpots.join("; ")}`);
      }
      if (feedback.suggestions.length > 0) {
        parts.push(`Feynman suggestions: ${feedback.suggestions.join("; ")}`);
      }
    }
  } else {
    const prior = buildSocraticCorrectionPriorContext(graphState);
    if (prior) parts.push(prior);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function createThreads(
  graphState: SocraticCorrectionState,
  environment: SocraticCorrectionEnvironment,
): SocraticCorrectionThread[] {
  const now = () => environment.now();
  const wrong = (graphState.quizResults ?? []).filter(
    (result) => result.status !== "correct",
  );
  const questions = quizQuestionsFromState(graphState);
  if (wrong.length > 0) {
    return wrong.map((result) => ({
      id: environment.createId(),
      quizQuestionIndex: result.index,
      label: questionLabel(result.index, questions[result.index]),
      questionText: questions[result.index]?.question,
      learningTargetRef: questions[result.index]?.primaryLearningTargetId,
      criterionRef: questions[result.index]?.criterionRef,
      source: "quiz" as const,
      messages: [],
      done: false,
      turn: 0,
      updatedAt: now(),
    }));
  }

  const feedback = graphState.feynmanFeedback;
  if (feedback && !feedback.passed) {
    const failedCriteria = feedback.criterionScores.filter(
      (criterion) => criterion.score < 0.7,
    );
    if (failedCriteria.length > 0) {
      return failedCriteria.map((criterion) => ({
        id: environment.createId(),
        label: `费曼讲解 · ${criterion.learningTargetId}`,
        source: "feynman" as const,
        learningTargetRef: criterion.learningTargetId,
        criterionRef: criterion.criterionRef,
        messages: [],
        done: false,
        turn: 0,
        updatedAt: now(),
      }));
    }
    return [
      {
        id: environment.createId(),
        label: "费曼讲解薄弱点",
        source: "feynman",
        messages: [],
        done: false,
        turn: 0,
        updatedAt: now(),
      },
    ];
  }

  return [
    {
      id: environment.createId(),
      label: "薄弱点修正",
      source: "general",
      messages: [],
      done: false,
      turn: 0,
      updatedAt: now(),
    },
  ];
}

export function ensureSocraticCorrectionThreads(
  graphState: SocraticCorrectionState,
  environment: SocraticCorrectionEnvironment,
): { threads: SocraticCorrectionThread[]; activeThreadId: string } {
  const threads = graphState.socraticThreads?.length
    ? graphState.socraticThreads
    : createThreads(graphState, environment);
  const active = pickActiveSocraticCorrectionThread(
    threads,
    graphState.activeSocraticThreadId,
  );
  return { threads, activeThreadId: active?.id ?? threads[0]?.id ?? "" };
}

export function replaceSocraticCorrectionThread(
  threads: readonly SocraticCorrectionThread[],
  threadId: string,
  patch: Partial<SocraticCorrectionThread>,
  now: string,
): SocraticCorrectionThread[] {
  return threads.map((thread) =>
    thread.id === threadId ? { ...thread, ...patch, updatedAt: now } : thread,
  );
}

function conversationHistory(messages: readonly SocraticCorrectionMessage[]) {
  if (messages.length === 0) return "";
  return `\nConversation so far:\n${messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "Tutor" : "Learner"}: ${message.content}`,
    )
    .join("\n")}\n`;
}

export function parseSocraticAuthoringOutput(
  value: unknown,
): SocraticAuthoringOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SocraticCorrectionError("invalid_author_output");
  }
  const output = value as Record<string, unknown>;
  const errorType = output.errorType;
  if (
    typeof output.question !== "string" ||
    typeof output.done !== "boolean" ||
    typeof output.resolved !== "boolean" ||
    typeof output.terminatedByLimit !== "boolean" ||
    (errorType !== undefined &&
      errorType !== "careless" &&
      errorType !== "concept" &&
      errorType !== "prerequisite")
  ) {
    throw new SocraticCorrectionError("invalid_author_output");
  }
  return {
    question: output.question,
    done: output.done,
    resolved: output.resolved,
    terminatedByLimit: output.terminatedByLimit,
    ...(errorType ? { errorType } : {}),
  };
}

export async function bootstrapSocraticCorrectionThread(params: {
  unitTitle: string;
  graphState: SocraticCorrectionState;
  thread: SocraticCorrectionThread;
  weakTags: readonly string[];
  environment: Pick<SocraticCorrectionEnvironment, "now">;
  author: SocraticCorrectionAuthorPort;
}) {
  if (params.thread.messages.length > 0 || params.thread.done) {
    return {
      thread: params.thread,
      question: params.thread.messages.at(-1)?.content,
    };
  }
  const output = parseSocraticAuthoringOutput(
    await params.author.authorSocraticTurn({
      unitTitle: params.unitTitle,
      weakTags: [...params.weakTags],
      turn: 0,
      priorContext: buildSocraticCorrectionThreadContext(
        params.graphState,
        params.thread,
      ),
    }),
  );
  return {
    thread: {
      ...params.thread,
      messages: [
        createMessage(params.environment, "assistant", output.question),
      ],
      turn: 1,
      updatedAt: params.environment.now(),
    },
    question: output.question,
  };
}

export async function processSocraticCorrectionTurn(params: {
  unitTitle: string;
  graphState: SocraticCorrectionState;
  thread: SocraticCorrectionThread;
  answer: string;
  weakTags: readonly string[];
  environment: Pick<SocraticCorrectionEnvironment, "now">;
  author: SocraticCorrectionAuthorPort;
}) {
  const answer = params.answer.trim();
  if (!answer) throw new SocraticCorrectionError("empty_answer");
  if (params.thread.done) {
    throw new SocraticCorrectionError("conversation_ended");
  }
  const messages = [
    ...params.thread.messages,
    createMessage(params.environment, "user", answer),
  ];
  const turn = params.thread.turn + 1;
  const priorContext = [
    buildSocraticCorrectionThreadContext(params.graphState, params.thread),
    conversationHistory(messages),
  ]
    .filter(Boolean)
    .join("\n");
  const output = parseSocraticAuthoringOutput(
    await params.author.authorSocraticTurn({
      unitTitle: params.unitTitle,
      weakTags: [...params.weakTags],
      turn,
      lastAnswer: answer,
      priorContext: priorContext || undefined,
    }),
  );
  const resolved = output.resolved;
  const terminatedByLimit =
    (output.terminatedByLimit || turn >= 5) && !resolved;
  const done = output.done || terminatedByLimit;
  const thread: SocraticCorrectionThread = {
    ...params.thread,
    messages: [
      ...messages,
      createMessage(params.environment, "assistant", output.question),
    ],
    turn,
    done,
    updatedAt: params.environment.now(),
  };
  return {
    thread,
    question: output.question,
    done,
    resolved,
    terminatedByLimit,
    ...(output.errorType ? { errorType: output.errorType } : {}),
  };
}

export function socraticCorrectionSessionPayload(
  threads: readonly SocraticCorrectionThread[],
  activeThreadId: string,
) {
  const activeThread = pickActiveSocraticCorrectionThread(
    threads,
    activeThreadId,
  );
  return {
    socraticThreads: [...threads],
    activeSocraticThreadId: activeThread?.id ?? activeThreadId,
    activeSocraticThread: activeThread ?? null,
    socraticQuestion:
      activeThread?.messages
        .filter((message) => message.role === "assistant")
        .at(-1)?.content ?? null,
  };
}

export function graphStateWithSocraticCorrection(
  graphState: SocraticCorrectionState,
  threads: SocraticCorrectionThread[],
  activeThreadId: string,
): SocraticCorrectionState {
  return {
    ...graphState,
    socraticThreads: threads,
    activeSocraticThreadId: activeThreadId,
  };
}

export async function persistSocraticCorrection(params: {
  persistence: SocraticCorrectionPersistencePort;
  graphState: SocraticCorrectionState;
  threads: SocraticCorrectionThread[];
  activeThreadId: string;
  socraticTurn: number;
}): Promise<SocraticCorrectionState> {
  const graphState = graphStateWithSocraticCorrection(
    params.graphState,
    params.threads,
    params.activeThreadId,
  );
  await params.persistence.saveSocraticCorrection({
    graphState,
    activeThreadId: params.activeThreadId,
    socraticTurn: params.socraticTurn,
    currentStep: "socratic",
  });
  return graphState;
}
