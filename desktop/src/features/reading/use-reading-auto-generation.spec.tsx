/** @jest-environment jsdom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReadingCourse, ReadingSnapshot } from "@xue-learn/core/domain/reading-document";
import { useReadingAutoGeneration } from "./use-reading-auto-generation";

type Props = Parameters<typeof useReadingAutoGeneration>[0];
const section = (id: string, reading: ReadingSnapshot | null = null): ReadingCourse["sections"][number] =>
  ({ id, title: id, scope: "", reading });
function Probe(props: Props) {
  useReadingAutoGeneration(props);
  return null;
}

let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});
const render = async (props: Props) => {
  await act(async () => root.render(<StrictMode><Probe {...props} /></StrictMode>));
};

it("waits for the saved chapter and the active reading view before generating once", async () => {
  const generate = jest.fn();
  const props: Props = { active: false, loaded: false, pending: false, unitId: "unit", section: section("one"), generate };
  await render(props);
  await render({ ...props, active: true });
  await render({ ...props, loaded: true });
  expect(generate).not.toHaveBeenCalled();
  await render({ ...props, active: true, loaded: true });
  // Strict Mode, unstable callbacks and post-request refetches must not spend twice.
  await render({ ...props, active: true, loaded: true, generate: () => generate() });
  expect(generate).toHaveBeenCalledTimes(1);
});

it.each(["pending", "running", "ready", "failed", "cancelled"] as const)(
  "preserves a saved %s job without starting another generation",
  async status => {
    const generate = jest.fn();
    await render({ active: true, loaded: true, pending: false, unitId: "unit", generate,
      section: section("one", { jobId: "saved", revision: 1, status, document: null, pendingComponents: 0 }) });
    expect(generate).not.toHaveBeenCalled();
  },
);

it("starts newly opened sections but does not loop after a failed start or a mode switch", async () => {
  const generate = jest.fn();
  const props: Props = { active: true, loaded: true, pending: false, unitId: "unit", section: section("one"), generate };
  await render(props);
  await render({ ...props, pending: true });
  await render(props); // A request can fail before it creates a saved job.
  await render({ ...props, active: false });
  await render(props);
  expect(generate).toHaveBeenCalledTimes(1);
  await render({ ...props, section: section("two"), pending: true });
  expect(generate).toHaveBeenCalledTimes(1);
  await render({ ...props, section: section("two") });
  expect(generate).toHaveBeenCalledTimes(2);
  await render(props);
  expect(generate).toHaveBeenCalledTimes(2);
  await render({ ...props, unitId: "another-unit" });
  expect(generate).toHaveBeenCalledTimes(3);
});
