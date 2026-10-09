import type { UnitContentGenStatus } from "@/shared/domain/unit-content-status";

export type UserLevel = "zero" | "basic" | "advanced";
export type DomainTag = "stem" | "humanities" | "general";
export type UnitStatus =
  | "available"
  | "in_progress"
  | "completed"
  | "completed_needs_reinforcement"
  | "skipped";
export type PathSource = "rag" | "search" | "generic";
export type SessionStep =
  | "structured_input"
  | "active_recall"
  | "feynman"
  | "socratic"
  | "complete";

export const UNIT_STATUS_COLORS: Record<UnitStatus, string> = {
  available: "#64748b",
  in_progress: "#5b5fef",
  completed: "#22c55e",
  completed_needs_reinforcement: "#f59e0b",
  skipped: "#94a3b8",
};

export interface MapNode {
  id: string;
  label: string;
  status: UnitStatus;
  position?: { x: number; y: number };
  unitKind?: "lesson" | "module";
  /** 0 = top-level on goal map */
  depth?: number;
  /** 1-based step in sequential path layout */
  stepIndex?: number;
  contentGen?: UnitContentGenStatus;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind?: "prerequisite" | "containment" | "sequence";
}

export type GoalMapLayoutMode = "sequential" | "tree";
