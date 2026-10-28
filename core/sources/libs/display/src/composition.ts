import type {DisplayNode} from "./types.js";

const forbidden = new Set(["__proto__", "prototype", "constructor"]);
/** Bindings read JSON data only. They cannot evaluate expressions, functions or code. */
function bind(value: unknown, payload: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => bind(item, payload));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (object.$display === "payload") {
    const path = object.path;
    if (typeof path !== "string") throw new Error("Display payload bindings need a string path");
    let result = payload;
    for (const key of path ? path.split(".") : []) {
      if (forbidden.has(key) || !result || typeof result !== "object" || !Object.hasOwn(result, key)) throw new Error(`Unknown display payload binding: ${path}`);
      result = (result as Record<string, unknown>)[key];
    }
    return result;
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => {
    if (forbidden.has(key)) throw new Error(`Forbidden display payload key: ${key}`);
    return [key, bind(item, payload)];
  }));
}

/** Template ids are scoped by the caller. Slots preserve the authored child identities. */
export function expandDisplayComposition(node: DisplayNode, template: DisplayNode): DisplayNode {
  const visit = (current: DisplayNode, depth: number): DisplayNode[] => {
    if (depth > 64) throw new Error("Display composition exceeds the nesting limit");
    if (current.kind === "display:slot") {
      const name = (current.payload as {name?: unknown})?.name;
      if (typeof name !== "string") throw new Error("A display:slot needs a slot name");
      return [...(name === "children" ? node.children ?? [] : node.slots?.[name] ?? [])];
    }
    return [{...current, id: `${node.id}/${current.id}`, payload: bind(current.payload, node.payload),
      ...(current.children ? {children: current.children.flatMap(child => visit(child, depth + 1))} : {}),
      ...(current.slots ? {slots: Object.fromEntries(Object.entries(current.slots).map(([name, children]) => [name, children.flatMap(child => visit(child, depth + 1))]))} : {}),
    }];
  };
  const result = visit(template, 0);
  if (result.length !== 1) throw new Error("A declarative component must expand to exactly one root node");
  return result[0]!;
}
