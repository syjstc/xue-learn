export type Position = {route?: string; goalId?: string; unitId?: string; sectionId?: string; tab?: 'reading' | 'display' | 'practice'};
export function isLearningRoute(value: unknown): value is string;
export function positionPath(position?: Position): string;
export function routePosition(route: string): Position | null;
