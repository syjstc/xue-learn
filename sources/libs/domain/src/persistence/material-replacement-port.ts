import type { MaterialCheckTaskDefinition } from "./material-check-completion-port.js";
import type { UnitLearningProgressReset } from "./unit-learning-progress-reset-port.js";

export type MaterialReplacementContent = Readonly<{
  introduction: string;
  sections: string;
  keyTakeaways: string;
  contextSources: string;
  sourceItemsJson: string;
}>;

export type MaterialReplacementInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  material: MaterialReplacementContent;
  sq3rData?: string;
  publishChecks: boolean;
  materialCheckTasks: readonly MaterialCheckTaskDefinition[];
  resetProgress: boolean;
  clearDownstream: boolean;
  deleteFollowUpThreadId?: string;
  expectedContentRevision?: number;
}>;

export type MaterialReplacementResult = Readonly<{
  contentRevision: number;
  reset: UnitLearningProgressReset;
}>;

export class MaterialReplacementStaleRevisionError extends Error {
  constructor(
    readonly expectedContentRevision?: number,
    readonly currentContentRevision?: number,
  ) {
    super("material replacement content revision is stale");
    this.name = "MaterialReplacementStaleRevisionError";
  }
}

/** Atomic full-unit material replacement and its learner-state reset composition. */
export interface MaterialReplacementRepository {
  replace(input: MaterialReplacementInput): Promise<MaterialReplacementResult>;
}
