import type { AgentToolDef } from "../core/types.js";
import { CAPABILITY_QUERY_TOOL_KEYS } from "../../providers/llm/operation-catalog.js";

type CapabilityResult<T> = { data?: T };
type Presentation = Pick<AgentToolDef, "renderUi">;

export const GLOBAL_ASSISTANT_TOOL_PRESENTATIONS: Readonly<
  Record<string, Presentation>
> = {
  [CAPABILITY_QUERY_TOOL_KEYS.searchGoals]: {
    renderUi: (_args, result) => {
      const goals =
        (
          result as CapabilityResult<{
            goals?: Array<{ id: string; title: string }>;
          }>
        ).data?.goals ?? [];
      if (goals.length === 0) return null;
      return {
        uiKind: "action_buttons",
        args: {
          title: `找到 ${goals.length} 个目标`,
          actions: goals.slice(0, 4).map((goal) => ({
            kind: "link",
            label: goal.title,
            href: `/goals/${goal.id}`,
            variant: "primary",
          })),
        },
      };
    },
  },
  [CAPABILITY_QUERY_TOOL_KEYS.searchUnits]: {
    renderUi: (_args, result) => {
      const units =
        (
          result as CapabilityResult<{
            units?: Array<{
              id: string;
              title: string;
              goalId: string;
              goalTitle: string;
            }>;
          }>
        ).data?.units ?? [];
      if (units.length === 0) return null;
      return {
        uiKind: "action_buttons",
        args: {
          title: `找到 ${units.length} 个学习单元`,
          actions: units.slice(0, 4).map((unit) => ({
            kind: "link",
            label: `${unit.title}（${unit.goalTitle}）`,
            href: `/goals/${unit.goalId}/units/${unit.id}`,
            variant: "primary",
          })),
        },
      };
    },
  },
  [CAPABILITY_QUERY_TOOL_KEYS.getRecentActivity]: {
    renderUi: (_args, result) => {
      const data = (
        result as CapabilityResult<{
          goals?: Array<{ id: string; title: string }>;
          units?: Array<{ id: string; title: string; goalId: string }>;
        }>
      ).data;
      const actions = [
        ...(data?.units ?? []).slice(0, 3).map((unit) => ({
          kind: "link",
          label: unit.title,
          href: `/goals/${unit.goalId}/units/${unit.id}`,
          variant: "primary",
        })),
        ...(data?.goals ?? []).slice(0, 2).map((goal) => ({
          kind: "link",
          label: goal.title,
          href: `/goals/${goal.id}`,
          variant: "secondary",
        })),
      ];
      return actions.length
        ? { uiKind: "action_buttons", args: { title: "最近学习", actions } }
        : null;
    },
  },
  [CAPABILITY_QUERY_TOOL_KEYS.getDueReviews]: {
    renderUi: (_args, result) => {
      const data = (
        result as CapabilityResult<{
          dueCount?: number;
          cards?: Array<{ unitTitle: string; goalId: string; unitId: string }>;
        }>
      ).data;
      const cards = data?.cards ?? [];
      if ((data?.dueCount ?? 0) <= 0 && cards.length === 0) return null;
      return {
        uiKind: "action_buttons",
        args: {
          title: `有 ${data?.dueCount ?? cards.length} 个单元待复习`,
          actions: [
            {
              kind: "link",
              label: "开始复习",
              href: "/reviews",
              variant: "primary",
            },
            ...cards.slice(0, 3).map((card) => ({
              kind: "link",
              label: `打开：${card.unitTitle}`,
              href: `/goals/${card.goalId}/units/${card.unitId}`,
              variant: "secondary",
            })),
          ],
        },
      };
    },
  },
  [CAPABILITY_QUERY_TOOL_KEYS.getActiveGoalCreation]: {
    renderUi: (_args, result) => {
      const session = (
        result as CapabilityResult<{
          session?: { title?: string | null; status?: string } | null;
        }>
      ).data?.session;
      if (!session) return null;
      return {
        uiKind: "action_buttons",
        args: {
          title: session.title
            ? `正在创建：${session.title}`
            : "当前目标正在创建",
          actions: [
            {
              kind: "client",
              clientAction: "open_goal_creation",
              label:
                session.status === "stopped" ? "查看创建草稿" : "打开创建进度",
              variant: "primary",
            },
          ],
        },
      };
    },
  },
};
