import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import {
  invalidateAgendaForUser,
  markAgendaItemCompletedForUnit,
} from "../../agenda/index.js";
import {
  learnerStateStatus,
  selectReviewEntity,
} from "../../flashcards/review-task.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

@Injectable()
export class ReviewsService {
  constructor(private readonly orm: LearningSpaceOrmProvider) {}

  async getDue(userId: string) {
    const now = new Date();
    const reviewCards = await this.orm.reviewExperience.listDue(userId, now);

    const tasks = reviewCards.flatMap((card) => {
      const selected = selectReviewEntity(card.candidates);
      if (!selected) return [];
      const status = learnerStateStatus(selected.state?.status);
      return [
        {
          id: card.id,
          dueAt: card.nextReviewAt.toISOString(),
          status,
          estimate: selected.state?.estimate ?? null,
          evidenceSufficiency: selected.state?.evidenceSufficiency ?? 0,
          entity: {
            id: selected.entity.id,
            title: selected.entity.title,
            explanation:
              selected.entity.atom?.explanation || selected.entity.description,
          },
          goal: { id: card.goalId, title: card.goalTitle },
          representativeUnit: { id: card.unitId, title: card.unitTitle },
        },
      ];
    });

    const groups = Array.from(
      tasks.reduce((byGoal, task) => {
        const existing = byGoal.get(task.goal.id);
        if (existing) existing.tasks.push(task);
        else byGoal.set(task.goal.id, { goal: task.goal, tasks: [task] });
        return byGoal;
      }, new Map<string, { goal: (typeof tasks)[number]["goal"]; tasks: typeof tasks }>()),
    ).map(([, group]) => group);

    // Unit scheduling remains a ReviewCard projection; cognitive clients use
    // the direct entity state exposed in `tasks`.
    const cards = reviewCards.map((card) => ({
      id: card.id,
      intervalDays: card.intervalDays,
      easeFactor: card.easeFactor,
      nextReviewAt: card.nextReviewAt.toISOString(),
      lastGrade: card.lastGrade,
      unitId: card.unitId,
      unit: {
        id: card.unitId,
        title: card.unitTitle,
        goal: { id: card.goalId, title: card.goalTitle },
      },
    }));

    return { groups, tasks, cards };
  }

  async getPractice(userId: string) {
    const units = await this.orm.reviewExperience.listPracticeUnits(userId, 50);

    return {
      units: units.map((unit) => ({
        id: unit.id,
        title: unit.title,
        status: unit.status,
        goal: { id: unit.goalId, title: unit.goalTitle },
      })),
    };
  }

  async submitReview(userId: string, cardId: string, grade: number) {
    if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
      throw new BadRequestException(tBackend("error.unknown"));
    }
    const result = await this.orm.reviewExperience.submitGrade(
      userId,
      cardId,
      grade,
    );
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.cardNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.cardForbidden"));
    }
    await markAgendaItemCompletedForUnit(userId, result.card.unitId, "review");
    await invalidateAgendaForUser(userId);

    return { card: result.card };
  }
}
