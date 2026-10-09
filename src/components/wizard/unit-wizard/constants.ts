import { FEATURE_FEYNMAN } from "@xue-learn/core/source/src/shared/features.ts";
import type { TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
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

export const ALL_STEPS: { id: Step; label: string; hint?: string }[] = [
  { id: "structured_input", label: "学习输入", hint: "阅读与预习" },
  { id: "active_recall", label: "主动回忆", hint: "测验检验" },
  { id: "feynman", label: "输出检验", hint: "用自己的话解释" },
  { id: "socratic", label: "引导修正", hint: "AI 纠错补漏" },
  { id: "complete", label: "完成", hint: "" },
];

export const STEPS = FEATURE_FEYNMAN
  ? ALL_STEPS
  : ALL_STEPS.filter((s) => s.id !== "feynman");

export const RESET_REGEN_CONFIRM_SQ =
  "本单元已完成学习。重新生成预习将重置掌握状态、测验记录、复习计划，并删除已有学习小节、正文与笔记。确定继续吗？";
export const RESET_REGEN_CONFIRM_MATERIAL =
  "本单元已完成学习。重新生成正文将重置掌握状态、测验记录、复习计划，并删除已有学习小节内容与笔记。确定继续吗？";
export const RESET_REGEN_CONFIRM_CORNELL =
  "本单元已完成学习。重新生成笔记将重置掌握状态、测验记录与复习计划。确定继续吗？";
export const REGEN_CONFIRM_SQ_WITH_CONTENT =
  "重新生成预习将删除已生成的学习小节、正文与学习笔记，确定继续吗？";
export const REGEN_CONFIRM_MATERIAL_WITH_SECTIONS =
  "重新生成正文将清空各学习小节内容与进度，并删除已有学习笔记，确定继续吗？";

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
