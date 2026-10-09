export type SseEvent =
  | { type: "run"; runId: string }
  | { type: "status"; message: string; phase?: string }
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
  | { type: "thinking" }
  | { type: "component_partial"; component: unknown }
  | { type: "message"; delta: string; role?: "assistant" }
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
  | {
      type: "unit_content_gen";
      unitId: string;
      hasSurvey?: boolean;
      hasMaterial?: boolean;
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
      delta: import("./material-delta.js").MaterialDelta;
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
      type: "learning_access";
      access: {
        modelPhase:
          | "pending"
          | "building"
          | "targets_ready"
          | "ready"
          | "failed"
          | "stale";
        contentMode: "none" | "draft" | "canonical";
        assessmentMode: "locked" | "ready";
        lockReason?: "model_building" | "model_failed" | "model_stale";
        activeRunId?: string;
        inputHash?: string;
        prefixHash?: string;
      };
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
      type: "material_ready";
      material: unknown;
      [key: string]: unknown;
    }
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
  | { type: "error"; message: string };

export function encodeSseEvent(event: SseEvent, id?: number): string {
  const prefix = id === undefined ? "" : `id: ${id}\n`;
  return `${prefix}data: ${JSON.stringify(event)}\n\n`;
}
