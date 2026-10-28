export const GENERAL_MEMORY_VERSION = "2.0.0";
export const GENERAL_MEMORY_SCHEMA_VERSION = 2;
export const XUELEARN_MEMORY_PRODUCT_ID = "xuelearn";

export const GENERAL_MEMORY_VIEW_KEYS = {
  learnerRelevantMemory: "learner.relevant_memory.v2",
} as const;

export const GENERAL_MEMORY_QUERY_TOOL_KEYS = {
  findRelevantMemory: "find_relevant_memory",
} as const;

export const GENERAL_MEMORY_COMMANDS = {
  create: "memory.create.v2",
  correct: "memory.correct.v2",
  archive: "memory.archive.v2",
  delete: "memory.delete.v2",
} as const;

export const GENERAL_MEMORY_EVENTS = {
  agentTurnCompleted: "agent.turn.completed.v1",
  memoryChanged: "memory.changed.v1",
} as const;
