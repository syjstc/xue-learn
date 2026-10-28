import { getRuntimeEnvironment } from "../env.js";
import { isAdvancedHtmlDiagramsEnabled } from "../../../common/src/index.js";
import { wrapInteractiveHtmlDocument } from "./safe-interactive-html.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";
import { interactiveHtmlSchema, type InteractiveBlock } from "./schemas.js";
import { buildMaterialComponentInvocationPrompt, HTML_PLAYGROUND_STABLE_INSTRUCTION } from "../learning-systems/capabilities/material-components/capability.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "../learning-systems/capabilities/material-components/keys.js";
import { parseLlmJson } from "./sanitize-response.js";
import {
  courseSvgIntentIssue,
  type CourseSvgIntent,
} from "./course-svg-intent.js";

export function prepareCourseHtmlGeneration(params: {
  intent: CourseSvgIntent;
  unitTitle: string;
  language: string;
  context: string;
}) {
  const operation = "unit.learning_material.html_generate" as const;
  const invocation = {
    unitTitle: params.unitTitle,
    language: params.language,
    context: params.context,
    intent: params.intent,
  };
  const prompt =
    buildMaterialComponentInvocationPrompt(
      MATERIAL_COMPONENT_VIEW_KEYS.htmlInstructionContext,
      invocation,
    ) ?? "";
  return {
    operation,
    invocation,
    prompt,
    standalonePrompt: `${HTML_PLAYGROUND_STABLE_INSTRUCTION}\n\n${prompt}`,
    bindingSchema: interactiveHtmlSchema,
    resultSchema: interactiveHtmlSchema,
    intentIssue: courseSvgIntentIssue(params.intent),
    parseProviderOutput(content: string) {
      const candidate = parseLlmJson<unknown>(content);
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return interactiveHtmlSchema.parse(candidate);
      }
      const source = candidate as Record<string, unknown>;
      const wrapped =
        typeof source.html === "string"
          ? wrapInteractiveHtmlDocument(source.html)
          : null;
      return interactiveHtmlSchema.parse({
        ...source,
        type: "interactive_html",
        html: wrapped ?? source.html,
        visualKind: params.intent.visualKind,
      });
    },
  };
}

export async function generateCourseInteractiveHtml(params: {
  intent: CourseSvgIntent;
  unitTitle: string;
  language: string;
  context: string;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onPartial?: (block: InteractiveBlock) => void | Promise<void>;
}): Promise<InteractiveBlock | null> {
  if (
    !isAdvancedHtmlDiagramsEnabled(getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1")
  ) {
    return null;
  }
  const prepared = prepareCourseHtmlGeneration(params);
  if (prepared.intentIssue) return null;
  const block = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: interactiveHtmlSchema,
      prompt: prepared.prompt,
      options: {
        operation: prepared.operation,
        bindingSchema: interactiveHtmlSchema,
        deepseekStrictOnly: true,
        meta: {
          ...params.meta,
          unitTitle: params.unitTitle,
          intent: params.intent.learningGoal,
          visualKind: params.intent.visualKind,
          outputFormat: "interactive_html_document",
        },
      },
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
      contextInvocation: prepared.invocation,
      recoveryPolicy: {
        sourceSchema: interactiveHtmlSchema,
        normalize: (candidate) => {
          if (
            !candidate ||
            typeof candidate !== "object" ||
            Array.isArray(candidate)
          ) {
            return { value: candidate };
          }
          const source = candidate as Record<string, unknown>;
          const html =
            typeof source.html === "string"
              ? wrapInteractiveHtmlDocument(source.html)
              : null;
          return {
            value: {
              ...source,
              type: "interactive_html",
              html: html ?? source.html,
              visualKind: params.intent.visualKind,
            },
            normalizedCount: html && html !== source.html ? 1 : 0,
          };
        },
        repairSlots: () => [],
      },
    },
    {
      signal: params.signal,
      onPartial: params.onPartial
        ? async (candidate) => {
            const parsed = interactiveHtmlSchema.safeParse(candidate);
            if (parsed.success) await params.onPartial?.(parsed.data);
          }
        : undefined,
    },
  );
  if (!block || block.type !== "interactive_html") return null;
  const wrapped = wrapInteractiveHtmlDocument(block.html);
  if (!wrapped) return null;
  return { ...block, html: wrapped, visualKind: params.intent.visualKind };
}
