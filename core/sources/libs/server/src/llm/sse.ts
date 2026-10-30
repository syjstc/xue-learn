import { localizeBackendPayload } from "../../../common/src/i18n/backend-i18n.js";
import { formatApiException } from "../../../common/src/api-exception.js";
import { safeJsonStringify } from "../../../common/src/safe-json.js";
import type { KnowledgeActivity } from "../../../domain/src/index.js";

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
  | {
      type: "unit_content_gen";
      unitId: string;
      hasSurvey?: boolean;
      hasMaterial?: boolean;
    }
  | {
      type: "material_ready";
      material: unknown;
      [key: string]: unknown;
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
      delta: import("../../../contracts/src/index.js").MaterialDelta;
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
      stage:
        | "requesting"
        | "generating"
        | "downloading"
        | "removing_background"
        | "saving";
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

export function encodeSseEvent(event: SseEvent, id?: number): string {
  const prefix = id === undefined ? "" : `id: ${id}\n`;
  return `${prefix}data: ${safeJsonStringify(localizeBackendPayload(event))}\n\n`;
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function formatSseError(e: unknown): { message: string; code?: string } {
  if (
    e &&
    typeof e === "object" &&
    "issues" in e &&
    Array.isArray((e as { issues: unknown }).issues)
  ) {
    const issues = (e as { issues: { path?: unknown[]; message?: string }[] })
      .issues;
    const summary = issues
      .map((issue) => {
        const path = issue.path?.length ? issue.path.join(".") : "响应";
        return `${path}: ${issue.message ?? "格式无效"}`;
      })
      .join("；");
    return {
      message: summary || "生成内容格式无效，请重试",
    };
  }
  return formatApiException(e);
}

export function createSseStream(
  run: (send: (event: SseEvent) => void) => Promise<void>,
  options?: { keepAliveMs?: number },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const isClosedStreamError = (error: unknown) =>
    error instanceof TypeError &&
    /Controller is already closed|Invalid state/i.test(error.message);

  return new ReadableStream({
    async start(controller) {
      const send = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        } catch (error) {
          if (isClosedStreamError(error)) {
            closed = true;
            return;
          }
          throw error;
        }
      };
      if (options?.keepAliveMs && options.keepAliveMs > 0) {
        keepAlive = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch (error) {
            if (isClosedStreamError(error)) closed = true;
          }
        }, options.keepAliveMs);
        keepAlive.unref?.();
      }
      const close = () => {
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        if (closed) return;
        closed = true;
        controller.close();
      };
      try {
        await run(send);
      } catch (e) {
        const formatted = formatSseError(e);
        send({
          type: "error",
          message: formatted.message,
          ...(formatted.code ? { code: formatted.code } : {}),
        });
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
    },
  });
}
