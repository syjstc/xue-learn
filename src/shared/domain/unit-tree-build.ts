import type { UnitContentGenStatus } from "@/shared/domain/unit-content-status";

export type FlatUnit = {
  id: string;
  moduleId?: string | null;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  contentGen?: UnitContentGenStatus;
  completionMethod?: "learned" | "test_out" | null;
  supportKind?: "prerequisite_bridge" | null;
};

type UnitHierarchyGoal = {
  id: string;
  modules?: Array<{ id: string; title: string }>;
  units: Array<{
    id: string;
    moduleId?: string | null;
    parentUnitId?: string | null;
    title: string;
  }>;
};

export type UnitHierarchyContext = {
  moduleId?: string;
  moduleTitle?: string;
  returnTo: string;
};

export function resolveUnitHierarchy(
  goal: UnitHierarchyGoal,
  unitId: string,
  options: {
    moduleId?: string;
    parentUnitId?: string | null;
    returnTo?: string;
  } = {},
): UnitHierarchyContext {
  const unit = goal.units.find((item) => item.id === unitId);
  const moduleId =
    options.moduleId ??
    unit?.moduleId ??
    unit?.parentUnitId ??
    options.parentUnitId ??
    undefined;
  const moduleTitle = moduleId
    ? (goal.modules?.find((item) => item.id === moduleId)?.title ??
      goal.units.find((item) => item.id === moduleId)?.title)
    : undefined;

  return {
    moduleId,
    moduleTitle,
    returnTo:
      options.returnTo ??
      (moduleId
        ? `/goals/${goal.id}/modules/${moduleId}`
        : `/goals/${goal.id}`),
  };
}

export type UnitTreeNode = FlatUnit & {
  /** 0 = top-level on goal map */
  depth: number;
  children: UnitTreeNode[];
};

export function buildUnitTree(units: FlatUnit[]): UnitTreeNode[] {
  const byParent = new Map<string | null, FlatUnit[]>();

  for (const u of units) {
    const key = u.parentUnitId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(u);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  function attach(parentId: string | null, depth: number): UnitTreeNode[] {
    return (byParent.get(parentId) ?? []).map((u) => ({
      ...u,
      depth,
      children: attach(u.id, depth + 1),
    }));
  }

  return attach(null, 0);
}

/** Hierarchical index like 1, 1.2, 2.1 for display in learning path */
export function formatTreeIndex(indices: number[]): string {
  return indices.join(".");
}

/**
 * Keep unusually deep legacy paths readable without losing their position.
 * Normal one- and two-level maps retain their full index.
 */
export function formatCompactTreeIndex(
  indices: number[],
  maxSegments = 4,
): string {
  if (indices.length <= maxSegments) return formatTreeIndex(indices);
  const leadingCount = Math.max(1, maxSegments - 1);
  return `${indices.slice(0, leadingCount).join(".")}…${indices[indices.length - 1]}`;
}

/** Branches to open when presenting a bounded overview of the map. */
export function collectBranchIdsThroughDepth(
  nodes: UnitTreeNode[],
  maxBranchDepth: number,
): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    if (node.depth <= maxBranchDepth) ids.push(node.id);
    if (node.depth < maxBranchDepth) {
      ids.push(...collectBranchIdsThroughDepth(node.children, maxBranchDepth));
    }
  }
  return ids;
}

/** Depth-first lesson order for learning-path navigation. */
export function flattenLessonUnits(nodes: UnitTreeNode[]): UnitTreeNode[] {
  const lessons: UnitTreeNode[] = [];
  function walk(list: UnitTreeNode[]) {
    for (const node of list) {
      if (node.unitKind === "lesson") lessons.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  }
  walk(nodes);
  return lessons;
}

export function resolveNextLessonUnit(
  units: FlatUnit[],
  currentUnitId: string,
): FlatUnit | null {
  const roots = buildUnitTree(units);
  const lessons = flattenLessonUnits(roots);
  const index = lessons.findIndex((unit) => unit.id === currentUnitId);
  if (index < 0 || index >= lessons.length - 1) return null;
  return lessons[index + 1] ?? null;
}

export function resolveNextLessonUnitInModule(
  units: FlatUnit[],
  currentUnitId: string,
  moduleId: string,
): FlatUnit | null {
  const lessons = units
    .filter(
      (unit) =>
        unit.unitKind === "lesson" &&
        unit.supportKind !== "prerequisite_bridge" &&
        (unit.moduleId === moduleId || unit.parentUnitId === moduleId),
    )
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const index = lessons.findIndex((unit) => unit.id === currentUnitId);
  if (index < 0 || index >= lessons.length - 1) return null;
  return lessons[index + 1] ?? null;
}
