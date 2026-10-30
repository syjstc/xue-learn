/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AssessmentReadinessNotice } from "./assessment-readiness-notice";
import type { UnitWizardModel } from "../unit-wizard/use-unit-wizard";
jest.mock("@xue-learn/core/i18n", () => ({ useT: () => (key: string) => key }));

it("offers a separate assessment retry for a failed model and disables it during preparation", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const retryAssessment = jest.fn();
  const model = { learningAccess: { modelPhase: "failed" }, preparingAssessment: false, retryAssessment } as unknown as UnitWizardModel;
  await act(async () => root.render(<AssessmentReadinessNotice model={model} />));
  expect(container.textContent).toContain("assessmentFailed");
  await act(async () => container.querySelector("button")!.click());
  expect(retryAssessment).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<AssessmentReadinessNotice model={{ ...model, preparingAssessment: true }} />));
  expect(container.querySelector("button")!.disabled).toBe(true);
  await act(async () => root.render(<AssessmentReadinessNotice model={{ ...model, learningAccess: { ...model.learningAccess!, modelPhase: "building" } }} />));
  expect(container.querySelector("button")).toBeNull();
  expect(container.textContent).toContain("assessmentLocked");
  await act(async () => root.unmount());
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});
