import { CAPABILITY_QUERY_TOOL_KEYS } from "../../providers/llm/operation-catalog.js";
import type { AgentPageContext } from "../core/types.js";
import type { GlobalAssistantActionToolKey } from "./tools.js";

export type GlobalAssistantIntentBand =
  | "agenda"
  | "reviews"
  | "discovery"
  | "learning"
  | "product"
  | "goal_creation"
  | "navigation"
  | "visualization"
  | "spaces"
  | "web";

export type GlobalAssistantToolSelection = {
  intentBands: GlobalAssistantIntentBand[];
  capabilityToolKeys: string[];
  actionToolKeys: GlobalAssistantActionToolKey[];
  fallbackReason?: string;
};

const MAX_TOOLS = 10;

function matches(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

export function selectGlobalAssistantTools(input: {
  query?: string;
  pageContext?: AgentPageContext;
  goalCreationPaused?: boolean;
  webContextProvided?: boolean;
}): GlobalAssistantToolSelection {
  const query = input.query?.trim() ?? "";
  const bands = new Set<GlobalAssistantIntentBand>();
  const capability = new Set<string>();
  const actions = new Set<GlobalAssistantActionToolKey>();

  if (matches(query, /今天学什么|学习安排|学习日程|容量|agenda|schedule/i)) {
    bands.add("agenda");
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.getCurrentAgenda);
  }
  if (matches(query, /复习|待复习|review|flashcard/i)) {
    bands.add("reviews");
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.getDueReviews);
    actions.add("navigate");
  }
  if (
    matches(
      query,
      /学习空间|空间整理|整理目标|归类目标|先修目标|相关目标|学习路线图|learning space|organize.*goal|roadmap|prerequisite/i,
    )
  ) {
    bands.add("spaces");
  }
  if (input.pageContext?.pageKind === "spaces" || input.pageContext?.pageKind === "space_dashboard") {
    bands.add("spaces");
  }
  const explicitlyDiscoversLearning = matches(
    query,
    /最近学|继续学|打开|查找|搜索|find|search|open|recent/i,
  );
  const mentionsLearningObjects = matches(
    query,
    /目标|课程|单元|goal|course|unit/i,
  );
  if (
    explicitlyDiscoversLearning ||
    (mentionsLearningObjects && !bands.has("spaces"))
  ) {
    bands.add("discovery");
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.searchGoals);
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.searchUnits);
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.getRecentActivity);
    actions.add("navigate");
  }
  if (
    matches(
      query,
      /怎么学|解释|为什么|不懂|掌握|薄弱|知识|资料|来源|偏好|learn|explain|why|source/i,
    )
  ) {
    bands.add("learning");
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.getCurrentLearningObjectives);
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.getCurrentLearningState);
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.findRelevantMemory);
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.searchKnowledge);
    if (matches(query, /资料|来源|文档|source|document/i)) {
      capability.add(CAPABILITY_QUERY_TOOL_KEYS.searchIndexedSources);
    }
  }
  if (matches(query, /好会学|功能|怎么用|学习闭环|GELC|what can you do/i)) {
    bands.add("product");
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.explainLearningApp);
  }
  if (
    matches(
      query,
      /画|绘制|作图|图像|坐标|函数|曲线|向量|几何|三维|可视化|余弦|3d|plot|graph|diagram|vector|coordinate|surface|visuali[sz]e/i,
    )
  ) {
    bands.add("visualization");
  }
  if (
    matches(
      query,
      /创建|新建|继续创建|我想学|想学习|准备学习|creation|create.*goal|want to learn/i,
    )
  ) {
    bands.add("goal_creation");
    capability.add(CAPABILITY_QUERY_TOOL_KEYS.getActiveGoalCreation);
    actions.add("create_goal");
    if (input.goalCreationPaused) actions.add("resume_goal_creation");
  }
  if (
    matches(query, /打开|前往|跳转|设置|导航|open|go to|settings/i) ||
    input.pageContext?.pageKind === "settings"
  ) {
    bands.add("navigation");
    actions.add("navigate");
  }
  if (input.webContextProvided) bands.add("web");

  const capabilityToolKeys = [...capability];
  const actionToolKeys = [...actions];
  const combined = [
    ...actionToolKeys.map((key) => ({ kind: "action" as const, key })),
    ...capabilityToolKeys.map((key) => ({ kind: "capability" as const, key })),
  ].slice(0, MAX_TOOLS);

  return {
    intentBands: [...bands],
    capabilityToolKeys: combined
      .filter((item) => item.kind === "capability")
      .map((item) => item.key),
    actionToolKeys: combined
      .filter((item) => item.kind === "action")
      .map((item) => item.key as GlobalAssistantActionToolKey),
    ...(combined.length === 0 && query
      ? { fallbackReason: "no_tool_intent" }
      : {}),
  };
}
