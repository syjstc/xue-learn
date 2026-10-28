import type { ExplanationCode } from "./types.js";

const EN: Record<ExplanationCode, string> = {
  overdue_review:
    "This review is overdue — catching up protects what you already learned.",
  due_review: "A spaced review is due today to keep this lesson fresh.",
  knowledge_gap:
    "Focused practice is scheduled for a critical knowledge gap supported by task evidence.",
  composition_gap:
    "An integration task is scheduled because the parts are ready but coordination is not yet demonstrated.",
  transfer_gap:
    "A new-context task is scheduled to build missing transfer evidence.",
  stability_gap:
    "A delayed check is due to validate that learning remains stable over time.",
  continue_in_progress:
    "Finish the lesson you already started before opening a new one.",
  next_after_prereqs: "Next new lesson with prerequisites satisfied.",
  goal_priority: "Prioritized for a goal you marked as important.",
  capacity_rebalance: "Fit into today’s study capacity after other work.",
  moved_from_missed:
    "Rebuilt from missed work within today’s capacity — not an endless backlog.",
  balanced_across_goals:
    "Balanced so active goals each get attention this week.",
};

const ZH_HANS: Record<ExplanationCode, string> = {
  overdue_review: "这篇复习已逾期，先补上有助于保住已学内容。",
  due_review: "今天到期的间隔复习，巩固这一课。",
  knowledge_gap: "任务证据显示存在关键知识缺口，安排针对性练习。",
  composition_gap: "组件已具备但协同尚未证实，安排整合任务。",
  transfer_gap: "迁移证据不足，安排新的跨情境任务。",
  stability_gap: "现在适合延迟复测，验证学习是否长期稳定。",
  continue_in_progress: "先完成你已开始的课，再开新课。",
  next_after_prereqs: "前置已满足，可以学下一课。",
  goal_priority: "你标记为更重要的目标，优先安排。",
  capacity_rebalance: "按今日可学习时长，排在其他任务之后。",
  moved_from_missed: "把错过的任务在今日容量内重排，不会无限堆积。",
  balanced_across_goals: "在多个进行中目标之间做了平衡。",
};

const ZH_HANT: Record<ExplanationCode, string> = {
  overdue_review: "這篇複習已逾期，先補上有助於保住已學內容。",
  due_review: "今天到期的間隔複習，鞏固這一課。",
  knowledge_gap: "任務證據顯示存在關鍵知識缺口，安排針對性練習。",
  composition_gap: "組件已具備但協同尚未證實，安排整合任務。",
  transfer_gap: "遷移證據不足，安排新的跨情境任務。",
  stability_gap: "現在適合延遲複測，驗證學習是否長期穩定。",
  continue_in_progress: "先完成你已開始的課，再開新課。",
  next_after_prereqs: "前置已滿足，可以學下一課。",
  goal_priority: "你標記為更重要的目標，優先安排。",
  capacity_rebalance: "按今日可學習時長，排在其他任務之後。",
  moved_from_missed: "把錯過的任務在今日容量內重排，不會無限堆積。",
  balanced_across_goals: "在多個進行中目標之間做了平衡。",
};

export function explanationForCode(
  code: ExplanationCode,
  locale: string = "zh-Hans",
): string {
  if (locale.startsWith("en")) return EN[code];
  if (
    locale === "zh-Hant" ||
    locale.startsWith("zh-TW") ||
    locale.startsWith("zh-HK")
  ) {
    return ZH_HANT[code];
  }
  return ZH_HANS[code];
}

export function withExplanation(
  code: ExplanationCode,
  locale?: string,
): { explanationCode: ExplanationCode; explanation: string } {
  return {
    explanationCode: code,
    explanation: explanationForCode(code, locale),
  };
}
