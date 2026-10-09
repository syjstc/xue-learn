"use client";

import { useEffect, useState } from "react";
import { BookOpen, PanelRightClose } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/source/src/components/ui/sheet.tsx";
import { LearningReferencePanel } from "../learning-reference-panel.tsx";
import { ActiveRecallStep } from "./steps/active-recall-step.tsx";
import { CompleteStep } from "./steps/complete-step.tsx";
import { SocraticStep } from "./steps/socratic-step.tsx";
import { useUnitWizard } from "./use-unit-wizard.tsx";
import type { UnitWizardProps } from "./types.ts";
import { ConversationalUnitView } from "../conversation/conversational-unit-view.tsx";
import { ReadingUnitView } from "../conversation/reading-unit-view.tsx";
import { learnerFacingError } from "@/shared/errors/learner-error";

export function UnitWizard(props: UnitWizardProps) {
  const model = useUnitWizard(props);
  const [reviewReferenceOpen, setReviewReferenceOpen] = useState(false);
  const [mobileReferenceOpen, setMobileReferenceOpen] = useState(false);

  useEffect(() => {
    if (!props.reviewMode) return;
    props.onReviewScoreChange?.(model.quizGrade?.score ?? null);
  }, [model.quizGrade?.score, props.onReviewScoreChange, props.reviewMode]);

  useEffect(() => {
    if (!props.reviewMode) return;
    props.onReviewReadyChange?.(
      model.quizGrade?.score === 1 || model.step === "complete",
    );
  }, [
    model.quizGrade?.score,
    model.step,
    props.onReviewReadyChange,
    props.reviewMode,
  ]);

  useEffect(() => {
    props.onLearningAccessChange?.(model.learningAccess);
  }, [model.learningAccess, props.onLearningAccessChange]);

  useEffect(() => {
    props.onCurrentStepChange?.(model.step);
  }, [model.step, props.onCurrentStepChange]);

  const reviewReference = (
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

  if (props.reviewMode) {
    return (
      <>
        <div
          className={
            reviewReferenceOpen && model.hasReference
              ? "grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_min(20rem,38%)] md:items-start"
              : "min-w-0"
          }
        >
          <div className="relative min-w-0 space-y-3">
            {model.error && (
              <p className="rounded-lg bg-[var(--error-50)] p-3 text-sm text-[var(--error-500)]">
                {learnerFacingError(model.error)}
              </p>
            )}
            {model.hasReference && !reviewReferenceOpen && (
              <Button
                type="button"
                variant="outline"
                className="mb-2 hidden md:inline-flex"
                onClick={() => setReviewReferenceOpen(true)}
              >
                <BookOpen aria-hidden />
                学习资料
              </Button>
            )}
            {model.step === "socratic" ? (
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
                reviewMode
              />
            ) : model.step === "complete" ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center">
                <h2 className="text-lg font-semibold">错题修正已完成</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  可以完成本单元并继续下一个复习单元。
                </p>
              </div>
            ) : (
              <ActiveRecallStep model={model} reviewMode />
            )}
          </div>

          {reviewReferenceOpen && model.hasReference && (
            <div className="relative hidden md:block">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-2 z-10"
                onClick={() => setReviewReferenceOpen(false)}
                aria-label="收起学习资料"
              >
                <PanelRightClose aria-hidden />
              </Button>
              {reviewReference}
            </div>
          )}
        </div>

        {model.hasReference && (
          <>
            <Button
              type="button"
              size="icon-lg"
              className="fixed bottom-20 right-4 z-30 rounded-full shadow-lg md:hidden"
              onClick={() => setMobileReferenceOpen(true)}
              aria-label="打开学习资料"
            >
              <BookOpen aria-hidden />
            </Button>
            <Sheet
              open={mobileReferenceOpen}
              onOpenChange={setMobileReferenceOpen}
            >
              <SheetContent
                side="right"
                className="w-[min(92vw,28rem)] gap-0 overflow-hidden p-0 md:hidden"
              >
                <SheetHeader className="border-b px-4 py-3 text-left">
                  <SheetTitle>学习资料</SheetTitle>
                  <SheetDescription>
                    复习时可随时查阅正文与笔记
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {reviewReference}
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}
      </>
    );
  }

  if (props.presentationMode === "chat") {
    return (
      <ConversationalUnitView
        model={model}
        initialSectionId={props.initialSectionId}
        initialSectionAnchor={props.initialSectionAnchor}
      />
    );
  }

  return (
    <ReadingUnitView
      model={model}
      initialSectionId={props.initialSectionId}
      initialSectionAnchor={props.initialSectionAnchor}
    />
  );
}

export type { UnitWizardProps } from "./types.ts";
