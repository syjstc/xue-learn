/**
 * Contract types for API payloads — generated from contracts/ (run pnpm run codegen).
 * Re-exported here for ergonomic frontend imports.
 */
export type {
  SqPreview,
  LearningMaterial,
  LearningGoal,
  GoalMapPlan,
  CornellNotes,
  Quiz,
} from "@xue-learn/core/source/src/shared/api/generated/index.ts";

export type { components, paths } from "@xue-learn/core/source/src/shared/api/generated/api.ts";

/** Alias used across wizard components */
export type { LearningMaterial as LearningMaterialContent } from "@xue-learn/core/source/src/shared/api/generated/index.ts";
