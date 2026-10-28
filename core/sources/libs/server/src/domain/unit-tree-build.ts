import type { UnitContentGenStatus } from "./unit-content-status.js";

export type FlatUnit = {
  id: string;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  contentGen?: UnitContentGenStatus;
};

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
