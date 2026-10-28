import { z } from "zod";
import {
  assembleCornellItems,
  cornellJitItemsSchema,
  type CornellJitItem,
} from "../llm/jit-structured-items.js";
import { buildCornellJsonPrompt } from "../learning-systems/capabilities/unit-content/cornell-prompt.js";

export type PrepareCornellAuthoringInput = {
  unitTitle: string;
  goalBlock: string;
  difficultyBlock: string;
  timeBudgetBlock: string;
  styleBlock: string;
  languageBlock: string;
  optionsBlock?: string;
  sqJson: string;
  materialJson: string;
  context?: string;
};

function parseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

export function cornellItemsFromCommitArgs(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { items?: unknown }).items)
  ) {
    return (value as { items: unknown[] }).items;
  }
  return value;
}

/** Compact continuation when Survey/material already live in authoring history. */
export function buildCornellHistoryContinuationPrompt(input: {
  unitTitle: string;
  languageBlock: string;
  styleBlock?: string;
  optionsBlock?: string;
  context?: string;
}): string {
  return `Generate Cornell study notes for "${input.unitTitle}" from the accepted Survey and learning material already in this conversation.
Do not rewrite Survey or material. Return note items first, then recall-cue items, then exactly one summary item.
Notes are distilled study notes rather than a copy of the textbook. The summary is a 2-4 sentence synthesis.
Call commit_cornell with {"items":[{"kind":"note"|"cue"|"summary","text":"..."}, ...]}.
${input.styleBlock?.trim() ? `${input.styleBlock.trim()}\n` : ""}${input.optionsBlock?.trim() ? `${input.optionsBlock.trim()}\n` : ""}${input.languageBlock.trim()}
${input.context?.trim() ? `\nContext:\n${input.context.trim()}` : ""}`;
}

export function cornellHistoryResultSchema() {
  return z.preprocess(
    cornellItemsFromCommitArgs,
    cornellJitItemsSchema.transform(assembleCornellItems),
  );
}

/** Provider-independent Cornell-note contract shared by hosted and local. */
export function prepareCornellAuthoring(input: PrepareCornellAuthoringInput) {
  const contextInvocation = {
    ...input,
    optionsBlock: input.optionsBlock ?? "",
    context: input.context ?? "",
  };
  const prompt = buildCornellJsonPrompt(contextInvocation);
  const resultSchema = cornellJitItemsSchema.transform(assembleCornellItems);
  return {
    operation: "unit.cornell" as const,
    prompt,
    contextInvocation,
    itemSchema: cornellJitItemsSchema.element,
    itemsSchema: cornellJitItemsSchema,
    resultSchema,
    parseProviderOutput(content: string) {
      return resultSchema.parse(parseJson(content));
    },
  };
}

export type { CornellJitItem };
