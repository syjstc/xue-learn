import {
  sanitizeLearningMaterialText,
  serializeLearningMaterialBlocks,
  serializeLearningMaterialKeyTakeaways,
  getPlanContextForGoal,
} from "../graph/unit-session.js";
import {
  enrichMaterialWithImages,
  stripIllustrationBlocksIfDisabled,
} from "../images/enrich-material.js";
import { isImageGenerationAvailable } from "../images/providers/index.js";
import { ensureImageRuntimeConfig } from "../images/runtime-config.js";
import type { OverviewCoursePublicationRepository } from "../../../domain/src/index.js";
import { overviewLessonTitle } from "./overview-lesson-title.js";
import type { GoalOverviewCourseResult } from "./generate-overview-course.js";
import {
  resolveOverviewCourseDifficulty,
  resolveOverviewCourseMode,
  formatOverviewCatalogLine,
} from "./generate-overview-course.js";

export type OverviewUnitNote = {
  keyConcepts: string[];
  branchIncludes: string[];
  checkQuestion: string;
  completedAt?: string | null;
};

export function parseOverviewUnitNote(raw: string): OverviewUnitNote {
  if (!raw.trim()) {
    return { keyConcepts: [], branchIncludes: [], checkQuestion: "" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OverviewUnitNote>;
    return {
      keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
      branchIncludes: Array.isArray(parsed.branchIncludes)
        ? parsed.branchIncludes
        : [],
      checkQuestion:
        typeof parsed.checkQuestion === "string" ? parsed.checkQuestion : "",
      completedAt:
        typeof parsed.completedAt === "string" ? parsed.completedAt : null,
    };
  } catch {
    return { keyConcepts: [], branchIncludes: [], checkQuestion: "" };
  }
}

export function serializeOverviewUnitNote(meta: OverviewUnitNote): string {
  return JSON.stringify(meta);
}

export async function persistOverviewCourseShellForGoal(
  goalId: string,
  options: {
    userId: string;
    title: string;
    topicOverview: string;
    branches: ReadonlyArray<{ title: string; summary: string }>;
    overviewCoursePublication: OverviewCoursePublicationRepository;
  },
): Promise<{ unitId: string; created: boolean }> {
  const plan = await getPlanContextForGoal(goalId);
  const note = serializeOverviewUnitNote({
    keyConcepts: [],
    branchIncludes: options.branches.map((branch) => branch.title),
    checkQuestion: "",
    completedAt: null,
  });
  const catalogSummary = options.branches
    .map((branch) => formatOverviewCatalogLine(branch))
    .filter(Boolean)
    .join("\n");
  const ensured =
    await options.overviewCoursePublication.ensureOwnedOverviewCourseShell({
      userId: options.userId,
      goalId,
      title: overviewLessonTitle(plan.langCode),
      difficulty: resolveOverviewCourseDifficulty(
        resolveOverviewCourseMode(options.branches),
      ),
      contentSummary:
        catalogSummary || options.topicOverview.trim() || options.title,
      note,
      topicOverview: options.topicOverview.trim() || undefined,
    });
  if (ensured.status === "not_found") {
    throw new Error("Goal not found while publishing overview course");
  }
  return { unitId: ensured.unitId, created: ensured.created };
}

export async function persistOverviewCourseForGoal(
  goalId: string,
  result: GoalOverviewCourseResult,
  options: {
    difficulty?: string;
    userId?: string;
    overviewCoursePublication?: OverviewCoursePublicationRepository;
  },
): Promise<{ unitId: string }> {
  const unitPayload = result.overviewCourse.units[0];
  if (!unitPayload) {
    throw new Error("Overview course must include exactly one unit");
  }
  if (!options.userId || !options.overviewCoursePublication) {
    throw new Error("Overview-course persistence is not configured");
  }

  const note = serializeOverviewUnitNote({
    keyConcepts: unitPayload.keyConcepts,
    branchIncludes: unitPayload.branchIncludes,
    checkQuestion: unitPayload.checkQuestion,
    completedAt: null,
  });
  const difficulty = options?.difficulty ?? "easy";
  const material = {
    introduction: sanitizeLearningMaterialText(
      unitPayload.material.introduction,
    ),
    sections: serializeLearningMaterialBlocks(unitPayload.material),
    keyTakeaways: serializeLearningMaterialKeyTakeaways(
      unitPayload.material.keyTakeaways,
    ),
  };

  const plan = await getPlanContextForGoal(goalId);
  const published =
    await options.overviewCoursePublication.publishOwnedOverviewCourse({
      userId: options.userId,
      goalId,
      title: overviewLessonTitle(plan.langCode),
      difficulty,
      contentSummary: unitPayload.summary,
      note,
      material,
      topicOverview: result.overviewCourse.summary.trim() || undefined,
    });
  if (published.status === "not_found") {
    throw new Error("Goal not found while publishing overview course");
  }
  await enrichPersistedOverviewMaterial(
    options.userId,
    goalId,
    published.unitId,
    unitPayload.title,
    unitPayload.material,
    options.overviewCoursePublication,
  );

  return published;
}

async function enrichPersistedOverviewMaterial(
  userId: string,
  goalId: string,
  unitId: string,
  unitTitle: string,
  material: GoalOverviewCourseResult["overviewCourse"]["units"][number]["material"],
  publication: OverviewCoursePublicationRepository,
): Promise<void> {
  await ensureImageRuntimeConfig();
  if (!isImageGenerationAvailable()) return;

  const plan = await getPlanContextForGoal(goalId);
  const enriched = await enrichMaterialWithImages(
    stripIllustrationBlocksIfDisabled(material),
    unitId,
    {
      goalId,
      unitTitle,
      contentLanguage: plan.langCode,
    },
  );

  await publication.updateOwnedOverviewMaterial({
    userId,
    goalId,
    unitId,
    material: {
      introduction: sanitizeLearningMaterialText(enriched.introduction),
      sections: serializeLearningMaterialBlocks(enriched),
      keyTakeaways: serializeLearningMaterialKeyTakeaways(
        enriched.keyTakeaways,
      ),
    },
  });
}
