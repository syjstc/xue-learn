import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { AGENT_CORE_VIEW_KEYS } from "../../agents/core/keys.js";
import { withAgentSystemRules } from "../../agents/core/user-facing.js";
import {
  buildAgentAwarenessPrompt,
  buildResumeContextPrompt,
  normalizeHandoffHistory,
  type AgentId,
  type AgentRegistry,
} from "../../agents/core/agent-registry.js";

export const AGENT_CORE_CAPABILITY_ID = "agent-core" as const;
export const AGENT_CORE_CAPABILITY_VERSION = "1.0.0" as const;

export function createAgentCoreCapability() {
  return defineLearningSystemCapability({
    id: AGENT_CORE_CAPABILITY_ID,
    version: AGENT_CORE_CAPABILITY_VERSION,
    kind: "core_provider",
    views: {
      [AGENT_CORE_VIEW_KEYS.systemRules]: async ({
        subject,
      }): Promise<ContextEnvelope> => ({
        ownerCapabilityId: AGENT_CORE_CAPABILITY_ID,
        ownerCapabilityVersion: AGENT_CORE_CAPABILITY_VERSION,
        schemaVersion: 1,
        authority: "server_policy",
        scope: { ...subject },
        freshness: { asOf: new Date(0).toISOString(), stale: false },
        data: { promptBlock: withAgentSystemRules("") },
      }),
      [AGENT_CORE_VIEW_KEYS.awareness]: async ({
        subject,
        invocation,
      }): Promise<ContextEnvelope | null> => {
        const input = invocation as
          { agentRegistry?: AgentRegistry; selfAgentId?: AgentId } | undefined;
        if (!input?.agentRegistry || !input.selfAgentId) return null;
        const hasOtherLiveAgent = Object.values(
          input.agentRegistry.agents,
        ).some(
          (card) =>
            card.agentId !== input.selfAgentId && card.status !== "idle",
        );
        if (
          !hasOtherLiveAgent &&
          normalizeHandoffHistory(input.agentRegistry).length === 0
        ) {
          return null;
        }
        return {
          ownerCapabilityId: AGENT_CORE_CAPABILITY_ID,
          ownerCapabilityVersion: AGENT_CORE_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "conversation_context",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: {
            promptBlock: buildAgentAwarenessPrompt(
              input.agentRegistry,
              input.selfAgentId,
            ),
          },
        };
      },
      [AGENT_CORE_VIEW_KEYS.resumeContext]: async ({
        subject,
        invocation,
      }): Promise<ContextEnvelope | null> => {
        const input = invocation as
          | {
              agentRegistry?: AgentRegistry;
              goalCreationPaused?: boolean;
            }
          | undefined;
        if (!input?.agentRegistry || !input.goalCreationPaused) return null;
        return {
          ownerCapabilityId: AGENT_CORE_CAPABILITY_ID,
          ownerCapabilityVersion: AGENT_CORE_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "conversation_context",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: {
            promptBlock: buildResumeContextPrompt(input.agentRegistry),
          },
        };
      },
    },
  });
}
