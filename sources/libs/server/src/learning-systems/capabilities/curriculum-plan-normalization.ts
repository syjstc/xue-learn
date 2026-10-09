import type { GoalMapPlan } from "../../llm/schemas.js";
import type { ContentLanguageCode } from "../../llm/content-language.js";
import {
  MAX_MODULE_UNITS,
  MAX_SEQUENTIAL_MODULES,
  MAX_TOP_LEVEL_UNITS,
  MIN_MODULE_UNITS,
} from "../../llm/schemas.js";

const HAN_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/;

export function curriculumModuleMatchesContentLanguage(
  module: NonNullable<GoalMapPlan["modules"]>[number],
  contentLanguage: ContentLanguageCode,
): boolean {
  if (contentLanguage !== "zh-Hans" && contentLanguage !== "zh-Hant") {
    return true;
  }
  const userFacingText = [
    module.title,
    module.summary,
    module.objective,
    module.dependsOnPrevious,
  ].join(" ");
  return HAN_CHARACTER_PATTERN.test(userFacingText);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Canonicalize the contract so every major area can own exactly one map root.
 * The validated module/area list is the authoritative top-level count.
 */
export function normalizeGoalMapPlan(plan: GoalMapPlan): GoalMapPlan {
  const modules = plan.modules?.slice(0, MAX_SEQUENTIAL_MODULES);
  const majorAreas = plan.majorAreas.slice(
    0,
    modules?.length ?? MAX_TOP_LEVEL_UNITS,
  );

  return {
    ...plan,
    ...(modules ? { schemaVersion: 2 as const, modules } : {}),
    majorAreas,
  };
}

function normalizeMajorArea(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const area = { ...(raw as Record<string, unknown>) };
  const role = area.mapRole ?? area.role ?? area.scope;
  if (role === "branch" || role === "module") {
    area.mapRole = "branch";
  } else if (role === "leaf" || role === "session") {
    area.mapRole = "leaf";
  } else if (
    typeof area.estimatedChildCount === "number" &&
    area.estimatedChildCount > 1
  ) {
    area.mapRole = "branch";
  } else {
    area.mapRole = area.mapRole ?? "leaf";
  }
  if (typeof area.estimatedChildCount === "number") {
    area.estimatedChildCount = clampInt(area.estimatedChildCount, 1, 30);
  }
  if (area.groupingAxis === null) delete area.groupingAxis;
  return area;
}

export function hydrateCurriculumModule(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const module = { ...(raw as Record<string, unknown>) };
  for (const field of ["title", "summary", "objective", "dependsOnPrevious"]) {
    if (typeof module[field] === "string") {
      module[field] = module[field].trim();
    }
  }
  for (const field of ["plannedOutcomes", "exitCapabilityBriefs"]) {
    if (Array.isArray(module[field])) {
      module[field] = (module[field] as unknown[])
        .flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
        .slice(0, field === "exitCapabilityBriefs" ? 8 : 6);
    }
  }
  const objective =
    typeof module.objective === "string" ? module.objective.trim() : "";
  if (
    (!Array.isArray(module.plannedOutcomes) ||
      (module.plannedOutcomes as unknown[]).length === 0) &&
    objective
  ) {
    module.plannedOutcomes = [objective];
  }
  if (
    (!Array.isArray(module.exitCapabilityBriefs) ||
      (module.exitCapabilityBriefs as unknown[]).length === 0) &&
    objective
  ) {
    module.exitCapabilityBriefs = [objective];
  }
  if (Array.isArray(module.entryFoundationBriefs)) {
    module.entryFoundationBriefs = (
      module.entryFoundationBriefs as Array<Record<string, unknown>>
    )
      .flatMap((item, index) => {
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const rationale =
          typeof item?.rationale === "string" ? item.rationale.trim() : "";
        if (!title || !rationale) return [];
        const dimensions = Array.isArray(item.verificationDimensions)
          ? [
              ...new Set(
                item.verificationDimensions.filter((value) =>
                  ["memory", "understanding", "application"].includes(
                    String(value),
                  ),
                ),
              ),
            ].slice(0, 3)
          : ["understanding"];
        return [
          {
            ref: `ef_${index + 1}`,
            title,
            rationale,
            criticality:
              item.criticality === "recommended" ? "recommended" : "critical",
            verificationDimensions:
              dimensions.length > 0 ? dimensions : ["understanding"],
          },
        ];
      })
      .slice(0, 6);
  }
  if (typeof module.estimatedUnitCount === "number") {
    module.estimatedUnitCount = clampInt(
      module.estimatedUnitCount,
      MIN_MODULE_UNITS,
      MAX_MODULE_UNITS,
    );
  }
  const estimatedUnitCount =
    typeof module.estimatedUnitCount === "number"
      ? module.estimatedUnitCount
      : 5;
  module.estimatedUnitCount = estimatedUnitCount;
  const scopeSize =
    estimatedUnitCount >= 9
      ? "large"
      : estimatedUnitCount >= 4
        ? "standard"
        : "compact";
  const rawBrief =
    module.unitPlanningBrief &&
    typeof module.unitPlanningBrief === "object" &&
    !Array.isArray(module.unitPlanningBrief)
      ? (module.unitPlanningBrief as Record<string, unknown>)
      : {};
  const progression = Array.isArray(rawBrief.progression)
    ? rawBrief.progression
        .flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
        .slice(0, 8)
    : [];
  const plannedOutcomes = Array.isArray(module.plannedOutcomes)
    ? (module.plannedOutcomes as string[])
    : [];
  module.unitPlanningBrief = {
    scopeSize,
    rationale:
      typeof rawBrief.rationale === "string" && rawBrief.rationale.trim()
        ? rawBrief.rationale.trim()
        : `This module needs ${estimatedUnitCount} focused lessons to cover its objective without overloading individual sessions.`,
    progression:
      progression.length > 0
        ? progression
        : plannedOutcomes.length > 0
          ? plannedOutcomes.slice(0, 8)
          : ["Build progressively toward the module exit capability."],
  };
  return module;
}

/** Coerce raw LLM JSON before schema validation (clamp counts, trim arrays). */
export function preprocessGoalMapPlanPayload(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  const root = { ...(data as Record<string, unknown>) };
  delete root.mapScope;
  if (Array.isArray(root.modules) && root.modules.length > 0) {
    const modules = root.modules
      .slice(0, MAX_SEQUENTIAL_MODULES)
      .map(hydrateCurriculumModule) as Array<Record<string, unknown>>;
    root.schemaVersion = 2;
    root.modules = modules;
    root.majorAreas = modules.map((module) => ({
      title: module.title,
      description: module.summary ?? module.objective,
      mapRole: "branch",
      estimatedChildCount: module.estimatedUnitCount,
      groupingAxis: "strict_sequential_milestone",
    }));
    const estimatedLeafUnits = Math.max(1, modules.length);
    root.mapStructure = {
      recommendedDepth: 2,
      estimatedLeafUnits,
      layeringStrategy:
        "Strict ordered modules; each module expands only after unlock.",
      nestingRationale:
        "Course milestones stay compact while their lesson units are generated just in time.",
    };
    if (!Array.isArray(root.whatYouWillLearn)) {
      root.whatYouWillLearn = [
        ...new Set(
          modules.flatMap((module) =>
            Array.isArray(module.plannedOutcomes)
              ? (module.plannedOutcomes as string[])
              : [],
          ),
        ),
      ].slice(0, MAX_TOP_LEVEL_UNITS);
    }
  }
  if (Array.isArray(root.majorAreas)) {
    root.majorAreas = root.majorAreas
      .slice(0, MAX_TOP_LEVEL_UNITS)
      .map(normalizeMajorArea);
  }

  if (typeof root.topicOverview === "string") {
    root.topicOverview = root.topicOverview.trim();
  }

  if (Array.isArray(root.whatYouWillLearn)) {
    const outcomes = root.whatYouWillLearn
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    root.whatYouWillLearn = outcomes.slice(0, MAX_TOP_LEVEL_UNITS + 2);
  }

  const mapStructureRaw = root.mapStructure;
  if (
    mapStructureRaw &&
    typeof mapStructureRaw === "object" &&
    !Array.isArray(mapStructureRaw)
  ) {
    const mapStructure = { ...(mapStructureRaw as Record<string, unknown>) };
    if (typeof mapStructure.recommendedDepth === "number") {
      mapStructure.recommendedDepth = Math.min(
        4,
        Math.max(1, Math.round(mapStructure.recommendedDepth)),
      );
    }
    if (typeof mapStructure.estimatedLeafUnits === "number") {
      mapStructure.estimatedLeafUnits = Math.min(
        200,
        Math.max(1, Math.round(mapStructure.estimatedLeafUnits)),
      );
    }
    if (typeof mapStructure.layeringStrategy === "string")
      mapStructure.layeringStrategy = mapStructure.layeringStrategy.trim();
    if (typeof mapStructure.nestingRationale === "string")
      mapStructure.nestingRationale = mapStructure.nestingRationale.trim();
    root.mapStructure = mapStructure;
  }

  if (
    root.domainAnalysis &&
    typeof root.domainAnalysis === "object" &&
    !Array.isArray(root.domainAnalysis)
  ) {
    const domainAnalysis = {
      ...(root.domainAnalysis as Record<string, unknown>),
    };
    if (typeof domainAnalysis.field === "string")
      domainAnalysis.field = domainAnalysis.field.trim();
    if (typeof domainAnalysis.subdomain === "string")
      domainAnalysis.subdomain = domainAnalysis.subdomain.trim();
    if (typeof domainAnalysis.modeClarification === "string")
      domainAnalysis.modeClarification =
        domainAnalysis.modeClarification.trim();
    if (!Array.isArray(domainAnalysis.alternateInterpretations)) {
      domainAnalysis.alternateInterpretations = [];
    }
    root.domainAnalysis = domainAnalysis;
  }

  return root;
}
