"use client";

import type { ReactElement } from "react";
import { InlineGenStream } from "@/components/ai/inline-gen-stream";
import type { TranslationKey, TranslationParams } from "@xue-learn/core/i18n";
import {
  formatGenerationProgress,
  formatSqGenerationStatus,
} from "@/shared/generation/progress-copy";
import { CONTEXT_STREAM_OPERATIONS } from "./constants.ts";
import type { ContextGenState, GenStreamContext } from "./types.ts";

export type GenStreamRendererDeps = {
  t: (key: TranslationKey, params?: TranslationParams) => string;
  contextGenState: (ctx: GenStreamContext) => ContextGenState;
  isContextLoading: (ctx: GenStreamContext) => boolean;
  activeGenContext: GenStreamContext | null;
  canStop: (operation: string) => boolean;
  stopContextGeneration: (ctx: GenStreamContext) => void;
  quizGenerating: boolean;
  quizGenState: ContextGenState;
};

export type GenStreamRenderers = {
  renderGenStream: (
    context: GenStreamContext,
    className?: string,
  ) => ReactElement | null;
  renderMaterialGenBox: (className?: string) => ReactElement | null;
  renderSqGenBox: (className?: string) => ReactElement | null;
  renderNotesGenBox: (className?: string) => ReactElement | null;
  renderQuizGenBox: (className?: string) => ReactElement | null;
};

export function quizGenerationProgress(
  state: Pick<ContextGenState, "partialCount" | "placeholderBlockCount">,
) {
  if (state.partialCount <= 0) return null;
  return {
    current: state.partialCount,
    total: state.partialCount + Math.max(0, state.placeholderBlockCount),
  };
}

export function createGenStreamRenderers(
  deps: GenStreamRendererDeps,
): GenStreamRenderers {
  const {
    t,
    contextGenState,
    isContextLoading,
    activeGenContext,
    canStop,
    stopContextGeneration,
    quizGenerating,
    quizGenState,
  } = deps;

  const renderGenStream = (context: GenStreamContext, className?: string) => {
    const state = contextGenState(context);
    const showStream =
      (isContextLoading(context) || activeGenContext === context) &&
      !(context === "material" && state.materialContentReady) &&
      !(context === "material" && state.partialCount > 0) &&
      !(context === "sq" && state.partialCount > 0) &&
      !(context === "quiz" && state.partialCount > 0) &&
      !(context === "notes" && state.partialCount > 0) &&
      Boolean(
        state.status ||
          state.progress ||
          state.knowledgeActivity,
      );
    if (!showStream) return null;
    return (
      <InlineGenStream
        status={state.status}
        progress={state.progress}
        knowledgeActivity={state.knowledgeActivity}
        canStop={CONTEXT_STREAM_OPERATIONS[context].some((op) => canStop(op))}
        onStop={() => stopContextGeneration(context)}
        className={className}
      />
    );
  };

  const renderMaterialGenBox = (className?: string) => {
    const state = contextGenState("material");
    if (!isContextLoading("material") || state.materialContentReady)
      return null;
    const status =
      state.partialCount > 0
        ? formatGenerationProgress(
            t,
            "material",
            state.partialCount,
            state.placeholderBlockCount,
          )
        : state.status || t("generation.material.preparing");
    return (
      <InlineGenStream
        status={status}
        knowledgeActivity={state.knowledgeActivity}
        canStop={canStop("unit.generate_material")}
        onStop={() => stopContextGeneration("material")}
        className={className}
      />
    );
  };

  const renderSqGenBox = (className?: string) => {
    const state = contextGenState("sq");
    if (!isContextLoading("sq")) return null;
    const status = formatSqGenerationStatus(t, state);
    return (
      <InlineGenStream
        status={status}
        knowledgeActivity={state.knowledgeActivity}
        canStop={canStop("unit.generate_sq")}
        onStop={() => stopContextGeneration("sq")}
        className={className}
      />
    );
  };

  const renderNotesGenBox = (className?: string) => {
    const state = contextGenState("notes");
    if (!isContextLoading("notes")) return null;
    const status =
      state.partialCount > 0
        ? formatGenerationProgress(t, "notes", state.partialCount)
        : state.status || t("generation.notes.preparing");
    return (
      <InlineGenStream
        status={status}
        canStop={canStop("unit.generate_cornell")}
        onStop={() => stopContextGeneration("notes")}
        className={className}
      />
    );
  };

  const renderQuizGenBox = (className?: string) => {
    if (!quizGenerating) return null;
    const progress = quizGenerationProgress(quizGenState);
    const status =
      quizGenState.partialCount > 0
        ? formatGenerationProgress(t, "quiz", quizGenState.partialCount)
        : quizGenState.status || t("generation.quiz.preparing");
    return (
      <InlineGenStream
        status={status}
        progress={progress}
        canStop={canStop("unit.generate_quiz")}
        onStop={() => stopContextGeneration("quiz")}
        className={className}
      />
    );
  };

  return {
    renderGenStream,
    renderMaterialGenBox,
    renderSqGenBox,
    renderNotesGenBox,
    renderQuizGenBox,
  };
}
