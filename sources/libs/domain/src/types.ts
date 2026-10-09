export type UserLevel = 'zero' | 'basic' | 'advanced';
export type DomainTag = 'stem' | 'humanities' | 'general';
export type UnitStatus =
  | 'available'
  | 'in_progress'
  | 'completed'
  | 'completed_needs_reinforcement'
  | 'skipped';
export type PathSource = 'rag' | 'search' | 'generic';
export type SessionStep =
  | 'structured_input'
  | 'active_recall'
  | 'feynman'
  | 'socratic'
  | 'complete';
