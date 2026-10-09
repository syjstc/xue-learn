import type { MaterialCheckTaskDefinition } from "./material-check-completion-port.js";
import type {
  MaterialReplacementContent,
  MaterialReplacementResult,
} from "./material-replacement-port.js";

export type SectionMaterialReplacementInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  sectionId: string;
  sectionMaterial: MaterialReplacementContent;
  aggregatedMaterial: MaterialReplacementContent;
  publishChecks: boolean;
  materialCheckTasks: readonly MaterialCheckTaskDefinition[];
  resetProgress: boolean;
  clearDownstream: boolean;
  deleteFollowUpThreadId: string;
  expectedContentRevision: number;
  expectedSectionContentRevision: number;
}>;

/** Atomic replacement for one first-class section and its unit projection. */
export interface SectionMaterialReplacementRepository {
  replaceSection(
    input: SectionMaterialReplacementInput,
  ): Promise<MaterialReplacementResult>;
}
