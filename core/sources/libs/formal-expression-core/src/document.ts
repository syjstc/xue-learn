import type { FormalDocument, LayoutNode, Patch, SubjectRef } from "./types.js";

export const clone = <T>(value: T): T => structuredClone(value);
export function createDocument(id = "document"): FormalDocument {
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    nodes: {},
    relations: {},
    layouts: {},
    roots: [],
    layoutRoots: [],
  };
}

export function applyPatches(
  document: FormalDocument,
  patches: Patch[],
): { document: FormalDocument; inverse: Patch[] } {
  const next = clone(document);
  const inverse: Patch[] = [];
  for (const patch of patches) {
    if (patch.op === "setRoots") {
      inverse.unshift({
        op: "setRoots",
        target: patch.target,
        value: [...next[patch.target]],
      });
      next[patch.target] = [...patch.value];
      continue;
    }
    const table = next[patch.table] as Record<string, any>;
    const old = table[patch.id];
    inverse.unshift(
      old === undefined
        ? { op: "delete", table: patch.table, id: patch.id }
        : { op: "set", table: patch.table, id: patch.id, value: clone(old) },
    );
    if (patch.op === "delete") delete table[patch.id];
    else table[patch.id] = clone(patch.value);
  }
  return { document: next, inverse };
}

export function validateDocument(doc: FormalDocument): string[] {
  const errors: string[] = [];
  const layoutKinds = new Set([
    "subject",
    "flow",
    "stack",
    "overlay",
    "grid",
    "attach",
    "surround",
    "free",
  ]);
  if (doc.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const id of doc.roots)
    if (!doc.nodes[id]) errors.push(`root ${id} is missing`);
  const parent = new Map<string, string>();
  for (const [id, relation] of Object.entries(doc.relations)) {
    if (relation.kind === "containment") {
      if (!doc.nodes[relation.parent] || !doc.nodes[relation.child])
        errors.push(`relation ${id} has a missing endpoint`);
      const existing = parent.get(relation.child);
      if (existing && existing !== id)
        errors.push(`node ${relation.child} has multiple containment parents`);
      else parent.set(relation.child, id);
    } else if (
      !doc.nodes[relation.connector] ||
      !doc.nodes[relation.participant]
    )
      errors.push(`relation ${id} has a missing endpoint`);
  }
  const children = new Map<string, string[]>();
  for (const r of Object.values(doc.relations))
    if (r.kind === "containment")
      children.set(r.parent, [...(children.get(r.parent) ?? []), r.child]);
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) {
      errors.push(`containment cycle at ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children.get(id) ?? []) walk(child);
    visiting.delete(id);
    visited.add(id);
  };
  Object.keys(doc.nodes).forEach(walk);
  for (const [id, layout] of Object.entries(doc.layouts)) {
    if (!layoutKinds.has(layout.kind))
      errors.push(`layout ${id} has invalid kind ${String(layout.kind)}`);
    for (const child of layout.children)
      if (!doc.layouts[child])
        errors.push(`layout ${id} references missing child ${child}`);
    if (layout.subject?.type === "node" && !doc.nodes[layout.subject.id])
      errors.push(`layout ${id} references missing node ${layout.subject.id}`);
    if (
      layout.subject?.type === "relation" &&
      !doc.relations[layout.subject.id]
    )
      errors.push(
        `layout ${id} references missing relation ${layout.subject.id}`,
      );
  }
  const layoutVisiting = new Set<string>(),
    layoutVisited = new Set<string>();
  const walkLayout = (id: string) => {
    if (layoutVisiting.has(id)) {
      errors.push(`layout cycle at ${id}`);
      return;
    }
    if (layoutVisited.has(id) || !doc.layouts[id]) return;
    layoutVisiting.add(id);
    doc.layouts[id].children.forEach(walkLayout);
    layoutVisiting.delete(id);
    layoutVisited.add(id);
  };
  Object.keys(doc.layouts).forEach(walkLayout);
  doc.layoutRoots.forEach((id) => {
    if (!doc.layouts[id]) errors.push(`layout root ${id} is missing`);
  });
  return [...new Set(errors)];
}
export function affectedSubjects(patches: Patch[]): SubjectRef[] {
  const seen = new Set<string>();
  const result: SubjectRef[] = [];
  for (const p of patches)
    if (p.op !== "setRoots") {
      const type =
        p.table === "nodes"
          ? "node"
          : p.table === "relations"
            ? "relation"
            : "layout";
      const key = `${type}:${p.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ type, id: p.id } as SubjectRef);
      }
    }
  return result;
}
export const patchSetLayout = (id: string, layout: LayoutNode): Patch => ({
  op: "set",
  table: "layouts",
  id,
  value: layout,
});
