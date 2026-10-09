"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { CollapsiblePanel } from "../../collapsible-panel.tsx";
import { AnchoredLearningMaterial } from "../../anchored-learning-material.tsx";
import {
  CornellReferenceContent,
  GuidingQuestionsRecapContent,
  SqReferenceContent,
  SqReferenceLoading,
} from "../../learning-reference-sections.tsx";
import { useScrollStructuredTabPanel } from "@/hooks/use-scroll-structured-tab-panel";
import type { UnitWizardModel } from "../use-unit-wizard.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { UnitConceptMapPanel } from "../../unit-concept-map-panel.tsx";
import { SectionLearningPanel } from "../../unit-sections/section-learning-panel.tsx";
import { AssistantSectionMaterial } from "../../unit-sections/assistant-section-material.tsx";
import { ConversationTypingIndicator } from "../../conversation/learning-conversation-surface.tsx";
import { getAuthUser } from "@/shared/auth";
import { assistantCourseClientContentRevision } from "@/shared/domain/assistant-course-feed";

type Props = {
  model: UnitWizardModel;
  initialSectionId?: string | null;
  initialSectionAnchor?: string | null;
  conversationMode?: boolean;
  onActiveSectionChange?: (sectionId: string) => void;
};

export function shouldUseSectionStyleMaterial({
  conversationMode,
  hasSections,
  isMicro,
  hasMaterial,
}: {
  conversationMode: boolean;
  hasSections: boolean;
  isMicro: boolean;
  hasMaterial: boolean;
}) {
  return !conversationMode && hasMaterial && (isMicro || !hasSections);
}

export function shouldShowStructuredMaterialPanel({
  structuredTab,
  hasSurvey,
  isOverview,
  hasSections,
}: {
  structuredTab: string;
  hasSurvey: boolean;
  isOverview: boolean;
  hasSections: boolean;
}) {
  return (
    structuredTab === "material" &&
    (hasSurvey || isOverview || hasSections)
  );
}

export function StructuredInputStep({
  model,
  initialSectionId,
  initialSectionAnchor,
  conversationMode = false,
  onActiveSectionChange,
}: Props) {
  const t = useT();
  const {
    structuredTab,
    setStructuredTab,
    hydrated,
    sq,
    material,
    materialCheckResults,
    cornell,
    unitId,
    goalId,
    unitTitle,
    materialSources,
    setMaterial,
    sections,
    setSections,
    sectionMiniTestDrafts,
    setSectionMiniTestDraft,
    isContextLoading,
    genButtonLabel,
    regenerateSq,
    generateSq,
    renderSqGenBox,
    generateMaterial,
    regenerateMaterial,
    handleSlidesCompleted,
    materialPresentationForRender,
    handlePresentationActivity,
    handleAssistantSectionCursorActivity,
    renderMaterialGenBox,
    materialContinueRef,
    finishMaterialReading,
    submitMaterialCheck,
    submitSectionMiniTest,
    materialInteractionBusy,
    materialGenState,
    sqGenState,
    sqQuestionAnswers,
    generateSqAnswers,
    generatingSqAnswers,
    generateCornellNotes,
    renderNotesGenBox,
    stopContextGeneration,
    loadQuiz,
    assessmentLocked,
    isMicro,
    isOverview,
    hasKacom,
    scenarioTheaterContent,
    scenarioTheaterPlay,
    scenarioTheaterCompletedOnce,
    prepareScenarioTheater,
    generateScenarioTheaterScene,
    startScenarioTheaterPlay,
    chooseScenarioTheaterChoice,
    restartScenarioTheaterPlay,
  } = model;
  const persistedSections = sections.filter((section) => !section.legacy);
  const hasSections = persistedSections.length > 0;
  const usesSectionLearning =
    !isMicro && (hasSections || !material || isContextLoading("material"));
  const usesSectionStyleMaterial = shouldUseSectionStyleMaterial({
    conversationMode,
    hasSections,
    isMicro,
    hasMaterial: Boolean(material),
  });
  const firstSectionReady = persistedSections[0]?.generationStatus === "ready";
  const showMaterialPanel = shouldShowStructuredMaterialPanel({
    structuredTab,
    hasSurvey: Boolean(sq),
    isOverview,
    hasSections,
  });
  const sqPanelRef = useRef<HTMLElement>(null);
  const materialPanelRef = useRef<HTMLElement>(null);
  const mapPanelRef = useRef<HTMLElement>(null);
  const questionsPanelRef = useRef<HTMLElement>(null);
  const notesPanelRef = useRef<HTMLElement>(null);
  const panelRefs = useMemo(
    () => ({
      sq: sqPanelRef,
      material: materialPanelRef,
      map: mapPanelRef,
      questions: questionsPanelRef,
      notes: notesPanelRef,
    }),
    [],
  );

  useScrollStructuredTabPanel(structuredTab, panelRefs, hydrated);

  useEffect(() => {
    if (isOverview && structuredTab === "sq") {
      setStructuredTab("material");
      return;
    }
    if (!hasKacom && structuredTab === "map") {
      setStructuredTab(material || isOverview ? "material" : "sq");
    }
  }, [hasKacom, isOverview, material, setStructuredTab, structuredTab]);

  return (
    <div className="min-w-0 w-full space-y-4">
      {!hydrated ? (
        <p className="text-sm text-[var(--text-400)]">
          {t("wizard.steps.structured.loadingProgress")}
        </p>
      ) : (
        <div className="min-w-0 w-full overflow-x-clip">
          {structuredTab === "sq" && (
            <section
              ref={sqPanelRef}
              className="scroll-mt-16 min-w-0 space-y-5"
              role="tabpanel"
            >
              {!conversationMode || sq ? (
                <div
                  className={`flex flex-wrap items-start gap-3 ${
                    conversationMode ? "justify-end" : "justify-between"
                  }`}
                >
                  {!conversationMode ? (
                    <div className="space-y-1">
                      <h2
                        className="text-lg font-semibold text-[var(--text-800)]"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {t("wizard.steps.structured.previewTitle")}
                      </h2>
                      <p
                        className="max-w-2xl text-sm text-[var(--text-400)]"
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        {isMicro
                          ? t("wizard.steps.structured.microPreviewDescription")
                          : t("wizard.steps.structured.previewDescription")}
                      </p>
                    </div>
                  ) : null}
                  {sq && !isContextLoading("sq") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={regenerateSq}
                      disabled={isContextLoading("sq")}
                      title={t(
                        "wizard.steps.structured.regeneratePreviewTitle",
                      )}
                    >
                      {genButtonLabel(
                        "sq",
                        t("wizard.steps.common.regenerate"),
                      )}
                    </Button>
                  )}
                </div>
              ) : null}
              {!sq && !isContextLoading("sq") ? (
                <div className="rounded-xl border border-dashed border-[var(--border-200)] bg-[var(--bg-200)] p-6">
                  <div className="mx-auto max-w-lg space-y-4 text-center">
                    <p className="text-sm leading-relaxed text-[var(--text-400)]">
                      {t("wizard.steps.structured.previewEmptyDescription")}
                    </p>
                    <Button
                      onClick={generateSq}
                      disabled={isContextLoading("sq")}
                    >
                      {genButtonLabel(
                        "sq",
                        t("wizard.steps.structured.startPreview"),
                      )}
                    </Button>
                  </div>
                </div>
              ) : !sq && isContextLoading("sq") ? (
                conversationMode ? (
                  <SqReferenceLoading
                    isMicro={isMicro}
                    status={sqGenState.status}
                  />
                ) : (
                  <div className="space-y-3 rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] p-4">
                    <div className="space-y-2">
                      <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--bg-300)]" />
                      <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-300)]" />
                      <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--bg-300)]" />
                      <div className="h-20 w-full animate-pulse rounded bg-[var(--bg-300)]" />
                    </div>
                    {renderSqGenBox()}
                  </div>
                )
              ) : sq ? (
                <div className="space-y-5">
                  <SqReferenceContent
                    sq={sq}
                    isMicro={isMicro}
                    conversationMode={conversationMode}
                    loading={conversationMode && isContextLoading("sq")}
                    status={sqGenState.status}
                  />
                  {!conversationMode ? renderSqGenBox() : null}
                  {(conversationMode ||
                    isMicro ||
                    !material ||
                    usesSectionLearning) &&
                    !isContextLoading("sq") && (
                      <div
                        className={`flex flex-col gap-3 rounded-xl border border-[var(--border-200)] p-4 sm:flex-row sm:items-center sm:justify-between ${
                          conversationMode
                            ? "sticky bottom-3 z-10 bg-[var(--bg-50)]/95 shadow-lg backdrop-blur"
                            : "bg-[var(--bg-200)]"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-[var(--text-800)]">
                            {usesSectionLearning
                              ? t(
                                  "wizard.steps.structured.previewCompleteSections",
                                )
                              : t(
                                  "wizard.steps.structured.previewCompleteMaterial",
                                )}
                          </p>
                          <p className="text-xs text-[var(--text-400)]">
                            {t(
                              "wizard.steps.structured.guidingQuestionsReminder",
                            )}
                          </p>
                        </div>
                        <Button
                          className="shrink-0"
                          onClick={() => {
                            if (
                              (hasSections && firstSectionReady) ||
                              Boolean(material)
                            )
                              setStructuredTab("material");
                            else void generateMaterial();
                          }}
                          disabled={isContextLoading("material")}
                        >
                          {conversationMode
                            ? t("learningConversation.continue")
                            : usesSectionLearning
                              ? t("wizard.steps.structured.enterFirstSection")
                              : genButtonLabel(
                                  "material",
                                  t("wizard.steps.structured.enterMaterial"),
                                )}
                        </Button>
                      </div>
                    )}
                </div>
              ) : null}
            </section>
          )}

          {showMaterialPanel && (
            <section
              ref={materialPanelRef}
              className={`scroll-mt-16 relative min-w-0 space-y-4 ${material && (sq || cornell) ? "pb-20" : ""}`}
              role="tabpanel"
            >
              {usesSectionLearning ? (
                <>
                  {hasSections ? (
                    <SectionLearningPanel
                      unitId={unitId}
                      goalId={goalId}
                      isOverview={isOverview}
                      initialSections={persistedSections}
                      initialSectionId={initialSectionId}
                      initialAnchor={initialSectionAnchor}
                      regenerating={isContextLoading("material")}
                      previewMaterial={material}
                      assessmentLocked={assessmentLocked}
                      materialCheckResults={materialCheckResults}
                      onVerifiedAnswer={
                        assessmentLocked ? undefined : submitMaterialCheck
                      }
                      onSubmitSectionMiniTest={
                        assessmentLocked ? undefined : submitSectionMiniTest
                      }
                      onSectionsChanged={setSections}
                      onStopGeneration={() => stopContextGeneration("material")}
                      onAllSectionsCompleted={() =>
                        void finishMaterialReading()
                      }
                      presentationMode={conversationMode ? "chat" : "reading"}
                      miniTestDrafts={sectionMiniTestDrafts}
                      onMiniTestDraftChange={setSectionMiniTestDraft}
                      onActiveSectionChange={onActiveSectionChange}
                      sectionCursors={
                        materialPresentationForRender?.sectionCursors
                      }
                      onSectionCursorChange={
                        handleAssistantSectionCursorActivity
                      }
                    />
                  ) : (
                    <>
                      {conversationMode ? (
                        <ConversationTypingIndicator>
                          {t("wizard.steps.structured.preparingSections")}
                        </ConversationTypingIndicator>
                      ) : (
                        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-200)] bg-[var(--bg-100)] p-6">
                          <p className="text-sm font-medium text-[var(--text-800)]">
                            {t("wizard.steps.structured.preparingSections")}
                          </p>
                          <p className="text-xs text-[var(--text-400)]">
                            {t("wizard.steps.structured.sectionsAutoAppear")}
                          </p>
                          {renderMaterialGenBox()}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {!conversationMode && !usesSectionStyleMaterial ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <h2 className="text-lg font-semibold text-[var(--text-800)]">
                          {t("wizard.steps.structured.materialTitle")}
                        </h2>
                      </div>
                      {material && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={regenerateMaterial}
                            disabled={isContextLoading("material")}
                            title={t(
                              "wizard.steps.structured.regenerateMaterialTitle",
                            )}
                          >
                            {genButtonLabel(
                              "material",
                              t("wizard.steps.common.regenerate"),
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {!material ? (
                    <div className="space-y-3">
                      {!isContextLoading("material") && (
                        <Button
                          onClick={generateMaterial}
                          disabled={isContextLoading("material")}
                        >
                          {genButtonLabel(
                            "material",
                            t("wizard.steps.structured.generateMaterial"),
                          )}
                        </Button>
                      )}
                      {isContextLoading("material") && (
                        <>
                          {conversationMode ? (
                            <ConversationTypingIndicator>
                              {t("wizard.steps.structured.preparingMaterial")}
                            </ConversationTypingIndicator>
                          ) : (
                            <div className="space-y-3 rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] p-4">
                              <div className="space-y-2">
                                <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--bg-300)]" />
                                <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-300)]" />
                                <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--bg-300)]" />
                                <div className="h-20 w-full animate-pulse rounded bg-[var(--bg-300)]" />
                              </div>
                              {renderMaterialGenBox()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {conversationMode ? (
                        <AssistantSectionMaterial
                          userId={getAuthUser()?.id ?? "anonymous"}
                          unitId={unitId}
                          goalId={goalId}
                          sectionId="legacy-material"
                          sectionTitle={unitTitle}
                          sectionNumber={1}
                          contentRevision={assistantCourseClientContentRevision(
                            material,
                          )}
                          material={material}
                          blockOffset={0}
                          complexComponentAnchors={[]}
                          materialCheckResults={materialCheckResults}
                          onVerifiedAnswer={
                            assessmentLocked ? undefined : submitMaterialCheck
                          }
                          busy={materialInteractionBusy}
                          onMaterialChange={setMaterial}
                          onContinue={finishMaterialReading}
                        />
                      ) : usesSectionStyleMaterial ? (
                        <div className="min-w-0 space-y-4">
                          <div className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 sm:p-4">
                            <p className="text-xs font-medium text-[var(--brand-600)]">
                              {t("wizard.steps.structured.linearProgress")}
                            </p>
                            <h2 className="mt-1 text-lg font-semibold text-[var(--text-800)]">
                              {t(
                                "wizard.steps.structured.learningSectionPrefix",
                              )}{" "}
                              {unitTitle}
                            </h2>
                          </div>
                          <AnchoredLearningMaterial
                            unitId={unitId}
                            sectionId="legacy-material"
                            goalId={goalId}
                            material={material}
                            contextSources={materialSources}
                            continuous
                            onMaterialChange={setMaterial}
                            onSlidesCompleted={handleSlidesCompleted}
                            initialPresentation={materialPresentationForRender}
                            onPresentationActivity={handlePresentationActivity}
                            onVerifiedAnswer={
                              assessmentLocked ? undefined : submitMaterialCheck
                            }
                            materialCheckResults={materialCheckResults}
                          />
                          <div className="sticky bottom-3 z-10 flex justify-end rounded-xl border border-[var(--border-200)] bg-[color:var(--bg-50)]/95 p-3 shadow-lg backdrop-blur">
                            <Button
                              disabled={Boolean(materialInteractionBusy)}
                              onClick={() => void finishMaterialReading()}
                            >
                              {t("wizard.steps.structured.finishReading")}
                              <ChevronRight aria-hidden />
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {renderMaterialGenBox()}

                      <div ref={materialContinueRef}>
                        {!cornell && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              onClick={() => void finishMaterialReading()}
                              disabled={materialInteractionBusy}
                            >
                              {materialInteractionBusy
                                ? materialGenState.status ||
                                  t(
                                    "wizard.steps.structured.preparingLessonContent",
                                  )
                                : t("wizard.steps.structured.finishReading")}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setStructuredTab("questions")}
                              disabled={materialInteractionBusy}
                            >
                              {t(
                                "wizard.steps.structured.reviewGuidingQuestions",
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                      {materialGenState.materialContentReady &&
                        isContextLoading("material") &&
                        materialGenState.progress && (
                          <p className="text-xs text-[var(--text-400)]">
                            {t("generation.images.progress", {
                              current: materialGenState.progress.current,
                              total: materialGenState.progress.total,
                            })}
                          </p>
                        )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {hasKacom && structuredTab === "map" && material && (
            <section
              ref={mapPanelRef}
              className="scroll-mt-16 min-w-0"
              role="tabpanel"
            >
              <UnitConceptMapPanel unitId={unitId} />
            </section>
          )}

          {structuredTab === "questions" && sq && material && (
            <section
              ref={questionsPanelRef}
              className="scroll-mt-16 min-w-0 space-y-4"
              role="tabpanel"
            >
              {!conversationMode ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-[var(--text-800)]">
                    {t("wizard.steps.structured.guidingQuestionsReview")}
                  </h2>
                  <p className="text-sm text-[var(--text-400)]">
                    {t("wizard.steps.structured.guidingQuestionsDescription")}
                  </p>
                </div>
              ) : null}
              <GuidingQuestionsRecapContent
                questions={sq.questions}
                answers={sqQuestionAnswers}
                showHeading={!conversationMode}
                onGenerateAnswers={() => void generateSqAnswers()}
                generatingAnswers={generatingSqAnswers}
              />
              <div className="flex flex-wrap gap-2">
                {conversationMode ? (
                  <Button
                    onClick={loadQuiz}
                    disabled={isContextLoading("quiz") || assessmentLocked}
                    title={
                      assessmentLocked
                        ? t("wizard.steps.structured.availableAfterModel")
                        : undefined
                    }
                  >
                    {genButtonLabel(
                      "quiz",
                      t("wizard.steps.structured.enterActiveRecall"),
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => void generateCornellNotes()}
                      disabled={isContextLoading("notes")}
                    >
                      {cornell
                        ? t("wizard.steps.structured.viewNotes")
                        : genButtonLabel(
                            "notes",
                            t("wizard.steps.structured.continueGenerateNotes"),
                          )}
                    </Button>
                    {cornell ? (
                      <Button
                        variant="outline"
                        onClick={() => setStructuredTab("notes")}
                      >
                        {t("wizard.steps.structured.openNotes")}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          )}

          {structuredTab === "notes" && material && (
            <section
              ref={notesPanelRef}
              className="scroll-mt-16 min-w-0 space-y-4"
              role="tabpanel"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--course-content)]">
                  {t("wizard.steps.structured.notesTitle")}
                </h2>
                {cornell && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={generateCornellNotes}
                    disabled={isContextLoading("notes")}
                  >
                    {genButtonLabel(
                      "notes",
                      t("wizard.steps.common.regenerate"),
                    )}
                  </Button>
                )}
              </div>
              {!cornell && !isContextLoading("notes") ? (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--course-content-muted)]">
                    {t("wizard.steps.structured.notesDescription")}
                  </p>
                  <Button
                    onClick={() => {
                      if (sq?.questions?.length) {
                        setStructuredTab("questions");
                        return;
                      }
                      void generateCornellNotes();
                    }}
                    disabled={isContextLoading("notes")}
                  >
                    {sq?.questions?.length
                      ? t("wizard.steps.structured.reviewQuestionsFirst")
                      : genButtonLabel(
                          "notes",
                          t("wizard.steps.structured.generateNotes"),
                        )}
                  </Button>
                </div>
              ) : !cornell && isContextLoading("notes") ? (
                <div className="space-y-3 rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)] p-4">
                  <div className="space-y-2">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--course-content-border)]" />
                    <div className="h-3 w-full animate-pulse rounded bg-[var(--course-content-border)]" />
                    <div className="h-20 w-full animate-pulse rounded bg-[var(--course-content-border)]" />
                  </div>
                  {renderNotesGenBox()}
                </div>
              ) : cornell ? (
                <div className="space-y-4">
                  <CornellReferenceContent cornell={cornell} />
                  {renderNotesGenBox()}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={loadQuiz}
                      disabled={isContextLoading("quiz") || assessmentLocked}
                      title={
                        assessmentLocked
                          ? t("wizard.steps.structured.availableAfterModel")
                          : undefined
                      }
                    >
                      {t("wizard.steps.structured.enterActiveRecall")}
                    </Button>
                    {assessmentLocked ? (
                      <p className="text-xs text-amber-700">
                        {t("wizard.steps.structured.modelPreparingHint")}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
