import { BadRequestException, Injectable } from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { getCurrentUserId } from "../../user-context.js";
import {
  getLearnerProfile,
  learnerKnowledgeUpsertSchema,
  learnerProfilePatchSchema,
  patchLearnerProfile,
  saveLearnerKnowledge,
} from "../../persona/learner-profile.js";
import { getLearningStateSummary } from "../../learner-state-memory/index.js";

@Injectable()
export class ProfileService {
  private requireUserId() {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new BadRequestException({
        code: "MISSING_USER_IDENTITY",
        message: tBackend("error.auth.missingUserIdentity"),
      });
    }
    return userId;
  }

  async getLearner() {
    return {
      profile: await getLearnerProfile(this.requireUserId()),
    };
  }

  async patchLearner(body: unknown) {
    const parsed = learnerProfilePatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    return {
      profile: await patchLearnerProfile(this.requireUserId(), parsed.data),
    };
  }

  async postKnowledge(body: unknown) {
    const parsed = learnerKnowledgeUpsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    return {
      profile: await saveLearnerKnowledge(this.requireUserId(), parsed.data),
    };
  }

  async getLearningState() {
    return {
      learningState: await getLearningStateSummary(this.requireUserId()),
    };
  }
}
