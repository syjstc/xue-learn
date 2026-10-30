/** Frontend SSE event types (mirror @cognilearn/contracts). */
import type { LearningAccess } from "@/shared/domain/learning-access";
import type { KnowledgeActivity } from "@xue-learn/core/domain";

export type SseEvent =
  | { type: "run"; runId: string }
  | { type: "status"; message: string; phase?: string; reset?: boolean }
  | {
      type: "content_verification";
      state: "verifying" | "verified";
      artifactKind: "survey" | "material" | "mini_test" | "assessment";
      result?: "passed" | "repaired" | "shadow_issues" | "skipped_error";
    }
  | {
      type: "content_repair";
      artifactKind: "survey" | "material" | "mini_test" | "assessment";
      patches: Array<{ index: number; kind: string; content: unknown }>;
    }
  | { type: "language"; code: string; label: string }
  | { type: "token"; delta: string }
  | { type: "thinking"; delta?: string }
  | {
      type: "reasoning_status";
      status: "requested" | "active" | "unsupported";
      provider: string;
    }
  | {
      type: "planning_activity";
      id: string;
      sequence: number;
      category: "thinking" | "research" | "synthesis" | "validation";
      status: "active" | "complete";
      message: string;
      elapsedSeconds: number;
      capabilityPath?: { moduleTitles: string[]; unitCount: number };
    }
  | {
      type: "planning_stage";
      stage:
        | "analyzing_goal"
        | "searching_web"
        | "reading_sources"
        | "cross_checking"
        | "researching_modules"
        | "sequencing_modules"
        | "revising_plan"
        | "validating_plan";
      message?: string;
    }
  | {
      type: "planning_outline";
      field: string;
      modeClarification: string;
      reusedSources: boolean;
      topicOverview?: string;
      whatYouWillLearn?: string[];
      prerequisitesAssumed?: string[];
      modules: Array<{
        moduleRef: string;
        title: string;
        objective: string;
        dependsOnPrevious: string;
        estimatedUnitCount?: number;
        scopeSize?: "compact" | "standard" | "large";
        progression?: string[];
      }>;
    }
  | {
      type: "research_query";
      query: string;
      current: number;
      total: number;
      scope: "goal" | "module";
      moduleRef?: string;
    }
  | {
      type: "module_research_progress";
      current: number;
      total: number;
      moduleRef?: string;
      moduleTitle?: string;
      status: "queued" | "researching" | "complete" | "warning";
      sourceCount?: number;
    }
  | { type: "planning_warning"; code: string; message: string }
  | { type: "knowledge_activity"; activity: KnowledgeActivity }
  | { type: "message"; delta: string; role?: "assistant" }
  | {
      type: "tool_ui";
      toolCallId: string;
      toolName: string;
      uiKind: string;
      args: Record<string, unknown>;
    }
  | {
      type: "quiz_explain_start";
      questionIndex: number;
      current: number;
      total: number;
    }
  | { type: "quiz_explain_token"; questionIndex: number; delta: string }
  | {
      type: "quiz_explain_item";
      questionIndex: number;
      explanation: string;
    }
  | { type: "progress"; current: number; total: number; message?: string }
  | { type: "learning_access"; access: LearningAccess }
  | {
      type: "unit_content_gen";
      unitId: string;
      hasSurvey?: boolean;
      hasMaterial?: boolean;
    }
  | {
      type: "material_ready";
      material: unknown;
      finalized?: boolean;
      inputHash?: string;
      prefixHash?: string;
      [key: string]: unknown;
    }
  | {
      type: "sq_partial";
      sq: unknown;
      completeLineCount: number;
      finalized?: boolean;
      inputHash?: string;
      prefixHash?: string;
    }
  | {
      type: "material_partial";
      material: unknown;
      completeBlockCount: number;
      placeholderBlockCount?: number;
      sections?: unknown[];
      finalized?: boolean;
      inputHash?: string;
      prefixHash?: string;
      streamRevision?: number;
    }
  | {
      type: "material_delta";
      delta: import("@xue-learn/core/contracts").MaterialDelta;
      reset?: boolean;
      completeBlockCount: number;
      placeholderBlockCount?: number;
      sections?: unknown[];
      finalized?: boolean;
      inputHash?: string;
      prefixHash?: string;
      streamRevision?: number;
    }
  | {
      type: "derivation_partial";
      derivation: unknown;
      completeStepCount: number;
      finalized?: boolean;
    }
  | {
      type: "teaching_derivation_partial";
      teachingDerivation: unknown;
      derived?: unknown;
      completeStepCount: number;
      finalized?: boolean;
    }
  | {
      type: "map_partial";
      map: unknown;
      unitCount: number;
      placeholderUnitCount?: number;
    }
  | {
      type: "micro_unit_partial";
      microUnit: unknown;
      pendingFields?: string[];
    }
  | {
      type: "shell_ready";
      goalId: string;
      unitId: string;
      navigateTo: string;
      runId?: string;
    }
  | {
      type: "quiz_partial";
      questions: unknown;
      completeQuestionCount: number;
      placeholderQuestionCount?: number;
    }
  | {
      type: "cornell_partial";
      cornell: unknown;
      completeLineCount: number;
    }
  | {
      type: "illustration";
      blockIndex: number;
      imageUrl: string;
      imageId: string;
    }
  | {
      type: "image_generation_progress";
      stage: "requesting" | "generating" | "downloading" | "saving";
      message: string;
      previewUrl?: string;
    }
  | { type: "component_partial"; component: unknown }
  | {
      type: "narration_audio_ready";
      asset: {
        audioId: string;
        contentKey: string;
        textHash: string;
        audioUrl: string;
        mimeType: string;
        durationMs: number;
        audioStartMs: number;
        audioEndMs: number;
        chars: Array<{
          char: string;
          startMs: number;
          endMs: number;
          endOffset: number;
        }>;
      };
    }
  | { type: "narration_audio_unavailable"; contentKey?: string }
  | { type: "done"; [key: string]: unknown }
  | { type: "cancelled"; message: string }
  | { type: "error"; message: string; code?: string };
