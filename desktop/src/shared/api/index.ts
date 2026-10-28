export {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiRequest,
  isNotFound,
  isUnauthorized,
} from "./http.ts";
export {
  classifyApiError,
  getUserFacingApiErrorMessage,
  isTechnicalApiErrorMessage,
  messageForApiErrorKind,
  messageForApiErrorStatus,
  resolveUserFacingApiError,
  type ApiErrorKind,
  type ResolvedUserFacingApiError,
} from "./user-facing-error.ts";
export { queryClient } from "./query-client.ts";
export { queryKeys } from "./query-keys.ts";
export {
  patchGoalActivityTouch,
  patchGoalDetailCache,
  patchGoalFromSessionResponse,
  patchGoalUnitContentGen,
} from "./patch-goal-cache.ts";
export type { GoalUnitCachePatch } from "./patch-goal-cache.ts";
export type { GoalMapPlan } from "@xue-learn/core/api";
export type {
  GoalDetail,
  GoalListItem,
  GoalMapSummary,
  GoalModule,
  LastLearnedUnit,
  GoalModuleDetail,
  GoalOverviewCourse,
  GoalOverviewUnit,
  GoalPlanResponse,
  GoalUnit,
  PracticeUnit,
  CognitiveReviewTask,
  DueCognitiveReviewResponse,
  SharedGoalPreview,
  SharedGoalCourse,
  PublicSharedCourseListItem,
  SharedCourseSection,
  SharedCourseLessonSection,
  UnitSectionManifest,
  UnitPageData,
  UploadedGoalDocument,
  FoundationGoalSummary,
  FoundationGoalsResponse,
} from "./types.ts";
export type {
  SqPreview,
  LearningMaterial,
  LearningGoal,
} from "./types/content.ts";
