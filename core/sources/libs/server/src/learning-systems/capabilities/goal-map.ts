import {
  type ContentLanguageCode,
  getContentLanguageLabel,
} from "../../llm/content-language.js";
import { type StreamTokenHandler } from "../../llm/chat-stream.js";
import { normalizeDecomposePayload } from "../../llm/normalize-decompose.js";
import {
  decomposeResultSchema,
  MAX_DECOMPOSE_UNITS,
  type DecomposeResult,
  type GoalMapPlan,
  type GoalMapSummary,
} from "../../llm/schemas.js";
import { buildDecomposePrompt } from "../../llm/decompose-prompt.js";
import { subdivideUnit } from "../../llm/subdivide.js";
import type { MapJsonPartial } from "../../llm/map-json-stream.js";
import {
  assembleMapItems,
  mapJitItemBindingSchema,
  mapJitItemSchema,
  mapJitItemsSchema,
  mapDomainJitItemSchema,
  mapUnitJitItemSchema,
  type MapJitItem,
} from "../../llm/jit-structured-items.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { normalizeGeneratedJsonValue } from "../../llm/structured-recovery.js";
import {
  canonicalGoalPlanCoverage,
  goalPlanAreas,
  goalPlanOutcomes,
} from "./goal-map-plan-coverage.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../types.js";
import { GOAL_MAP_VIEW_KEYS } from "../../llm/decompose-keys.js";

export { buildDecomposePrompt } from "../../llm/decompose-prompt.js";

function normalizeDecomposeResult(
  result: DecomposeResult,
  _mapPlan?: GoalMapPlan,
): DecomposeResult {
  return result;
}

function finalizeStructuredDecompose(
  parsed: DecomposeResult,
  mapPlan?: GoalMapPlan,
  rootsOnly = false,
): DecomposeResult {
  const binding = rootsOnly
    ? {
        ...parsed,
        // The first stage of two-level generation only needs roots.
        // Ignore accidental child rows so a partially nested response cannot
        // trip sibling-count validation before dedicated sub-map generation.
        units: parsed.units.filter((unit) => !unit.parentTitle?.trim()),
      }
    : parsed;
  const normalized = normalizeDecomposePayload(binding, {
    topLevelCap: mapPlan?.majorAreas.length,
  });
  const result = decomposeResultSchema.parse(normalized);
  if (!mapPlan) return result;

  const areaRefs = new Set(goalPlanAreas(mapPlan).map((area) => area.ref));
  const outcomeRefs = new Set(
    goalPlanOutcomes(mapPlan).map((outcome) => outcome.ref),
  );
  const roots = result.units.filter((unit) => !unit.parentTitle?.trim());
  const rootByTitle = new Map(roots.map((unit) => [unit.title.trim(), unit]));
  const seenAreas = new Set<string>();
  const coveredOutcomes = new Set<string>();
  const units = result.units.map((unit) => {
    const root = unit.parentTitle?.trim()
      ? rootByTitle.get(unit.parentTitle.trim())
      : unit;
    const planAreaRef = unit.planAreaRef ?? root?.planAreaRef;
    if (!planAreaRef || !areaRefs.has(planAreaRef)) {
      throw new Error(`Map unit ${unit.title} has an invalid planAreaRef`);
    }
    if (!unit.parentTitle?.trim()) {
      if (seenAreas.has(planAreaRef)) {
        throw new Error(
          `Plan area ${planAreaRef} has multiple top-level roots`,
        );
      }
      seenAreas.add(planAreaRef);
    } else if (root?.planAreaRef && root.planAreaRef !== planAreaRef) {
      throw new Error(
        `Map child ${unit.title} does not inherit its parent plan area`,
      );
    }
    const planningOutcomeRefs = [...new Set(unit.planningOutcomeRefs ?? [])];
    if (planningOutcomeRefs.some((ref) => !outcomeRefs.has(ref))) {
      throw new Error(`Map unit ${unit.title} cites an unknown goal outcome`);
    }
    if (unit.scope === "session" && planningOutcomeRefs.length === 0) {
      throw new Error(`Map lesson ${unit.title} must cover a goal outcome`);
    }
    planningOutcomeRefs.forEach((ref) => coveredOutcomes.add(ref));
    return { ...unit, planAreaRef, planningOutcomeRefs };
  });
  const missingAreas = [...areaRefs].filter((ref) => !seenAreas.has(ref));
  const missingOutcomes = [...outcomeRefs].filter(
    (ref) => !coveredOutcomes.has(ref),
  );
  if (missingAreas.length) {
    throw new Error(`Map omits planned areas: ${missingAreas.join(", ")}`);
  }
  if (missingOutcomes.length) {
    throw new Error(
      `Map omits approved outcomes: ${missingOutcomes.join(", ")}`,
    );
  }
  return { ...result, units };
}

function mapPlanningInvalidItems(
  items: ReadonlyArray<MapJitItem | undefined>,
  mapPlan: GoalMapPlan,
) {
  const coverage = canonicalGoalPlanCoverage(mapPlan);
  const validAreas = new Set(coverage.areas.map((area) => area.ref));
  const validOutcomes = new Set(
    coverage.outcomes.map((outcome) => outcome.ref),
  );
  const unitEntries = items.flatMap((item, index) =>
    item?.kind === "unit" ? [{ item, unit: item.unit, index }] : [],
  );
  const roots = unitEntries.filter(({ unit }) => !unit.parentTitle?.trim());
  const rootsByTitle = new Map(
    roots.map((entry) => [entry.unit.title.trim(), entry]),
  );
  const seenRootAreas = new Set<string>();
  const issues = new Map<number, string[]>();
  const addIssue = (index: number, issue: string) =>
    issues.set(index, [...(issues.get(index) ?? []), issue]);

  for (const { unit, index } of unitEntries) {
    const areaRef = unit.planAreaRef?.trim() ?? "";
    const outcomeRefs = [...new Set(unit.planningOutcomeRefs ?? [])];
    if (!validAreas.has(areaRef)) {
      addIssue(index, `assign exactly one valid planned area ref`);
    }
    if (
      outcomeRefs.length === 0 ||
      outcomeRefs.some((ref) => !validOutcomes.has(ref))
    ) {
      addIssue(index, `assign one or more valid planned outcome refs`);
    }
    if (!unit.parentTitle?.trim()) {
      if (seenRootAreas.has(areaRef)) {
        addIssue(index, `replace duplicate top-level area ${areaRef}`);
      } else if (validAreas.has(areaRef)) {
        seenRootAreas.add(areaRef);
      }
      continue;
    }
    const root = rootsByTitle.get(unit.parentTitle.trim());
    if (!root) {
      addIssue(index, `use an existing top-level parent title`);
    } else if (root.unit.planAreaRef !== areaRef) {
      addIssue(
        index,
        `inherit parent area ${root.unit.planAreaRef ?? "(missing)"}`,
      );
    }
  }

  const initiallyValid = unitEntries.filter(({ index }) => !issues.has(index));
  const validRootAreas = new Set(
    initiallyValid
      .filter(({ unit }) => !unit.parentTitle?.trim())
      .map(({ unit }) => unit.planAreaRef),
  );
  const missingAreas = coverage.areas.filter(
    (area) => !validRootAreas.has(area.ref),
  );
  const repairableRoots = roots.filter(({ index }) => issues.has(index));
  missingAreas.slice(0, repairableRoots.length).forEach((area, index) => {
    addIssue(
      repairableRoots[index]!.index,
      `use missing top-level area ${area.ref} (${area.title})`,
    );
  });
  const coveredOutcomes = new Set(
    initiallyValid.flatMap(({ unit }) => unit.planningOutcomeRefs ?? []),
  );
  const missingOutcomes = coverage.outcomes
    .map((outcome) => outcome.ref)
    .filter((ref) => !coveredOutcomes.has(ref));
  if (missingOutcomes.length > 0 && initiallyValid.length > 0) {
    const candidate = initiallyValid.at(-1)!;
    addIssue(
      candidate.index,
      `preserve this unit and add uncovered outcome refs ${missingOutcomes.join(", ")}`,
    );
  }

  return [...issues].map(([index, descriptions]) => ({
    index,
    description: `Correct map unit binding: ${descriptions.join("; ")}.`,
    schema: mapUnitJitItemSchema,
  }));
}

export function matchesMapDepth(
  result: DecomposeResult,
  depth: 1 | 2 | undefined,
): boolean {
  const roots = result.units.filter((unit) => !unit.parentTitle?.trim());
  const childParentTitles = new Set(
    result.units
      .map((unit) => unit.parentTitle?.trim())
      .filter((title): title is string => Boolean(title)),
  );
  if (depth === 1) {
    return childParentTitles.size === 0;
  }
  if (depth === 2) {
    return (
      roots.length > 0 &&
      roots.every((root) => childParentTitles.has(root.title))
    );
  }
  return true;
}

function buildDecomposeStructuredPrompt(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  mapPlan?: GoalMapPlan;
  mapSummary?: GoalMapSummary;
  generationOptions?: string;
  retryNote?: string;
  rootsOnly?: boolean;
}): string {
  const depth = params.rootsOnly
    ? 1
    : params.mapPlan?.mapStructure.recommendedDepth;
  const nested = depth === 2;
  const aiDecidesDepth = depth === undefined;
  const targetUnits = params.mapPlan
    ? `EXACTLY ${params.mapPlan.majorAreas.length}`
    : "a natural number of";

  return `${buildDecomposePrompt(params)}

Structured item-array requirements:
- Ignore the legacy root-object example above; the wire format is a bare root JSON array.
- First item: {"kind":"domain","domainTag":"stem|humanities|general"}.
- Remaining items: {"kind":"unit","unit":{"title":"...","difficulty":"easy|medium|hard","prerequisiteTitles":[],"contentSummary":"...","planAreaRef":"a_1","planningOutcomeRefs":["o_1"],"scope":"session","parentTitle":null,"needsExpansion":false}}.
- Output ${targetUnits} top-level unit objects (scope session only).
${
  nested
    ? `- Generate exactly two layers: top-level module-like sessions plus child sessions.
- Give each child the exact title of its top-level parent in parentTitle.
- Every top-level unit must have 2–6 children; do not create grandchildren.`
    : aiDecidesDepth
      ? `- Decide whether this topic needs one or two layers. Use two layers only when grouping materially improves a broad or complex map.
- For two layers, give every child the exact top-level parent title and create 2–6 children per parent. Never create grandchildren.
- For one layer, leave every parentTitle empty.`
      : "- Generate exactly one layer. parentTitle must be empty for every unit."
}
- needsExpansion must be the JSON boolean false for every unit (never null, "", or a quoted string).
- When an approved plan is present, every unit must include planAreaRef using the exact a_N ref and planningOutcomeRefs using one or more exact o_N refs from the plan.
- Each top-level unit must use a different planAreaRef. Children inherit the same planAreaRef as their parent. Every o_N outcome must appear on at least one lesson.
- prerequisite titles must exactly match earlier U titles when present.
- Never use scope branch or module.${
    params.retryNote ? `\n- ${params.retryNote}` : ""
  }`;
}

export function createGoalMapCapability() {
  const capabilityId = "goal-map";
  const version = "1.1.0";
  const instruction = `Generate the requested XueLearn goal map from the invocation input.
- Preserve the confirmed goal and approved planning contract.
- Follow the invocation's complete hierarchy, coverage, language, and structured item-array requirements.
- Return only map content supported by the supplied goal, plan, and references.`;
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [GOAL_MAP_VIEW_KEYS.instructionContext]: async ({
        subject,
      }: SystemViewRequest): Promise<ContextEnvelope | null> => {
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: instruction },
        };
      },
    },
  });
}

export async function decomposeGoal(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  mapPlan?: GoalMapPlan;
  mapSummary?: GoalMapSummary;
  generationOptions?: string;
}): Promise<DecomposeResult> {
  return decomposeGoalStream(params);
}

export async function decomposeGoalStream(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  mapPlan?: GoalMapPlan;
  mapSummary?: GoalMapSummary;
  generationOptions?: string;
  onToken?: StreamTokenHandler;
  onPartialMap?: (partial: MapJsonPartial) => void | Promise<void>;
  signal?: AbortSignal;
  /** Internal first pass used only while constructing a nested legacy map. */
  rootsOnly?: boolean;
}): Promise<DecomposeResult> {
  const depth = params.rootsOnly
    ? 1
    : params.mapPlan?.mapStructure.recommendedDepth;
  const shouldGenerateTwoLevels = depth === 2;

  if (shouldGenerateTwoLevels) {
    const rootResult = await decomposeGoalStream({
      ...params,
      rootsOnly: true,
    });
    const combinedUnits = [...rootResult.units];

    for (const root of rootResult.units) {
      if (params.signal?.aborted) {
        throw new DOMException("Map generation aborted", "AbortError");
      }
      const subMap = await subdivideUnit({
        goalTitle: params.title,
        unitTitle: root.title,
        contentSummary: root.contentSummary || root.title,
        contentLanguage: params.contentLanguage,
        context: params.context,
        generationOptions: params.generationOptions,
        onToken: params.onToken,
        onPartialMap: async (partial) => {
          const currentChildren = partial.map.units.map((child) => ({
            ...child,
            scope: "session" as const,
            parentTitle: root.title,
            planAreaRef: root.planAreaRef,
            planningOutcomeRefs: root.planningOutcomeRefs ?? [],
            prerequisiteTitles: child.prerequisiteTitles ?? [],
          }));
          const previewUnits = [...combinedUnits, ...currentChildren];
          await params.onPartialMap?.({
            map: {
              domainTag: rootResult.domainTag,
              units: previewUnits,
            },
            unitCount: previewUnits.length,
            placeholderUnitCount: partial.placeholderUnitCount,
          });
        },
        signal: params.signal,
      });
      combinedUnits.push(
        ...subMap.children.map((child) => ({
          ...child,
          scope: "session" as const,
          parentTitle: root.title,
          planAreaRef: root.planAreaRef,
          planningOutcomeRefs: root.planningOutcomeRefs ?? [],
          prerequisiteTitles: [],
        })),
      );
      await params.onPartialMap?.({
        map: {
          domainTag: rootResult.domainTag,
          units: combinedUnits,
        },
        unitCount: combinedUnits.length,
        placeholderUnitCount: 0,
      });
    }

    const combined = decomposeResultSchema.parse({
      domainTag: rootResult.domainTag,
      units: combinedUnits,
    });
    if (!matchesMapDepth(combined, 2)) {
      throw new Error("两层学习地图生成不完整：部分一级模块缺少子地图");
    }
    return finalizeStructuredDecompose(combined, params.mapPlan);
  }

  const operation = "goal.map";
  const meta = {
    goalTitle: params.title,
    level: params.level,
    pathSource: params.pathSource,
    contentLanguage: params.contentLanguage,
    languageLabel: getContentLanguageLabel(params.contentLanguage),
    outputFormat: "structured_json" as const,
  };

  let lastPartialAt = 0;
  let lastPartialUnitCount = 0;
  const emitPartialMap = (partial: MapJsonPartial) => {
    if (!params.onPartialMap) return;
    const now = Date.now();
    const unitDelta = partial.unitCount - lastPartialUnitCount;
    if (now - lastPartialAt < 150 && unitDelta < 1) return;
    lastPartialAt = now;
    lastPartialUnitCount = partial.unitCount;
    void params.onPartialMap(partial);
  };
  const resultSchema = mapJitItemsSchema
    .transform(assembleMapItems)
    .transform((parsed) =>
      finalizeStructuredDecompose(parsed, params.mapPlan, params.rootsOnly),
    )
    .superRefine((result, ctx) => {
      if (!matchesMapDepth(result, depth)) {
        ctx.addIssue({
          code: "custom",
          message: `map does not satisfy expected depth ${depth}`,
        });
      }
    });
  const result = await runValidatedStructuredGeneration<
    MapJitItem,
    MapJsonPartial,
    DecomposeResult
  >(
    {
      mode: "item-array",
      operation,
      prompt: buildDecomposeStructuredPrompt(params),
      itemSchema: mapJitItemSchema,
      bindingItemSchema: mapJitItemBindingSchema,
      resultSchema,
      assemble: (items) => items,
      // Progressive map_partial UI needs content-token streaming. Native
      // function-calling often buffers tool args (DashScope/Qwen), so use the
      // raw JSON-array stream — same approach as course material NDJSON.
      preferRawStream: true,
      assemblePartial: (items, placeholderUnitCount) => {
        const domain = items.find((item) => item.kind === "domain");
        const units = items.flatMap((item) =>
          item.kind === "unit" ? [item.unit] : [],
        );
        return {
          map: { domainTag: domain?.domainTag ?? "general", units },
          unitCount: units.length,
          placeholderUnitCount,
        };
      },
      recoveryPolicy: {
        normalizeItem: normalizeGeneratedJsonValue,
        dedupeExact: true,
        maxItems: MAX_DECOMPOSE_UNITS + 1,
        normalize: (items) => {
          let domainSeen = false;
          const normalized = items.filter((item) => {
            if (item.kind !== "domain") return true;
            if (domainSeen) return false;
            domainSeen = true;
            return true;
          });
          return {
            items: normalized,
            droppedCount: items.length - normalized.length,
          };
        },
        invalidItems: params.mapPlan
          ? ({ items }) => mapPlanningInvalidItems(items, params.mapPlan!)
          : undefined,
        missingItems: ({ validItems, sourceItems }) => {
          const missing = [];
          const sourceKinds = sourceItems.flatMap((item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? [(item as Record<string, unknown>).kind]
              : [],
          );
          if (
            !validItems.some((item) => item.kind === "domain") &&
            !sourceKinds.includes("domain")
          ) {
            missing.push({
              description:
                "Add the missing map domain item using the best matching domainTag.",
              schema: mapDomainJitItemSchema,
              insertAt: 0,
            });
          }
          const validUnits = validItems.flatMap((item) =>
            item.kind === "unit" ? [item.unit] : [],
          );
          const unitCount = Math.max(
            validUnits.length,
            sourceKinds.filter((kind) => kind === "unit").length,
          );
          const requiredUnitCount =
            params.rootsOnly && params.mapPlan
              ? params.mapPlan.majorAreas.length
              : 1;
          if (params.rootsOnly && params.mapPlan) {
            const validAreaRefs = new Set(
              validUnits
                .filter((unit) => !unit.parentTitle?.trim())
                .map((unit) => unit.planAreaRef),
            );
            const validOutcomeRefs = new Set(
              validUnits.flatMap((unit) => unit.planningOutcomeRefs ?? []),
            );
            const missingAreas = goalPlanAreas(params.mapPlan).filter(
              (area) => !validAreaRefs.has(area.ref),
            );
            const missingOutcomes = goalPlanOutcomes(params.mapPlan)
              .map((outcome) => outcome.ref)
              .filter((ref) => !validOutcomeRefs.has(ref));
            const insertionCount = Math.max(0, requiredUnitCount - unitCount);
            for (let index = 0; index < insertionCount; index += 1) {
              const area = missingAreas[index];
              missing.push({
                description: `Add the missing top-level map root${
                  area
                    ? ` for ${area.ref} (${area.title})`
                    : ` ${unitCount + index + 1} of ${requiredUnitCount}`
                }. Use valid outcome refs${
                  index === 0 && missingOutcomes.length
                    ? ` and cover ${missingOutcomes.join(", ")}`
                    : ""
                }.`,
                schema: mapUnitJitItemSchema,
              });
            }
          } else {
            for (let index = unitCount; index < requiredUnitCount; index += 1) {
              missing.push({
                description: `Add missing map unit ${index + 1} of ${requiredUnitCount}; it must preserve the requested ordering and coverage.`,
                schema: mapUnitJitItemSchema,
              });
            }
          }
          return missing;
        },
      },
      repairContext: `Preserve the expected map structure, exact unit coverage, and ordering.${
        params.mapPlan
          ? ` Approved planning refs: ${JSON.stringify(
              canonicalGoalPlanCoverage(params.mapPlan),
            )}.`
          : ""
      }`,
      meta,
      contextSubject: {},
      contextQuery: params.title.slice(0, 2_000),
      contextInvocation: params,
    },
    {
      onToken: params.onToken,
      onPartial: emitPartialMap,
      signal: params.signal,
    },
  );
  await params.onPartialMap?.({
    map: result,
    unitCount: result.units.length,
    placeholderUnitCount: 0,
  });
  return normalizeDecomposeResult(result, params.mapPlan);
}
