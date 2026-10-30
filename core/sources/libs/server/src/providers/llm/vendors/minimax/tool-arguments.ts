import {fromJSONSchema} from "zod";

type Schema = boolean | Readonly<Record<string, unknown>>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Decode observed MiniMax transport wrappers only where the schema declares
 * their type. Opaque payloads, strings, unknown keys and missing fields survive
 * unchanged; the authoritative validator still decides whether to accept. */
export function normalizeMinimaxToolValue(input: unknown, schema: Schema): unknown {
  const resolve = (value: Schema): Schema => {
    for (let count = 0; record(value) && typeof value.$ref === "string" && count < 32; count++) {
      if (!value.$ref.startsWith("#/")) break;
      let target: unknown = schema;
      for (const key of value.$ref.slice(2).split("/")) {
        target = target !== null && typeof target === "object" ? (target as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
      }
      if (!record(target) && typeof target !== "boolean") break;
      value = target;
    }
    return value;
  };
  const visit = (value: unknown, rawSchema: Schema, depth: number): unknown => {
    if (depth > 64) return value;
    const current = resolve(rawSchema);
    if (!record(current)) return value;
    const types = Array.isArray(current.type) ? current.type : [current.type];
    if (types.includes("string") && typeof value === "string") return value;
    const objectType = types.includes("object") || record(current.properties);
    const arrayType = types.includes("array");
    if (objectType || arrayType) {
      const text = record(value) && Object.keys(value).length === 1 && typeof value.$text === "string" ? value.$text : value;
      if (typeof text === "string" && /^[\s]*[\[{]/.test(text)) {
        try {
          const decoded: unknown = JSON.parse(text);
          if ((objectType && record(decoded)) || (arrayType && Array.isArray(decoded))) value = decoded;
        } catch { /* Keep incomplete or non-JSON content for normal validation. */ }
      }
    }
    const branches = current.anyOf ?? current.oneOf;
    if (Array.isArray(branches)) {
      const validatorFor = (branch: Schema) => fromJSONSchema((record(branch)
        ? {...branch, ...(record(schema) && schema.$defs ? {$defs: schema.$defs} : {}),
          ...(record(schema) && schema.definitions ? {definitions: schema.definitions} : {})}
        : branch) as Parameters<typeof fromJSONSchema>[0]);
      for (const branch of branches) {
        if (!record(branch) && typeof branch !== "boolean") continue;
        try { if (validatorFor(branch).safeParse(value).success) return value; }
        catch { /* Local recursive references may need the enclosing schema. */ }
      }
      for (const branch of branches) {
        if (!record(branch) && typeof branch !== "boolean") continue;
        const candidate = visit(value, branch, depth + 1);
        const resolved = resolve(branch);
        if (record(candidate) && record(resolved) && record(resolved.properties)) {
          const literals = Object.entries(resolved.properties).flatMap(([key, property]) => {
            if (!record(property) && typeof property !== "boolean") return [];
            const field = resolve(property);
            return record(field) && Object.hasOwn(field, "const") ? [[key, field.const] as const] : [];
          });
          if (literals.length && literals.every(([key, literal]) => candidate[key] === literal)) return candidate;
        }
        try {
          if (validatorFor(branch).safeParse(candidate).success) return candidate;
        } catch { /* Unsupported schemas remain the authoritative validator's concern. */ }
      }
      return value;
    }
    if (arrayType) {
      if (record(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "item")) {
        value = Array.isArray(value.item) ? value.item : [value.item];
      }
      if (!Array.isArray(value)) return value;
      const items = current.items;
      return record(items) || typeof items === "boolean" ? value.map(item => visit(item, items, depth + 1)) : value;
    }
    if (objectType && record(value)) {
      const properties = record(current.properties) ? current.properties : {};
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        const property = properties[key] ?? current.additionalProperties;
        return [key, record(property) || typeof property === "boolean" ? visit(item, property, depth + 1) : item];
      }));
    }
    if (typeof value === "string") {
      if (types.includes("number") || types.includes("integer")) {
        if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
          const number = Number(value);
          if (Number.isFinite(number) && (!types.includes("integer") || Number.isSafeInteger(number))) return number;
        }
      }
      if (types.includes("boolean") && (value === "true" || value === "false")) return value === "true";
    }
    return value;
  };
  return visit(input, schema, 0);
}
