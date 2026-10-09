import { getContentLanguageLabel } from "@/shared/i18n/content-language";
import { collectFormOptionText } from "@/shared/agent/collect-form-values";

/** Mirrors GOAL_CREATION_HUMAN_TOOLS — tools that pause for real user input. */
export const GOAL_CREATION_HUMAN_TOOLS = new Set([
  "ask_clarification",
  "ask_discovery_questions",
  "collect_form",
  "show_confirmation",
  "review_plan",
]);

export const GOAL_CREATION_RESET_UI_KIND = "goal_creation_reset";

export const GOAL_CREATION_UI_KINDS = new Set([
  "discovery_questions",
  "form",
  "confirmation_card",
  "plan_editor",
]);

export function isGoalCreationHumanTool(toolName: string): boolean {
  return GOAL_CREATION_HUMAN_TOOLS.has(toolName);
}

const COLLECT_FORM_LABELS: Record<string, string> = {
  level: "基础水平",
  contentLanguage: "内容语言",
  generationOptions: "补充说明",
  isSmallCourse: "轻课",
};

const LEVEL_LABELS: Record<string, string> = {
  zero: "零基础",
  basic: "有基础",
  advanced: "进阶",
};

function formatCollectForm(
  data: Record<string, unknown>,
  pendingArgs?: Record<string, unknown>,
): string | null {
  const parts: string[] = [];
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const pendingQuestions = Array.isArray(pendingArgs?.questions)
    ? pendingArgs.questions
    : [];
  for (const entry of answers) {
    if (!entry || typeof entry !== "object") continue;
    const { questionId, answer } = entry as {
      questionId?: string;
      answer?: string | string[];
    };
    if (!questionId) continue;
    const question = pendingQuestions.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { id?: string }).id === questionId,
    ) as { text?: string } | undefined;
    const label = question?.text ?? questionId;
    const value = Array.isArray(answer)
      ? answer.join("、")
      : String(answer ?? "");
    if (value) parts.push(`${label}：${value}`);
  }
  for (const [key, label] of Object.entries(COLLECT_FORM_LABELS)) {
    if (data[key] === undefined || data[key] === "") continue;
    if (key === "isSmallCourse" && data[key] !== true) continue;
    let value = collectFormOptionText(data[key]);
    if (!value) continue;
    if (key === "level") {
      value = LEVEL_LABELS[value] ?? value;
    }
    if (key === "contentLanguage") {
      value = value === "auto" ? "自动检测" : getContentLanguageLabel(value);
    }
    if (key === "isSmallCourse") {
      value = "是";
    }
    parts.push(`${label}：${value}`);
  }
  if (data.hasDocuments === true || data.documents) {
    parts.push("已上传学习资料");
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function formatDiscoveryAnswers(
  data: Record<string, unknown>,
  pendingArgs?: Record<string, unknown>,
): string | null {
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const pendingQuestions = Array.isArray(pendingArgs?.questions)
    ? pendingArgs.questions
    : [];
  const values = answers.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as {
      questionId?: string;
      question?: string;
      answer?: string | string[];
    };
    const answer = item.answer;
    const value = Array.isArray(answer)
      ? answer.map(String).filter(Boolean).join("、")
      : String(answer ?? "").trim();
    if (!value) return [];
    const question = pendingQuestions.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        (candidate as { id?: string }).id === item.questionId,
    ) as { text?: string } | undefined;
    const label =
      question?.text?.trim() || item.question?.trim() || item.questionId;
    return [label ? `${label}：${value}` : value];
  });
  return values.length > 0 ? values.join("\n") : null;
}

export function formatGoalCreationUserReply(
  toolName: string,
  result: unknown,
  pendingArgs?: Record<string, unknown>,
): string | null {
  if (!isGoalCreationHumanTool(toolName)) {
    return null;
  }

  const data =
    typeof result === "object" && result
      ? (result as Record<string, unknown>)
      : {};

  if (toolName === "ask_clarification") {
    const answers = Array.isArray(data.answers) ? data.answers : [];
    const first = answers[0] as { answer?: string | string[] } | undefined;
    const cardAnswer = Array.isArray(first?.answer)
      ? first.answer.join("、")
      : first?.answer;
    const answer = String(
      cardAnswer ?? data.answer ?? data.userResponse ?? "",
    ).trim();
    if (!answer) return null;
    const question =
      typeof pendingArgs?.question === "string"
        ? pendingArgs.question.trim()
        : "";
    return question ? `${question}：${answer}` : answer;
  }

  if (toolName === "ask_discovery_questions") {
    return formatDiscoveryAnswers(data, pendingArgs);
  }

  if (toolName === "collect_form") {
    return formatCollectForm(data, pendingArgs);
  }

  if (toolName === "show_confirmation") {
    if (data.approved === true) return "确认创建学习目标";
    if (data.approved === false) return "需要修改后再确认";
    return null;
  }

  if (toolName === "review_plan") {
    if (data.approved === true) return "确认学习计划";
    if (data.approved === false) return "需要调整学习计划";
    return null;
  }

  return null;
}
