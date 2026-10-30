/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PlanEditorCard } from "./plan-editor-card";

jest.mock("@xue-learn/core/i18n", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    `${key}${params ? ` ${JSON.stringify(params)}` : ""}`,
}));
jest.mock("@xue-learn/core/ui/button", () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock("./goal-plan-stream-card.tsx", () => ({
  GoalPlanStreamCard: ({ children }: any) => <section>{children}</section>,
}));

it("lets the learner request a bridge for a concrete assumption, without approving or assigning mastery", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const onSubmit = jest.fn();
  const assessment = {
    task: "Explain an unfamiliar example",
    criteria: ["Correct explanation"],
    assistance: "independent",
    context: "near",
  };
  const plan = {
    schemaVersion: 2,
    modules: [{ title: "First module" }],
    learningPath: {
      schemaVersion: 1,
      entities: [
        {
          semanticKey: "prior",
          title: "Fractions",
          kind: "concept",
          scope: "Simple ratios",
          description: "Use ratios",
        },
      ],
      baseline: [
        {
          entityKey: "prior",
          dimensions: ["understanding"],
          threshold: 0.7,
          status: "unknown",
          rationale: "Needed for proportions",
        },
      ],
      goal: { outcomes: [], assessment },
      modules: [
        {
          moduleRef: "m_1",
          requires: [],
          provides: [],
          rationale: "Start with ratios",
          assessment,
          units: [
            {
              unitRef: "u_1_1",
              title: "Ratios",
              summary: "Compare quantities",
              requires: [],
              provides: [],
              assessment,
            },
          ],
        },
      ],
    },
  };
  try {
    await act(async () =>
      root.render(<PlanEditorCard plan={plan as never} onSubmit={onSubmit} />),
    );
    expect(container.textContent).toContain("Fractions");
    expect(container.textContent).toContain("capabilityPath.unknown");
    expect(container.textContent).not.toContain("70%");
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "capabilityPath.needBridge",
    )!;
    await act(async () => button.click());
    expect(onSubmit).toHaveBeenCalledWith({
      approved: false,
      feedback: 'capabilityPath.bridgeFeedback {"title":"Fractions"}',
    });
  } finally {
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
