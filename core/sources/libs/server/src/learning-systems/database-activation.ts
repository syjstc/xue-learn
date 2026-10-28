import type {
  LearningSystemActivationRequest,
  LearningSystemActivationResolver,
  LearningSystemSubjectResolver,
  LearningSystemViewRequirementRequest,
} from "./activation.js";
import { BASE_CAPABILITY_ID } from "./keys.js";
import type { LearningSystemSubject } from "./types.js";
import type { LearningSystemPersistenceClient } from "./persistence-client.js";

type AvailabilityRow = { enabled: boolean };
type BindingRow = { enabled: boolean };
type GoalPolicyRow = {
  id: string;
  userId: string | null;
  goalKind: string;
  learningMode: string;
};
type UnitScopeRow = {
  id: string;
  goalId: string;
  goal: GoalPolicyRow;
};

export type LearningSystemActivationStore = Pick<LearningSystemPersistenceClient,
  "learningSystemAvailability" | "goalLearningSystemBinding" | "learningGoal" | "learningUnit" | "learningModule">;
/* Legacy structural documentation:
type LearningSystemActivationStoreShape = {
  learningSystemAvailability: {
    findUnique(args: {
      where: { capabilityId: string };
      select: { enabled: true };
    }): Promise<AvailabilityRow | null>;
  };
  goalLearningSystemBinding: {
    findFirst(args: {
      where: {
        goalId: string;
        capabilityId: string;
        goal: { userId: string };
      };
      select: { enabled: true };
    }): Promise<BindingRow | null>;
  };
  learningGoal: {
    findFirst(args: {
      where: { id: string; userId?: string };
      select: {
        id: true;
        userId: true;
        goalKind: true;
        learningMode: true;
      };
    }): Promise<GoalPolicyRow | null>;
  };
  learningUnit: {
    findFirst(args: {
      where: {
        id: string;
        goal?: { userId: string };
      };
      select: {
        id: true;
        goalId: true;
        goal: {
          select: {
            id: true;
            userId: true;
            goalKind: true;
            learningMode: true;
          };
        };
      };
    }): Promise<UnitScopeRow | null>;
  };
};
*/

export class LearningSystemSubjectAuthorizationError extends Error {
  constructor(message = "Generation subject is unavailable or inconsistent") {
    super(message);
    this.name = "LearningSystemSubjectAuthorizationError";
  }
}

export function goalRequiresKacom(goal: GoalPolicyRow | null): boolean {
  return Boolean(
    goal && goal.goalKind !== "micro" && goal.learningMode !== "exploration",
  );
}

async function findOwnedGoal(
  store: LearningSystemActivationStore,
  subject: LearningSystemSubject,
): Promise<GoalPolicyRow | null> {
  if (!subject.userId) return null;
  if (subject.unitId) {
    const unit = await store.learningUnit.findFirst({
      where: {
        id: subject.unitId,
        goal: { userId: subject.userId },
      },
      select: {
        id: true,
        goalId: true,
        moduleId: true,
        goal: {
          select: {
            id: true,
            userId: true,
            goalKind: true,
            learningMode: true,
          },
        },
      },
    });
    if (!unit || (subject.goalId && unit.goalId !== subject.goalId))
      return null;
    if (subject.moduleId && unit.moduleId && unit.moduleId !== subject.moduleId)
      return null;
    return unit.goal;
  }
  if (subject.moduleId) {
    const module = await store.learningModule.findFirst({
      where: {
        id: subject.moduleId,
        ...(subject.goalId ? { goalId: subject.goalId } : {}),
        goal: { userId: subject.userId },
      },
      select: {
        id: true,
        goalId: true,
        goal: {
          select: {
            id: true,
            userId: true,
            goalKind: true,
            learningMode: true,
          },
        },
      },
    });
    if (!module?.goal || (subject.goalId && module.goalId !== subject.goalId)) {
      return null;
    }
    return module.goal;
  }
  if (!subject.goalId) return null;
  return store.learningGoal.findFirst({
    where: { id: subject.goalId, userId: subject.userId },
    select: {
      id: true,
      userId: true,
      goalKind: true,
      learningMode: true,
    },
  });
}

/**
 * Hydrates trusted internal goal/unit jobs with their learner owner. If a
 * caller already supplies an authenticated learner, ownership is included in
 * the lookup itself so foreign goal existence and policy cannot be observed.
 */
export class DatabaseLearningSystemSubjectResolver implements LearningSystemSubjectResolver {
  constructor(private readonly store: LearningSystemActivationStore) {}

  async resolve(
    subject: LearningSystemSubject,
  ): Promise<LearningSystemSubject> {
    if (subject.unitId) {
      const unit = await this.store.learningUnit.findFirst({
        where: {
          id: subject.unitId,
          ...(subject.userId ? { goal: { userId: subject.userId } } : {}),
        },
        select: {
          id: true,
          goalId: true,
          moduleId: true,
          goal: {
            select: {
              id: true,
              userId: true,
              goalKind: true,
              learningMode: true,
            },
          },
        },
      });
      if (
        !unit?.goal.userId ||
        (subject.goalId && subject.goalId !== unit.goalId) ||
        (subject.moduleId && subject.moduleId !== unit.moduleId) ||
        (subject.userId && subject.userId !== unit.goal.userId)
      ) {
        throw new LearningSystemSubjectAuthorizationError();
      }
      return {
        ...subject,
        userId: unit.goal.userId,
        goalId: unit.goalId,
        moduleId: unit.moduleId ?? undefined,
        unitId: unit.id,
      };
    }

    if (subject.moduleId) {
      const module = await this.store.learningModule.findFirst({
        where: {
          id: subject.moduleId,
          ...(subject.goalId ? { goalId: subject.goalId } : {}),
          ...(subject.userId ? { goal: { userId: subject.userId } } : {}),
        },
        select: {
          id: true,
          goalId: true,
          goal: {
            select: {
              id: true,
              userId: true,
            },
          },
        },
      });
      if (
        !module?.goal?.userId ||
        (subject.goalId && subject.goalId !== module.goalId) ||
        (subject.userId && subject.userId !== module.goal.userId)
      ) {
        throw new LearningSystemSubjectAuthorizationError();
      }
      return {
        ...subject,
        userId: module.goal.userId,
        goalId: module.goalId,
        moduleId: module.id,
      };
    }

    if (subject.goalId) {
      const goal = await this.store.learningGoal.findFirst({
        where: {
          id: subject.goalId,
          ...(subject.userId ? { userId: subject.userId } : {}),
        },
        select: {
          id: true,
          userId: true,
          goalKind: true,
          learningMode: true,
        },
      });
      if (!goal?.userId || (subject.userId && subject.userId !== goal.userId)) {
        throw new LearningSystemSubjectAuthorizationError();
      }
      return { ...subject, userId: goal.userId, goalId: goal.id };
    }

    if (
      !subject.userId &&
      !subject.goalId &&
      !subject.moduleId &&
      !subject.unitId &&
      !subject.threadId
    ) {
      return {};
    }
    if (!subject.userId) {
      throw new LearningSystemSubjectAuthorizationError(
        "Generation subject requires an authenticated user, owned goal, or owned unit",
      );
    }
    return { ...subject };
  }
}

/**
 * Resolves product policy before optional bindings. Every goal/binding lookup
 * includes the authenticated owner, so another learner's goal cannot disclose
 * its mode, binding, or even whether a capability is enabled for it.
 */
export class DatabaseLearningSystemActivationResolver implements LearningSystemActivationResolver {
  constructor(private readonly store: LearningSystemActivationStore) {}

  async isActive({
    capability,
    subject,
  }: LearningSystemActivationRequest): Promise<boolean> {
    const capabilityId = capability.manifest.id;
    if (capabilityId === BASE_CAPABILITY_ID) return true;
    const scopedToGoal = Boolean(subject.goalId || subject.moduleId || subject.unitId);
    const goal = scopedToGoal ? await findOwnedGoal(this.store, subject) : null;
    if (scopedToGoal && !goal) return false;

    const [availability, binding] = await Promise.all([
      this.store.learningSystemAvailability.findUnique({
        where: { capabilityId },
        select: { enabled: true },
      }),
      goal && subject.userId
        ? this.store.goalLearningSystemBinding.findFirst({
            where: {
              goalId: goal.id,
              capabilityId,
              goal: { userId: subject.userId },
            },
            select: { enabled: true },
          })
        : Promise.resolve(null),
    ]);

    if (capabilityId === "kacom") {
      if (!goal) return availability?.enabled !== false;
      if (!goalRequiresKacom(goal)) return false;
      return true;
    }

    if (availability?.enabled === false) return false;
    if (binding) return binding.enabled;
    return true;
  }

  async isViewRequired({
    capability,
    subject,
    profile,
  }: LearningSystemViewRequirementRequest): Promise<boolean> {
    if (!profile.required || capability.manifest.id !== "kacom") {
      return profile.required;
    }
    if (!subject.goalId && !subject.unitId) return true;
    const goal = await findOwnedGoal(this.store, subject);
    // Missing or foreign ownership remains required so the broker fails closed.
    return goal ? goalRequiresKacom(goal) : true;
  }
}
