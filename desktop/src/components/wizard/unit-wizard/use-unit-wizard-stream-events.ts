"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { applyMaterialDelta } from "@xue-learn/core/contracts";
import type { SseEvent } from "@/shared/llm/sse";
import { apiGet, type UnitSectionManifest } from "@/shared/api";
import type { LearningMaterialContent, SqPreview } from "@xue-learn/core/schemas";
import { clearUnitInstantMicro } from "@/shared/goals/instant-micro-creation";
import {
  learningAccessFromEvent,
  type LearningAccess,
} from "@/shared/domain/learning-access";
import type { PracticeTab } from "../practice-hub.tsx";
import { MIN_MATERIAL_PARTIAL_BLOCKS } from "./constants.ts";
import type {
  ContextGenState,
  GenStreamContext,
  QuizGradeView,
  QuizQ,
  Step,
  StructuredSubStep,
  StructuredTab,
} from "./types.ts";
import { emptyContextGenState, genContextFromOperation } from "./utils.ts";

export type StreamEventDeps = {
  unitId: string;
  syncFromEvent: (event: SseEvent) => void;
  instantPhaseRef: MutableRefObject<string>;
  navigateForGenContext: (context: GenStreamContext) => void;
  patchGenContext: (
    ctx: GenStreamContext,
    patch: Partial<ContextGenState>,
  ) => void;
  applyStreamDone: (data: Record<string, unknown>) => void;
  applyIllustrationPatch: (
    blockIndex: number,
    patch: { imageUrl: string; imageId: string },
  ) => void;
  setLearningAccess: Dispatch<SetStateAction<LearningAccess | null>>;
  setGenByContext: Dispatch<
    SetStateAction<Partial<Record<GenStreamContext, ContextGenState>>>
  >;
  setActiveGenContext: Dispatch<SetStateAction<GenStreamContext | null>>;
  setSq: Dispatch<SetStateAction<SqPreview | null>>;
  setStructuredSubStep: Dispatch<SetStateAction<StructuredSubStep>>;
  setStructuredTab: Dispatch<SetStateAction<StructuredTab>>;
  setMaterial: Dispatch<SetStateAction<LearningMaterialContent | null>>;
  setSections: Dispatch<SetStateAction<UnitSectionManifest[]>>;
  setQuestions: Dispatch<SetStateAction<QuizQ[]>>;
  setQuizGrade: Dispatch<SetStateAction<QuizGradeView | null>>;
  setQuizReadOnly: Dispatch<SetStateAction<boolean>>;
  setStep: Dispatch<SetStateAction<Step>>;
  setPracticeTab: Dispatch<SetStateAction<PracticeTab>>;
  setCornell: Dispatch<
    SetStateAction<{ notes: string; cues: string; summary: string } | null>
  >;
};

function materialPartialCounts(
  event: Extract<SseEvent, { type: "material_partial" | "material_delta" }>,
  material?: LearningMaterialContent | null,
) {
  const snapshot =
    material ??
    (event.type === "material_partial"
      ? (event.material as LearningMaterialContent)
      : null);
  const renderableBlockCount = Array.isArray(snapshot?.blocks)
    ? snapshot.blocks.filter((block) => block.type !== "placeholder").length
    : 0;
  return {
    completeBlockCount: Math.max(
      typeof event.completeBlockCount === "number"
        ? event.completeBlockCount
        : 0,
      renderableBlockCount,
    ),
    placeholderBlockCount:
      typeof event.placeholderBlockCount === "number"
        ? event.placeholderBlockCount
        : 0,
  };
}

function shouldPaintMaterialPartial(params: {
  completeBlockCount: number;
  placeholderBlockCount: number;
  introduction?: string;
}): boolean {
  return (
    params.completeBlockCount >= MIN_MATERIAL_PARTIAL_BLOCKS ||
    params.placeholderBlockCount > 0 ||
    Boolean(params.introduction?.trim())
  );
}

export function handleGenStreamEvent(
  operation: string,
  event: SseEvent,
  deps: StreamEventDeps,
): void {
  deps.syncFromEvent(event);
  if (event.type === "learning_access") {
    deps.setLearningAccess(learningAccessFromEvent(event));
  }
  const ctx = genContextFromOperation(operation);
  if (!ctx) return;

  if (event.type === "status") {
    deps.patchGenContext(ctx, {
      status: event.message,
      ...(event.phase ? { phase: event.phase } : {}),
    });
    if (ctx === "material" && event.phase === "material") {
      void apiGet<UnitSectionManifest[]>(`/api/units/${deps.unitId}/sections`)
        .then((sections) => deps.setSections(sections))
        .catch(() => undefined);
    }
  }
  if (event.type === "content_repair" && event.artifactKind === "assessment") {
    deps.setQuestions((current) => {
      const next = [...current];
      for (const patch of event.patches) {
        if (patch.index >= 0 && patch.index < next.length) {
          next[patch.index] = patch.content as QuizQ;
        }
      }
      return next;
    });
  }
  if (event.type === "content_repair" && event.artifactKind === "material") {
    deps.setMaterial((current) => {
      if (!current) return current;
      let introduction = current.introduction;
      const blocks = [...current.blocks];
      const keyTakeaways = [...current.keyTakeaways];
      for (const patch of event.patches) {
        if (patch.kind === "material_introduction") {
          introduction = String(patch.content ?? "");
        } else if (patch.kind === "material_takeaway") {
          const position = patch.index - blocks.length - 1;
          if (position >= 0 && position < keyTakeaways.length) {
            keyTakeaways[position] = String(patch.content ?? "");
          }
        } else {
          const position = patch.index - 1;
          if (position >= 0 && position < blocks.length) {
            blocks[position] = patch.content as (typeof blocks)[number];
          }
        }
      }
      return { introduction, blocks, keyTakeaways };
    });
  }
  if (event.type === "knowledge_activity") {
    deps.patchGenContext(ctx, { knowledgeActivity: event.activity });
  }
  if (event.type === "progress") {
    deps.patchGenContext(ctx, {
      progress: { current: event.current, total: event.total },
      ...(event.message ? { status: event.message } : {}),
    });
  }
  if (event.type === "token") {
    deps.setGenByContext((prev) => {
      const current = prev[ctx] ?? emptyContextGenState();
      return {
        ...prev,
        [ctx]: {
          ...current,
          preview: (current.preview + event.delta).slice(-3000),
        },
      };
    });
  }
  if (event.type === "sq_partial") {
    deps.setSq(event.sq as SqPreview);
    deps.setStructuredSubStep("sq");
    deps.setStructuredTab("sq");
    deps.patchGenContext(ctx, {
      preview: "",
      placeholderBlockCount: 0,
      partialCount:
        typeof event.completeLineCount === "number"
          ? event.completeLineCount
          : 0,
    });
  }
  if (event.type === "material_partial") {
    const { completeBlockCount, placeholderBlockCount } =
      materialPartialCounts(event);
    if (Array.isArray(event.sections)) {
      deps.setSections(event.sections as UnitSectionManifest[]);
    }
    if (
      shouldPaintMaterialPartial({
        completeBlockCount,
        placeholderBlockCount,
        introduction:
          event.material &&
          typeof event.material === "object" &&
          "introduction" in event.material
            ? String(
                (event.material as { introduction?: unknown }).introduction ??
                  "",
              )
            : "",
      })
    ) {
      deps.setMaterial(event.material as LearningMaterialContent);
    }
    deps.setStructuredSubStep("material");
    deps.patchGenContext(ctx, {
      preview: "",
      materialContentReady: false,
      partialCount: completeBlockCount,
      placeholderBlockCount,
    });
  }
  if (event.type === "material_delta") {
    if (Array.isArray(event.sections)) {
      deps.setSections(event.sections as UnitSectionManifest[]);
    }
    deps.setMaterial(
      (current) =>
        applyMaterialDelta(
          event.reset ? null : current,
          event.delta,
        ) as LearningMaterialContent,
    );
    const { completeBlockCount, placeholderBlockCount } =
      materialPartialCounts(event);
    deps.setStructuredSubStep("material");
    deps.patchGenContext(ctx, {
      preview: "",
      materialContentReady: false,
      partialCount: completeBlockCount,
      placeholderBlockCount,
    });
  }
  if (event.type === "material_ready") {
    const { type: _, material: readyMaterial, ...rest } = event;
    deps.applyStreamDone({ material: readyMaterial, ...rest });
    deps.patchGenContext(ctx, {
      materialContentReady: true,
      status: "",
      preview: "",
      partialCount: 0,
      placeholderBlockCount: 0,
    });
    deps.setActiveGenContext((current) => (current === ctx ? null : current));
  }
  if (event.type === "illustration") {
    deps.applyIllustrationPatch(event.blockIndex, {
      imageUrl: event.imageUrl,
      imageId: event.imageId,
    });
  }
  if (event.type === "quiz_partial") {
    const partialQuestions = Array.isArray(event.questions)
      ? (event.questions as QuizQ[])
      : [];
    if (partialQuestions.length > 0) {
      deps.setQuestions(partialQuestions);
      deps.setQuizGrade(null);
      deps.setQuizReadOnly(false);
      deps.setStep("active_recall");
      deps.setPracticeTab("quiz");
    }
    const placeholderQuestionCount =
      typeof event.placeholderQuestionCount === "number"
        ? event.placeholderQuestionCount
        : 0;
    deps.patchGenContext(ctx, {
      preview: "",
      partialCount:
        typeof event.completeQuestionCount === "number"
          ? event.completeQuestionCount
          : partialQuestions.length,
      placeholderBlockCount: placeholderQuestionCount,
    });
  }
  if (event.type === "cornell_partial") {
    deps.setCornell(
      event.cornell as { notes: string; cues: string; summary: string },
    );
    deps.setStructuredSubStep("cornell");
    deps.setStructuredTab("notes");
    deps.patchGenContext(ctx, {
      preview: "",
      partialCount:
        typeof event.completeLineCount === "number"
          ? event.completeLineCount
          : 0,
    });
  }
}

export function handleInstantMicroStreamEvent(
  event: SseEvent,
  deps: StreamEventDeps,
): void {
  deps.syncFromEvent(event);
  if (event.type === "learning_access") {
    deps.setLearningAccess(learningAccessFromEvent(event));
  }
  const resolveCtx = (): GenStreamContext =>
    deps.instantPhaseRef.current === "material" ? "material" : "sq";

  if (event.type === "status") {
    if (event.phase) deps.instantPhaseRef.current = event.phase;
    const ctx = resolveCtx();
    deps.patchGenContext(ctx, {
      status: event.message,
      ...(event.phase ? { phase: event.phase } : {}),
    });
    deps.setActiveGenContext(ctx);
    deps.navigateForGenContext(ctx);
  }
  if (event.type === "knowledge_activity") {
    const ctx = resolveCtx();
    deps.patchGenContext(ctx, { knowledgeActivity: event.activity });
  }
  if (event.type === "token") {
    const ctx = resolveCtx();
    deps.setGenByContext((prev) => {
      const current = prev[ctx] ?? emptyContextGenState();
      return {
        ...prev,
        [ctx]: {
          ...current,
          preview: (current.preview + event.delta).slice(-3000),
        },
      };
    });
    deps.setActiveGenContext(ctx);
  }
  if (event.type === "sq_partial") {
    deps.setSq(event.sq as SqPreview);
    deps.setStructuredSubStep("sq");
    deps.setStructuredTab("sq");
    deps.patchGenContext("sq", {
      preview: "",
      placeholderBlockCount: 0,
      partialCount:
        typeof event.completeLineCount === "number"
          ? event.completeLineCount
          : 0,
    });
    deps.setActiveGenContext("sq");
  }
  if (event.type === "material_partial") {
    const { completeBlockCount, placeholderBlockCount } =
      materialPartialCounts(event);
    if (Array.isArray(event.sections)) {
      deps.setSections(event.sections as UnitSectionManifest[]);
    }
    if (
      shouldPaintMaterialPartial({
        completeBlockCount,
        placeholderBlockCount,
        introduction:
          event.material &&
          typeof event.material === "object" &&
          "introduction" in event.material
            ? String(
                (event.material as { introduction?: unknown }).introduction ??
                  "",
              )
            : "",
      })
    ) {
      deps.setMaterial(event.material as LearningMaterialContent);
    }
    deps.setStructuredSubStep("material");
    deps.setStructuredTab("material");
    deps.patchGenContext("material", {
      preview: "",
      materialContentReady: false,
      partialCount: completeBlockCount,
      placeholderBlockCount,
    });
    deps.setActiveGenContext("material");
  }
  if (event.type === "material_delta") {
    if (Array.isArray(event.sections)) {
      deps.setSections(event.sections as UnitSectionManifest[]);
    }
    deps.setMaterial(
      (current) =>
        applyMaterialDelta(
          event.reset ? null : current,
          event.delta,
        ) as LearningMaterialContent,
    );
    const { completeBlockCount, placeholderBlockCount } =
      materialPartialCounts(event);
    deps.setStructuredSubStep("material");
    deps.setStructuredTab("material");
    deps.patchGenContext("material", {
      preview: "",
      materialContentReady: false,
      partialCount: completeBlockCount,
      placeholderBlockCount,
    });
    deps.setActiveGenContext("material");
  }
  if (event.type === "material_ready") {
    const { type: _, material: readyMaterial, ...rest } = event;
    deps.applyStreamDone({ material: readyMaterial, ...rest });
    deps.patchGenContext("material", {
      materialContentReady: true,
      status: "",
      preview: "",
      partialCount: 0,
      placeholderBlockCount: 0,
    });
    deps.setActiveGenContext(null);
    clearUnitInstantMicro(deps.unitId);
  }
  if (event.type === "unit_content_gen" && event.unitId === deps.unitId) {
    if (event.hasMaterial) {
      void apiGet<{
        material?: LearningMaterialContent;
        sq?: SqPreview;
      }>(`/api/units/${deps.unitId}/session`).then((data) => {
        if (data.material) {
          deps.setMaterial(data.material as LearningMaterialContent);
          deps.setStructuredSubStep("material");
          deps.setStructuredTab("material");
        }
        if (data.sq) deps.setSq(data.sq as SqPreview);
      });
    } else if (event.hasSurvey) {
      void apiGet<{ sq?: SqPreview }>(
        `/api/units/${deps.unitId}/session`,
      ).then((data) => {
        if (data.sq) deps.setSq(data.sq as SqPreview);
      });
    }
  }
  if (event.type === "done") {
    void apiGet<{
      material?: LearningMaterialContent;
      sq?: SqPreview;
    }>(`/api/units/${deps.unitId}/session`).then((data) => {
      if (data.sq) {
        deps.setSq(data.sq as SqPreview);
        deps.setStructuredSubStep("sq");
        deps.setStructuredTab("sq");
      }
      if (data.material) {
        deps.setMaterial(data.material as LearningMaterialContent);
        deps.setStructuredSubStep("material");
        deps.setStructuredTab("material");
      }
      // Keep the instant-generation guard active until generated content is
      // reflected in local state. Otherwise the empty-SQ auto-start effect
      // can launch a second generation run in this request's loading gap.
      clearUnitInstantMicro(deps.unitId);
    });
    deps.patchGenContext("sq", { status: "", preview: "" });
    deps.patchGenContext("material", { status: "", preview: "" });
    deps.setActiveGenContext(null);
  }
}
