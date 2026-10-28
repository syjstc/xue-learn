import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { extractAgentToolCalls } from "../agents/core/extract-tool-calls.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import {
  defineAgentTool,
  toLangChainTools,
} from "../agents/core/tools.js";
import {
  componentCompileBindingSchemaForType,
  complexInteractiveBlockTypeSchema,
  interactiveBlockSchema,
  interactiveBlockSchemaForType,
  type ComplexInteractiveBlockType,
  type InteractiveBlock,
} from "./schemas.js";
import { beginLlmRequestLog } from "./logger.js";
import {
  parseMessageForLog,
  serializeChatMessagesForLog,
} from "./parse-log-response.js";
import { formatStructuredParseError } from "./parse-structured.js";
import { extractAssistantText, parseLlmJson } from "./sanitize-response.js";
import { extractTokenUsage, usageLogFields } from "./token-usage.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";
import {
  prepareGenerationInvocation,
  runMergedGenerationContextScope,
} from "../generation/kernel.js";
import {
  canonicalLlmOperationKey,
  getActiveLlmOperationRoute,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import { qwenRequiresAutoToolChoice } from "../providers/llm/vendors/qwen/options.js";
import { buildMaterialComponentInvocationPrompt } from "../learning-systems/capabilities/material-components/capability.js";
import { MATERIAL_COMPONENT_COMPILE_STABLE_INSTRUCTION } from "../learning-systems/capabilities/material-components/capability.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "../learning-systems/capabilities/material-components/keys.js";

export type ComponentIntent = {
  type: ComplexInteractiveBlockType;
  description: string;
};

type CheckBlock = Extract<InteractiveBlock, { type: "check" }>;

export const checkBlockSchema = z
  .object({
    type: z.literal("check"),
    checkId: z.string().min(1).optional(),
    question: z.string(),
    options: z.array(z.string()).min(2).max(8),
    correctIndex: z.number().int().min(0),
    explanation: z.string(),
    primaryLearningTargetId: z
      .string()
      .regex(/^lt_\d+$/)
      .optional(),
    learningTargetIds: z.array(z.string().regex(/^lt_\d+$/)).min(1),
    targetCognitiveEntityId: z.string().min(1).optional(),
    evidenceDimension: z.enum(["memory", "understanding", "application"]),
    criterionRef: z.string().regex(/^lt_\d+:c\d+$/),
    contextDistance: z.enum(["same", "near"]),
  })
  .superRefine((block, ctx) => {
    if (block.correctIndex >= block.options.length) {
      ctx.addIssue({
        code: "custom",
        path: ["correctIndex"],
        message: "correctIndex must point to an existing option",
      });
    }
  });

const INTENT_LINE_NUMBER_PREFIX = /^\d+\s*(?:\||[:：])\s*(?=CI\s*‖)/i;

/** Repair responses may prefix lines with `12|CI‖…`; strip before parsing intents. */
function isCompiledIntentLine(line: string): boolean {
  const trimmed = line.trim().replace(INTENT_LINE_NUMBER_PREFIX, "");
  return /^CI\s*‖/.test(trimmed);
}

export function parseComponentIntentLine(line: string): ComponentIntent | null {
  const trimmed = line.trim().replace(INTENT_LINE_NUMBER_PREFIX, "");
  const first = trimmed.indexOf("‖");
  const second = first < 0 ? -1 : trimmed.indexOf("‖", first + 1);
  if (trimmed.slice(0, first).trim() !== "CI" || second < 0) return null;
  const type = complexInteractiveBlockTypeSchema.safeParse(
    trimmed.slice(first + 1, second).trim(),
  );
  const description = trimmed.slice(second + 1).trim();
  if (!type.success || !description) return null;
  return { type: type.data, description };
}

export function componentDslLine(block: InteractiveBlock): string {
  return `COMP‖${JSON.stringify(JSON.stringify(block))}`;
}

function cleanDslField(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/‖/g, "｜")
    .replace(/[;；]/g, "，")
    .trim();
}

export function checkDslLine(block: CheckBlock): string {
  const options = (block.options ?? []).map(cleanDslField).join(";");
  const fields = [
    "Q",
    cleanDslField(block.question),
    options,
    String(block.correctIndex ?? ""),
    cleanDslField(block.explanation),
    block.learningTargetIds.join(","),
  ];
  return fields.join("‖");
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStepSortSequence(
  value: unknown,
): Array<{ id: string; content: string; order: number }> | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const items = value
    .map((item, index) => {
      if (typeof item === "string") {
        const content = item.trim();
        if (!content) return null;
        return {
          id: `s${index + 1}`,
          content,
          order: index + 1,
        };
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const content = asTrimmedString(
        record.content ??
          record.text ??
          record.label ??
          record.description ??
          record.body,
      );
      if (!content) return null;
      const id = asTrimmedString(record.id ?? record.key) || `s${index + 1}`;
      const rawOrder = record.order ?? record.position ?? record.index;
      const order =
        typeof rawOrder === "number" && Number.isFinite(rawOrder)
          ? Math.trunc(rawOrder)
          : typeof rawOrder === "string" && rawOrder.trim()
            ? Number.parseInt(rawOrder, 10)
            : index + 1;
      return {
        id,
        content,
        order: Number.isFinite(order) ? order : index + 1,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length < 2) return null;

  // Sort by model-provided order (incl. zero-based), then renumber to 1..N.
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      id: item.id,
      content: item.content,
      order: index + 1,
    }));
}

function normalizeStepSortComponent(
  component: Record<string, unknown>,
): Record<string, unknown> | null {
  const rawSequence =
    component.correct_sequence ??
    component.correctSequence ??
    component.steps ??
    component.sequence ??
    component.items;
  const correct_sequence = normalizeStepSortSequence(rawSequence);
  if (!correct_sequence) return null;

  const title =
    asTrimmedString(component.title) ||
    asTrimmedString(component.name) ||
    "步骤排序";
  const dependency_hint = asTrimmedString(
    component.dependency_hint ??
      component.dependencyHint ??
      component.hint ??
      "",
  );

  return {
    ...component,
    type: "step_sort",
    title,
    correct_sequence,
    dependency_hint,
  };
}

function normalizeChartComponent(
  component: Record<string, unknown>,
): Record<string, unknown> | null {
  const normalized = { ...component };
  let changed = false;
  if (
    Array.isArray(normalized.data) &&
    normalized.data.some(
      (row) =>
        row != null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Array.isArray((row as Record<string, unknown>).entries),
    )
  ) {
    normalized.data = normalized.data.map((row) => {
      const record = parseComponentPayload(row);
      if (!record || !Array.isArray(record.entries)) return row;
      return Object.fromEntries(
        record.entries.flatMap((entry) => {
          const item = parseComponentPayload(entry);
          if (!item || typeof item.key !== "string") return [];
          return [
            [
              item.key,
              item.valueType === "number" ? item.numberValue : item.stringValue,
            ],
          ];
        }),
      );
    });
    changed = true;
  }
  if (Array.isArray(normalized.series)) {
    const series = normalized.series.map((value) => {
      const item = parseComponentPayload(value);
      if (!item) return value;
      const next = { ...item };
      for (const key of ["color", "unit"] as const) {
        if (typeof next[key] === "string" && !next[key].trim()) {
          delete next[key];
          changed = true;
        }
      }
      return next;
    });
    normalized.series = series;
  }
  for (const key of ["categoryKey", "xKey", "yKey"] as const) {
    if (typeof normalized[key] === "string" && !normalized[key].trim()) {
      delete normalized[key];
      changed = true;
    }
  }
  for (const key of ["xLabel", "yLabel", "unit"] as const) {
    if (typeof normalized[key] === "string" && !normalized[key].trim()) {
      delete normalized[key];
      changed = true;
    }
  }
  return changed ? normalized : null;
}

function normalizeMathSceneComponent(
  component: Record<string, unknown>,
): Record<string, unknown> {
  const coordinate = (x: unknown, y: unknown, z: unknown) =>
    component.dimension === "3d" ? [x, y, z] : [x, y];
  const strictWireObjects =
    component.objects == null
      ? [
          ...(Array.isArray(component.points)
            ? component.points.map((value) => {
                const point = parseComponentPayload(value) ?? {};
                return {
                  id: point.id,
                  label: point.label,
                  draggable: point.draggable,
                  kind: "point",
                  position: coordinate(point.x, point.y, point.z),
                };
              })
            : []),
          ...(Array.isArray(component.vectors)
            ? component.vectors.map((value) => {
                const vector = parseComponentPayload(value) ?? {};
                return {
                  id: vector.id,
                  label: vector.label,
                  draggable: vector.draggable,
                  kind: "vector",
                  start: coordinate(
                    vector.startX,
                    vector.startY,
                    vector.startZ,
                  ),
                  end: coordinate(vector.endX, vector.endY, vector.endZ),
                  ...(vector.relationOperation === "sum" ||
                  vector.relationOperation === "difference"
                    ? {
                        relation: {
                          operation: vector.relationOperation,
                          operands: [
                            vector.relationOperandA,
                            vector.relationOperandB,
                          ],
                        },
                      }
                    : vector.relationOperation === "scale"
                      ? {
                          relation: {
                            operation: vector.relationOperation,
                            operand: vector.relationOperandA,
                            factor: vector.relationFactor,
                            ...(typeof vector.relationFactorParameter ===
                              "string" && vector.relationFactorParameter.trim()
                              ? {
                                  factorParameter:
                                    vector.relationFactorParameter,
                                }
                              : {}),
                          },
                        }
                      : {}),
                };
              })
            : []),
          ...(Array.isArray(component.segments)
            ? component.segments.map((value) => {
                const segment = parseComponentPayload(value) ?? {};
                return {
                  id: segment.id,
                  label: segment.label,
                  draggable: segment.draggable,
                  kind: "segment",
                  from: coordinate(segment.fromX, segment.fromY, segment.fromZ),
                  to: coordinate(segment.toX, segment.toY, segment.toZ),
                };
              })
            : []),
          ...(Array.isArray(component.functions)
            ? component.functions.map((value) => ({
                ...parseComponentPayload(value),
                kind: "function",
                variable: "x",
              }))
            : []),
          ...(Array.isArray(component.parametricCurves)
            ? component.parametricCurves.map((value) => {
                const curve = parseComponentPayload(value) ?? {};
                const normalized: Record<string, unknown> = {
                  ...curve,
                  kind: "parametric",
                  parameter: "t",
                };
                if (
                  component.dimension !== "3d" ||
                  typeof curve.zExpression !== "string" ||
                  !curve.zExpression.trim()
                ) {
                  delete normalized.zExpression;
                }
                return normalized;
              })
            : []),
          ...(Array.isArray(component.polarFunctions)
            ? component.polarFunctions.map((value) => ({
                ...parseComponentPayload(value),
                kind: "polar_function",
                variable: "theta",
              }))
            : []),
          ...(Array.isArray(component.surfaces)
            ? component.surfaces.map((value) => ({
                ...parseComponentPayload(value),
                kind: "surface",
                variables: ["x", "y"],
              }))
            : []),
        ]
      : component.objects;
  const objects = Array.isArray(strictWireObjects)
    ? strictWireObjects.map((value) => {
        const object = parseComponentPayload(value);
        if (!object) return value;
        const kind = object.kind ?? object.type;
        const normalized: Record<string, unknown> = {
          ...object,
          kind,
          ...(kind === "segment" && object.from == null
            ? { from: object.start }
            : {}),
          ...(kind === "segment" && object.to == null
            ? { to: object.end }
            : {}),
          ...(kind === "point" && object.position == null
            ? { position: object.coordinates ?? object.coords }
            : {}),
          ...(kind === "function" && object.variable == null
            ? { variable: "x" }
            : {}),
          ...(kind === "function" && object.domain == null
            ? { domain: component.xRange }
            : {}),
          ...(kind === "parametric" && object.xExpression == null
            ? { xExpression: object.x }
            : {}),
          ...(kind === "parametric" && object.yExpression == null
            ? { yExpression: object.y }
            : {}),
          ...(kind === "parametric" && object.parameter == null
            ? { parameter: "t" }
            : {}),
          ...(kind === "parametric" && object.domain == null
            ? { domain: [object.tMin, object.tMax] }
            : {}),
        };
        for (const key of [
          "type",
          "coordinates",
          "coords",
          "sampleCount",
          "strokeWidth",
          "style",
        ]) {
          delete normalized[key];
        }
        return normalized;
      })
    : component.objects;
  const parameters = Array.isArray(component.parameters)
    ? component.parameters.map((value) => {
        const parameter = parseComponentPayload(value);
        if (!parameter) return value;
        return {
          id: parameter.id,
          name: parameter.name ?? parameter.label ?? parameter.id,
          min: parameter.min,
          max: parameter.max,
          step: parameter.step,
          default: parameter.default ?? parameter.initial,
        };
      })
    : component.parameters;
  const dimension =
    component.dimension === 2
      ? "2d"
      : component.dimension === 3
        ? "3d"
        : component.dimension;
  const hasExpressionObject =
    Array.isArray(objects) &&
    objects.some((value) => {
      const kind = parseComponentPayload(value)?.kind;
      return (
        kind === "function" ||
        kind === "parametric" ||
        kind === "polar_function" ||
        kind === "surface"
      );
    });
  const hasParameterizedVector =
    Array.isArray(objects) &&
    objects.some((value) => {
      const object = parseComponentPayload(value);
      const relation = parseComponentPayload(object?.relation);
      return (
        object?.kind === "vector" &&
        relation?.operation === "scale" &&
        typeof relation.factorParameter === "string" &&
        relation.factorParameter.trim()
      );
    });
  const normalized: Record<string, unknown> = {
    ...component,
    title: component.title ?? component.unit ?? component.name,
    dimension,
    objects,
    // The strict provider wire shape always includes a parameters array. Keep
    // it whenever an expression object or scaled-vector relation can consume
    // those values, in either dimension; otherwise drop inert slider metadata
    // instead of failing the whole optional teaching component.
    parameters: hasExpressionObject || hasParameterizedVector ? parameters : [],
    showGrid: component.showGrid ?? true,
    showAxes: component.showAxes ?? true,
  };
  for (const key of [
    "points",
    "vectors",
    "segments",
    "functions",
    "parametricCurves",
    "polarFunctions",
    "surfaces",
  ]) {
    delete normalized[key];
  }
  if (normalized.dimension !== "3d") delete normalized.zRange;
  return normalized;
}

function parseComponentPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

const COMPONENT_WRAPPER_KEYS = [
  "component",
  "block",
  "data",
  "payload",
  "result",
  "arguments",
  "parameters",
  "input",
  "output",
] as const;

const TYPE_SEQUENCE_KEYS: Partial<
  Record<ComplexInteractiveBlockType, readonly string[]>
> = {
  step_sort: [
    "correct_sequence",
    "correctSequence",
    "steps",
    "sequence",
    "items",
  ],
  chart: ["data", "series", "chartType"],
  math_scene: ["dimension", "coordinateSystem", "objects"],
  graph: ["variant", "nodes", "edges", "direction"],
  mechanics_sandbox: ["sandboxType", "objects", "parameters"],
  circuit_sandbox: ["circuit", "components", "wires", "groundNode"],
  chemistry_lab: ["experimentId", "experimentVersion", "parameters", "stage"],
};

function hasExpectedTypeFields(
  value: Record<string, unknown>,
  expectedType: ComplexInteractiveBlockType,
): boolean {
  const keys = TYPE_SEQUENCE_KEYS[expectedType];
  if (!keys) {
    return Object.keys(value).some(
      (key) =>
        key !== "type" &&
        key !== "component" &&
        !COMPONENT_WRAPPER_KEYS.includes(
          key as (typeof COMPONENT_WRAPPER_KEYS)[number],
        ),
    );
  }
  return keys.some((key) => value[key] != null);
}

function looksLikeInteractiveBlock(
  value: Record<string, unknown>,
  expectedType?: ComplexInteractiveBlockType,
): boolean {
  const type = complexInteractiveBlockTypeSchema.safeParse(value.type);
  if (type.success) {
    return !expectedType || type.data === expectedType;
  }
  if (!expectedType) return false;
  return hasExpectedTypeFields(value, expectedType);
}

function findNestedComponentCandidate(
  value: unknown,
  expectedType?: ComplexInteractiveBlockType,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 4) return null;
  const obj = parseComponentPayload(value);
  if (!obj) return null;
  if (looksLikeInteractiveBlock(obj, expectedType)) return obj;
  for (const nested of Object.values(obj)) {
    const found = findNestedComponentCandidate(nested, expectedType, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Models often flatten the block onto tool-call args (or stringify it) instead
 * of nesting under `component`. Recover those shapes before Zod validation.
 */
export function normalizeComponentToolArgs(
  args: Record<string, unknown> | undefined,
  expectedType?: ComplexInteractiveBlockType,
): Record<string, unknown> | undefined {
  if (!args) return args;
  if (Object.keys(args).length === 0) return args;

  let component: Record<string, unknown> | null = null;
  for (const key of COMPONENT_WRAPPER_KEYS) {
    component = parseComponentPayload(args[key]);
    if (component) break;
  }
  if (!component && expectedType) {
    component = parseComponentPayload(args[expectedType]);
  }
  if (!component && looksLikeInteractiveBlock(args, expectedType)) {
    component = { ...args };
  }
  if (!component) {
    component = findNestedComponentCandidate(args, expectedType);
  }
  if (!component) return args;

  if (expectedType && (component.type == null || component.type === "")) {
    component = { ...component, type: expectedType };
  }

  // Unwrap accidental double nesting: { component: { component: { type, ... } } }
  const nested = parseComponentPayload(component.component);
  if (nested) {
    const outerHasType = complexInteractiveBlockTypeSchema.safeParse(
      component.type,
    ).success;
    if (!outerHasType && looksLikeInteractiveBlock(nested, expectedType)) {
      component =
        expectedType && (nested.type == null || nested.type === "")
          ? { ...nested, type: expectedType }
          : nested;
    }
  }

  const normalized =
    component.type === "step_sort"
      ? normalizeStepSortComponent(component)
      : component.type === "chart"
        ? normalizeChartComponent(component)
        : component.type === "math_scene"
          ? normalizeMathSceneComponent(component)
          : null;

  return {
    component: normalized ?? component,
  };
}

/** Recover a component payload from assistant text when tool args are empty. */
export function recoverComponentArgsFromText(
  text: string,
  expectedType?: ComplexInteractiveBlockType,
): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = parseLlmJson<unknown>(trimmed);
    const asObject = parseComponentPayload(parsed);
    if (!asObject) return undefined;
    return normalizeComponentToolArgs(asObject, expectedType);
  } catch {
    return undefined;
  }
}

/** Provider-independent prepared contract shared by hosted and local adapters. */
export function prepareComponentIntentCompilation(params: {
  intent: ComponentIntent;
  unitTitle: string;
  language: string;
  context: string;
}) {
  const operation = "unit.learning_material.component_compile" as const;
  const toolName =
    params.intent.type === "math_scene"
      ? "draw_math_scene"
      : `emit_${params.intent.type}`;
  const invocation = {
    intentType: params.intent.type,
    intentDescription: params.intent.description,
    unitTitle: params.unitTitle,
    language: params.language,
    context: params.context,
    toolName,
    transport: "structured" as const,
  };
  const prompt =
    buildMaterialComponentInvocationPrompt(
      MATERIAL_COMPONENT_VIEW_KEYS.compileInstructionContext,
      invocation,
    ) ?? "";
  const bindingSchema = componentCompileBindingSchemaForType(
    params.intent.type,
  );
  const resultSchema = interactiveBlockSchemaForType(params.intent.type);
  return {
    operation,
    invocation,
    prompt,
    standalonePrompt: `${MATERIAL_COMPONENT_COMPILE_STABLE_INSTRUCTION}\n\n${prompt}`,
    bindingSchema,
    resultSchema,
    parseProviderOutput(content: string) {
      const parsed = parseLlmJson<unknown>(content);
      const object = parseComponentPayload(parsed);
      if (!object) return resultSchema.parse(parsed);
      const normalized = normalizeComponentToolArgs(
        object,
        params.intent.type,
      )?.component;
      return resultSchema.parse(normalized);
    },
  };
}

/**
 * Last-resort step_sort from numbered / arrow-separated intent text.
 * CI descriptions often already list the ordered steps.
 */
export function synthesizeStepSortFromIntent(
  description: string,
): Extract<InteractiveBlock, { type: "step_sort" }> | null {
  const trimmed = description.trim();
  if (!trimmed) return null;

  const numbered = [
    ...trimmed.matchAll(
      /(?:^|[^\d])(\d{1,2})\s*[.、:)：)\]]\s*([^\n\r]+?)(?=(?:(?:^|[^\d])\d{1,2}\s*[.、:)：)\]])|$)/gu,
    ),
  ]
    .map((match) => ({
      order: Number.parseInt(match[1]!, 10),
      content: match[2]!.replace(/\s+/g, " ").trim(),
    }))
    .filter((item) => item.content.length > 0);

  let steps = numbered
    .sort((a, b) => a.order - b.order)
    .map((item) => item.content);

  if (steps.length < 2) {
    const arrowParts = trimmed
      .split(/\s*(?:→|->|⇒|➜|➡|→)\s*/u)
      .map((part) =>
        part
          .replace(/^.*?按(?:正确)?顺序排列[：:]\s*/u, "")
          .replace(/^.*?排列[：:]\s*/u, "")
          .trim(),
      )
      .filter((part) => part.length > 0 && !/^请/.test(part));
    if (arrowParts.length >= 2) {
      steps = arrowParts;
    }
  }

  if (steps.length < 2) return null;

  const titleMatch = trimmed.match(/(?:将|把)?(.+?)按(?:正确)?顺序排列/u);
  const title = (titleMatch?.[1]?.trim() || "步骤排序").slice(0, 40);

  return {
    type: "step_sort",
    title,
    correct_sequence: steps.map((content, index) => ({
      id: `s${index + 1}`,
      order: index + 1,
      content,
    })),
    dependency_hint: "",
  };
}

export function replaceComponentIntentLines(
  text: string,
  compiledByLine: ReadonlyMap<number, InteractiveBlock | null>,
): string {
  // Line indices must match streamCourseMaterialDsl's completedLineCount, which
  // only advances for non-empty lines (see flushCompleteLines).
  let nonEmptyLineIndex = 0;
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];

      const currentIndex = nonEmptyLineIndex;
      nonEmptyLineIndex += 1;

      if (!isCompiledIntentLine(line)) return [line];
      if (!compiledByLine.has(currentIndex)) {
        if (!parseComponentIntentLine(line)) {
          return [];
        }
        return [line];
      }
      const block = compiledByLine.get(currentIndex);
      // Keep the CI record when compilation fails. The DSL parser renders it
      // as a placeholder, preserving both its position and an explicit signal
      // that the enrichment is still unavailable.
      if (block) return [componentDslLine(block)];
      if (parseComponentIntentLine(line)) {
        return [line];
      }
      return [];
    })
    .join("\n")
    .trim();
}

async function invokeToolModel(
  model: BaseChatModel | Runnable,
  messages: (SystemMessage | HumanMessage)[],
  signal: AbortSignal | undefined,
  logHandle: Awaited<ReturnType<typeof beginLlmRequestLog>>,
): Promise<AIMessage | AIMessageChunk | undefined> {
  // Component compilation only consumes the final structured tool call. Some
  // OpenAI-compatible providers omit the tool-call index/id from argument
  // deltas, so concatenating streamed chunks can leave a name-only call with
  // `{}` args even though the provider generated the full JSON. A non-streamed
  // response preserves the provider's complete tool arguments atomically.
  const response = await (
    model as {
      invoke: (input: typeof messages, options?: object) => Promise<unknown>;
    }
  ).invoke(messages, { signal });
  return response as AIMessage;
}

function componentParseError(params: {
  response: AIMessage | AIMessageChunk | undefined;
  call: ReturnType<typeof extractAgentToolCalls>[number] | undefined;
  parsedArgs?: ReturnType<z.ZodType["safeParse"]>;
  parsedBlock?: ReturnType<z.ZodType["safeParse"]> | null;
  expectedType?: ComplexInteractiveBlockType;
}): string {
  if (!params.response) return "Component compile returned an empty response";
  if (!params.call)
    return "Component compile response did not contain the required tool call";
  if (params.parsedArgs && !params.parsedArgs.success) {
    return `Component tool arguments are invalid: ${formatStructuredParseError(params.parsedArgs.error)}`;
  }
  if (params.parsedBlock && !params.parsedBlock.success) {
    return `Compiled component is invalid: ${formatStructuredParseError(params.parsedBlock.error)}`;
  }
  if (
    params.parsedBlock?.success &&
    params.expectedType &&
    (params.parsedBlock.data as { type?: unknown }).type !== params.expectedType
  ) {
    return `Compiled component type mismatch: expected ${params.expectedType}, received ${String((params.parsedBlock.data as { type?: unknown }).type)}`;
  }
  return "Component compile result could not be parsed";
}

async function emitValidatedComponentPartial(
  candidate: unknown,
  expectedType: ComplexInteractiveBlockType,
  schema: z.ZodType<InteractiveBlock>,
  onPartial?: (block: InteractiveBlock) => void | Promise<void>,
): Promise<void> {
  if (!onPartial) return;
  const normalized =
    normalizeComponentToolArgs(
      parseComponentPayload(candidate) ?? candidate,
      expectedType,
    )?.component ?? candidate;
  const parsed = schema.safeParse(normalized);
  if (parsed.success) await onPartial(parsed.data);
}

async function compileComponentIntentOnce(params: {
  intent: ComponentIntent;
  unitTitle: string;
  language: string;
  context: string;
  model?: BaseChatModel;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onPartial?: (block: InteractiveBlock) => void | Promise<void>;
  /** When set, compact the compile prompt against the durable unit authoring transcript. */
  authoringScope?: {
    userId: string;
    goalId: string;
    unitId: string;
  };
}): Promise<InteractiveBlock | null> {
  const prepared = prepareComponentIntentCompilation(params);
  const operation = prepared.operation;
  if (
    params.model &&
    getActiveLlmOperationRoute()?.operationKey !==
      canonicalLlmOperationKey(operation)
  ) {
    return withLlmOperationRoute(operation, () =>
      compileComponentIntentOnce(params),
    );
  }

  let authoringHistoryMessages: LlmMessageRecord[] | undefined;
  if (params.authoringScope) {
    const { resolveUnitAuthoringHistoryPrefix } =
      await import("../unit-authoring/history.js");
    const history = await resolveUnitAuthoringHistoryPrefix({
      ...params.authoringScope,
      requireCommits: ["commit_survey"],
    });
    if (history.available) {
      authoringHistoryMessages = history.messages;
    }
  }
  const compactAgainstAuthoringHistory = async (prompt: string) => {
    if (!authoringHistoryMessages) return prompt;
    const { compactUnitAuthoringStagePrompt } =
      await import("../unit-authoring/agent-round.js");
    return compactUnitAuthoringStagePrompt(prompt, authoringHistoryMessages);
  };
  const historyReuseMeta = params.authoringScope
    ? { unitAuthoringHistoryReuse: true }
    : {};

  const componentBindingSchema = prepared.bindingSchema;
  const componentSchema = prepared.resultSchema;
  const tool = defineAgentTool({
    name:
      params.intent.type === "math_scene"
        ? "draw_math_scene"
        : `emit_${params.intent.type}`,
    description: `Build one complete ${params.intent.type} learning component from the supplied teaching intent. Emit component fields at the top level of the tool arguments.`,
    // Flat schema: nested `{ component: ... }` wrappers are a common failure mode.
    schema: componentBindingSchema,
    handler: async (args) => args,
  });
  const model = params.model;
  const promptInvocation = {
    intentType: params.intent.type,
    intentDescription: params.intent.description,
    unitTitle: params.unitTitle,
    language: params.language,
    context: params.context,
    toolName: tool.name,
  };

  if (!model) {
    const structuredInvocation = prepared.invocation;
    const prompt = await compactAgainstAuthoringHistory(prepared.prompt);
    return runValidatedStructuredGeneration(
      {
        mode: "object",
        schema: componentSchema,
        prompt,
        options: {
          operation,
          bindingSchema: componentBindingSchema,
          meta: {
            ...params.meta,
            componentType: params.intent.type,
            intent: params.intent.description,
            unitTitle: params.unitTitle,
            outputFormat: "structured_object",
            ...historyReuseMeta,
          },
        },
        // Provider JSON mode can ignore discriminator/property spelling even
        // when given the binding schema (for example `type` instead of `kind`).
        // Capture syntactically valid JSON first, then apply the same bounded,
        // deterministic alias normalization used by the tool-call transport.
        recoveryPolicy: {
          sourceSchema: z.unknown(),
          normalize: (candidate) => ({
            value: normalizeComponentToolArgs(
              parseComponentPayload(candidate) ?? undefined,
              params.intent.type,
            )?.component,
          }),
          repairSlots: () => [],
        },
        contextSubject: {},
        contextQuery: params.unitTitle.slice(0, 2_000),
        contextInvocation: structuredInvocation,
      },
      {
        signal: params.signal,
        onPartial: params.onPartial
          ? (candidate) =>
              emitValidatedComponentPartial(
                candidate,
                params.intent.type,
                componentSchema,
                params.onPartial,
              )
          : undefined,
      },
    );
  }

  const toolInvocation = { ...promptInvocation, transport: "tool" as const };
  const toolPrompt = await compactAgainstAuthoringHistory(
    buildMaterialComponentInvocationPrompt(
      MATERIAL_COMPONENT_VIEW_KEYS.compileInstructionContext,
      toolInvocation,
    ) ?? "",
  );
  const preparedGeneration = await runMergedGenerationContextScope(
    {
      subject: {},
      query: params.unitTitle.slice(0, 2_000),
      invocation: toolInvocation,
    },
    () => prepareGenerationInvocation(operation, toolPrompt),
  );
  const compileRoute = getActiveLlmOperationRoute();
  const modelWithTool =
    typeof model.bindTools === "function"
      ? model.bindTools(toLangChainTools([tool]), {
          // Local OpenAI-compatible servers commonly support the portable
          // required choice but reject named tool choices. This operation
          // binds exactly one tool, so naming it adds no value. Qwen thinking
          // mode 400s on `required`, so those routes use `auto`.
          tool_choice: qwenRequiresAutoToolChoice({
            provider: compileRoute?.provider,
            model: compileRoute?.model,
          })
            ? "auto"
            : "required",
        })
      : model;

  let lastCandidateForRepair: unknown = undefined;
  return runValidatedStructuredGeneration(
    {
      mode: "tool-call",
      operation,
      schema: componentSchema,
      invoke: async ({ attempt, validationError, signal }) => {
        let retryContext = "";
        if (attempt > 0) {
          const serializedPrev =
            lastCandidateForRepair !== undefined
              ? (() => {
                  try {
                    const raw = JSON.stringify(lastCandidateForRepair);
                    return raw.length > 3000 ? `${raw.slice(0, 3000)}...` : raw;
                  } catch {
                    return undefined;
                  }
                })()
              : undefined;

          retryContext = `
The previous tool arguments were invalid${validationError ? `: ${validationError}` : ""}.${
            serializedPrev
              ? `
Previous output was:
${serializedPrev}`
              : ""
          }
Call ${tool.name} again. Correct the invalid fields, ensure all referenced variables/keys exist, fill every required field at the top level, and satisfy all id references.`;
        }

        const attemptMessages = [
          new SystemMessage(
            attempt === 0
              ? preparedGeneration.prompt
              : `${preparedGeneration.prompt}${retryContext}`,
          ),
          new HumanMessage(""),
        ];
        const started = Date.now();
        const logHandle = await beginLlmRequestLog({
          operation: "unit.learning_material.component_compile",
          kind: "chat",
          request: {
            messages: serializeChatMessagesForLog(attemptMessages),
            tool: tool.name,
            componentType: params.intent.type,
            intent: params.intent.description,
            unitTitle: params.unitTitle,
            attempt: attempt + 1,
            ...preparedGeneration.contextMeta,
            ...params.meta,
          },
          meta: {
            ...params.meta,
            componentType: params.intent.type,
            attempt: attempt + 1,
            outputFormat: "tool_call",
            ...historyReuseMeta,
          },
          setActiveSpan: true,
        });
        try {
          const response = await invokeToolModel(
            modelWithTool,
            attemptMessages,
            signal,
            logHandle,
          );
          const call = response
            ? extractAgentToolCalls(response, [tool.name])[0]
            : undefined;
          let normalizedArgs = normalizeComponentToolArgs(
            call?.args,
            params.intent.type,
          );
          if (
            !componentSchema.safeParse(normalizedArgs?.component).success &&
            response
          ) {
            normalizedArgs =
              recoverComponentArgsFromText(
                extractAssistantText(response),
                params.intent.type,
              ) ?? normalizedArgs;
          }
          const candidate = normalizedArgs?.component ?? call?.args;
          lastCandidateForRepair = candidate;
          const parsedBlock = componentSchema.safeParse(candidate);
          const durationMs = Date.now() - started;
          const error = parsedBlock.success
            ? undefined
            : componentParseError({
                response,
                call,
                parsedBlock,
                expectedType: params.intent.type,
              });
          await logHandle?.finish({
            status: parsedBlock.success ? "success" : "error",
            durationMs,
            response: {
              raw: response ? parseMessageForLog(response).raw : undefined,
              ...(call
                ? {
                    toolCalls: [
                      { id: call.id, name: call.name, args: call.args },
                    ],
                  }
                : {}),
              toolCallCount: call ? 1 : 0,
              valid: parsedBlock.success,
              ...(response
                ? usageLogFields(extractTokenUsage(response), durationMs)
                : {}),
            },
            error,
          });
          if (parsedBlock.success) {
            await emitValidatedComponentPartial(
              parsedBlock.data,
              params.intent.type,
              componentSchema,
              params.onPartial,
            );
          }
          return candidate;
        } catch (error) {
          await logHandle?.finish({
            status: "error",
            durationMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    },
    {
      signal: params.signal,
      onPartial: params.onPartial
        ? (candidate) =>
            emitValidatedComponentPartial(
              candidate,
              params.intent.type,
              componentSchema,
              params.onPartial,
            )
        : undefined,
    },
  );
}

const COURSE_MATH_SCENE_MAX_AUDIT_ROUNDS = 3;

/**
 * Compile a component and semantically audit math scenes. Repairs are fresh
 * bounded compiler turns: the stable capability instruction remains the same,
 * while the prior scene and audit contract stay in the volatile invocation.
 */
export async function compileComponentIntent(
  params: Parameters<typeof compileComponentIntentOnce>[0],
): Promise<InteractiveBlock | null> {
  if (params.intent.type !== "math_scene") {
    return compileComponentIntentOnce(params);
  }

  const teachingBrief = [
    `Lesson: ${params.unitTitle}`,
    `Intent: ${params.intent.description}`,
    `Context: ${params.context.slice(0, 6_000)}`,
  ].join("\n");
  let current: InteractiveBlock | null = null;
  let repairContext = params.context;

  for (
    let submission = 0;
    submission < COURSE_MATH_SCENE_MAX_AUDIT_ROUNDS;
    submission += 1
  ) {
    current = await compileComponentIntentOnce({
      ...params,
      context: repairContext,
      meta: {
        ...params.meta,
        mathSceneSubmission: submission + 1,
        mathSceneMaxAuditRounds: COURSE_MATH_SCENE_MAX_AUDIT_ROUNDS,
        mathSceneStage: submission === 0 ? "author" : "repair",
      },
    });
    if (!current || current.type !== "math_scene") return current;
    await params.onPartial?.(current);

    const { auditCourseMathSceneIfConfigured } =
      await import("./course-math-scene-audit.js");
    const audit = await auditCourseMathSceneIfConfigured({
      scene: current,
      teachingBrief,
      signal: params.signal,
    });
    if (!audit || audit.result) return current;
    if (submission + 1 >= COURSE_MATH_SCENE_MAX_AUDIT_ROUNDS) return current;

    repairContext = `${params.context.slice(0, 6_000)}\n\nMath-scene audit repair request:\n${(
      audit.reason ??
      "The scene is mathematically inconsistent with its teaching intent."
    ).slice(
      0,
      4_000,
    )}\n\nPrevious compiled scene:\n${JSON.stringify(current).slice(0, 12_000)}\nRepair only the audited defects. Preserve correct objects, labels, ranges, and interaction behavior.`;
  }

  return current;
}
