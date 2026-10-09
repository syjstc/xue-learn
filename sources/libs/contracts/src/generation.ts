export type GenerationScope =
  | 'goal'
  | 'module'
  | 'unit'
  | 'goal_creation';
export type GenerationRunStatus = 'running' | 'completed' | 'cancelled' | 'error';

export interface GenerationRunDto {
  id: string;
  scope: GenerationScope;
  scopeId: string;
  operation: string;
  status: GenerationRunStatus;
  tokenPreview: string;
  statusMessage: string;
  partialEvent?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
