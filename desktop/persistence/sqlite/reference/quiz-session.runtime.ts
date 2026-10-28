import type { QuizSessionRepository } from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

export class MikroOrmQuizSessionRuntimeAdapter implements QuizSessionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findOwnedUnit(input: Parameters<QuizSessionRepository["findOwnedUnit"]>[0]) {
    return this.runtime.repositories.quizSession.findOwnedUnit(input);
  }
  listQuizSets(input: Parameters<QuizSessionRepository["listQuizSets"]>[0]) {
    return this.runtime.repositories.quizSession.listQuizSets(input);
  }

  findAttemptExplanations(input: Parameters<QuizSessionRepository["findAttemptExplanations"]>[0]) {
    return this.runtime.repositories.quizSession.findAttemptExplanations(input);
  }
  listLearningSetQuestions(input: Parameters<QuizSessionRepository["listLearningSetQuestions"]>[0]) {
    return this.runtime.repositories.quizSession.listLearningSetQuestions(input);
  }
  getRecallStats(input: Parameters<QuizSessionRepository["getRecallStats"]>[0]) {
    return this.runtime.repositories.quizSession.getRecallStats(input);
  }
  findQuizSetDetail(input: Parameters<QuizSessionRepository["findQuizSetDetail"]>[0]) {
    return this.runtime.repositories.quizSession.findQuizSetDetail(input);
  }
  saveAttemptExplanation(input: Parameters<QuizSessionRepository["saveAttemptExplanation"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.quizSession.saveAttemptExplanation(input),
    );
  }
  publishGenerated(input: Parameters<QuizSessionRepository["publishGenerated"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.quizSession.publishGenerated(input),
    );
  }
}
