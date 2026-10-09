import { clone } from "./document.js";
import type {
  ContainmentRelation,
  FormalDocument,
  FormalNode,
  FormalRelation,
  JsonValue,
  LayoutNode,
  Patch,
  SerializedCommand,
} from "./types.js";
const setNode = (id: string, node: FormalNode): Patch => ({
  op: "set",
  table: "nodes",
  id,
  value: node,
});
const delRelation = (id: string): Patch => ({
  op: "delete",
  table: "relations",
  id,
});
function subtree(doc: FormalDocument, root: string): string[] {
  const out = [root];
  for (const r of Object.values(doc.relations))
    if (r.kind === "containment" && r.parent === root)
      out.push(...subtree(doc, r.child));
  return out;
}
export function prepareCommand(
  doc: FormalDocument,
  command: SerializedCommand,
): Patch[] {
  const c = command as any;
  switch (c.type) {
    case "insertNode":
      return [
        setNode(c.id, c.node),
        ...(c.root
          ? [
              {
                op: "setRoots",
                target: "roots",
                value: [...doc.roots, c.id],
              } as Patch,
            ]
          : []),
      ];
    case "replaceNode":
      if (!doc.nodes[c.id]) throw new Error(`node ${c.id} does not exist`);
      return [setNode(c.id, c.node)];
    case "removeNode": {
      if (!doc.nodes[c.id]) throw new Error(`node ${c.id} does not exist`);
      const ids = new Set(subtree(doc, c.id));
      const patches: Patch[] = [];
      for (const [relationId, r] of Object.entries(doc.relations))
        if (
          (r.kind === "containment" &&
            (ids.has(r.parent) || ids.has(r.child))) ||
          (r.kind === "connection" &&
            (ids.has(r.connector) || ids.has(r.participant)))
        )
          patches.push(delRelation(relationId));
      for (const id of ids) patches.push({ op: "delete", table: "nodes", id });
      patches.push({
        op: "setRoots",
        target: "roots",
        value: doc.roots.filter((id) => !ids.has(id)),
      });
      return patches;
    }
    case "moveNode": {
      const rel = Object.entries(doc.relations).find(
        ([, r]) => r.kind === "containment" && r.child === c.id,
      );
      const patches: Patch[] = rel ? [delRelation(rel[0])] : [];
      if (c.parent)
        patches.push({
          op: "set",
          table: "relations",
          id: c.relationId ?? `contain:${c.parent}:${c.id}`,
          value: {
            kind: "containment",
            parent: c.parent,
            child: c.id,
            slot: c.slot ?? "content",
            index: c.index ?? 0,
          },
        });
      patches.push({
        op: "setRoots",
        target: "roots",
        value: c.parent
          ? doc.roots.filter((id) => id !== c.id)
          : [...doc.roots.filter((id) => id !== c.id), c.id],
      });
      return patches;
    }
    case "cloneSubtree": {
      const ids = subtree(doc, c.id);
      const map = new Map(
        ids.map((id, i) => [id, `${c.prefix ?? `${c.id}-copy`}${i || ""}`]),
      );
      const patches: Patch[] = ids.map((id) =>
        setNode(map.get(id)!, clone(doc.nodes[id])),
      );
      for (const [relationId, r] of Object.entries(doc.relations))
        if (r.kind === "containment" && map.has(r.parent) && map.has(r.child))
          patches.push({
            op: "set",
            table: "relations",
            id: `${relationId}-copy-${c.prefix}`,
            value: {
              ...clone(r),
              parent: map.get(r.parent)!,
              child: map.get(r.child)!,
            },
          });
      patches.push({
        op: "setRoots",
        target: "roots",
        value: [...doc.roots, map.get(c.id)!],
      });
      return patches;
    }
    case "wrap": {
      const node: FormalNode = c.wrapper;
      const wrapperId: string = c.wrapperId;
      const old = Object.entries(doc.relations).find(
        ([, r]) =>
          (r.kind === "containment" && r.child === c.id) ||
          (r.kind === "connection" && r.participant === c.id),
      );
      const relationId = c.relationId ?? `contain:${wrapperId}:${c.id}`;
      const relation: FormalRelation = {
        kind: "containment",
        parent: wrapperId,
        child: c.id,
        slot: c.slot ?? "content",
        index: 0,
      };
      const patches: Patch[] = [
        setNode(wrapperId, node),
        { op: "set", table: "relations", id: relationId, value: relation },
      ];
      if (old?.[1].kind === "containment")
        patches.push({
          op: "set",
          table: "relations",
          id: old[0],
          value: { ...old[1], child: wrapperId },
        });
      else if (old?.[1].kind === "connection")
        patches.push({
          op: "set",
          table: "relations",
          id: old[0],
          value: { ...old[1], participant: wrapperId },
        });
      else
        patches.push({
          op: "setRoots",
          target: "roots",
          value: doc.roots.map((id) => (id === c.id ? wrapperId : id)),
        });
      return patches;
    }
    case "unwrap": {
      const outgoing = Object.entries(doc.relations)
        .filter(
          (entry): entry is [string, ContainmentRelation] =>
            entry[1].kind === "containment" && entry[1].parent === c.id,
        )
        .sort((a, b) => a[1].index - b[1].index);
      const incoming = Object.entries(doc.relations).find(
        (entry): entry is [string, ContainmentRelation] =>
          entry[1].kind === "containment" && entry[1].child === c.id,
      );
      const patches: Patch[] = [
        { op: "delete", table: "nodes", id: c.id },
        ...outgoing.map(([id]) => delRelation(id)),
      ];
      if (incoming) {
        const parentRelation = incoming[1];
        patches.push(delRelation(incoming[0]));
        outgoing.forEach(([, r], i) =>
          patches.push({
            op: "set",
            table: "relations",
            id: `${incoming[0]}:${i}`,
            value: {
              ...parentRelation,
              child: r.child,
              index: parentRelation.index + i,
            },
          }),
        );
      } else
        patches.push({
          op: "setRoots",
          target: "roots",
          value: doc.roots.flatMap((id) =>
            id === c.id ? outgoing.map(([, r]) => r.child) : id,
          ),
        });
      return patches;
    }
    case "connect":
      return [
        {
          op: "set",
          table: "relations",
          id: c.id,
          value: c.relation,
        },
      ];
    case "disconnect":
      return [delRelation(c.id)];
    case "setContent": {
      const node = doc.nodes[c.id];
      if (!node) throw new Error(`node ${c.id} does not exist`);
      return [
        setNode(c.id, {
          ...node,
          contentType: c.contentType ?? node.contentType,
          value: c.value,
        }),
      ];
    }
    case "setAttribute": {
      const node = doc.nodes[c.id];
      if (!node) throw new Error(`node ${c.id} does not exist`);
      const attributes = { ...(node.attributes ?? {}) };
      if (c.value === undefined) delete attributes[c.key];
      else attributes[c.key] = c.value as JsonValue;
      return [setNode(c.id, { ...node, attributes })];
    }
    case "setLayout":
      return Object.entries(c.layouts as Record<string, LayoutNode>).map(
        ([id, layout]) => ({
          op: "set" as const,
          table: "layouts" as const,
          id,
          value: layout,
        }),
      );
    case "moveLayoutItem": {
      const from = doc.layouts[c.from],
        to = doc.layouts[c.to];
      if (!from || !to) throw new Error("layout parent does not exist");
      return [
        {
          op: "set",
          table: "layouts",
          id: c.from,
          value: {
            ...from,
            children: from.children.filter((id) => id !== c.id),
          },
        },
        {
          op: "set",
          table: "layouts",
          id: c.to,
          value: {
            ...to,
            children: [
              ...to.children.slice(0, c.index ?? to.children.length),
              c.id,
              ...to.children.slice(c.index ?? to.children.length),
            ],
          },
        },
      ];
    }
    default:
      throw new Error(`unknown command ${c.type}`);
  }
}
