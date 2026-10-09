import { getCurrentLocale } from "../../../../common/src/index.js";
import {
  resolvePersonaPromptLocale,
  type TeachingPersonaPromptPart,
} from "../../teaching-personas/index.js";
import { resolveUserFacingResponseLanguage } from "../response-language.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import * as shared from "./support/builtin.js";
import type { BuiltinReadCapabilityDependencies } from "./support/builtin.js";

const { VERSION, BUILTIN_READ_VIEW_KEYS, envelope } = shared;

const VIEW_PART: Record<string, TeachingPersonaPromptPart> = {
  [BUILTIN_READ_VIEW_KEYS.teachingPersonaBase]: "base",
  [BUILTIN_READ_VIEW_KEYS.teachingPersonaCourse]: "course",
  [BUILTIN_READ_VIEW_KEYS.teachingPersonaAssessment]: "assessment",
  [BUILTIN_READ_VIEW_KEYS.teachingPersonaFollowUp]: "follow_up",
};

const FULL_VIEW_KEY = BUILTIN_READ_VIEW_KEYS.teachingPersonaFull;

async function resolvePersonaView(options: {
  key: string;
  userId: string;
  goalId?: string;
  query?: string;
  deps: BuiltinReadCapabilityDependencies;
}): Promise<ContextEnvelope | null> {
  const part = VIEW_PART[options.key];
  const isFull = options.key === FULL_VIEW_KEY;
  if (!part && !isFull) return null;
  const locale = resolvePersonaPromptLocale(
    resolveUserFacingResponseLanguage(options.query, getCurrentLocale()),
  );
  const prompt = isFull
    ? await options.deps.formatTeachingPersonaPromptBlockForUser(
        options.userId,
        options.goalId,
        locale,
      )
    : await options.deps.formatTeachingPersonaPromptPartForUser(
        options.userId,
        options.goalId,
        part!,
        locale,
      );
  return envelope({
    ownerCapabilityId: "teaching-persona",
    authority: "pedagogical_guidance",
    scope: {
      userId: options.userId,
      ...(options.goalId ? { goalId: options.goalId } : {}),
    },
    data: isFull ? { part: "full", prompt } : { part, prompt },
  });
}

export function createTeachingPersonaCapability(
  deps: BuiltinReadCapabilityDependencies,
) {
  return defineLearningSystemCapability({
    id: "teaching-persona",
    version: VERSION,
    views: Object.fromEntries(
      [...Object.keys(VIEW_PART), FULL_VIEW_KEY].map((key) => [
        key,
        async (request) => {
          if (!request.subject.userId) return null;
          return resolvePersonaView({
            key: request.key,
            userId: request.subject.userId,
            goalId: request.subject.goalId,
            query: request.query,
            deps,
          });
        },
      ]),
    ),
  });
}
