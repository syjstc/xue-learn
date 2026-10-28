import { invalidateAgendaForUser } from "../../agenda/settings.js";
import { retrieveLearnedKnowledge } from "../../rag/learned-knowledge.js";
import { retrieveContextForUnitWithSources } from "../../rag/retrieve.js";
import { createAgendaCapability } from "../capabilities/agenda.js";
import { createKnowledgeCapability } from "../capabilities/knowledge.js";
import { createRagCapability } from "../capabilities/rag.js";
import { createReviewCapability } from "../capabilities/review.js";
import type { LearningSystemCapability } from "../types.js";
import type {
  CreateRuntimeContextCapabilitiesOptions,
  RuntimeContextDependencies,
} from "../capabilities/support/runtime.js";

export {
  RUNTIME_CONTEXT_QUERY_TOOL_KEYS,
  RUNTIME_CONTEXT_VIEW_KEYS,
} from "../capabilities/support/runtime.js";
export type { CreateRuntimeContextCapabilitiesOptions } from "../capabilities/support/runtime.js";

export function createRuntimeContextCapabilities(
  options: CreateRuntimeContextCapabilitiesOptions = {},
): LearningSystemCapability[] {
  const deps: RuntimeContextDependencies = {
    retrieveLearnedKnowledge:
      options.dependencies?.retrieveLearnedKnowledge ??
      retrieveLearnedKnowledge,
    retrieveContextForUnitWithSources:
      options.dependencies?.retrieveContextForUnitWithSources ??
      retrieveContextForUnitWithSources,
    invalidateAgendaForUser:
      options.dependencies?.invalidateAgendaForUser ?? invalidateAgendaForUser,
    now: options.dependencies?.now ?? (() => new Date()),
  };
  return [
    createKnowledgeCapability(deps),
    createRagCapability({
      retrieveContextForUnitWithSources: deps.retrieveContextForUnitWithSources,
      now: deps.now,
    }),
    createAgendaCapability(deps),
    createReviewCapability(deps),
  ];
}
