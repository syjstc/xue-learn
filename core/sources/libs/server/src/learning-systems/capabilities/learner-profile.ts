import {
  formatLearnerProfilePromptBlock,
  getLearnerProfileSnapshot,
} from "../../persona/learner-profile.js";
import type { LearningSystemCapability } from "../types.js";
import {
  BUILTIN_READ_VIEW_KEYS,
  VERSION,
  envelope,
  iso,
} from "./support/builtin.js";

export function createLearnerProfileCapability(): LearningSystemCapability {
  const capabilityId = "learner-profile";
  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesViews: [BUILTIN_READ_VIEW_KEYS.learnerProfile],
    },
    getView: async (request) => {
      if (
        request.key !== BUILTIN_READ_VIEW_KEYS.learnerProfile ||
        !request.subject.userId
      ) {
        return null;
      }
      const record = await getLearnerProfileSnapshot(request.subject.userId);
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "learner_declared_context",
        scope: { userId: request.subject.userId },
        asOf: iso(record.updatedAt),
        data: {
          profile: record.profile,
          prompt: formatLearnerProfilePromptBlock(record.profile),
        },
      });
    },
  };
}
