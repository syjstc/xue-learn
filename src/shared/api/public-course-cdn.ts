import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { ScenarioTheaterDefinition } from "@/shared/domain/scenario-theater";
import type { GoalKind } from "@/shared/api/types";
import { ApiError } from "@/shared/api/http";
import { messageForApiErrorStatus } from "@/shared/api/user-facing-error";

export type PublicCourseManifestSection =
  | {
      kind: "module";
      index: string;
      title: string;
      contentSummary: string;
    }
  | {
      kind: "lesson";
      unitId: string;
      index: string;
      title: string;
      contentSummary: string;
      unitPath: string;
      checksum: string;
    };

export type PublicCourseManifestUnit = {
  unitId: string;
  index: string;
  title: string;
  contentSummary: string;
  objectKey: string;
  url: string;
  checksum: string;
  bytes: number;
};

export type PublicCourseManifest = {
  schemaVersion: number;
  shareId: string;
  goalId: string;
  publishedAt: string;
  goal: {
    id: string;
    title: string;
    level: string;
    goalKind: GoalKind;
    topicOverview: string;
    iconSvg?: string;
    iconTint?: string;
  };
  sections: PublicCourseManifestSection[];
  units: PublicCourseManifestUnit[];
  checksum: string;
  bytes: number;
};

export type PublicCourseUnitPayload = {
  unitId: string;
  title: string;
  index: string;
  contentSummary: string;
  material: LearningMaterialContent | null;
  scenarioTheater?: ScenarioTheaterDefinition;
  sections?: Array<{
    id: string;
    stableKey: string;
    orderIndex: number;
    title: string;
    contentSummary: string;
    requiredForCompletion: boolean;
    componentPlan: unknown;
    material: LearningMaterialContent;
  }>;
};

export async function fetchPublicCourseManifest(
  manifestUrl: string,
): Promise<PublicCourseManifest> {
  const res = await fetch(manifestUrl, { credentials: "omit" });
  if (!res.ok) {
    throw new ApiError(messageForApiErrorStatus(res.status), res.status);
  }
  return (await res.json()) as PublicCourseManifest;
}

export async function fetchPublicCourseUnit(
  unitUrl: string,
): Promise<PublicCourseUnitPayload> {
  const res = await fetch(unitUrl, { credentials: "omit" });
  if (!res.ok) {
    throw new ApiError(messageForApiErrorStatus(res.status), res.status);
  }
  return (await res.json()) as PublicCourseUnitPayload;
}
