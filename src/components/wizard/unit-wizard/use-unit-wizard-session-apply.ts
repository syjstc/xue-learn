"use client";

import type { Dispatch, SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  patchGoalFromSessionResponse,
  queryKeys,
} from "@/shared/api";
import {
  clearMaterialLearningProgress,
  DEFAULT_MATERIAL_PRESENTATION,
  type MaterialPresentationState,
} from "@/shared/domain/material-presentation";
import type { LearningMaterialContent, SqPreview } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { postQuizNextStep } from "@xue-learn/core/source/src/shared/features.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import type { UnitSectionManifest } from "@/shared/api";
import { parseLearningAccess } from "@/shared/domain/learning-access";
import type { LearningAccess } from "@/shared/domain/learning-access";
import {
  sessionPatchMarksLearningDone,
  sessionPatchUnitStatus,
} from "@/shared/domain/learning-completion";
import type { UnitStatus } from "@/shared/domain/types";
import type { QuizGradeSummary } from "@/shared/domain/quiz-sets";
import type { SocraticThread } from "@/shared/graph/socratic-threads";
import type {
  QuizAnswerValue,
  QuizExplainItemState,
  QuizGradeView,
  QuizQ,
  Step,
  StructuredSubStep,
  StructuredTab,
} from "./types.ts";
import { quizExplainStateFromExplanations } from "./utils.ts";
import type { MaterialCheckResult } from "../interactive-material-body.tsx";

type CornellNotes = { notes: string; cues: string; summary: string };

export type SessionApplyDeps = {
  unitId: string;
  goalId: string;
  isLearningDone: boolean;
  queryClient: QueryClient;
  refreshQuizSets: () => void | Promise<unknown>;
  setLearningAccess: Dispatch<SetStateAction<LearningAccess | null>>;
  setIsLearningDone: Dispatch<SetStateAction<boolean>>;
  setUnitStatus: Dispatch<SetStateAction<UnitStatus>>;
  setStep: Dispatch<SetStateAction<Step>>;
  setStructuredSubStep: Dispatch<SetStateAction<StructuredSubStep>>;
  setStructuredTab: Dispatch<SetStateAction<StructuredTab>>;
  setSq: Dispatch<SetStateAction<SqPreview | null>>;
  setSqQuestionAnswers: Dispatch<SetStateAction<string[] | null>>;
  setMaterial: Dispatch<SetStateAction<LearningMaterialContent | null>>;
  setMaterialCheckResults: Dispatch<SetStateAction<MaterialCheckResult[]>>;
  setMaterialSources: Dispatch<SetStateAction<ContentSource[]>>;
  setMaterialPresentation: Dispatch<
    SetStateAction<MaterialPresentationState | null>
  >;
  setCornell: Dispatch<SetStateAction<CornellNotes | null>>;
  setSections: Dispatch<SetStateAction<UnitSectionManifest[]>>;
  setQuestions: Dispatch<SetStateAction<QuizQ[]>>;
  setAnswers: Dispatch<SetStateAction<Record<string, QuizAnswerValue>>>;
  setQuizGrade: Dispatch<SetStateAction<QuizGradeView | null>>;
  setActiveQuizSetId: Dispatch<SetStateAction<string | null>>;
  setQuizReadOnly: Dispatch<SetStateAction<boolean>>;
  setQuizExplainByIndex: Dispatch<
    SetStateAction<Record<number, QuizExplainItemState>>
  >;
  setFeedback: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  setFeynmanText: Dispatch<SetStateAction<string>>;
  setSocraticThreads: Dispatch<SetStateAction<SocraticThread[]>>;
  setActiveSocraticThreadId: Dispatch<SetStateAction<string | null>>;
};

export function applySocraticPayload(
  data: Record<string, unknown> | null | undefined,
  deps: SessionApplyDeps,
) {
  if (!data) return;
  if (Array.isArray(data.socraticThreads)) {
    deps.setSocraticThreads(data.socraticThreads as SocraticThread[]);
  }
  if (typeof data.activeSocraticThreadId === "string") {
    deps.setActiveSocraticThreadId(data.activeSocraticThreadId);
  }
}

export function applyLearningReset(
  data: Record<string, unknown> | null | undefined,
  deps: SessionApplyDeps,
) {
  if (!data?.resetProgress) return;
  deps.setIsLearningDone(false);
  deps.setUnitStatus("in_progress");
  deps.setStep("structured_input");
  deps.setQuizGrade(null);
  deps.setQuestions([]);
  deps.setAnswers({});
  deps.setActiveQuizSetId(null);
  deps.setQuizReadOnly(false);
  deps.setFeedback(null);
  deps.setFeynmanText("");
  deps.setSocraticThreads([]);
  deps.setActiveSocraticThreadId(null);
  deps.setSqQuestionAnswers(null);
  if (data.unitStatus) deps.setUnitStatus(data.unitStatus as UnitStatus);
}

/** Sync completion flags from session actions so post-complete navigation works. */
export function applyLearningCompletionState(
  data: Record<string, unknown> | null | undefined,
  deps: Pick<SessionApplyDeps, "setIsLearningDone" | "setUnitStatus">,
) {
  if (!data) return;
  const unitStatus = sessionPatchUnitStatus(data);
  if (unitStatus) deps.setUnitStatus(unitStatus);
  if (sessionPatchMarksLearningDone(data)) {
    deps.setIsLearningDone(true);
  }
}

export function applyIllustrationPatch(
  setMaterial: SessionApplyDeps["setMaterial"],
  blockIndex: number,
  patch: { imageUrl: string; imageId: string },
) {
  setMaterial((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      blocks: prev.blocks.map((block, index) =>
        index === blockIndex && block.type === "illustration"
          ? { ...block, ...patch }
          : block,
      ),
    };
  });
}

export function applyQuizPayload(
  data: {
    questions?: QuizQ[];
    quizSetId?: string;
    quizGrade?: QuizGradeSummary | null;
    quizExplanations?: Record<number, string>;
    readOnly?: boolean;
  },
  options: { keepStep?: boolean; preserveAnswers?: boolean } | undefined,
  deps: SessionApplyDeps,
) {
  if (data.questions) {
    deps.setQuestions(data.questions);
    if (!options?.keepStep) {
      deps.setStep("active_recall");
      deps.setStructuredSubStep("done");
    }
  }
  if (typeof data.quizSetId === "string") {
    deps.setActiveQuizSetId(data.quizSetId);
  }
  deps.setQuizReadOnly(Boolean(data.readOnly));
  if (!options?.preserveAnswers) {
    deps.setAnswers({});
  }
  deps.setQuizExplainByIndex(
    quizExplainStateFromExplanations(data.quizExplanations),
  );
  if (data.quizGrade) {
    deps.setQuizGrade({
      ...data.quizGrade,
      nextStep: postQuizNextStep(data.quizGrade.score, deps.isLearningDone),
    });
  } else {
    deps.setQuizGrade(null);
  }
}

export function applyStreamDone(
  data: Record<string, unknown>,
  deps: SessionApplyDeps,
  options?: { preserveStructuredTab?: boolean },
) {
  const nextAccess = parseLearningAccess(data.learningAccess);
  if (nextAccess) deps.setLearningAccess(nextAccess);
  applyLearningReset(data, deps);
  applyLearningCompletionState(data, deps);
  if (data.sq) {
    deps.setSq(data.sq as SqPreview);
    deps.setStructuredSubStep("sq");
    if (!options?.preserveStructuredTab) deps.setStructuredTab("sq");
    deps.setSqQuestionAnswers(null);
    if (data.clearedMaterial || data.clearedSections) {
      deps.setMaterial(null);
      deps.setMaterialCheckResults([]);
      deps.setMaterialSources([]);
      deps.setSections([]);
    }
    if (data.clearedCornell) deps.setCornell(null);
  }
  if (Array.isArray(data.sections)) {
    deps.setSections(data.sections as UnitSectionManifest[]);
  } else if (data.clearedSections) {
    deps.setSections([]);
  }
  if (Array.isArray(data.sections) || data.clearedSections) {
    void deps.queryClient.invalidateQueries({
      queryKey: queryKeys.units.page(deps.unitId, deps.goalId),
    });
  }
  if (data.material) {
    clearMaterialLearningProgress(deps.unitId);
    deps.setMaterialPresentation(DEFAULT_MATERIAL_PRESENTATION);
    deps.setMaterial(data.material as LearningMaterialContent);
    deps.setMaterialCheckResults([]);
    if (Array.isArray(data.contextSources)) {
      deps.setMaterialSources(data.contextSources as ContentSource[]);
    } else if (Array.isArray(data.materialSources)) {
      deps.setMaterialSources(data.materialSources as ContentSource[]);
    }
    deps.setStructuredSubStep(
      (data.structuredSubStep as StructuredSubStep) || "material",
    );
    if (!options?.preserveStructuredTab) deps.setStructuredTab("material");
    deps.setSqQuestionAnswers(null);
    if (data.clearedCornell) {
      deps.setCornell(null);
    }
  }
  if (data.cornell) {
    deps.setCornell(data.cornell as CornellNotes);
    deps.setStructuredSubStep("cornell");
    if (!options?.preserveStructuredTab) deps.setStructuredTab("notes");
  }
  if (data.questions) {
    applyQuizPayload(
      {
        questions: data.questions as QuizQ[],
        quizSetId:
          typeof data.quizSetId === "string" ? data.quizSetId : undefined,
      },
      { preserveAnswers: true },
      deps,
    );
    void deps.refreshQuizSets();
  }
  if (data.deck) {
    void deps.queryClient.invalidateQueries({
      queryKey: queryKeys.flashcards.deck(deps.unitId),
    });
    void deps.queryClient.invalidateQueries({
      queryKey: queryKeys.flashcards.all,
    });
  }
  patchGoalFromSessionResponse(deps.queryClient, deps.goalId, deps.unitId, data);
}
