import { mainlineEnabled } from "@/features/learning-mainline/enabled";
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SseEvent } from "@/shared/llm/sse";
import { useAiGeneration } from "@/hooks/use-ai-generation";
import { useConfirm } from "@/hooks/use-confirm";
import { useTouchUnitActivity } from "@/hooks/use-touch-unit-activity";
import { useUnitContentGenSync } from "@/hooks/use-unit-content-gen-sync";
import {
  clearMaterialLearningProgress,
  DEFAULT_MATERIAL_PRESENTATION,
  type MaterialPresentationState,
} from "@/shared/domain/material-presentation";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiPost,
  patchGoalFromSessionResponse,
  queryKeys,
} from "@/shared/api";
import { useGoal } from "@/hooks/api";
import { isMicroGoal } from "@/shared/domain/goal-kind";
import { isOverviewUnitKind } from "@/shared/domain/unit-tree";
import {
  clearUnitInstantMicro,
  isUnitInstantMicro,
} from "@/shared/goals/instant-micro-creation";
import {
  resolveNextLessonUnit,
  resolveNextLessonUnitInModule,
  resolveUnitHierarchy,
} from "@/shared/domain/unit-tree-build";
import type { LearningMaterialContent, SqPreview } from "@xue-learn/core/schemas";
import {
  FEATURE_FEYNMAN,
  postQuizNextStep,
  type PostQuizStep,
} from "@xue-learn/core/features";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { useT } from "@xue-learn/core/i18n";
import type { SessionNavStep } from "@/shared/graph/review-mode";
import { selectUnattemptedQuizSet } from "@/shared/graph/review-quiz-selection";
import { isUnitLearningDone } from "@/shared/domain/unit-status";
import {
  isAssessmentLocked,
  learningAccessFromEvent,
  parseLearningAccess,
  type LearningAccess,
} from "@/shared/domain/learning-access";
import type { UnitStatus } from "@/shared/domain/types";
import { consumeSsePost } from "@/shared/client/consume-sse";
import type { PracticeTab } from "../practice-hub.tsx";
import { useQuizSets } from "@/hooks/use-quiz-sets";
import type {
  ActiveQuizState,
  QuizSetSummary,
} from "@/shared/domain/quiz-sets";
import type { SocraticThread } from "@/shared/graph/socratic-threads";
import {
  CONTEXT_STREAM_OPERATIONS,
  REGEN_CONFIRM_MATERIAL_WITH_SECTIONS,
  REGEN_CONFIRM_SQ_WITH_CONTENT,
  RESET_REGEN_CONFIRM_CORNELL,
  RESET_REGEN_CONFIRM_MATERIAL,
  RESET_REGEN_CONFIRM_SQ,
  STEPS,
  STREAM_ACTIONS,
  STREAM_ACTION_CONTEXT,
  STREAM_START_STATUS,
} from "./constants.ts";
import type {
  ContextGenState,
  GenStreamContext,
  QuizAnswerValue,
  QuizExplainItemState,
  QuizGradeItem,
  QuizGradeView,
  QuizQ,
  RecallProgress,
  SessionActionResponse,
  Step,
  StructuredSubStep,
  StructuredTab,
  UnitWizardProps,
} from "./types.ts";
import {
  emptyContextGenState,
  genContextFromOperation,
  parseRecallProgress,
  quizExplainStateFromExplanations,
  structuredSubStepToTab,
  unitOperationForAction,
} from "./utils.ts";
import {
  applyIllustrationPatch as applyIllustrationPatchImpl,
  applyLearningCompletionState as applyLearningCompletionStateImpl,
  applyLearningReset as applyLearningResetImpl,
  applyQuizPayload as applyQuizPayloadImpl,
  applySocraticPayload as applySocraticPayloadImpl,
  applyStreamDone as applyStreamDoneImpl,
  type SessionApplyDeps,
} from "./use-unit-wizard-session-apply.ts";
import {
  handleGenStreamEvent,
  handleInstantMicroStreamEvent,
  type StreamEventDeps,
} from "./use-unit-wizard-stream-events.ts";
import { createGenStreamRenderers } from "./use-unit-wizard-gen-ui.tsx";
import type { MaterialCheckResult } from "../interactive-material-body.tsx";
import type {
  ScenarioTheaterContent,
  ScenarioTheaterPlayState,
  ScenarioTheaterRun,
} from "@/shared/domain/scenario-theater";
import {
  keepReadyUnitLabContent,
  unitLabContentFromPayload,
  type UnitLabContent,
} from "@xue-learn/core/shared/domain/unit-lab";

export function useUnitWizard({
  unitId,
  goalId,
  unitTitle,
  initialStep,
  startNewQuiz = false,
  instantMicro = false,
  instantRunId,
  sections: initialSections = [],
  unitKind,
}: UnitWizardProps) {
  const t = useT();
  const effectiveInstantMicro = instantMicro || isUnitInstantMicro(unitId);
  const instantPhaseRef = useRef<string>("micro");
  const [sections, setSections] = useState(initialSections);
  const [step, setStep] = useState<Step>(
    startNewQuiz
      ? "active_recall"
      : (initialStep as Step) || "structured_input",
  );
  const [structuredSubStep, setStructuredSubStep] =
    useState<StructuredSubStep>("sq");
  const [structuredTab, setStructuredTab] = useState<StructuredTab>(
    isOverviewUnitKind(unitKind) ? "material" : "sq",
  );
  /** Optional prompt after material: enter 会学剧场 without auto-navigating. */
  const [theaterOfferOpen, setTheaterOfferOpen] = useState(false);
  const [labOfferOpen, setLabOfferOpen] = useState(false);
  const [practiceTab, setPracticeTab] = useState<PracticeTab>("quiz");
  const [sectionMiniTestDrafts, setSectionMiniTestDrafts] = useState<
    Record<string, Record<string, number | number[] | boolean>>
  >({});
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionHydrationFailed, setSessionHydrationFailed] = useState(false);
  const [activeGenContext, setActiveGenContext] =
    useState<GenStreamContext | null>(null);
  const [genByContext, setGenByContext] = useState<
    Partial<Record<GenStreamContext, ContextGenState>>
  >({});
  const activeStreamOpsRef = useRef<Set<string>>(new Set());
  const startedNavigationQuizRef = useRef(false);
  const autoSqStartedRef = useRef<string | null>(null);
  const [genReconnectChecked, setGenReconnectChecked] = useState(false);

  useEffect(() => {
    setSections(initialSections);
    setSectionMiniTestDrafts({});
  }, [unitId]); // eslint-disable-line react-hooks/exhaustive-deps -- hydrate once per unit; regen updates local state

  const setSectionMiniTestDraft = useCallback(
    (sectionId: string, draft: Record<string, number | number[] | boolean>) => {
      setSectionMiniTestDrafts((current) => ({
        ...current,
        [sectionId]: draft,
      }));
    },
    [],
  );

  function patchGenContext(
    ctx: GenStreamContext,
    patch: Partial<ContextGenState>,
  ) {
    setGenByContext((prev) => ({
      ...prev,
      [ctx]: { ...emptyContextGenState(), ...prev[ctx], ...patch },
    }));
  }

  function contextGenState(ctx: GenStreamContext): ContextGenState {
    return genByContext[ctx] ?? emptyContextGenState();
  }

  function clearContextGenState(ctx: GenStreamContext) {
    setGenByContext((prev) => {
      if (!prev[ctx]) return prev;
      const next = { ...prev };
      delete next[ctx];
      return next;
    });
  }

  function finishStreamOperation(
    operation: string,
    ctx: GenStreamContext | null,
  ) {
    activeStreamOpsRef.current.delete(operation);
    if (!ctx) return;
    const stillActive = CONTEXT_STREAM_OPERATIONS[ctx].some((op) =>
      activeStreamOpsRef.current.has(op),
    );
    if (!stillActive) {
      clearContextGenState(ctx);
      setActiveGenContext((current) => (current === ctx ? null : current));
    }
  }

  function navigateForGenContext(context: GenStreamContext) {
    if (context === "sq") setStructuredTab("sq");
    else if (context === "material") setStructuredTab("material");
    else if (context === "notes") setStructuredTab("notes");
    else if (context === "quiz") setStep("active_recall");
    else if (context === "feynman" && FEATURE_FEYNMAN) setStep("feynman");
    else if (context === "socratic") setStep("socratic");
  }

  const queryClient = useQueryClient();
  const { data: goal } = useGoal(goalId);
  const isMicro = goal ? isMicroGoal(goal) : false;
  const isOverview = isOverviewUnitKind(unitKind);
  const hasKacom = !isMicro && !isOverview && goal?.learningMode !== "exploration";
  const wizardSteps = isOverview
    ? STEPS.filter((item) => item.id === "structured_input" || item.id === "complete")
    : STEPS;
  const unitHierarchy = useMemo(
    () => (goal ? resolveUnitHierarchy(goal, unitId) : undefined),
    [goal, unitId],
  );
  const currentModule = useMemo(
    () =>
      goal?.modules?.find((module) => module.id === unitHierarchy?.moduleId),
    [goal?.modules, unitHierarchy?.moduleId],
  );
  const nextUnit = useMemo(() => {
    if (!goal?.units || isMicroGoal(goal)) return null;
    const mapUnits = goal.units.filter((u) => u.unitKind !== "overview");
    if (currentModule) {
      return resolveNextLessonUnitInModule(mapUnits, unitId, currentModule.id);
    }
    return resolveNextLessonUnit(mapUnits, unitId);
  }, [currentModule, goal, unitId]);
  const completeReturn = useMemo(() => {
    if (mainlineEnabled() && !isMicro) return { path: `/goals/${goalId}?continue=1`, label: t("mainline.continue"), overviewPath: `/goals/${goalId}?view=plan`, overviewLabel: t("mainline.plan") };
    if (isOverview) {
      return {
        path: `/goals/${goalId}`,
        label: "返回学习旅程",
        overviewPath: `/goals/${goalId}`,
        overviewLabel: "查看学习旅程",
      };
    }
    if (isMicro) {
      return {
        path: "/goals",
        label: "返回目标列表",
        overviewPath: "/goals",
        overviewLabel: "查看目标列表",
      };
    }
    if (nextUnit) {
      return {
        path: `/goals/${goalId}/units/${nextUnit.id}`,
        label: "学习下个单元",
        overviewPath: `/goals/${goalId}`,
        overviewLabel: "查看学习旅程",
      };
    }
    if (currentModule) {
      return {
        path: `/goals/${goalId}/modules/${currentModule.id}`,
        label: "返回模块",
        overviewPath: `/goals/${goalId}`,
        overviewLabel: "查看学习旅程",
      };
    }
    return {
      path: `/goals/${goalId}`,
      label: "返回学习旅程",
      overviewPath: `/goals/${goalId}`,
      overviewLabel: "查看学习旅程",
    };
  }, [currentModule, goalId, isMicro, isOverview, nextUnit, t]);
  const { confirm } = useConfirm();
  const { syncFromEvent } = useUnitContentGenSync(goalId);
  const onGenStreamEventRef = useRef<
    ((operation: string) => (event: SseEvent) => void) | null
  >(null);
  const onInstantMicroStreamEventRef = useRef<
    ((event: SseEvent) => void) | null
  >(null);
  const aiGen = useAiGeneration({
    scope: "unit",
    scopeId: unitId,
    onRestore: (run) => {
      const ctx = genContextFromOperation(run.operation);
      if (!ctx) return;
      patchGenContext(ctx, {
        status: run.statusMessage ?? "",
        preview: run.tokenPreview ?? "",
      });
      if (run.partialEvent) {
        onGenStreamEventRef.current?.(run.operation)(run.partialEvent);
      }
      activeStreamOpsRef.current.add(run.operation);
      setActiveGenContext(ctx);
      navigateForGenContext(ctx);
    },
  });

  const goalInstantGen = useAiGeneration({
    scope: "goal",
    scopeId: goalId,
    onRestore: (run) => {
      if (run.operation !== "goal.instant_micro") return;
      const ctx = instantPhaseRef.current === "material" ? "material" : "sq";
      patchGenContext(ctx, {
        status: run.statusMessage ?? "",
        preview: run.tokenPreview ?? "",
      });
      if (run.partialEvent) {
        onInstantMicroStreamEventRef.current?.(run.partialEvent);
      }
      setActiveGenContext(ctx);
      navigateForGenContext(ctx);
    },
  });
  const goalInstantGenRef = useRef(goalInstantGen);
  goalInstantGenRef.current = goalInstantGen;

  function isContextLoading(ctx: GenStreamContext): boolean {
    if (
      effectiveInstantMicro &&
      goalInstantGen.isLoading("goal.instant_micro")
    ) {
      const instantCtx =
        instantPhaseRef.current === "material" ? "material" : "sq";
      if (ctx === instantCtx) return true;
    }
    return CONTEXT_STREAM_OPERATIONS[ctx].some((op) => aiGen.isLoading(op));
  }

  function genButtonLabel(
    ctx: GenStreamContext,
    idle: string,
    fallback?: string,
  ): string {
    if (!isContextLoading(ctx)) return idle;
    return fallback ?? t("generation.preparing");
  }

  function stopContextGeneration(ctx: GenStreamContext) {
    for (const op of CONTEXT_STREAM_OPERATIONS[ctx]) {
      if (aiGen.canStop(op)) void aiGen.stop(op);
    }
  }

  const sessionBusy = sessionLoading;
  const [hydrated, setHydrated] = useState(false);
  const [learningAccess, setLearningAccess] = useState<LearningAccess | null>(
    null,
  );
  const assessmentLocked =
    !isMicro && !isOverview && isAssessmentLocked(learningAccess);
  const activityTab =
    structuredTab === "notes"
      ? "cornell"
      : structuredTab === "map"
        ? "map"
        : structuredTab === "questions"
          ? "questions"
          : structuredTab === "material"
            ? "material"
            : "sq";
  const { touch } = useTouchUnitActivity(unitId, goalId);
  const materialContinueRef = useRef<HTMLDivElement>(null);
  const [sq, setSq] = useState<SqPreview | null>(null);
  const [sqQuestionAnswers, setSqQuestionAnswers] = useState<string[] | null>(
    null,
  );
  const [generatingSqAnswers, setGeneratingSqAnswers] = useState(false);
  const [material, setMaterial] = useState<LearningMaterialContent | null>(
    null,
  );
  const [materialCheckResults, setMaterialCheckResults] = useState<
    MaterialCheckResult[]
  >([]);
  const [materialSources, setMaterialSources] = useState<ContentSource[]>([]);
  const [scenarioTheaterContent, setScenarioTheaterContent] =
    useState<ScenarioTheaterContent | null>(null);
  const [scenarioTheaterPlay, setScenarioTheaterPlay] =
    useState<ScenarioTheaterPlayState | null>(null);
  const [scenarioTheaterCompletedOnce, setScenarioTheaterCompletedOnce] =
    useState(false);
  const [unitLabContent, setUnitLabContent] = useState<UnitLabContent | null>(
    null,
  );
  const [materialPresentation, setMaterialPresentation] =
    useState<MaterialPresentationState | null>(null);

  useEffect(() => {
    if (!hydrated || !assessmentLocked) return;
    let cancelled = false;
    let polling = false;
    const refresh = async () => {
      if (
        cancelled ||
        polling ||
        (typeof document !== "undefined" &&
          document.visibilityState === "hidden")
      ) {
        return;
      }
      polling = true;
      try {
        const access = parseLearningAccess(
          await apiGet(
            `/api/units/${encodeURIComponent(unitId)}/learning-access`,
          ),
        );
        if (!cancelled && access) setLearningAccess(access);
      } catch {
        // The normal session and generation streams remain authoritative.
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assessmentLocked, hydrated, unitId]);

  useEffect(() => {
    if (learningAccess?.assessmentMode !== "ready") return;
    void queryClient.invalidateQueries({
      queryKey: ["units", unitId, "learning-targets"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["goals", goalId, "cognitive-model"],
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.goals.detail(goalId),
    });
  }, [goalId, learningAccess?.assessmentMode, queryClient, unitId]);

  const prevActivityTabRef = useRef<string | null>(null);
  const materialPresentationRef = useRef(materialPresentation);

  useEffect(() => {
    materialPresentationRef.current = materialPresentation;
  }, [materialPresentation]);

  useEffect(() => {
    if (!hydrated) return;
    const prevTab = prevActivityTabRef.current;
    const payload: Parameters<typeof touch>[0] = { tab: activityTab };
    if (prevTab === "material" && activityTab !== "material") {
      const materialState = materialPresentationRef.current;
      if (materialState) {
        payload.slideIndex = materialState.slideIndex;
        payload.hasCompletedSlides = materialState.hasCompletedSlides;
        payload.sectionSteps = materialState.sectionSteps;
      }
    }
    touch(payload);
    prevActivityTabRef.current = activityTab;
  }, [activityTab, hydrated, touch]);

  const handlePresentationActivity = useCallback(
    (state: MaterialPresentationState) => {
      setMaterialPresentation(state);
      touch({
        tab: "material",
        slideIndex: state.slideIndex,
        hasCompletedSlides: state.hasCompletedSlides,
        sectionSteps: state.sectionSteps,
      });
    },
    [touch],
  );

  const handleAssistantSectionCursorActivity = useCallback(
    (sectionId: string, contentRevision: number, cursor: number) => {
      setMaterialPresentation((current) => {
        const base = current ?? DEFAULT_MATERIAL_PRESENTATION;
        const saved = base.sectionCursors?.[sectionId];
        if (
          saved?.contentRevision === contentRevision &&
          saved.cursor === cursor
        ) {
          return current;
        }
        return {
          ...base,
          sectionCursors: {
            ...(base.sectionCursors ?? {}),
            [sectionId]: { contentRevision, cursor },
          },
        };
      });
      touch({
        tab: "material",
        sectionId,
        sectionContentRevision: contentRevision,
        sectionCursor: cursor,
      });
    },
    [touch],
  );

  const [cornell, setCornell] = useState<{
    notes: string;
    cues: string;
    summary: string;
  } | null>(null);
  const [questions, setQuestions] = useState<QuizQ[]>([]);
  const [answers, setAnswers] = useState<Record<string, QuizAnswerValue>>({});
  const [quizGrade, setQuizGrade] = useState<QuizGradeView | null>(null);
  const [activeQuizSetId, setActiveQuizSetId] = useState<string | null>(null);
  const [quizReadOnly, setQuizReadOnly] = useState(false);
  const [quizExplainByIndex, setQuizExplainByIndex] = useState<
    Record<number, QuizExplainItemState>
  >({});
  const [recallProgress, setRecallProgress] = useState<RecallProgress | null>(
    null,
  );
  const [quizPostSubmitDismissed, setQuizPostSubmitDismissed] = useState(false);
  const quizExplainAbortRef = useRef<AbortController | null>(null);
  const activeExplainIndexRef = useRef<number | null>(null);
  const [feynmanText, setFeynmanText] = useState("");
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(
    null,
  );
  const [socraticThreads, setSocraticThreads] = useState<SocraticThread[]>([]);
  const [activeSocraticThreadId, setActiveSocraticThreadId] = useState<
    string | null
  >(null);
  const [socraticStreamText, setSocraticStreamText] = useState("");
  const socraticAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [unitStatus, setUnitStatus] = useState<UnitStatus>("available");
  const [isLearningDone, setIsLearningDone] = useState(false);
  const {
    sets: quizSets,
    loading: quizSetsLoading,
    refresh: refreshQuizSets,
    selectQuizSet,
  } = useQuizSets(unitId);

  function sessionApplyDeps(): SessionApplyDeps {
    return {
      unitId,
      goalId,
      isLearningDone,
      queryClient,
      refreshQuizSets,
      setLearningAccess,
      setIsLearningDone,
      setUnitStatus,
      setStep,
      setStructuredSubStep,
      setStructuredTab,
      setSq,
      setSqQuestionAnswers,
      setMaterial,
      setMaterialCheckResults,
      setMaterialSources,
      setMaterialPresentation,
      setCornell,
      setSections,
      setQuestions,
      setAnswers,
      setQuizGrade,
      setActiveQuizSetId,
      setQuizReadOnly,
      setQuizExplainByIndex,
      setFeedback,
      setFeynmanText,
      setSocraticThreads,
      setActiveSocraticThreadId,
    };
  }

  function applySocraticPayload(
    data: Record<string, unknown> | null | undefined,
  ) {
    applySocraticPayloadImpl(data, sessionApplyDeps());
  }

  function applyLearningReset(
    data: Record<string, unknown> | null | undefined,
  ) {
    applyLearningResetImpl(data, sessionApplyDeps());
  }

  function applyLearningCompletionState(
    data: Record<string, unknown> | null | undefined,
  ) {
    applyLearningCompletionStateImpl(data, sessionApplyDeps());
  }

  function applyQuizPayload(
    data: Parameters<typeof applyQuizPayloadImpl>[0],
    options?: Parameters<typeof applyQuizPayloadImpl>[1],
  ) {
    applyQuizPayloadImpl(data, options, sessionApplyDeps());
  }

  function applyStreamDone(data: Record<string, unknown>) {
    applyStreamDoneImpl(data, sessionApplyDeps(), {
      preserveStructuredTab: true,
    });
  }

  function applyIllustrationPatch(
    blockIndex: number,
    patch: { imageUrl: string; imageId: string },
  ) {
    applyIllustrationPatchImpl(setMaterial, blockIndex, patch);
  }

  function streamEventDeps(): StreamEventDeps {
    return {
      unitId,
      syncFromEvent,
      instantPhaseRef,
      navigateForGenContext,
      patchGenContext,
      applyStreamDone,
      applyIllustrationPatch,
      setLearningAccess,
      setGenByContext,
      setActiveGenContext,
      setSq,
      setStructuredSubStep,
      setStructuredTab,
      setMaterial,
      setSections,
      setQuestions,
      setQuizGrade,
      setQuizReadOnly,
      setStep,
      setPracticeTab,
      setCornell,
    };
  }

  const onGenStreamEvent = useCallback(
    (operation: string) => (event: SseEvent) => {
      handleGenStreamEvent(operation, event, streamEventDeps());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- patchGenContext is stable per render
    [unitId, syncFromEvent],
  );

  const onInstantMicroStreamEvent = useCallback(
    (event: SseEvent) => {
      handleInstantMicroStreamEvent(event, streamEventDeps());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyStreamDone closes over session helpers
    [syncFromEvent, unitId],
  );

  useEffect(() => {
    onGenStreamEventRef.current = onGenStreamEvent;
  }, [onGenStreamEvent]);

  useEffect(() => {
    onInstantMicroStreamEventRef.current = onInstantMicroStreamEvent;
  }, [onInstantMicroStreamEvent]);

  useEffect(() => {
    let cancelled = false;
    setSessionHydrationFailed(false);
    (async () => {
      let data: Record<string, unknown> & {
        currentStep?: string;
        structuredSubStep?: string;
        sq?: SqPreview;
        material?: LearningMaterialContent;
        materialSources?: unknown;
        cornell?: { notes: string; cues: string; summary: string };
        unitStatus?: unknown;
        isLearningDone?: unknown;
        materialPresentation?: MaterialPresentationState | null;
        socraticQuestion?: unknown;
        socraticThreads?: unknown;
        activeSocraticThreadId?: unknown;
        sqQuestionAnswers?: unknown;
        materialCheckResults?: unknown;
        learningAccess?: unknown;
        sections?: unknown;
        scenarioTheaterContent?: ScenarioTheaterContent | null;
        scenarioTheater?: {
          completedOnce?: boolean;
          activeRun?: ScenarioTheaterRun | null;
          currentSceneStatus?: ScenarioTheaterPlayState["currentSceneStatus"];
        } | null;
      };
      try {
        data = await apiGet(`/api/units/${unitId}/session`);
      } catch (e) {
        // A failed session read is not an empty session. Auto-generating from
        // blank client state can invalidate server-owned material/theater that
        // the failed response simply did not hydrate.
        if (!cancelled) {
          setSessionHydrationFailed(true);
          setError(e instanceof Error ? e.message : "学习会话加载失败");
          setHydrated(true);
        }
        return;
      }
      if (cancelled) return;

      const contentRevision =
        typeof (data as { contentRevision?: unknown }).contentRevision ===
        "number"
          ? (data as { contentRevision: number }).contentRevision
          : 0;
      if (contentRevision > 0 || data.sq == null || data.material == null) {
        try {
          const { loadUnitStableContent } =
            await import("@/shared/api/unit-content");
          const content = await loadUnitStableContent(unitId, contentRevision);
          if (cancelled) return;
          data = {
            ...data,
            sq: (content.sq as SqPreview | null | undefined) ?? data.sq,
            material:
              (content.material as
                LearningMaterialContent | null | undefined) ?? data.material,
            materialSources:
              content.materialSources ?? data.materialSources ?? [],
            scenarioTheaterContent:
              content.scenarioTheaterContent ??
              data.scenarioTheaterContent ??
              null,
            unitLabContent:
              content.unitLabContent ?? data.unitLabContent ?? null,
            contentRevision: content.contentRevision,
          };
        } catch (e) {
          // Stable generated bodies are authoritative. Do not interpret a
          // failed content read as an empty Survey and regenerate it, because
          // regeneration also invalidates an already prepared theater.
          setSessionHydrationFailed(true);
          setError(e instanceof Error ? e.message : "学习内容加载失败");
        }
      }
      if (cancelled) return;

      const sub = isOverview
        ? ((data.structuredSubStep as StructuredSubStep) || "material")
        : (data.structuredSubStep as StructuredSubStep) || "sq";
      let nextStep = (data.currentStep as Step) || "structured_input";
      if (isOverview && nextStep !== "complete") {
        nextStep = "structured_input";
      }
      const learningDone =
        data.isLearningDone !== undefined
          ? Boolean(data.isLearningDone)
          : isUnitLearningDone(String(data.unitStatus ?? ""));
      if (!FEATURE_FEYNMAN && nextStep === "feynman") {
        nextStep = learningDone ? "socratic" : "complete";
      }

      setStep(nextStep);
      setStructuredSubStep(isOverview && sub === "sq" ? "material" : sub);
      setStructuredTab(
        isOverview && structuredSubStepToTab(sub) === "sq"
          ? "material"
          : structuredSubStepToTab(sub),
      );
      setSq(data.sq ?? null);
      setSqQuestionAnswers(
        Array.isArray(data.sqQuestionAnswers)
          ? (data.sqQuestionAnswers as string[])
          : null,
      );
      setMaterial(data.material ?? null);
      if (Array.isArray(data.sections)) {
        setSections(data.sections as typeof sections);
      }
      setMaterialCheckResults(
        Array.isArray(data.materialCheckResults)
          ? (data.materialCheckResults as MaterialCheckResult[])
          : [],
      );
      setMaterialSources(
        Array.isArray(data.materialSources)
          ? (data.materialSources as ContentSource[])
          : [],
      );
      const theaterContent = data.scenarioTheaterContent ?? null;
      setScenarioTheaterContent(theaterContent);
      setScenarioTheaterCompletedOnce(
        Boolean(data.scenarioTheater?.completedOnce),
      );
      if (theaterContent?.definition && data.scenarioTheater?.activeRun) {
        setScenarioTheaterPlay({
          definition: theaterContent.definition,
          run: data.scenarioTheater.activeRun,
          currentSceneStatus: data.scenarioTheater.currentSceneStatus,
          completedOnce: Boolean(data.scenarioTheater.completedOnce),
        });
      } else {
        setScenarioTheaterPlay(null);
      }
      setUnitLabContent((prev) =>
        keepReadyUnitLabContent(prev, unitLabContentFromPayload(data)),
      );
      setMaterialPresentation(data.materialPresentation ?? null);
      setCornell(data.cornell ?? null);
      setUnitStatus((data.unitStatus as UnitStatus) ?? "available");
      setIsLearningDone(learningDone);
      setLearningAccess(parseLearningAccess(data.learningAccess));
      applySocraticPayload(data);
      if (
        Array.isArray(data.socraticThreads) &&
        data.socraticThreads.length === 0 &&
        typeof data.socraticQuestion === "string" &&
        data.socraticQuestion
      ) {
        setSocraticThreads([
          {
            id: "legacy",
            label: "薄弱点修正",
            source: "general",
            messages: [
              {
                role: "assistant",
                content: data.socraticQuestion,
                createdAt: new Date().toISOString(),
              },
            ],
            done: false,
            turn: 1,
            updatedAt: new Date().toISOString(),
          },
        ]);
      }
      const activeQuiz = data.activeQuiz as ActiveQuizState | null | undefined;
      if (activeQuiz?.questions?.length) {
        applyQuizPayload(
          {
            questions: activeQuiz.questions as QuizQ[],
            quizSetId: activeQuiz.quizSetId ?? undefined,
            quizGrade: activeQuiz.quizGrade,
            quizExplanations: activeQuiz.quizExplanations,
            readOnly: false,
          },
          { keepStep: true },
        );
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  async function callSessionStream(
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<SessionActionResponse | null> {
    if (
      assessmentLocked &&
      [
        "generate_quiz",
        "generate_feynman",
        "start_socratic",
        "socratic",
        "finish_socratic",
      ].includes(action)
    ) {
      setError("认知模型仍在准备，阅读不受影响；测验稍后开放。");
      return null;
    }
    setError("");
    const operation = unitOperationForAction(action);
    const ctx = STREAM_ACTION_CONTEXT[action] ?? null;
    if (ctx) {
      patchGenContext(ctx, {
        ...emptyContextGenState(),
        status: STREAM_START_STATUS[action]
          ? t(STREAM_START_STATUS[action])
          : "",
        ...(action === "generate_sq" ? { phase: "sq_preview" } : {}),
      });
      activeStreamOpsRef.current.add(operation);
      setActiveGenContext(ctx);
      navigateForGenContext(ctx);
      if (action === "generate_sq") {
        setSq(null);
        setSqQuestionAnswers(null);
        setStructuredSubStep("sq");
        setStructuredTab("sq");
        setMaterial(null);
        setMaterialCheckResults([]);
        setMaterialSources([]);
        setMaterialPresentation(DEFAULT_MATERIAL_PRESENTATION);
        setCornell(null);
        setSections([]);
      }
      if (action === "generate_material") {
        clearMaterialLearningProgress(unitId);
        setStructuredSubStep("material");
        setStructuredTab("material");
        setMaterial(null);
        setMaterialPresentation(DEFAULT_MATERIAL_PRESENTATION);
        setMaterialSources([]);
      }
      if (action === "generate_cornell") {
        setCornell(null);
        setStructuredSubStep("cornell");
        setStructuredTab("notes");
      }
      if (action === "generate_quiz") {
        setQuestions([]);
        setQuizGrade(null);
        setQuizReadOnly(false);
        setAnswers({});
        setActiveQuizSetId(null);
        setQuizPostSubmitDismissed(false);
        setPracticeTab("quiz");
      }
    }
    try {
      const done = await aiGen.startPost(
        `/api/units/${unitId}/session/stream`,
        { action, ...extra },
        onGenStreamEvent(operation),
        operation,
      );
      if (!done || done.type !== "done") return null;
      const { type: _, ...data } = done;
      applyStreamDone(data);
      captureRecallProgress(data);
      return data as SessionActionResponse;
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误");
      return null;
    } finally {
      finishStreamOperation(operation, ctx);
    }
  }

  async function callSession(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<SessionActionResponse | null> {
    if (
      assessmentLocked &&
      [
        "generate_quiz",
        "submit_quiz",
        "submit_material_check",
        "submit_section_mini_test",
        "submit_feynman",
        "start_socratic",
        "select_socratic_thread",
        "socratic",
        "finish_socratic",
        "complete",
      ].includes(action)
    ) {
      setError("认知模型仍在准备，阅读不受影响；测验稍后开放。");
      return null;
    }
    if (STREAM_ACTIONS.has(action)) {
      return callSessionStream(action, payload);
    }
    setSessionLoading(true);
    setError("");
    try {
      const data = await apiPost<SessionActionResponse>(
        `/api/units/${unitId}/session`,
        { action, payload },
      );
      patchGoalFromSessionResponse(queryClient, goalId, unitId, data);
      applyLearningCompletionState(data);
      const lab = unitLabContentFromPayload(data);
      if (lab) {
        setUnitLabContent((prev) => keepReadyUnitLabContent(prev, lab));
      }
      if (action === "complete") {
        void queryClient.invalidateQueries({
          queryKey: ["profile", "learning-state"],
        });
      }
      if (action === "generate_flashcards") {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.flashcards.deck(unitId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.flashcards.all,
        });
      }
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误");
      return null;
    } finally {
      setSessionLoading(false);
    }
  }

  useEffect(() => {
    autoSqStartedRef.current = null;
    setGenReconnectChecked(false);
  }, [unitId]);

  useEffect(() => {
    if (structuredTab !== "sq" && !aiGen.isLoading("unit.generate_sq")) {
      autoSqStartedRef.current = null;
    }
  }, [structuredTab, aiGen]);

  useEffect(() => {
    if (!hydrated) return;
    let stale = false;
    setGenReconnectChecked(false);
    void aiGen
      .reconnectActive(
        (event, operation = "") => {
          if (stale) return;
          onGenStreamEvent(operation)(event);
        },
        (op) => op.startsWith("unit."),
      )
      .then((results) => {
        if (stale) return;
        for (const done of results) {
          if (done?.type === "done") {
            const { type: _, ...data } = done;
            applyStreamDone(data);
          }
        }
      })
      .catch((e) => {
        if (!stale) {
          setError(e instanceof Error ? e.message : "重连失败");
        }
      })
      .finally(() => {
        if (!stale) setGenReconnectChecked(true);
      });
    return () => {
      stale = true;
      void aiGen.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect once per unit
  }, [hydrated, unitId]);

  useEffect(() => {
    if (!hydrated || !effectiveInstantMicro) return;
    let stale = false;
    void (async () => {
      try {
        const gen = goalInstantGenRef.current;
        if (instantRunId) {
          await gen.followRun(
            instantRunId,
            (event) => {
              if (!stale) onInstantMicroStreamEventRef.current?.(event);
            },
            "goal.instant_micro",
          );
        } else {
          const results = await gen.reconnectActive(
            (event) => {
              if (!stale) onInstantMicroStreamEventRef.current?.(event);
            },
            (op) => op === "goal.instant_micro",
          );
          for (const done of results) {
            if (done?.type === "done" && !stale) {
              onInstantMicroStreamEventRef.current?.(done);
            }
          }
        }
      } catch (e) {
        if (stale) return;
        try {
          const data = await apiGet<Record<string, unknown>>(
            `/api/units/${unitId}/session`,
          );
          if (stale) return;
          const restoredSq = data.sq as SqPreview | undefined;
          const restoredMaterial = data.material as
            LearningMaterialContent | undefined;
          if (restoredSq || restoredMaterial) {
            if (restoredSq) {
              setSq(restoredSq);
              setStructuredSubStep("sq");
              setStructuredTab("sq");
            }
            if (restoredMaterial) {
              setMaterial(restoredMaterial);
              setStructuredSubStep("material");
              setStructuredTab("material");
            }
            clearUnitInstantMicro(unitId);
            return;
          }
        } catch {
          // Preserve the original stream error when reconciliation also fails.
        }
        setError(e instanceof Error ? e.message : "极速轻课生成重连失败");
      }
    })();
    return () => {
      stale = true;
      goalInstantGenRef.current.detach("goal.instant_micro");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow once per unit/instant session
  }, [effectiveInstantMicro, goalId, hydrated, instantRunId, unitId]);

  async function submitMaterialCheck(input: {
    blockIndex: number;
    checkId?: string;
    itemIndex?: number;
    answer: number | number[] | boolean;
  }): Promise<MaterialCheckResult | null> {
    if (assessmentLocked) {
      setError("认知模型仍在准备，正文可继续阅读；验证记录稍后开放。");
      return null;
    }
    try {
      const result = await apiPost<MaterialCheckResult>(
        `/api/units/${unitId}/session`,
        {
          action: "submit_material_check",
          payload: input,
        },
      );
      if (input.checkId && result?.checkId) {
        setMaterialCheckResults((current) => [
          ...current.filter((item) => item.checkId !== result.checkId),
          result,
        ]);
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "正文互动验证失败");
      return null;
    }
  }

  async function submitSectionMiniTest(input: {
    sectionId: string;
    answers: Record<string, number | number[] | boolean>;
  }): Promise<{ score: number; results: MaterialCheckResult[] } | null> {
    if (assessmentLocked) {
      setError("认知模型仍在准备，测验稍后开放。");
      return null;
    }
    try {
      const result = await apiPost<{
        score: number;
        results: MaterialCheckResult[];
      }>(`/api/units/${unitId}/session`, {
        action: "submit_section_mini_test",
        payload: input,
      });
      if (Array.isArray(result?.results)) {
        setMaterialCheckResults((current) => {
          const next = [...current];
          for (const item of result.results) {
            const index = next.findIndex(
              (entry) => entry.checkId === item.checkId,
            );
            if (index >= 0) next[index] = item;
            else next.push(item);
          }
          return next;
        });
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "小节测验提交失败");
      return null;
    }
  }

  async function generateSq() {
    const data = await callSession("generate_sq");
    applyLearningReset(data);
    if (data?.sq) {
      setSq(data.sq);
      setStructuredSubStep("sq");
      setStructuredTab("sq");
      if (data.clearedMaterial || data.clearedSections) {
        setMaterial(null);
        setMaterialCheckResults([]);
        setMaterialSources([]);
        setSections([]);
      }
      if (data.clearedCornell) setCornell(null);
    }
  }

  useEffect(() => {
    if (
      effectiveInstantMicro ||
      isOverview ||
      !hydrated ||
      sessionHydrationFailed ||
      !genReconnectChecked ||
      step !== "structured_input" ||
      structuredTab !== "sq" ||
      sq ||
      isContextLoading("sq")
    ) {
      return;
    }
    const autoKey = `${unitId}:sq`;
    if (autoSqStartedRef.current === autoKey) return;
    autoSqStartedRef.current = autoKey;
    void generateSq();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-start once per survey tab visit
  }, [
    hydrated,
    sessionHydrationFailed,
    genReconnectChecked,
    step,
    structuredTab,
    sq,
    unitId,
    aiGen,
  ]);

  async function regenerateSq() {
    const hasSectionPlan = sections.some((section) => !section.legacy);
    if (isLearningDone) {
      const ok = await confirm({
        title: "重新生成预习",
        description: RESET_REGEN_CONFIRM_SQ,
        variant: "destructive",
      });
      if (!ok) return;
    } else if (material || cornell || hasSectionPlan) {
      const ok = await confirm({
        title: "重新生成预习",
        description: REGEN_CONFIRM_SQ_WITH_CONTENT,
        variant: "destructive",
      });
      if (!ok) return;
    }
    await generateSq();
  }

  async function generateMaterial() {
    const data = await callSession("generate_material");
    applyLearningReset(data);
    if (Array.isArray(data?.sections)) {
      setSections(data.sections as typeof sections);
    }
    if (data?.material) {
      setMaterial(data.material);
      setMaterialCheckResults([]);
      if (Array.isArray(data.materialSources)) {
        setMaterialSources(data.materialSources as ContentSource[]);
      }
      setStructuredSubStep("material");
      setStructuredTab("material");
      if (data.clearedCornell) setCornell(null);
    }
  }

  async function regenerateMaterial() {
    const hasSectionPlan = sections.some((section) => !section.legacy);
    if (isLearningDone) {
      const ok = await confirm({
        title: "重新生成正文",
        description: RESET_REGEN_CONFIRM_MATERIAL,
        variant: "destructive",
      });
      if (!ok) return;
    } else if (cornell || hasSectionPlan) {
      const ok = await confirm({
        title: "重新生成正文",
        description: hasSectionPlan
          ? REGEN_CONFIRM_MATERIAL_WITH_SECTIONS
          : "重新生成学习正文将删除已有学习笔记，确定继续吗？",
        variant: "destructive",
      });
      if (!ok) return;
    }
    await generateMaterial();
  }

  async function finishMaterialReading() {
    if (isOverview) {
      const section =
        sections.find((item) => item.sectionKind === "content") ??
        sections[0];
      if (
        section &&
        section.status !== "completed" &&
        section.status !== "skipped"
      ) {
        await callSession("complete_section", { sectionId: section.id });
      }
      const data = await callSession("complete");
      if (data?.nextStep === "complete") setStep("complete");
      return;
    }
    const data = await callSession("finish_material_reading");
    if (
      data?.structuredSubStep === "questions" ||
      data?.structuredSubStep === "theater"
    ) {
      // Prefer guiding questions. Theater may still be offered as optional practice
      // (including legacy sessions that still report structuredSubStep "theater").
      setStructuredSubStep("questions");
      setStructuredTab("questions");
      if (
        data.scenarioTheaterOffered === true ||
        data.scenarioTheaterRequired === true ||
        data.structuredSubStep === "theater"
      ) {
        setTheaterOfferOpen(true);
      }
      if (data.unitLabOffered === true) {
        setLabOfferOpen(true);
      }
    } else if (!data) {
      setStructuredSubStep("material");
      setStructuredTab("material");
    }
  }

  async function prepareScenarioTheater(force = false) {
    const data = await callSessionStream("prepare_scenario_theater", {
      force,
    });
    const theater = data?.scenarioTheater as
      | {
          definition?: ScenarioTheaterContent["definition"];
          revision?: number;
          status?: string;
        }
      | undefined;
    if (theater?.definition) {
      setScenarioTheaterContent({
        status: theater?.status === "ready" ? "ready" : "prepared",
        recommended: scenarioTheaterContent?.recommended ?? false,
        recommendation: scenarioTheaterContent?.recommendation ?? "",
        revision: theater.revision ?? 1,
        definition: theater.definition,
      });
    }
    return data;
  }

  async function prepareUnitLab(force = false) {
    setUnitLabContent((prev) => ({
      status: "preparing",
      recommended: prev?.recommended ?? false,
      recommendation: prev?.recommendation ?? "",
      revision: prev?.revision,
      definition: prev?.definition ?? null,
      generationError: "",
    }));
    const data = await callSessionStream("prepare_unit_lab", { force });
    let fromContent: UnitLabContent | null = null;
    const revision =
      typeof data?.contentRevision === "number" ? data.contentRevision : 0;
    if (revision > 0) {
      try {
        const { loadUnitStableContent } =
          await import("@/shared/api/unit-content");
        const content = await loadUnitStableContent(unitId, revision);
        fromContent = content.unitLabContent ?? null;
      } catch {
        // Stream payload is the fallback when the revisioned content read fails.
      }
    }
    const lab =
      (fromContent?.definition?.items?.length ? fromContent : null) ??
      unitLabContentFromPayload(data as Record<string, unknown>) ??
      fromContent;
    setUnitLabContent((prev) => {
      if (lab) {
        const next = keepReadyUnitLabContent(prev, lab);
        if (lab.status === "failed" && !lab.definition?.items?.length) {
          return {
            ...lab,
            recommended: lab.recommended ?? prev?.recommended ?? false,
            recommendation: lab.recommendation ?? prev?.recommendation ?? "",
            generationError:
              lab.generationError || prev?.generationError || "",
          };
        }
        return next;
      }
      return {
        status: "failed",
        recommended: prev?.recommended ?? false,
        recommendation: prev?.recommendation ?? "",
        revision: prev?.revision,
        definition: prev?.definition ?? null,
        generationError: prev?.generationError || "",
      };
    });
    return data;
  }

  async function startUnitLab() {
    await callSession("start_unit_lab");
  }

  async function completeUnitLab() {
    await callSession("complete_unit_lab");
  }

  async function regenerateUnitLabItem(itemIndex: number) {
    const response = await apiPost<{
      item: NonNullable<UnitLabContent["definition"]>["items"][number];
      revision: number;
    }>(`/api/units/${unitId}/lab/components/${itemIndex}/regenerate`);
    setUnitLabContent((prev) => {
      if (!prev?.definition) return prev;
      return {
        ...prev,
        status: "ready",
        revision: response.revision,
        definition: {
          ...prev.definition,
          items: prev.definition.items.map((item, index) =>
            index === itemIndex ? response.item : item,
          ),
        },
      };
    });
    return response.item;
  }

  async function generateScenarioTheaterScene(runId: string) {
    const data = await callSessionStream("generate_scenario_scene", {
      runId,
    });
    const play = data?.scenarioTheater as ScenarioTheaterPlayState | undefined;
    if (play?.definition && play.run) {
      setScenarioTheaterPlay(play);
      return play;
    }
    return null;
  }

  async function startScenarioTheaterPlay() {
    const data = await callSession("start_scenario_theater");
    const play = data?.scenarioTheater as ScenarioTheaterPlayState | undefined;
    if (play?.definition && play.run) {
      setScenarioTheaterPlay(play);
      setScenarioTheaterCompletedOnce(Boolean(play.completedOnce));
      return play;
    }
    return null;
  }

  async function chooseScenarioTheaterChoice(
    sceneId: string,
    choiceId: string,
  ) {
    const run = scenarioTheaterPlay?.run;
    if (!run) return null;
    const data = await callSession("choose_scenario_option", {
      runId: run.id,
      runVersion: run.runVersion,
      sceneId,
      choiceId,
    });
    const play = data?.scenarioTheater as ScenarioTheaterPlayState | undefined;
    if (play?.definition && play.run) {
      setScenarioTheaterPlay(play);
      if (play.run.status === "completed") {
        setScenarioTheaterCompletedOnce(true);
      }
      return play;
    }
    return null;
  }

  async function restartScenarioTheaterPlay() {
    const data = await callSession("restart_scenario_theater");
    const play = data?.scenarioTheater as ScenarioTheaterPlayState | undefined;
    if (play?.definition && play.run) {
      setScenarioTheaterPlay(play);
      return play;
    }
    return null;
  }

  async function generateSqAnswers() {
    if (!sq?.questions.length || generatingSqAnswers) return;
    setGeneratingSqAnswers(true);
    setError("");
    try {
      const data = await callSession("generate_sq_answers");
      if (Array.isArray(data?.sqQuestionAnswers)) {
        setSqQuestionAnswers(data.sqQuestionAnswers as string[]);
      }
    } finally {
      setGeneratingSqAnswers(false);
    }
  }

  async function generateCornellNotes() {
    if (isLearningDone) {
      const ok = await confirm({
        title: "重新生成笔记",
        description: RESET_REGEN_CONFIRM_CORNELL,
        variant: "destructive",
      });
      if (!ok) return;
    }
    const data = await callSession("generate_cornell");
    applyLearningReset(data);
    if (data?.cornell) {
      setCornell(data.cornell);
      setStructuredSubStep("cornell");
      setStructuredTab("notes");
    }
  }

  function captureRecallProgress(
    data: Record<string, unknown> | null | undefined,
  ) {
    const parsed = parseRecallProgress(data?.recallProgress);
    if (parsed) setRecallProgress(parsed);
  }

  async function submitQuiz() {
    if (isContextLoading("quiz")) return;
    const data = await callSession("submit_quiz", { answers });
    if (data?.score !== undefined && data?.results) {
      setQuizPostSubmitDismissed(false);
      setQuizExplainByIndex({});
      setQuizGrade({
        score: data.score as number,
        weakTags: (data.weakTags as string[]) ?? [],
        results: data.results as QuizGradeItem[],
        nextStep:
          (data.nextStep as PostQuizStep) ??
          postQuizNextStep(data.score as number, isLearningDone),
      });
      setQuizReadOnly(false);
    }
    captureRecallProgress(data);
    if (typeof data?.quizSetId === "string") {
      setActiveQuizSetId(data.quizSetId);
    }
    if (data?.questions) setQuestions(data.questions as QuizQ[]);
    void refreshQuizSets();
  }

  async function explainQuizQuestion(questionIndex: number) {
    if (!quizGrade) return;
    const graded = quizGrade.results.find((row) => row.index === questionIndex);
    if (!graded) return;
    if (quizExplainByIndex[questionIndex]?.loading) return;

    quizExplainAbortRef.current?.abort();
    const ac = new AbortController();
    quizExplainAbortRef.current = ac;
    activeExplainIndexRef.current = questionIndex;
    setError("");

    setQuizExplainByIndex((prev) => ({
      ...prev,
      [questionIndex]: { text: "", loading: true },
    }));

    try {
      const done = await consumeSsePost(
        `/api/units/${unitId}/session/stream`,
        { action: "explain_quiz_wrong", questionIndex },
        (event) => {
          if (event.type === "token") {
            setQuizExplainByIndex((prev) => {
              const current = prev[questionIndex] ?? {
                text: "",
                loading: true,
              };
              return {
                ...prev,
                [questionIndex]: {
                  text: current.text + event.delta,
                  loading: true,
                },
              };
            });
          }
        },
        ac.signal,
      );

      if (done?.type === "done") {
        const explanation =
          typeof done.explanation === "string" ? done.explanation : "";
        const resolvedIndex =
          typeof done.questionIndex === "number"
            ? done.questionIndex
            : questionIndex;
        const savedExplanations =
          done.quizExplanations &&
          typeof done.quizExplanations === "object" &&
          !Array.isArray(done.quizExplanations)
            ? (done.quizExplanations as Record<number, string>)
            : undefined;
        setQuizExplainByIndex((prev) => ({
          ...prev,
          ...quizExplainStateFromExplanations(savedExplanations),
          [resolvedIndex]: { text: explanation, loading: false },
        }));
      } else {
        setQuizExplainByIndex((prev) => {
          const next = { ...prev };
          delete next[questionIndex];
          return next;
        });
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : "题目解析失败");
      }
      setQuizExplainByIndex((prev) => {
        const next = { ...prev };
        delete next[questionIndex];
        return next;
      });
    } finally {
      if (quizExplainAbortRef.current === ac) {
        quizExplainAbortRef.current = null;
        activeExplainIndexRef.current = null;
      }
    }
  }

  function stopQuizExplain() {
    const index = activeExplainIndexRef.current;
    quizExplainAbortRef.current?.abort();
    quizExplainAbortRef.current = null;
    activeExplainIndexRef.current = null;
    if (index == null) return;
    setQuizExplainByIndex((prev) => {
      const current = prev[index];
      if (!current) return prev;
      return {
        ...prev,
        [index]: { ...current, loading: false },
      };
    });
  }

  async function callSocraticStream(
    action:
      | "socratic"
      | "start_socratic"
      | "select_socratic_thread"
      | "finish_socratic",
    extra: Record<string, unknown> = {},
    options?: { optimisticUserAnswer?: string },
  ): Promise<SessionActionResponse | null> {
    if (assessmentLocked) {
      setError("认知模型仍在准备，引导修正稍后开放。");
      return null;
    }
    socraticAbortRef.current?.abort();
    const ac = new AbortController();
    socraticAbortRef.current = ac;
    setSessionLoading(true);
    setSocraticStreamText("");
    setError("");

    if (action === "socratic" && options?.optimisticUserAnswer) {
      const answer = options.optimisticUserAnswer;
      setSocraticThreads((prev) =>
        prev.map((thread) =>
          thread.id === activeSocraticThreadId
            ? {
                ...thread,
                messages: [
                  ...thread.messages,
                  {
                    role: "user" as const,
                    content: answer,
                    createdAt: new Date().toISOString(),
                  },
                ],
                updatedAt: new Date().toISOString(),
              }
            : thread,
        ),
      );
    }

    try {
      const done = await consumeSsePost(
        `/api/units/${unitId}/session/stream`,
        { action, ...extra },
        (event) => {
          if (event.type === "learning_access") {
            setLearningAccess(learningAccessFromEvent(event));
          }
          if (event.type === "message") {
            setSocraticStreamText((prev) => prev + event.delta);
          }
        },
        ac.signal,
      );
      if (!done || done.type !== "done") return null;
      const { type: _, ...data } = done;
      patchGoalFromSessionResponse(queryClient, goalId, unitId, data);
      applyLearningCompletionState(data);
      applySocraticPayload(data);
      return data as SessionActionResponse;
    } catch (e) {
      if (action === "socratic" && options?.optimisticUserAnswer) {
        setSocraticThreads((prev) =>
          prev.map((thread) =>
            thread.id === activeSocraticThreadId
              ? {
                  ...thread,
                  messages: thread.messages.filter(
                    (message) =>
                      !(
                        message.role === "user" &&
                        message.content === options.optimisticUserAnswer
                      ),
                  ),
                }
              : thread,
          ),
        );
      }
      setError(e instanceof Error ? e.message : "未知错误");
      return null;
    } finally {
      setSessionLoading(false);
      setSocraticStreamText("");
      if (socraticAbortRef.current === ac) {
        socraticAbortRef.current = null;
      }
    }
  }

  async function startSocratic() {
    const data = await callSocraticStream("start_socratic");
    if (data?.nextStep) setStep(data.nextStep as Step);
  }

  async function selectSocraticThread(threadId: string) {
    const data = await callSocraticStream("select_socratic_thread", {
      threadId,
    });
    if (data?.nextStep) setStep(data.nextStep as Step);
  }

  async function finishSocratic() {
    const data = await callSocraticStream("finish_socratic");
    if (data?.nextStep) setStep(data.nextStep as Step);
  }

  async function continueAfterQuiz(next: PostQuizStep) {
    if (!quizGrade) return;
    setQuizGrade(null);
    if (next === "socratic") {
      setSocraticThreads([]);
      setActiveSocraticThreadId(null);
    }
    setStep(next);
  }

  async function goToStep(target: SessionNavStep) {
    if (assessmentLocked && target !== "structured_input") {
      setError("认知模型仍在准备，测验与完成记录稍后开放。");
      return;
    }
    // Heal stale in-session state: complete UI can render before isLearningDone flips.
    const canNavigate =
      isLearningDone || step === "complete" || isUnitLearningDone(unitStatus);
    if (!canNavigate) return;
    if (!isLearningDone) setIsLearningDone(true);
    const data = await callSession("set_step", { step: target });
    if (data?.currentStep) setStep(data.currentStep as Step);
    if (target === "structured_input") {
      setStructuredSubStep("done");
      setStructuredTab("notes");
    }
    if (target === "socratic") {
      applySocraticPayload(data);
    }
  }

  useEffect(() => {
    if (
      !hydrated ||
      step !== "socratic" ||
      socraticThreads.length > 0 ||
      sessionBusy ||
      assessmentLocked
    ) {
      return;
    }
    void startSocratic();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap when landing on socratic without threads
  }, [assessmentLocked, hydrated, step, socraticThreads.length]);

  async function practiceAnotherBatch() {
    setQuizPostSubmitDismissed(false);
    await loadQuiz();
  }

  function dismissRecallPractice() {
    setQuizPostSubmitDismissed(true);
  }

  async function loadQuiz() {
    if (!material) {
      try {
        const content = await apiGet<{
          material?: LearningMaterialContent | null;
          materialSources?: unknown;
        }>(`/api/units/${unitId}/content`);
        if (!content.material) {
          setError("学习内容仍在准备，请稍后重试。");
          return;
        }
        setMaterial(content.material);
        if (Array.isArray(content.materialSources)) {
          setMaterialSources(content.materialSources as ContentSource[]);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "学习内容载入失败");
        return;
      }
    }
    await callSession("generate_quiz");
  }

  useEffect(() => {
    if (!startNewQuiz || !hydrated || startedNavigationQuizRef.current) return;
    if (assessmentLocked) return;
    if (quizSetsLoading) return;
    startedNavigationQuizRef.current = true;
    setStep("active_recall");
    setPracticeTab("quiz");

    // Keep an unfinished attempt exactly as the learner left it.
    if (questions.length > 0 && !quizGrade && !quizReadOnly) return;

    const reusableSet = selectUnattemptedQuizSet(quizSets);
    if (!reusableSet) {
      void loadQuiz();
      return;
    }

    void selectQuizSet(reusableSet.id).then((data) => {
      if (!data?.questions) return;
      applyQuizPayload({
        questions: data.questions as QuizQ[],
        quizSetId: data.quizSetId,
        readOnly: false,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for each review-entry intent
  }, [assessmentLocked, hydrated, quizSetsLoading, startNewQuiz]);

  async function openQuizSet(set: QuizSetSummary, viewLatestAttempt = false) {
    const data = await selectQuizSet(
      set.id,
      viewLatestAttempt ? "latest" : undefined,
    );
    if (!data?.questions) return;
    applyQuizPayload({
      questions: data.questions as QuizQ[],
      quizSetId: data.quizSetId,
      quizGrade: data.quizGrade,
      quizExplanations: data.quizExplanations,
      readOnly: viewLatestAttempt ? Boolean(data.readOnly) : false,
    });
    setStep("active_recall");
  }

  async function retryCurrentQuizSet() {
    if (!activeQuizSetId) return;
    const data = await selectQuizSet(activeQuizSetId);
    if (!data?.questions) return;
    applyQuizPayload({
      questions: data.questions as QuizQ[],
      quizSetId: data.quizSetId,
      readOnly: false,
    });
  }

  async function submitFeynman() {
    const data = await callSession("submit_feynman", { userText: feynmanText });
    if (data?.feedback) setFeedback(data.feedback);
    if (data?.nextStep) {
      setStep(data.nextStep as Step);
      if (data.nextStep === "socratic") {
        applySocraticPayload(data);
      }
    }
  }

  async function socraticTurn(answer: string) {
    const data = await callSocraticStream(
      "socratic",
      { answer },
      { optimisticUserAnswer: answer },
    );
    if (data?.nextStep) setStep(data.nextStep as Step);
  }

  async function finishDrills() {
    if (isLearningDone) {
      await goToStep("complete");
      return;
    }
    const data = await callSession("complete");
    if (data?.nextStep === "complete") setStep("complete");
  }

  const handleSlidesCompleted = useCallback(() => {
    if (cornell) {
      setStructuredTab("notes");
      return;
    }
    if (sq?.questions?.length) {
      setStructuredSubStep("questions");
      setStructuredTab("questions");
      void callSession("finish_material_reading");
      return;
    }
    materialContinueRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [cornell, sq]);

  const hasReference = Boolean(sq || material || cornell);
  /** Sidebar for review during practice and after completion; structured_input uses inline sections. */
  const showReferenceAside = hasReference && step !== "structured_input";

  const sqGenState = contextGenState("sq");
  const materialGenState = contextGenState("material");
  const materialInteractionBusy =
    isContextLoading("material") && !materialGenState.materialContentReady;
  const materialPresentationForRender =
    isContextLoading("material") && !materialGenState.materialContentReady
      ? DEFAULT_MATERIAL_PRESENTATION
      : hydrated
        ? materialPresentation
        : undefined;
  const quizGenState = contextGenState("quiz");
  const quizGenerating = isContextLoading("quiz");
  const quizPlaceholderCount = quizGenerating
    ? quizGenState.placeholderBlockCount
    : 0;

  const {
    renderGenStream,
    renderMaterialGenBox,
    renderSqGenBox,
    renderNotesGenBox,
    renderQuizGenBox,
  } = createGenStreamRenderers({
    t,
    contextGenState,
    isContextLoading,
    activeGenContext,
    canStop: (op) => aiGen.canStop(op),
    stopContextGeneration,
    quizGenerating,
    quizGenState,
  });

  return {
    unitId,
    goalId,
    unitTitle,
    sections,
    setSections,
    sectionMiniTestDrafts,
    setSectionMiniTestDraft,
    step,
    structuredSubStep,
    structuredTab,
    setStructuredTab,
    theaterOfferOpen,
    dismissTheaterOffer: () => setTheaterOfferOpen(false),
    labOfferOpen,
    dismissLabOffer: () => setLabOfferOpen(false),
    practiceTab,
    setPracticeTab,
    sessionBusy,
    learningAccess,
    assessmentLocked,
    hydrated,
    error,
    sq,
    material,
    materialCheckResults,
    cornell,
    materialSources,
    scenarioTheaterContent,
    scenarioTheaterPlay,
    scenarioTheaterCompletedOnce,
    unitLabContent,
    setMaterial,
    questions,
    answers,
    quizGrade,
    recallProgress,
    quizPostSubmitDismissed,
    activeQuizSetId,
    quizReadOnly,
    quizExplainByIndex,
    quizSets,
    quizSetsLoading,
    quizGenerating,
    quizPlaceholderCount,
    feynmanText,
    feedback,
    socraticThreads,
    activeSocraticThreadId,
    socraticStreamText,
    unitStatus,
    isLearningDone,
    nextUnit,
    isMicro,
    isOverview,
    hasKacom,
    completeReturn,
    hasReference,
    showReferenceAside,
    materialContinueRef,
    sqGenState,
    materialGenState,
    materialInteractionBusy,
    materialPresentationForRender,
    handleAssistantSectionCursorActivity,
    generatingSqAnswers,
    sqQuestionAnswers,
    setFeynmanText,
    setAnswers,
    isContextLoading,
    stopContextGeneration,
    genButtonLabel,
    generateSq,
    regenerateSq,
    generateMaterial,
    regenerateMaterial,
    finishMaterialReading,
    prepareScenarioTheater,
    prepareUnitLab,
    startUnitLab,
    completeUnitLab,
    regenerateUnitLabItem,
    generateScenarioTheaterScene,
    startScenarioTheaterPlay,
    chooseScenarioTheaterChoice,
    restartScenarioTheaterPlay,
    submitMaterialCheck,
    submitSectionMiniTest,
    generateSqAnswers,
    generateCornellNotes,
    loadQuiz,
    openQuizSet,
    retryCurrentQuizSet,
    submitQuiz,
    explainQuizQuestion,
    stopQuizExplain,
    continueAfterQuiz,
    practiceAnotherBatch,
    dismissRecallPractice,
    submitFeynman,
    socraticTurn,
    selectSocraticThread,
    finishSocratic,
    finishDrills,
    goToStep,
    callSession,
    handleSlidesCompleted,
    handlePresentationActivity,
    renderGenStream,
    renderMaterialGenBox,
    renderSqGenBox,
    renderNotesGenBox,
    renderQuizGenBox,
    STEPS: wizardSteps,
  };
}

export type UnitWizardModel = ReturnType<typeof useUnitWizard>;
