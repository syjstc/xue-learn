import type { TopicCategory } from "../../../../common/src/index.js";
import { capabilityToolSetFromTools } from "../../agents/core/tool-capability.js";
import { withAgentUserFacingRules } from "../../agents/core/user-facing.js";
import { MATERIAL_FOLLOW_UP_VIEW_KEYS } from "../../agents/material-follow-up/keys.js";
import { buildMaterialFollowUpSystemPrompt } from "../../agents/material-follow-up/prompt.js";
import { createMaterialFollowUpTools } from "../../agents/material-follow-up/tools.js";
import {
  formatCurrentDatePromptBlock,
  formatCurrentTimePromptBlock,
  queryNeedsExactCurrentTime,
} from "../../assistant/index.js";
import { appendContentMarkupRules } from "../../llm/content-markup.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";

export const MATERIAL_FOLLOW_UP_CAPABILITY_ID = "material-follow-up" as const;
export const MATERIAL_FOLLOW_UP_CAPABILITY_VERSION = "1.0.0" as const;

type MaterialFollowUpInvocation = {
  unitTitle: string;
  goalTitle: string;
  anchorSnippet: string;
  lang: string;
  ragContext?: string;
  sourceCount?: number;
  learnerMemoryBlock?: string;
  moduleContext?: string;
  topicCategory?: TopicCategory;
};

const MATERIAL_FOLLOW_UP_OPERATION_INSTRUCTIONS = Object.freeze({
  [MATERIAL_FOLLOW_UP_VIEW_KEYS.instructionContext]:
    "Tutor one learner about an anchored passage. Stay within the unit, use supplied learner and source context safely, and use tools only under their server-owned contracts.",
});

export function buildMaterialFollowUpInvocationPrompt(
  key: string,
  invocation: unknown,
  query?: string,
): string | null {
  if (key === MATERIAL_FOLLOW_UP_VIEW_KEYS.instructionContext) {
    const input = invocation as MaterialFollowUpInvocation | undefined;
    if (
      !input?.unitTitle ||
      !input.goalTitle ||
      !input.anchorSnippet ||
      !input.lang
    ) {
      return null;
    }
    return appendContentMarkupRules(
      withAgentUserFacingRules(
        buildMaterialFollowUpSystemPrompt({
          ...input,
          currentTimeBlock: queryNeedsExactCurrentTime(query)
            ? formatCurrentTimePromptBlock()
            : formatCurrentDatePromptBlock(),
        }),
      ),
      {
        topicCategory: input.topicCategory,
        goalTitle: input.goalTitle,
      },
    );
  }
  return null;
}

export function createMaterialFollowUpCapability() {
  return defineLearningSystemCapability({
    id: MATERIAL_FOLLOW_UP_CAPABILITY_ID,
    version: MATERIAL_FOLLOW_UP_CAPABILITY_VERSION,
    kind: "learning_system",
    toolSets: [
      capabilityToolSetFromTools({
        key: "material_follow_up",
        ownerCapabilityId: MATERIAL_FOLLOW_UP_CAPABILITY_ID,
        ownerCapabilityVersion: MATERIAL_FOLLOW_UP_CAPABILITY_VERSION,
        description: "Material follow-up search and micro-course actions.",
        requiredScopes: ["user", "goal", "unit"],
        tools: createMaterialFollowUpTools(),
      }),
    ],
    views: Object.fromEntries(
      Object.entries(MATERIAL_FOLLOW_UP_OPERATION_INSTRUCTIONS).map(
        ([key, instruction]) => [
          key,
          async ({ subject }): Promise<ContextEnvelope> => ({
            ownerCapabilityId: MATERIAL_FOLLOW_UP_CAPABILITY_ID,
            ownerCapabilityVersion: MATERIAL_FOLLOW_UP_CAPABILITY_VERSION,
            schemaVersion: 1,
            authority: "server_policy",
            scope: { ...subject },
            freshness: { asOf: new Date(0).toISOString(), stale: false },
            data: { promptBlock: instruction },
          }),
        ],
      ),
    ),
  });
}
