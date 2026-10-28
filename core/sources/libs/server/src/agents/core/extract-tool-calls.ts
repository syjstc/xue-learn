import type { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { extractAssistantText } from "../../llm/sanitize-response.js";
import { toolArgsAreEmpty } from "./streamed-tool-args.js";
import type { AgentToolCallRecord } from "./types.js";

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function nativeToolCalls(
  msg: AIMessage | AIMessageChunk,
): AgentToolCallRecord[] {
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  return calls.map((tc, index) => ({
    id: tc.id ?? `agent-tool-${Date.now()}-${index}`,
    name: tc.name,
    args: parseToolArgs(tc.args),
  }));
}

function invalidToolCalls(
  msg: AIMessage | AIMessageChunk,
  allowed: Set<string>,
): AgentToolCallRecord[] {
  const recovered: AgentToolCallRecord[] = [];
  const calls = Array.isArray(msg.invalid_tool_calls)
    ? msg.invalid_tool_calls
    : [];
  for (const [index, inv] of calls.entries()) {
    const name = inv.name;
    if (!name || !allowed.has(name)) continue;
    recovered.push({
      id: inv.id ?? `agent-tool-invalid-${Date.now()}-${index}`,
      name,
      args: parseToolArgs(inv.args),
    });
  }
  return recovered;
}

function extractHeuristicToolArgs(
  name: string,
  text: string,
): Record<string, unknown> {
  if (name === "create_goal") {
    const seedTopic =
      text.match(/seedTopic["'\s:]*["']([^"']+)["']/i)?.[1]?.trim() ??
      text
        .match(/(?:启动|创建|新建|开始|生成)(?:[^「『“"']{0,24})[「『“"']([^」』”"']+)[」』”"'](?:[^。！？!?]{0,40})(?:学习地图|学习目标|目标|创建流程|创建过程|流程)/u)?.[1]
        ?.trim() ??
      text.match(/想学(?:习)?[「『“"']([^」』”"']+)[」』”"']/u)?.[1]?.trim() ??
      text.match(/关于[「『“"']([^」』”"']+)[」』”"']/u)?.[1]?.trim() ??
      text
        .match(/[「『“"']([^」』”"']+)[」』”"'][\s\S]{0,24}(?:学习|目标|地图)/u)?.[1]
        ?.trim();
    return seedTopic ? { seedTopic } : {};
  }
  if (name === "navigate") {
    const path = text
      .match(/(?:path|路径)["'\s:]*["']([^"']+)["']/i)?.[1]
      ?.trim();
    return path ? { path } : {};
  }
  return {};
}

function isExplanatoryGoalCreationReply(text: string): boolean {
  return (
    /(很简单|只需要|只要|步骤|告诉我|说一下|举个例子|例如[：:]|比如[：:])/u.test(
      text,
    ) && /(创建|新建).{0,12}(学习)?目标/u.test(text)
  );
}

function recoverCreateGoalFromNaturalLanguage(
  text: string,
): AgentToolCallRecord | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isExplanatoryGoalCreationReply(trimmed)) return null;

  const hasGoalCreationIntent =
    /(启动|创建|新建|开始|准备|帮你).{0,40}(学习目标|目标创建|创建流程|创建过程)/u.test(
      trimmed,
    ) ||
    /(学习目标|目标创建).{0,40}(启动|创建|新建|开始|准备)/u.test(trimmed);

  if (!hasGoalCreationIntent) return null;

  const args = extractHeuristicToolArgs("create_goal", trimmed);
  return {
    id: `agent-tool-natural-${Date.now()}`,
    name: "create_goal",
    args,
  };
}

function recoverToolCallsFromContent(
  text: string,
  allowed: Set<string>,
): AgentToolCallRecord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const jsonPattern =
    /\{\s*"name"\s*:\s*"([a-z_][a-z0-9_]*)"\s*,\s*"(?:arguments|parameters)"\s*:\s*([\s\S]*?)\s*\}/gi;
  for (const match of trimmed.matchAll(jsonPattern)) {
    const name = match[1];
    if (!name || !allowed.has(name)) continue;
    try {
      const args = JSON.parse(match[2]!);
      return [
        {
          id: `agent-tool-json-${Date.now()}`,
          name,
          args: parseToolArgs(args),
        },
      ];
    } catch {
      continue;
    }
  }

  if (allowed.has("create_goal")) {
    const recovered = recoverCreateGoalFromNaturalLanguage(trimmed);
    if (recovered) return [recovered];
  }

  for (const name of allowed) {
    const intent = new RegExp(
      `(?:调用|使用|执行|call(?:ing)?|use|using|invoke).*?(?:\`|'|"|\\b)${name}(?:\`|'|"|\\b)`,
      "i",
    );
    if (!intent.test(trimmed)) continue;
    return [
      {
        id: `agent-tool-intent-${Date.now()}`,
        name,
        args: extractHeuristicToolArgs(name, trimmed),
      },
    ];
  }

  return [];
}

function healEmptyNativeToolCalls(
  native: AgentToolCallRecord[],
  invalid: AgentToolCallRecord[],
): AgentToolCallRecord[] {
  if (invalid.length === 0) return native;
  return native.map((tc) => {
    if (!toolArgsAreEmpty(tc.args)) return tc;
    const recovered = invalid.find(
      (item) =>
        item.name === tc.name &&
        !toolArgsAreEmpty(item.args) &&
        (!item.id || !tc.id || item.id === tc.id),
    );
    return recovered ? { ...tc, args: recovered.args } : tc;
  });
}

/** Native tool_calls, invalid_tool_calls, then text recovery for weak local models. */
export function extractAgentToolCalls(
  msg: AIMessage | AIMessageChunk,
  allowedToolNames: Iterable<string>,
): AgentToolCallRecord[] {
  const allowed = new Set(allowedToolNames);

  const native = nativeToolCalls(msg).filter((tc) => allowed.has(tc.name));
  const invalid = invalidToolCalls(msg, allowed);
  if (native.length > 0) return healEmptyNativeToolCalls(native, invalid);
  if (invalid.length > 0) return invalid;

  const text = extractAssistantText(msg);
  return recoverToolCallsFromContent(text, allowed);
}
