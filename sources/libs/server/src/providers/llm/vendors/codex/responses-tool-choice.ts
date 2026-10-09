import type { ChatOpenAI } from "@langchain/openai";

export type ResponsesToolChoiceBindOptions = {
  tool_choice?: unknown;
};

/**
 * LangChain `ChatOpenAIResponses.invocationParams` only forwards object
 * `tool_choice` values. Completions-style strings (`required` / `auto` /
 * `none`) become `undefined`, so Codex never sees a forced function call.
 */
export function restoreDroppedResponsesToolChoice<
  T extends { tool_choice?: unknown },
>(params: T, options?: ResponsesToolChoiceBindOptions): T {
  if (params.tool_choice != null || options?.tool_choice == null) {
    return params;
  }
  const choice = options.tool_choice;
  if (choice === "any" || choice === "required") {
    return { ...params, tool_choice: "required" };
  }
  if (choice === "auto" || choice === "none") {
    return { ...params, tool_choice: choice };
  }
  return params;
}

type ResponsesInvocationHost = {
  responses?: {
    invocationParams: (options?: unknown) => { tool_choice?: unknown };
  };
  withConfig: ChatOpenAI["withConfig"];
};

/** Keep `bindTools({ tool_choice: "required" })` on the Responses wire. */
export function patchCodexChatOpenAI<T extends ChatOpenAI>(model: T): T {
  const host = model as T & ResponsesInvocationHost;
  const responses = host.responses;
  if (responses && typeof responses.invocationParams === "function") {
    const original = responses.invocationParams.bind(responses);
    responses.invocationParams = (options?: unknown) =>
      restoreDroppedResponsesToolChoice(
        original(options),
        options as ResponsesToolChoiceBindOptions | undefined,
      );
  }
  if (typeof host.withConfig === "function") {
    const originalWithConfig = host.withConfig.bind(host);
    host.withConfig = ((config) =>
      patchCodexChatOpenAI(
        originalWithConfig(config) as ChatOpenAI,
      )) as ChatOpenAI["withConfig"];
  }
  return model;
}
