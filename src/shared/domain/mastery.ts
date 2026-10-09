import type {
  CognitiveDimension,
  LearnerMasteryStatus,
} from "./cognitive-model.ts";

export type MasteryTargetSummary = {
  learningTargetId: string;
  title: string;
  status: LearnerMasteryStatus;
  verifiedMasteryPercent: number;
  evidenceCoveragePercent: number;
  passed: boolean;
  weakDimensions: CognitiveDimension[];
  unverifiedDimensions: CognitiveDimension[];
};

export type MasterySummary = {
  projectionVersion: number;
  assessmentPolicyVersion: number;
  scope: "goal" | "module";
  scopeId: string;
  status: LearnerMasteryStatus;
  verifiedMasteryPercent: number;
  evidenceCoveragePercent: number;
  requiredTargetCount: number;
  demonstratedTargetCount: number;
  formingTargetCount: number;
  unobservedTargetCount: number;
  robustTargetCount: number;
  revalidationTargetCount: number;
  weakDimensions: CognitiveDimension[];
  unverifiedDimensions: CognitiveDimension[];
  targets: MasteryTargetSummary[];
  modelVersion: number;
  inferencePolicyVersion: number;
  evidenceCutoffAt: string | null;
  lifecycleCutoffAt: string | null;
  computedAt: string;
};

const MASTERY_DIMENSION_LABELS: Record<CognitiveDimension, string> = {
  memory: "记忆",
  understanding: "理解",
  application: "应用",
  transfer: "迁移",
  fluency: "熟练",
  stability: "稳定",
  independence: "独立",
};

export function formatMasteryDimensions(
  dimensions: readonly CognitiveDimension[],
): string {
  return dimensions
    .map((dimension) => MASTERY_DIMENSION_LABELS[dimension])
    .join("、");
}
