import { z } from "zod";
import {
  interactiveBlockBindingSchemaForType,
  interactiveBlockSchema,
  type InteractiveBlock,
} from "./schemas.js";
import {
  getLanguagePromptInstruction,
  type ContentLanguageCode,
} from "./content-language.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";

/**
 * Block types a single-block AI edit may target. Text blocks, markup diagrams,
 * and model-authored structured visuals are editable; server-owned assessment
 * (`check`), image assets (`illustration`), loading `placeholder`s, and the
 * deterministic sandbox engines are not.
 */
const AI_EDITABLE_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "code",
  "conversation",
  "callout",
  "accordion",
  "svg",
  "chart",
  "math_scene",
  "graph",
  "step_sort",
  "interactive_html",
] as const;

export type AiEditableBlockType = (typeof AI_EDITABLE_BLOCK_TYPES)[number];

export function isAiEditableBlockType(type: string): type is AiEditableBlockType {
  return (AI_EDITABLE_BLOCK_TYPES as readonly string[]).includes(type);
}

/** Model output occasionally wraps the block; unwrap before validation. */
function unwrapBlockCandidate(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }
  const record = candidate as Record<string, unknown>;
  for (const key of ["block", "component", "result"]) {
    const inner = record[key];
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      typeof (inner as Record<string, unknown>).type === "string"
    ) {
      return inner;
    }
  }
  return candidate;
}

function parseEditedBlock(
  candidate: unknown,
  originalType: InteractiveBlock["type"],
): InteractiveBlock | null {
  const parsed = interactiveBlockSchema.safeParse(unwrapBlockCandidate(candidate));
  if (!parsed.success || parsed.data.type !== originalType) return null;
  return parsed.data;
}

function buildBlockEditPrompt(params: {
  unitTitle: string;
  language: ContentLanguageCode;
  instruction: string;
  block: InteractiveBlock;
  introduction?: string;
  surroundingBlocks: InteractiveBlock[];
}): string {
  const currentBlock = JSON.stringify(params.block);
  const surrounding =
    params.surroundingBlocks.length > 0
      ? `\n\nNearby blocks for context only (never rewrite them):\n${JSON.stringify(
          params.surroundingBlocks,
        ).slice(0, 6_000)}`
      : "";
  const introduction = params.introduction
    ? `\n\nLesson introduction for context only:\n${params.introduction.slice(0, 2_000)}`
    : "";
  return `You are editing exactly ONE existing block of the teaching material for the lesson "${params.unitTitle}".${getLanguagePromptInstruction(
    params.language,
  )}

Current block (JSON):
${currentBlock}

Learner edit request:
${params.instruction}${introduction}${surrounding}

Rules:
- Return the COMPLETE edited block as a single JSON object. Its "type" must stay exactly "${params.block.type}".
- Keep every field of the current block unchanged unless the edit request requires changing it. Preserve ids, keys, variables, references, formulas, urls, and code semantics.
- After your edit, all internal references (ids, series/axis keys, variable ids, option indexes, step orders) must stay valid and consistent.
- Apply only the requested change; do not rewrite unrelated parts, reorder the material, or add extra fields.
- Write learner-visible text in the requested content language; keep code, identifiers, and formulas intact.
- Output JSON only, no markdown fence, no commentary.`;
}

/**
 * Edit one existing course-material block with the learner's routed chat
 * model. The edited block must validate against the authoritative block
 * schema AND keep the original block type; anything else fails closed.
 */
export async function editCourseMaterialBlockWithAi(params: {
  unitTitle: string;
  language: ContentLanguageCode;
  instruction: string;
  block: InteractiveBlock;
  introduction?: string;
  surroundingBlocks?: InteractiveBlock[];
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
  onPartial?: (block: InteractiveBlock) => void | Promise<void>;
}): Promise<InteractiveBlock | null> {
  const { block } = params;
  if (!isAiEditableBlockType(block.type)) return null;
  const originalType: InteractiveBlock["type"] = block.type;
  // The binding helper is keyed by complex types but resolves any union
  // member; text blocks use the same per-member lookup.
  const bindingSchema = interactiveBlockBindingSchemaForType(
    block.type as Parameters<typeof interactiveBlockBindingSchemaForType>[0],
  );
  const result = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: interactiveBlockSchema,
      prompt: buildBlockEditPrompt({
        unitTitle: params.unitTitle,
        language: params.language,
        instruction: params.instruction,
        block,
        introduction: params.introduction,
        surroundingBlocks: (params.surroundingBlocks ?? []).slice(0, 4),
      }),
      options: {
        operation: "unit.learning_material.component_compile",
        bindingSchema,
        schemaShape: `{"type":"${block.type}", ...} — the complete edited block with every field of the current block.`,
        meta: {
          ...params.meta,
          blockEditType: block.type,
          outputFormat: "structured_object",
        },
      },
      recoveryPolicy: {
        sourceSchema: z.unknown(),
        normalize: (candidate) => ({
          value: parseEditedBlock(candidate, originalType) ?? candidate,
        }),
        repairSlots: () => [],
      },
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
    },
    {
      signal: params.signal,
      onPartial: params.onPartial
        ? (candidate) => {
            const partial = parseEditedBlock(candidate, originalType);
            if (partial) return params.onPartial?.(partial);
          }
        : undefined,
    },
  );
  // The union schema accepts any block type; the edit contract pins the
  // original type, so re-parse and fail closed on a type switch.
  const edited = parseEditedBlock(result, originalType);
  if (edited && edited.type === "svg" && block.type === "svg") {
    // A redrawn diagram keeps the frozen picture-level brief so later
    // redraws preserve the layout contract.
    return { ...edited, intent: edited.intent ?? block.intent };
  }
  return edited;
}
