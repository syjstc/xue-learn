import { FEATURE_FEYNMAN } from "@xue-learn/core/features";
import type { TranslationKey } from "@xue-learn/core/i18n";
import type { GenStreamContext, Step } from "./types.ts";

export const STREAM_ACTION_CONTEXT: Record<string, GenStreamContext> = {
  generate_sq: "sq",
  generate_material: "material",
  generate_cornell: "notes",
  generate_quiz: "quiz",
  generate_flashcards: "flashcards",
  prepare_scenario_theater: "theater",
  generate_scenario_scene: "theater",
  prepare_unit_lab: "lab",
};

export const OPERATION_CONTEXT: Record<string, GenStreamContext> = {
  "unit.generate_sq": "sq",
  "unit.generate_material": "material",
  "unit.generate_cornell": "notes",
  "unit.generate_quiz": "quiz",
  "unit.generate_flashcards": "flashcards",
  "unit.prepare_scenario_theater": "theater",
  "unit.generate_scenario_scene": "theater",
  "unit.prepare_unit_lab": "lab",
  "goal.instant_micro": "sq",
  // Legacy trace / older run names
  "unit.sq_preview": "sq",
  "unit.section_plan": "sq",
  "unit.learning_material": "material",
  "unit.cornell": "notes",
  "unit.quiz": "quiz",
  "unit.flashcards": "flashcards",
  "unit.feynman": "feynman",
  "unit.socratic": "socratic",
};

export const CONTEXT_STREAM_OPERATIONS: Record<GenStreamContext, string[]> = {
  sq: ["unit.generate_sq"],
  material: ["unit.generate_material"],
  notes: ["unit.generate_cornell"],
  quiz: ["unit.generate_quiz"],
  flashcards: ["unit.generate_flashcards"],
  feynman: [],
  socratic: [],
  theater: ["unit.prepare_scenario_theater", "unit.generate_scenario_scene"],
  lab: ["unit.prepare_unit_lab"],
};

export const STREAM_START_STATUS: Record<string, TranslationKey> = {
  generate_sq: "generation.sq.preparing",
  generate_material: "generation.material.preparing",
  generate_cornell: "generation.notes.preparing",
  generate_quiz: "generation.quiz.preparing",
  prepare_scenario_theater: "scenario.card.preparing",
  generate_scenario_scene: "scenario.stage.buildingTitle",
  prepare_unit_lab: "learningJourney.labPreparing",
};

export const ALL_STEPS: {
  id: Step;
  label: TranslationKey;
  hint?: TranslationKey | "";
}[] = [
  {
    id: "structured_input",
    label: "desktop.wizard.learningInput",
    hint: "desktop.wizard.readingAndPreview",
  },
  {
    id: "active_recall",
    label: "learningJourney.recall",
    hint: "desktop.wizard.checkWithAQuiz",
  },
  {
    id: "feynman",
    label: "learningConversation.outputCheck",
    hint: "desktop.wizard.explainInYourOwnWords",
  },
  {
    id: "socratic",
    label: "learningJourney.correction",
    hint: "desktop.wizard.aiGuidedCorrections",
  },
  { id: "complete", label: "learningJourney.complete", hint: "" },
];

export const STEPS = FEATURE_FEYNMAN
  ? ALL_STEPS
  : ALL_STEPS.filter((s) => s.id !== "feynman");

export const RESET_REGEN_CONFIRM_SQ =
  "desktop.wizard.thisUnitIsCompleteRegeneratingThePreviewWillResetMasteryQuizRecords";
export const RESET_REGEN_CONFIRM_MATERIAL =
  "desktop.wizard.thisUnitIsCompleteRegeneratingLessonContentWillResetMasteryQuizRecords";
export const RESET_REGEN_CONFIRM_CORNELL =
  "desktop.wizard.thisUnitIsCompleteRegeneratingNotesWillResetMasteryQuizRecordsAnd";
export const REGEN_CONFIRM_SQ_WITH_CONTENT =
  "desktop.wizard.regeneratingThePreviewWillDeleteGeneratedSectionsLessonContentAndLearningNotes";
export const REGEN_CONFIRM_MATERIAL_WITH_SECTIONS =
  "desktop.wizard.regeneratingLessonContentWillClearSectionContentAndProgressAndDeleteExisting";

export const MIN_MATERIAL_PARTIAL_BLOCKS = 1;

export const STREAM_ACTIONS = new Set([
  "generate_sq",
  "generate_material",
  "generate_cornell",
  "generate_quiz",
  "generate_flashcards",
  "prepare_scenario_theater",
  "generate_scenario_scene",
  "prepare_unit_lab",
]);
