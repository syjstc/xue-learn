"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/source/src/components/ui/sheet.tsx";
import { LearningReferencePanel } from "../learning-reference-panel.tsx";
import {
  CornellReferenceContent,
  GuidingQuestionsRecapContent,
  SqReferenceContent,
} from "../learning-reference-sections.tsx";
import { UnitConceptMapPanel } from "../unit-concept-map-panel.tsx";
import { ActiveRecallStep } from "../unit-wizard/steps/active-recall-step.tsx";
import { CompleteStep } from "../unit-wizard/steps/complete-step.tsx";
import { FeynmanStep } from "../unit-wizard/steps/feynman-step.tsx";
import { SocraticStep } from "../unit-wizard/steps/socratic-step.tsx";
import { StructuredInputStep } from "../unit-wizard/steps/structured-input-step.tsx";
import type { UnitWizardModel } from "../unit-wizard/use-unit-wizard.tsx";
import type { UnitWizardProps } from "../unit-wizard/types.ts";
import { learnerFacingError } from "@/shared/errors/learner-error";
import {
  ConversationActivity,
  ConversationDivider,
  ConversationPersonaProvider,
  ConversationStatus,
  ConversationTurn,
  LearningConversationSurface,
} from "./learning-conversation-surface.tsx";
import {
  buildUnitJourney,
  type UnitJourneyNode,
  type UnitJourneyReference,
} from "./unit-journey.ts";
import { UnitJourneyNavigation } from "./unit-journey-navigation.tsx";
import { ScenarioTheaterCard } from "../scenario-theater.tsx";
import { UnitLabCard } from "../unit-lab.tsx";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { isChatAudioFeatureEnabled, FEATURE_FEYNMAN } from "@xue-learn/core/source/src/shared/features.ts";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/source/src/components/ui/dialog.tsx";
import { FlaskConical, Theater, Volume2, VolumeX } from "lucide-react";
import {
  useLearningViewSettings,
  useSaveChatAudioSettings,
} from "@/hooks/api/use-settings";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import {
  isDesktopLocalRuntime,
  isScenarioTheaterActivityAvailable,
  supportsChatAudioGeneration,
  supportsScenarioTheaterGeneration,
} from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { isUnitLabActivityAvailable } from "@xue-learn/core/source/src/shared/domain/unit-lab.ts";
import { AssistantSectionMaterial } from "../unit-sections/assistant-section-material.tsx";
import { AnchoredLearningMaterial } from "../anchored-learning-material.tsx";
import { loadUnitSectionStableContent } from "@/shared/api/unit-content";
import { getAuthUser } from "@/shared/auth";
import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { UnitSectionManifest } from "@/shared/api";
import { useImmersiveLearning } from "./use-immersive-learning.ts";
import {
  ImmersiveLearningPortal,
  ImmersiveEnterFocusButton,
  ImmersiveTopControls,
} from "./immersive-learning-chrome.tsx";

type ReviewSectionContent = {
  sectionId: string;
  contentRevision: number;
  blockOffset: number;
  material: LearningMaterialContent | null;
};

function CompletedJourneyScene({
  model,
  node,
  persona,
  onReturn,
}: {
  model: UnitWizardModel;
  node: UnitJourneyNode;
  persona: { name: string; avatarSrc?: string };
  onReturn: () => void;
}) {
  const t = useT();
  const section = node.sectionId
    ? model.sections.find((item) => item.id === node.sectionId)
    : null;
  const [content, setContent] = useState<ReviewSectionContent | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!section) {
      setContent(null);
      setError("");
      return;
    }
    let cancelled = false;
    setContent(null);
    setError("");
    void loadUnitSectionStableContent(
      model.unitId,
      section.id,
      section.contentRevision,
    )
      .then((next) => {
        if (!cancelled) setContent(next as ReviewSectionContent);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "无法载入回看内容");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [model.unitId, section?.contentRevision, section?.id]);

  if (node.id === "preview" && model.sq) {
    return (
      <section className="mx-auto w-full max-w-[52rem] space-y-4 py-4">
        <ReviewSceneHeader onReturn={onReturn} />
        <ConversationPersonaProvider persona={persona}>
          <div className="rounded-2xl border border-[var(--course-content-border)] bg-[var(--bg-50)] p-4 sm:p-6">
            <SqReferenceContent sq={model.sq} conversationMode />
          </div>
        </ConversationPersonaProvider>
      </section>
    );
  }

  if (node.id === "questions" && model.sq) {
    return (
      <section className="mx-auto w-full max-w-[52rem] space-y-4 py-4">
        <ReviewSceneHeader onReturn={onReturn} />
        <div className="rounded-2xl border border-[var(--course-content-border)] bg-[var(--bg-50)] p-4 sm:p-6">
          <GuidingQuestionsRecapContent
            answers={model.sqQuestionAnswers}
            generatingAnswers={model.generatingSqAnswers}
            questions={model.sq.questions}
            onGenerateAnswers={() => void model.generateSqAnswers()}
          />
        </div>
      </section>
    );
  }

  if (!section) return null;
  if (error) {
    return (
      <section className="mx-auto w-full max-w-[52rem] space-y-4 py-4">
        <ReviewSceneHeader onReturn={onReturn} />
        <p className="rounded-xl border border-[var(--error-200)] bg-[var(--error-50)] p-4 text-sm text-[var(--error-600)]">
          {error}
        </p>
      </section>
    );
  }
  if (!content?.material) {
    return (
      <section className="mx-auto flex min-h-80 w-full max-w-[52rem] flex-col items-center justify-center gap-3 py-4 text-center">
        <ReviewSceneHeader onReturn={onReturn} />
        <p className="text-sm text-muted-foreground">
          {t("learningScene.loadingReview")}
        </p>
      </section>
    );
  }

  if (section.sectionKind === "mini_test") {
    return (
      <section className="mx-auto w-full max-w-[52rem] space-y-4 py-4">
        <ReviewSceneHeader onReturn={onReturn} />
        <div className="rounded-2xl border border-[var(--course-content-border)] bg-[var(--bg-50)] p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">{section.title}</h2>
          <AnchoredLearningMaterial
            unitId={model.unitId}
            goalId={model.goalId}
            material={content.material}
            sectionId={section.id}
            continuous
            blockOffset={content.blockOffset}
            materialCheckResults={model.materialCheckResults}
          />
          <div className="mt-5 flex justify-end">
            <Button onClick={onReturn}>
              {t("learningScene.returnCurrent")}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="py-4">
      <AssistantSectionMaterial
        userId={getAuthUser()?.id ?? "anonymous"}
        unitId={model.unitId}
        goalId={model.goalId}
        sectionId={section.id}
        sectionTitle={section.title}
        sectionNumber={contentSectionNumber(model.sections, section)}
        contentRevision={content.contentRevision}
        material={content.material}
        blockOffset={content.blockOffset}
        complexComponentAnchors={section.virtualComponents.map(
          (component) => component.anchor,
        )}
        materialCheckResults={model.materialCheckResults}
        historical
        forceExpanded
        onContinue={onReturn}
      />
    </div>
  );
}

function ReviewSceneHeader({ onReturn }: { onReturn: () => void }) {
  const t = useT();
  return (
    <header className="flex items-center justify-between gap-3 rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)] px-4 py-3">
      <p className="text-sm font-medium text-[var(--course-content-muted)]">
        {t("learningScene.reviewing")}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onReturn}>
        {t("learningScene.returnCurrent")}
      </Button>
    </header>
  );
}

function contentSectionNumber(
  sections: UnitSectionManifest[],
  active: UnitSectionManifest,
) {
  return Math.max(
    1,
    sections.filter(
      (section) =>
        section.orderIndex <= active.orderIndex &&
        section.sectionKind === "content",
    ).length,
  );
}

export function ConversationalUnitView({
  model,
  initialSectionId,
  initialSectionAnchor,
}: {
  model: UnitWizardModel;
  initialSectionId?: UnitWizardProps["initialSectionId"];
  initialSectionAnchor?: UnitWizardProps["initialSectionAnchor"];
}) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [journeyExpanded, setJourneyExpanded] = useState(false);
  const [immersiveJourneyOpen, setImmersiveJourneyOpen] = useState(false);
  const [reviewNode, setReviewNode] = useState<UnitJourneyNode | null>(null);
  const updateLocationRef = useRef<
    | ((patch: {
        section?: string | null;
        reference?: string | null;
        activity?: string | null;
      }) => void)
    | null
  >(null);
  const {
    focusMode,
    enterFocusMode,
    exitImmersiveMode,
    immersiveCompanionOpen,
    workspaceClassName,
    workspaceStyle,
  } = useImmersiveLearning({
    unitId: model.unitId,
    immersiveJourneyOpen,
    onCloseImmersiveJourney: () => setImmersiveJourneyOpen(false),
    referenceOpen,
    onCloseReference: () => {
      setReferenceOpen(false);
      updateLocationRef.current?.({ reference: null });
    },
  });

  useEffect(() => {
    if (!focusMode) setImmersiveJourneyOpen(false);
  }, [focusMode]);

  const personas = useTeachingPersonas({ goalId: model.goalId });
  const learningView = useLearningViewSettings();
  const saveChatAudio = useSaveChatAudioSettings();
  const chatAudioEligible =
    isChatAudioFeatureEnabled(isDesktopLocalRuntime()) &&
    supportsChatAudioGeneration();
  const chatAudioEnabled =
    chatAudioEligible && Boolean(learningView.data?.chatAudioEnabled);
  const showChatAudioControl =
    chatAudioEligible && (!isDesktopLocalRuntime() || chatAudioEnabled);
  const persona = {
    name: localizeTeachingPersonaName(personas.data?.current, t),
    avatarSrc: teachingPersonaAvatarSrc(
      personas.data?.current.avatarCode ?? "xiaohui_female",
    ),
  };
  const selectedSectionId =
    searchParams.get("section") ?? initialSectionId ?? null;
  const displayedSection =
    model.sections.find((section) => section.id === selectedSectionId) ??
    model.sections.find(
      (section) =>
        section.status !== "completed" && section.status !== "skipped",
    ) ??
    model.sections.at(-1);
  const selectedSectionOwnsGenerationError = Boolean(
    model.step === "structured_input" &&
    model.structuredTab === "material" &&
    displayedSection?.generationStatus === "failed",
  );
  const requestedReference = searchParams.get("reference");
  const requestedActivity = searchParams.get("activity");
  const theaterActivityAvailable = isScenarioTheaterActivityAvailable(
    model.scenarioTheaterContent,
    model.isMicro || model.isOverview,
  );
  const theaterOpen =
    requestedActivity === "theater" && theaterActivityAvailable;
  const labActivityAvailable = isUnitLabActivityAvailable(
    model.unitLabContent,
    model.isMicro || model.isOverview,
  );
  const labOpen = requestedActivity === "lab" && labActivityAvailable;
  const practiceActivities = [
    ...(theaterActivityAvailable
      ? [{ id: "theater" as const, available: true }]
      : []),
    ...(labActivityAvailable ? [{ id: "lab" as const, available: true }] : []),
  ];
  const prevStructuredSubStepRef = useRef(model.structuredSubStep);
  const journey = useMemo(
    () =>
      buildUnitJourney({
        step: model.step,
        structuredTab: model.structuredTab,
        sections: model.sections,
        selectedSectionId,
        hasSq: Boolean(model.sq),
        hasMaterial: Boolean(model.material || model.sections.length),
        hasKacom: model.hasKacom,
        hasSocratic: model.socraticThreads.length > 0,
        isLearningDone: model.isLearningDone,
        orientationOnly: model.isOverview,
      }),
    [
      model.isLearningDone,
      model.hasKacom,
      model.material,
      model.sections,
      model.socraticThreads.length,
      model.sq,
      model.step,
      model.structuredTab,
      model.isOverview,
      selectedSectionId,
    ],
  );
  useEffect(() => {
    setReferenceOpen(
      requestedReference === "questions"
        ? Boolean(model.sq && (model.material || model.sections.length))
        : journey.references.some(
            (reference) =>
              reference.id === requestedReference && reference.available,
          ),
    );
  }, [
    journey.references,
    model.material,
    model.sections.length,
    model.sq,
    requestedReference,
  ]);

  const updateLocation = useCallback(
    (patch: {
      section?: string | null;
      reference?: string | null;
      activity?: string | null;
    }) => {
      const next = new URLSearchParams(searchParams);
      if (patch.section === null) next.delete("section");
      else if (patch.section) next.set("section", patch.section);
      if (patch.reference === null) next.delete("reference");
      else if (patch.reference) next.set("reference", patch.reference);
      if (patch.activity === null) next.delete("activity");
      else if (patch.activity) next.set("activity", patch.activity);
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );
  updateLocationRef.current = updateLocation;

  // Theater is optional. Never force `?activity=theater` — learners open it from
  // the journey practice entry or the post-material offer dialog. Only clear the
  // activity when the session advances out of a legacy theater sub-step.
  useEffect(() => {
    if (!model.hydrated || model.isMicro) return;
    const prev = prevStructuredSubStepRef.current;
    prevStructuredSubStepRef.current = model.structuredSubStep;
    if (
      prev === "theater" &&
      model.structuredSubStep === "questions" &&
      theaterOpen
    ) {
      updateLocation({ activity: null });
    }
  }, [
    model.hydrated,
    model.isMicro,
    model.structuredSubStep,
    theaterOpen,
    updateLocation,
  ]);

  useEffect(() => {
    if (requestedActivity === "theater" && !theaterActivityAvailable) {
      updateLocation({ activity: null });
    }
    if (requestedActivity === "lab" && !labActivityAvailable) {
      updateLocation({ activity: null });
    }
  }, [
    requestedActivity,
    theaterActivityAvailable,
    labActivityAvailable,
    updateLocation,
  ]);

  const handleActiveSectionChange = useCallback(
    (sectionId: string) =>
      updateLocation({ section: sectionId, reference: null, activity: null }),
    [updateLocation],
  );
  useEffect(() => {
    if (
      model.step !== "structured_input" ||
      (model.structuredTab !== "map" && model.structuredTab !== "notes")
    ) {
      return;
    }
    const reference = model.structuredTab;
    model.setStructuredTab(
      model.material || model.sections.length > 0 ? "material" : "sq",
    );
    updateLocation({ reference });
  }, [
    model.material,
    model.sections.length,
    model.setStructuredTab,
    model.step,
    model.structuredTab,
    updateLocation,
  ]);

  function selectJourneyNode(node: UnitJourneyNode) {
    if (node.status === "locked") return;
    if (
      node.id !== journey.currentId &&
      model.step !== "structured_input" &&
      !model.isLearningDone &&
      (node.id === "preview" ||
        node.id === "questions" ||
        node.kind === "section")
    ) {
      setReferenceOpen(false);
      setReviewNode(node);
      updateLocation({ reference: null, activity: null });
      return;
    }
    setReviewNode(null);
    if (node.id === "preview") {
      if (model.step !== "structured_input" && !model.isLearningDone) {
        setReferenceOpen(true);
        return;
      }
      model.setStructuredTab("sq");
      updateLocation({ section: null, reference: null, activity: null });
      if (model.step !== "structured_input") {
        void model.goToStep("structured_input");
      }
      return;
    }
    if (node.kind === "section" && node.sectionId) {
      if (model.step !== "structured_input" && !model.isLearningDone) {
        setReferenceOpen(true);
        return;
      }
      model.setStructuredTab("material");
      updateLocation({
        section: node.sectionId,
        reference: null,
        activity: null,
      });
      if (model.step !== "structured_input") {
        void model.goToStep("structured_input");
      }
      return;
    }
    if (node.id === "questions") {
      if (model.step !== "structured_input" && !model.isLearningDone) {
        updateLocation({ reference: "questions" });
        setReferenceOpen(true);
        return;
      }
      model.setStructuredTab("questions");
      updateLocation({ section: null, reference: null, activity: null });
      if (model.step !== "structured_input") {
        void model.goToStep("structured_input");
      }
      return;
    }
    if (node.id === "recall" && model.step !== "active_recall") {
      void model.goToStep("active_recall");
      return;
    }
    if (node.id === "correction" && model.step !== "socratic") {
      void model.goToStep("socratic");
      return;
    }
    if (node.id === "complete" && model.step !== "complete") {
      void model.goToStep("complete");
    }
  }

  function selectReference(reference: UnitJourneyReference) {
    if (!reference.available) return;
    updateLocation({ reference: reference.id, activity: null });
    setReferenceOpen(true);
  }

  const reference =
    requestedReference === "map" ? (
      <UnitConceptMapPanel unitId={model.unitId} />
    ) : requestedReference === "questions" && model.sq ? (
      <GuidingQuestionsRecapContent
        answers={model.sqQuestionAnswers}
        generatingAnswers={model.generatingSqAnswers}
        questions={model.sq.questions}
        onGenerateAnswers={() => void model.generateSqAnswers()}
      />
    ) : requestedReference === "notes" ? (
      model.cornell ? (
        <CornellReferenceContent cornell={model.cornell} />
      ) : (
        <div className="space-y-3 rounded-xl border border-dashed p-5">
          <p className="text-sm text-muted-foreground">
            {t("learningJourney.notesEmpty")}
          </p>
          <Button
            disabled={model.isContextLoading("notes")}
            onClick={() => void model.generateCornellNotes()}
          >
            {model.genButtonLabel("notes", t("learningJourney.generateNotes"))}
          </Button>
        </div>
      )
    ) : (
      <LearningReferencePanel
        unitId={model.unitId}
        goalId={model.goalId}
        sq={model.sq}
        material={model.material}
        materialSources={model.materialSources}
        cornell={model.cornell}
        onMaterialChange={model.setMaterial}
      />
    );

  const sceneChrome = (
    <header className="flex items-center justify-end gap-3 px-0.5 py-1 sm:px-1">
      <div className="flex shrink-0 items-center gap-0.5">
        {showChatAudioControl ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={saveChatAudio.isPending}
            aria-pressed={chatAudioEnabled}
            aria-label={chatAudioEnabled ? "关闭语音讲解" : "开启语音讲解"}
            onClick={() => saveChatAudio.mutate(!chatAudioEnabled)}
          >
            {chatAudioEnabled ? (
              <Volume2 aria-hidden />
            ) : (
              <VolumeX aria-hidden />
            )}
          </Button>
        ) : null}
        {!focusMode ? (
          <ImmersiveEnterFocusButton onEnter={enterFocusMode} />
        ) : null}
      </div>
    </header>
  );

  const content = (
    <div
      data-guided-scene-root="true"
      data-immersive-learning={focusMode ? "true" : undefined}
      data-assistant-sidebar-open={immersiveCompanionOpen ? "true" : undefined}
      role={focusMode ? "region" : undefined}
      aria-label={focusMode ? model.unitTitle : undefined}
      className={workspaceClassName}
      style={workspaceStyle}
    >
      {focusMode ? <ImmersiveTopControls onExit={exitImmersiveMode} /> : null}
      <div
        data-immersive-scroll-surface
        className={cn(
          "min-h-0 min-w-0",
          focusMode && "flex-1 overflow-y-auto px-4 pt-16 sm:px-6",
        )}
      >
        <div
          className={cn(
            "grid min-w-0 grid-cols-[minmax(0,1fr)] items-start transition-[grid-template-columns] duration-200 motion-reduce:transition-none lg:gap-6",
            !focusMode && journeyExpanded
              ? "lg:grid-cols-[20rem_minmax(0,1fr)]"
              : !focusMode
                ? "lg:grid-cols-[2.75rem_minmax(0,1fr)]"
                : "lg:grid-cols-[minmax(0,1fr)] lg:gap-0",
          )}
        >
          <UnitJourneyNavigation
            nodes={journey.nodes}
            references={journey.references}
            activities={practiceActivities}
            currentId={
              labOpen
                ? "activity:lab"
                : theaterOpen
                  ? "activity:theater"
                  : (reviewNode?.id ?? journey.currentId)
            }
            desktopExpanded={journeyExpanded}
            onDesktopExpandedChange={setJourneyExpanded}
            immersive={focusMode}
            immersiveOpen={immersiveJourneyOpen}
            onImmersiveOpenChange={setImmersiveJourneyOpen}
            onSelectNode={selectJourneyNode}
            onSelectReference={selectReference}
            onSelectActivity={(activity) => {
              setReferenceOpen(false);
              setReviewNode(null);
              if (activity.id === "lab") void model.startUnitLab();
              updateLocation({ reference: null, activity: activity.id });
            }}
          />

          <div className="min-w-0">
            <div className={cn("mb-1", focusMode && "hidden")}>
              {sceneChrome}
            </div>
            {reviewNode ? (
              <CompletedJourneyScene
                model={model}
                node={reviewNode}
                persona={persona}
                onReturn={() => setReviewNode(null)}
              />
            ) : labOpen ? (
              <div className="mx-auto w-full max-w-[64rem] py-3 sm:py-5">
                <UnitLabCard
                  content={model.unitLabContent}
                  generating={model.isContextLoading("lab")}
                  onPrepare={() => void model.prepareUnitLab(true)}
                  onRegenerateItem={model.regenerateUnitLabItem}
                  onComplete={() => {
                    void model.completeUnitLab();
                    updateLocation({ activity: null, section: null });
                  }}
                />
              </div>
            ) : theaterOpen ? (
              <div className="mx-auto w-full max-w-[64rem] py-3 sm:py-5">
                <ScenarioTheaterCard
                  content={model.scenarioTheaterContent}
                  play={model.scenarioTheaterPlay}
                  completedOnce={model.scenarioTheaterCompletedOnce}
                  generating={model.isContextLoading("theater")}
                  generationEnabled={supportsScenarioTheaterGeneration()}
                  onGenerate={model.prepareScenarioTheater}
                  onGenerateScene={model.generateScenarioTheaterScene}
                  onStart={model.startScenarioTheaterPlay}
                  onChoose={model.chooseScenarioTheaterChoice}
                  onRestart={model.restartScenarioTheaterPlay}
                  onContinue={model.finishMaterialReading}
                  onLeave={() =>
                    updateLocation({ activity: null, section: null })
                  }
                />
              </div>
            ) : (
              <LearningConversationSurface
                persona={persona}
                busy={model.sessionBusy}
                className="min-w-0 pt-2 sm:pt-3"
              >
                {model.assessmentLocked && !model.isMicro ? (
                  <ConversationTurn role="system">
                    {t("learningConversation.assessmentPreparing")}
                  </ConversationTurn>
                ) : null}

                {model.error && !selectedSectionOwnsGenerationError ? (
                  <ConversationTurn role="system">
                    {learnerFacingError(model.error)}
                  </ConversationTurn>
                ) : null}

                {model.step === "structured_input" ? (
                  model.structuredTab === "material" ? (
                    <StructuredInputStep
                      model={model}
                      conversationMode
                      initialSectionId={selectedSectionId}
                      initialSectionAnchor={initialSectionAnchor}
                      onActiveSectionChange={handleActiveSectionChange}
                    />
                  ) : model.structuredTab === "questions" ? (
                    <ConversationTurn role="assistant">
                      <ConversationActivity
                        label={t("learningJourney.questions")}
                      >
                        <StructuredInputStep
                          model={model}
                          conversationMode
                          initialSectionId={selectedSectionId}
                          initialSectionAnchor={initialSectionAnchor}
                          onActiveSectionChange={handleActiveSectionChange}
                        />
                      </ConversationActivity>
                    </ConversationTurn>
                  ) : (
                    <>
                      <ConversationTurn role="assistant">
                        {t("learningConversation.previewLead")}
                      </ConversationTurn>
                      <StructuredInputStep
                        model={model}
                        conversationMode
                        initialSectionId={selectedSectionId}
                        initialSectionAnchor={initialSectionAnchor}
                        onActiveSectionChange={handleActiveSectionChange}
                      />
                    </>
                  )
                ) : null}

                {model.step === "active_recall" ? (
                  <>
                    <ConversationTurn role="assistant">
                      {t("learningConversation.recallLead")}
                    </ConversationTurn>
                    <ConversationActivity label={t("learningJourney.recall")}>
                      <ActiveRecallStep model={model} conversationMode />
                    </ConversationActivity>
                  </>
                ) : null}

                {FEATURE_FEYNMAN && model.step === "feynman" ? (
                  <>
                    <ConversationDivider>
                      {t("learningConversation.outputCheck")}
                    </ConversationDivider>
                    <ConversationActivity
                      label={t("learningConversation.outputCheck")}
                    >
                      <FeynmanStep
                        unitTitle={model.unitTitle}
                        feynmanText={model.feynmanText}
                        setFeynmanText={model.setFeynmanText}
                        submitFeynman={model.submitFeynman}
                        sessionBusy={
                          model.sessionBusy || model.assessmentLocked
                        }
                        feedback={model.feedback}
                        renderGenStream={model.renderGenStream}
                      />
                    </ConversationActivity>
                  </>
                ) : null}

                {model.step === "socratic" ? (
                  <>
                    <ConversationTurn role="assistant">
                      {t("learningConversation.correctionLead")}
                    </ConversationTurn>
                    <ConversationActivity
                      label={t("learningJourney.correction")}
                    >
                      <SocraticStep
                        socraticThreads={model.socraticThreads}
                        activeSocraticThreadId={model.activeSocraticThreadId}
                        questions={model.questions}
                        sessionBusy={
                          model.sessionBusy || model.assessmentLocked
                        }
                        socraticStreamText={model.socraticStreamText}
                        socraticTurn={model.socraticTurn}
                        selectSocraticThread={model.selectSocraticThread}
                        finishSocratic={model.finishSocratic}
                        finishDrills={model.finishDrills}
                        isLearningDone={model.isLearningDone}
                        conversationMode
                      />
                    </ConversationActivity>
                  </>
                ) : null}

                {model.step === "complete" ? (
                  <>
                    <ConversationTurn role="assistant">
                      {t("learningConversation.completeLead")}
                    </ConversationTurn>
                    <ConversationActivity label={t("learningJourney.complete")}>
                      <CompleteStep
                        unitStatus={model.unitStatus}
                        hasReference={model.hasReference}
                        goToStep={model.goToStep}
                        sessionBusy={
                          model.sessionBusy || model.assessmentLocked
                        }
                        isMicro={model.isMicro}
                        completeReturn={model.completeReturn}
                        preserveImmersive={focusMode && Boolean(model.nextUnit)}
                      />
                    </ConversationActivity>
                  </>
                ) : null}

                {model.sessionBusy ? (
                  <ConversationStatus loading>
                    {model.generatingSqAnswers
                      ? t("wizard.reference.generatingAnswers")
                      : t("learningConversation.updating")}
                  </ConversationStatus>
                ) : null}
              </LearningConversationSurface>
            )}
          </div>
        </div>
      </div>

      <Sheet
        open={referenceOpen}
        onOpenChange={(open) => {
          setReferenceOpen(open);
          if (!open) updateLocation({ reference: null });
        }}
      >
        <SheetContent className="w-[min(94vw,36rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="border-b text-left">
            <SheetTitle>{t("learningJourney.references")}</SheetTitle>
            <SheetDescription>
              {t("learningJourney.referencesDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{reference}</div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={model.theaterOfferOpen && theaterActivityAvailable}
        onOpenChange={(open) => {
          if (!open) model.dismissTheaterOffer();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Theater aria-hidden className="size-5 text-primary" />
              {t("learningJourney.theaterOfferTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("learningJourney.theaterOfferBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => model.dismissTheaterOffer()}
            >
              {t("learningJourney.theaterOfferSkip")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                model.dismissTheaterOffer();
                setReferenceOpen(false);
                setReviewNode(null);
                updateLocation({
                  section: null,
                  reference: null,
                  activity: "theater",
                });
              }}
            >
              {t("learningJourney.theaterOfferEnter")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          model.labOfferOpen &&
          labActivityAvailable &&
          model.unitLabContent?.recommended === true
        }
        onOpenChange={(open) => {
          if (!open) model.dismissLabOffer();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical aria-hidden className="size-5 text-primary" />
              {t("learningJourney.labOfferTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("learningJourney.labOfferBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => model.dismissLabOffer()}
            >
              {t("learningJourney.labOfferSkip")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                model.dismissLabOffer();
                setReferenceOpen(false);
                setReviewNode(null);
                void model.startUnitLab();
                updateLocation({
                  section: null,
                  reference: null,
                  activity: "lab",
                });
              }}
            >
              {t("learningJourney.labOfferEnter")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  return (
    <ImmersiveLearningPortal active={focusMode}>
      {content}
    </ImmersiveLearningPortal>
  );
}
