export type ModuleEntryFoundationContext = Readonly<{
  moduleId: string;
  orderIndex: number;
  entryFoundationBriefs: unknown;
  entryFoundationStatus: string;
  mapPlanJson: string;
  hasEntryTargets: boolean;
}>;

export type ModuleEntryFoundationPublicationResult = Readonly<{
  goalId: string;
  status: "superseded" | "not_applicable" | "ready";
}>;

export interface ModuleEntryFoundationQueueRepository {
  findOwnedContext(input: Readonly<{ userId: string; goalId: string; moduleId: string }>): Promise<ModuleEntryFoundationContext | null>;
  markNotApplicable(moduleId: string): Promise<boolean>;
  claim(input: Readonly<{ userId: string; goalId: string; moduleId: string; briefs: unknown; token: string; now: Date; leaseMs: number; eventType: string }>): Promise<boolean>;
  publish(input: Readonly<{ goalId: string; moduleId: string; token: string }>): Promise<ModuleEntryFoundationPublicationResult>;
  markFailed(input: Readonly<{ moduleId: string; token: string; message: string }>): Promise<void>;
}
