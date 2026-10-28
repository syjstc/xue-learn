import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../types.js";
import { MAP_EXPANSION_VIEW_KEYS } from "../../llm/map-expansion-keys.js";

const BRANCH_EXPANSION_INSTRUCTION = `Expand the requested XueLearn goal-map branch from the invocation input.
- Preserve the parent branch's allocated goal scope, language, and explicit catalog coverage.
- Produce only the hierarchy and structured output allowed by the invocation contract.
- Do not repeat the parent or drift into sibling scope.`;

const SUBDIVIDE_INSTRUCTION = `Subdivide the requested XueLearn goal-map unit from the invocation input.
- Preserve the parent unit's goal scope, language, and prerequisites-to-advanced ordering.
- Produce only focused session lessons in the structured item-array contract.
- Do not add unrelated topics or an extra hierarchy level.`;

export function createMapExpansionCapability() {
  const capabilityId = "map-expansion";
  const version = "1.1.0";
  const envelope = (
    subject: SystemViewRequest["subject"],
    promptBlock: string,
  ): ContextEnvelope => ({
    ownerCapabilityId: capabilityId,
    ownerCapabilityVersion: version,
    schemaVersion: 1,
    authority: "server_policy",
    scope: { ...subject },
    freshness: { asOf: new Date().toISOString(), stale: false },
    data: { promptBlock },
  });
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [MAP_EXPANSION_VIEW_KEYS.branchInstructionContext]: async ({
        subject,
      }: SystemViewRequest) => {
        return envelope(subject, BRANCH_EXPANSION_INSTRUCTION);
      },
      [MAP_EXPANSION_VIEW_KEYS.subdivideInstructionContext]: async ({
        subject,
      }: SystemViewRequest) => {
        return envelope(subject, SUBDIVIDE_INSTRUCTION);
      },
    },
  });
}
