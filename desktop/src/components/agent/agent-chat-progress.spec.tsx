/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "./agent-chat";
import type { PlanningProgress } from "@/hooks/use-agent-thread";

jest.mock("@xue-learn/core/i18n", () => ({
  useT: () => (key: string) => key,
}));
jest.mock("@xue-learn/core/ui/button", () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));
jest.mock("./assistant-welcome-panel.tsx", () => ({
  AssistantReviewReminder: () => null,
  AssistantWelcomePanel: () => null,
}));
jest.mock("./goal-plan-stream-card.tsx", () => ({
  GoalPlanStreamCard: () => <div>streamed-plan</div>,
}));
jest.mock("./tool-ui-renderer.tsx", () => ({
  ToolUiRenderer: () => <div data-testid="plan-editor">previous-plan</div>,
}));
jest.mock("@/components/wizard/assistant-message-body", () => ({
  AssistantMessageBody: ({ content }: any) => <div>{content}</div>,
}));
jest.mock("@/components/desktop-python-editor/python-ask-ai-message", () => ({
  PythonAskAiUserMessage: () => null,
}));

it("replaces the old plan with revision feedback, follows live updates, and offers retry after failure", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const retry = jest.fn();
  const pendingToolUi = {
    toolCallId: "review-1",
    toolName: "review_plan",
    uiKind: "plan_editor",
    args: {},
  };
  const base = {
    messages: [{ id: "review", role: "assistant" as const, content: "", toolUi: pendingToolUi }],
    pendingToolUi,
    streaming: false,
    phase: "reviewing_plan",
    error: "",
    goalCreationActive: true,
    hideDeepPlanningProgress: true,
    onSend: jest.fn(),
    onResume: jest.fn(),
    onRetry: retry,
  };
  const progress: PlanningProgress = {
    active: true,
    stage: "revising_plan",
    stageMessage: "正在补充所缺的基础，并重新检查学习顺序",
    updates: [],
    activities: [],
    warnings: [],
  };
  try {
    await act(async () => root.render(<AgentChat {...base} />));
    expect(container.textContent).toContain("previous-plan");
    await act(async () => root.render(
      <AgentChat {...base} streaming phase="generating_plan" planningProgress={progress} />,
    ));
    expect(container.querySelector('[data-testid="plan-editor"]')).toBeNull();
    expect(container.textContent).toContain(progress.stageMessage);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("planning.revising");
    await act(async () => root.render(
      <AgentChat {...base} streaming phase="generating_plan" planningProgress={{
        ...progress,
        updates: [{ id: "path", sequence: 2, category: "validation", status: "active", message: "已补入换算基础，正在核对后续 8 个模块", elapsedSeconds: 12 }],
      }} />,
    ));
    expect(container.textContent).toContain("已补入换算基础，正在核对后续 8 个模块");
    await act(async () => root.render(<AgentChat {...base} error="这次调整未完成，请重试" canRetry />));
    const retryButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "errors.retry")!;
    expect(retryButton.disabled).toBe(false);
    await act(async () => retryButton.click());
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
