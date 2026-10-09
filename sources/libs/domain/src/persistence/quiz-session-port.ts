export interface QuizSessionRepository {
  findOwnedUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<{ goalId: string; title: string } | null>;
  listQuizSets(input: {
    userId: string;
    unitId: string;
  }): Promise<readonly {
    id: string;
    createdAt: string;
    questionCount: number;
    typeCounts: { mcq: number; mcq_multi: number; true_false: number };
    preview: string;
    attemptCount: number;
    bestScore: number | null;
    latestScore: number | null;
    latestAttemptAt: string | null;
  }[]>;
  findAttemptExplanations(input: {
    userId: string;
    unitId: string;
    attemptId: string;
  }): Promise<string | null>;
  listLearningSetQuestions(input: {
    userId: string;
    unitId: string;
  }): Promise<readonly string[]>;
  getRecallStats(input: {
    userId: string;
    unitId: string;
  }): Promise<{ completedBatches: number; totalAnswers: number }>;
  findQuizSetDetail(input: {
    userId: string;
    unitId: string;
    quizSetId: string;
  }): Promise<null | {
    id: string;
    questionsJson: string;
    createdAt: Date;
    attempts: readonly {
      id: string;
      quizSetId: string | null;
      score: number;
      weakTagsJson: string;
      answersJson: string;
      resultsJson: string;
      explanationsJson: string;
      createdAt: Date;
    }[];
  }>;
  saveAttemptExplanation(input: {
    userId: string;
    unitId: string;
    attemptId: string;
    questionIndex: number;
    explanation: string;
  }): Promise<Record<number, string> | null>;
  publishGenerated(input: {
    userId: string;
    unitId: string;
    quizSetId: string;
    questionsJson: string;
    graphState: string;
  }): Promise<{ quizSetId: string }>;
}
