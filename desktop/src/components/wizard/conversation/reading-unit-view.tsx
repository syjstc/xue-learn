"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FlaskConical, Theater } from "lucide-react";
import { FEATURE_FEYNMAN } from "@xue-learn/core/features";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";
import {
  isScenarioTheaterActivityAvailable,
  supportsScenarioTheaterGeneration,
} from "@xue-learn/core/client-runtime";
import { isUnitLabActivityAvailable } from "@xue-learn/core/shared/domain/unit-lab";
import { Button } from "@xue-learn/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { UnitJourneyNavigation } from "./unit-journey-navigation.tsx";
import {
  buildUnitJourney,
  type UnitJourneyNode,
  type UnitJourneyReference,
} from "./unit-journey.ts";
import type { UnitWizardModel } from "../unit-wizard/use-unit-wizard.tsx";
import type { UnitWizardProps } from "../unit-wizard/types.ts";
import { learnerFacingError } from "@/shared/errors/learner-error";
import { StructuredInputStep } from "../unit-wizard/steps/structured-input-step.tsx";
import { ActiveRecallStep } from "../unit-wizard/steps/active-recall-step.tsx";
import { FeynmanStep } from "../unit-wizard/steps/feynman-step.tsx";
import { SocraticStep } from "../unit-wizard/steps/socratic-step.tsx";
import { CompleteStep } from "../unit-wizard/steps/complete-step.tsx";
import { ScenarioTheaterCard } from "../scenario-theater.tsx";
import { UnitLabCard } from "../unit-lab.tsx";
import { LearningReferencePanel } from "../learning-reference-panel.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/ui/sheet";
import { useImmersiveLearning } from "./use-immersive-learning.ts";
import {
  ImmersiveLearningPortal,
  ImmersiveEnterFocusButton,
  ImmersiveTopControls,
} from "./immersive-learning-chrome.tsx";

export function ReadingUnitView({
  active = true,
  model,
  initialSectionId,
  initialSectionAnchor,
}: {
  active?: boolean;
  model: UnitWizardModel;
  initialSectionId?: UnitWizardProps["initialSectionId"];
  initialSectionAnchor?: UnitWizardProps["initialSectionAnchor"];
}) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [journeyExpanded, setJourneyExpanded] = useState(true);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [immersiveJourneyOpen, setImmersiveJourneyOpen] = useState(false);
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
      model.isOverview,
      model.material,
      model.sections,
      model.socraticThreads.length,
      model.sq,
      model.step,
      model.structuredTab,
      selectedSectionId,
    ],
  );
  const updateLocation = useCallback(
    (patch: { section?: string | null; activity?: string | null }) => {
      const next = new URLSearchParams(searchParams);
      if (patch.section === null) next.delete("section");
      else if (patch.section) next.set("section", patch.section);
      if (patch.activity === null) next.delete("activity");
      else if (patch.activity) next.set("activity", patch.activity);
      if (next.toString() !== searchParams.toString())
        setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const {
    focusMode,
    enterFocusMode,
    exitImmersiveMode,
    immersiveCompanionOpen,
    workspaceClassName,
    workspaceStyle,
  } = useImmersiveLearning({
    enabled: active,
    unitId: model.unitId,
    immersiveJourneyOpen,
    onCloseImmersiveJourney: () => setImmersiveJourneyOpen(false),
    referenceOpen,
    onCloseReference: () => setReferenceOpen(false),
  });

  useEffect(() => {
    if (!focusMode) setImmersiveJourneyOpen(false);
  }, [focusMode]);

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

  const selectNode = (node: UnitJourneyNode) => {
    if (node.status === "locked") return;
    updateLocation({ activity: null, section: node.sectionId ?? null });
    if (node.id === "preview") {
      model.setStructuredTab("sq");
      if (model.step !== "structured_input")
        void model.goToStep("structured_input");
    } else if (node.kind === "section") {
      model.setStructuredTab("material");
      if (model.step !== "structured_input")
        void model.goToStep("structured_input");
    } else if (node.id === "questions") {
      model.setStructuredTab("questions");
      if (model.step !== "structured_input")
        void model.goToStep("structured_input");
    } else if (node.id === "recall" && model.step !== "active_recall") {
      void model.goToStep("active_recall");
    } else if (node.id === "correction" && model.step !== "socratic") {
      void model.goToStep("socratic");
    } else if (node.id === "complete" && model.step !== "complete") {
      void model.goToStep("complete");
    }
  };
  const selectReference = (reference: UnitJourneyReference) => {
    if (reference.available) setReferenceOpen(true);
  };

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
                  : journey.currentId
            }
            desktopExpanded={journeyExpanded}
            onDesktopExpandedChange={setJourneyExpanded}
            immersive={focusMode}
            immersiveOpen={immersiveJourneyOpen}
            onImmersiveOpenChange={setImmersiveJourneyOpen}
            onSelectNode={selectNode}
            onSelectReference={selectReference}
            onSelectActivity={(activity) => {
              if (activity.id === "lab") void model.startUnitLab();
              updateLocation({ activity: activity.id });
            }}
          />

          <main className={cn("mx-auto min-w-0 w-full space-y-4 px-0 sm:px-1", focusMode ? "max-w-[100rem]" : "max-w-[84rem]")}>
            {active && !focusMode ? (
              <div className="flex justify-end">
                <ImmersiveEnterFocusButton onEnter={enterFocusMode} />
              </div>
            ) : null}
            {model.assessmentLocked && !model.isMicro ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t("wizard.reading.assessmentLocked")}
              </p>
            ) : null}
            {model.error && !selectedSectionOwnsGenerationError ? (
              <p className="rounded-lg bg-[var(--error-50)] p-3 text-sm text-[var(--error-500)]">
                {learnerFacingError(model.error)}
              </p>
            ) : null}
            {labOpen ? (
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
            ) : theaterOpen ? (
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
            ) : model.step === "structured_input" ? (
              <StructuredInputStep
                model={model}
                initialSectionId={selectedSectionId}
                initialSectionAnchor={initialSectionAnchor}
                onActiveSectionChange={(sectionId) =>
                  updateLocation({ section: sectionId, activity: null })
                }
              />
            ) : model.step === "active_recall" ? (
              <ActiveRecallStep model={model} />
            ) : FEATURE_FEYNMAN && model.step === "feynman" ? (
              <FeynmanStep
                unitTitle={model.unitTitle}
                feynmanText={model.feynmanText}
                setFeynmanText={model.setFeynmanText}
                submitFeynman={model.submitFeynman}
                sessionBusy={model.sessionBusy || model.assessmentLocked}
                feedback={model.feedback}
                renderGenStream={model.renderGenStream}
              />
            ) : model.step === "socratic" ? (
              <SocraticStep
                socraticThreads={model.socraticThreads}
                activeSocraticThreadId={model.activeSocraticThreadId}
                questions={model.questions}
                sessionBusy={model.sessionBusy || model.assessmentLocked}
                socraticStreamText={model.socraticStreamText}
                socraticTurn={model.socraticTurn}
                selectSocraticThread={model.selectSocraticThread}
                finishSocratic={model.finishSocratic}
                finishDrills={model.finishDrills}
                isLearningDone={model.isLearningDone}
              />
            ) : model.step === "complete" ? (
              <CompleteStep
                unitStatus={model.unitStatus}
                hasReference={model.hasReference}
                goToStep={model.goToStep}
                sessionBusy={model.sessionBusy || model.assessmentLocked}
                isMicro={model.isMicro}
                completeReturn={model.completeReturn}
                preserveImmersive={focusMode && Boolean(model.nextUnit)}
              />
            ) : null}
          </main>
        </div>
      </div>

      <Sheet open={referenceOpen} onOpenChange={setReferenceOpen}>
        <SheetContent className="w-[min(94vw,36rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="border-b text-left">
            <SheetTitle>{t("wizard.reading.referenceTitle")}</SheetTitle>
            <SheetDescription>
              {t("wizard.reading.referenceDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <LearningReferencePanel
              unitId={model.unitId}
              goalId={model.goalId}
              sq={model.sq}
              material={model.material}
              materialSources={model.materialSources}
              cornell={model.cornell}
              onMaterialChange={model.setMaterial}
            />
          </div>
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
                updateLocation({ section: null, activity: "theater" });
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
                void model.startUnitLab();
                updateLocation({ section: null, activity: "lab" });
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
