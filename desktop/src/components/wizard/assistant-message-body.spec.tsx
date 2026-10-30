/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantMessageBody } from "./assistant-message-body";

jest.mock("@xue-learn/core/i18n", () => ({useT: () => (key: string) => key}));
jest.mock("@/hooks/api/use-learner-profile", () => ({useLearnerDisplayName: () => "Learner"}));
jest.mock("@/components/citations/citation-markdown-content", () => ({
  CitationMarkdownContent: ({content}: {content: string}) => <div data-answer>{content}</div>,
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount());});

it("previews live provider reasoning, appends updates and collapses when the answer starts", async () => {
  await act(async () => root.render(
    <AssistantMessageBody content="" thinking thinkingContent="先核对已知条件。" showCursor />,
  ));
  expect(container.querySelector("[data-thinking-content]")?.textContent).toBe("先核对已知条件。");
  expect(container.querySelector("[data-answer]")).toBeNull();
  await act(async () => root.render(
    <AssistantMessageBody content="" thinking thinkingContent="先核对已知条件。再比较两种方法。" showCursor />,
  ));
  expect(container.querySelector("[data-thinking-content]")?.textContent).toContain("再比较两种方法。");
  await act(async () => root.render(
    <AssistantMessageBody content="可以用代入法。" thinking={false} thinkingContent="先核对已知条件。再比较两种方法。" showCursor />,
  ));
  expect(container.querySelector("[data-thinking-content]")).toBeNull();
  expect(container.querySelector("[data-answer]")?.textContent).toBe("可以用代入法。");
  expect(container.querySelector("[data-thinking-block] .animate-bounce")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("[data-thinking-content]")?.textContent).toContain("再比较两种方法。");
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("[data-thinking-content]")).toBeNull();
});

it("keeps status-only events honest and displays split tagged reasoning separately", async () => {
  await act(async () => root.render(<AssistantMessageBody content="" thinking showCursor />));
  expect(container.querySelector("[data-thinking-content]")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.textContent).toBe("wizard.thinking.loading");
  await act(async () => root.render(<AssistantMessageBody content="<think>核对条件" showCursor />));
  expect(container.querySelector("[data-thinking-content]")?.textContent).toBe("核对条件");
  await act(async () => root.render(<AssistantMessageBody content="<think>核对条件</think>这是回答" showCursor />));
  expect(container.querySelector("[data-answer]")?.textContent).toBe("这是回答");
  expect(container.querySelector("[data-thinking-content]")).toBeNull();
});

it("treats reasoning as plain text and clears an unfinished indicator after cancellation", async () => {
  await act(async () => root.render(<AssistantMessageBody content="<think><img src=x onerror=alert(1)>" showCursor />));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("[data-thinking-block]")?.getAttribute("aria-busy")).toBe("true");
  await act(async () => root.render(<AssistantMessageBody content="<think><img src=x onerror=alert(1)>" />));
  expect(container.querySelector("[data-thinking-block]")?.getAttribute("aria-busy")).toBe("false");
});
