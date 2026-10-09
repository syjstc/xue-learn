import type { StreamTokenHandler } from "./chat-stream.js";
import {
  type ContentLanguageCode,
  getContentLanguageLabel,
  getLanguagePromptInstruction,
} from "./content-language.js";
import { getGenerationOptionsPromptBlock } from "./generation-options.js";
import type { MapDslPartial } from "./map-dsl.js";
import {
  assembleSubdivideItems,
  subdivideJitItemSchema,
  subdivideJitItemsSchema,
  type SubdivideJitItem,
} from "./jit-structured-items.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";
import {
  LARGE_FLAT_CHILD_THRESHOLD,
  MAX_BRANCH_CHILD_UNITS,
  MIN_BRANCH_CHILD_UNITS,
  type SubdivideResult,
} from "./schemas.js";

const SUBDIVIDE_SCHEMA_SHAPE = `{
  "children": [
    {
      "title": "...",
      "difficulty": "medium",
      "contentSummary": "..."
    }
  ]
}`;

export function buildSubdividePrompt(params: {
  goalTitle: string;
  unitTitle: string;
  contentSummary: string;
  contentLanguage: ContentLanguageCode;
  context?: string;
  mapScope?: string;
  generationOptions?: string;
}): string {
  const contextBlock = params.context
    ? `\nReference material (use only sections relevant to the parent topic below):\n${params.context.slice(0, 8000)}`
    : "";

  const mapScopeBlock = params.mapScope ? `\n${params.mapScope}\n` : "";

  const langNote = getLanguagePromptInstruction(params.contentLanguage);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );

  return `You are XueLearn's unit refinement engine.
The parent topic "${params.unitTitle}" is TOO BROAD for a single focused study session.
Split it into smaller lessons, each sized to what that slice actually needs (survey + reading + practice).

Overall learning goal: ${params.goalTitle}
Parent unit: "${params.unitTitle}"
Parent scope: ${params.contentSummary}
${mapScopeBlock}${contextBlock}
${optionsBlock ? `\n${optionsBlock}\n` : ""}
${langNote}

Rules:
- ${MIN_BRANCH_CHILD_UNITS}-${MAX_BRANCH_CHILD_UNITS} capability-scoped child lessons.
- Do not create a huge flat child list. If this parent seems to need more than ${LARGE_FLAT_CHILD_THRESHOLD} lessons, choose ${MIN_BRANCH_CHILD_UNITS}-${MAX_BRANCH_CHILD_UNITS} larger sibling slices now; each can be subdivided again later.
- Each child covers ONE narrow concept — small enough that SQ preview has ~3-6 outline items and ~3-6 guiding questions, not a whole course chapter
- Order children from prerequisites to advanced within this parent
- Do NOT repeat the parent title as a single child; decompose meaningfully
- Split by real learning substance, not by generic phases. Avoid circular children such as "overview", "basics", "practice", "applications", or "recap" when those would all cover the same parent again
- Children should be parallel sibling slices at one smaller granularity, like spreading the parent unit into adjacent smaller units

Topic coherence (critical):
- Every child MUST be a strict subtopic of "${params.unitTitle}" — a narrower piece of the parent scope, NOT a separate top-level topic from the goal
- Together, children partition the parent: cover its full scope without gaps and without adding topics outside it
- Do NOT introduce tangential fields, adjacent subjects, or lessons that belong to other units on the goal map
- Each contentSummary must be 2-3 sentences listing the core things to generate — which specific part of "${params.unitTitle}" that lesson covers, plus key concepts, skills, or practice
- Stay aligned with the overall goal "${params.goalTitle}", but never drift beyond the parent unit's scope
- When this is a deep sub-map, preserve all ancestor constraints from Map placement; do not replace the deep unit with a broad top-level map
- If map placement mentions a groupingAxis or estimated child count, honor that grouping (themes, difficulty tiers, skill strands) — children should be parallel slices at one finer granularity, not a second copy of the whole parent

Required child fields (the caller supplies the root-array wire format):
${SUBDIVIDE_SCHEMA_SHAPE}`;
}

export async function subdivideUnit(params: {
  goalTitle: string;
  unitTitle: string;
  contentSummary: string;
  contentLanguage: ContentLanguageCode;
  context?: string;
  mapScope?: string;
  generationOptions?: string;
  onToken?: StreamTokenHandler;
  onPartialMap?: (partial: MapDslPartial) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<SubdivideResult> {
  let lastPartialAt = 0;
  let lastPartialUnitCount = 0;
  const emitPartialMap = (partial: MapDslPartial) => {
    if (!params.onPartialMap) return;
    const now = Date.now();
    const unitDelta = partial.unitCount - lastPartialUnitCount;
    if (now - lastPartialAt < 150 && unitDelta < 1) return;
    lastPartialAt = now;
    lastPartialUnitCount = partial.unitCount;
    void params.onPartialMap(partial);
  };
  return runValidatedStructuredGeneration<
    SubdivideJitItem,
    MapDslPartial,
    SubdivideResult
  >(
    {
      mode: "item-array",
      operation: "subdivide",
      prompt: `${buildSubdividePrompt(params)}

Return 2-8 unit items. Every item must use:
{"kind":"unit","unit":{"title":"...","difficulty":"easy|medium|hard","contentSummary":"..."}}
All children are session lessons. Order them from prerequisites to advanced.`,
      itemSchema: subdivideJitItemSchema,
      resultSchema: subdivideJitItemsSchema.transform(assembleSubdivideItems),
      assemble: (items) => items,
      // Map JIT needs content-token streaming for progressive UI. Provider
      // function-calling often buffers tool arguments until the end (esp.
      // DashScope), so prefer the raw JSON-array stream like material does.
      preferRawStream: true,
      assemblePartial: (items, placeholderCount) => ({
        map: {
          domainTag: "general",
          units: items.map((item) => ({
            ...item.unit,
            scope: "session" as const,
            parentTitle: null,
            prerequisiteTitles: [],
          })),
        },
        unitCount: items.length,
        placeholderUnitCount: placeholderCount,
      }),
      repairContext: `Return ${MIN_BRANCH_CHILD_UNITS}-${MAX_BRANCH_CHILD_UNITS} child lessons for ${params.unitTitle}.`,
      meta: {
        goalTitle: params.goalTitle,
        unitTitle: params.unitTitle,
        languageLabel: getContentLanguageLabel(params.contentLanguage),
      },
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
      contextInvocation: params,
    },
    {
      onToken: params.onToken,
      onPartial: emitPartialMap,
      signal: params.signal,
    },
  );
}
