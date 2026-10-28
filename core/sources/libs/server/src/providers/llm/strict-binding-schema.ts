import { projectProviderBindingSchema } from "./provider-binding-schema.js";

export type StrictBindingDialect = "openai" | "deepseek";

const SUPPORTED_TYPES = new Set([
  "object",
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "null",
]);

const STRICT_SCHEMA_KEYWORDS = new Set([
  "$ref",
  "$defs",
  "definitions",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
  "oneOf",
  "description",
  "title",
  "pattern",
  "format",
  "default",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableSchema(schema: unknown): boolean {
  if (!isSchemaObject(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined;
  return Boolean(variants?.some(isNullableSchema));
}

function asNullable(schema: unknown): unknown {
  if (isNullableSchema(schema)) return schema;
  return { anyOf: [schema, { type: "null" }] };
}

function compileStrictSchemaNode(
  value: unknown,
  dialect: StrictBindingDialect,
): unknown | undefined {
  if (!isSchemaObject(value)) return value;
  const node = value;
  if (typeof node.type !== "undefined") {
    if (typeof node.type === "string") {
      if (!SUPPORTED_TYPES.has(node.type)) return undefined;
    } else if (Array.isArray(node.type)) {
      // DeepSeek strict rejects type unions on the node itself.
      if (dialect === "deepseek") return undefined;
      if (
        !node.type.every(
          (entry) => typeof entry === "string" && SUPPORTED_TYPES.has(entry),
        )
      ) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    if (key === "$schema") continue;
    if (key === "prefixItems") {
      if (!Array.isArray(child) || child.length === 0) return undefined;
      const compiled = child.map((entry) =>
        compileStrictSchemaNode(entry, dialect),
      );
      if (compiled.some((entry) => entry === undefined)) return undefined;
      // Neither OpenAI Structured Outputs nor DeepSeek strict accept JSON
      // Schema tuple `prefixItems`. Coordinates stay constrained to array
      // items; exact tuple length/order remains in the authoritative schema.
      const [first] = compiled;
      const homogeneous = compiled.every(
        (entry) => JSON.stringify(entry) === JSON.stringify(first),
      );
      if (homogeneous) {
        output.items = first;
      } else {
        const itemTypes = [
          ...new Set(
            compiled.flatMap((entry) =>
              isSchemaObject(entry) && typeof entry.type === "string"
                ? [entry.type]
                : [],
            ),
          ),
        ];
        if (itemTypes.length !== 1) return undefined;
        output.items = { type: itemTypes[0], anyOf: compiled };
      }
      continue;
    }
    if (!STRICT_SCHEMA_KEYWORDS.has(key)) return undefined;
    if (key === "properties" || key === "$defs" || key === "definitions") {
      if (!isSchemaObject(child)) return undefined;
      const compiledEntries: Array<[string, unknown]> = [];
      for (const [name, nested] of Object.entries(child)) {
        const compiled = compileStrictSchemaNode(nested, dialect);
        if (compiled === undefined) return undefined;
        compiledEntries.push([name, compiled]);
      }
      output[key] = Object.fromEntries(compiledEntries);
      continue;
    }
    if (key === "items") {
      const compiled = compileStrictSchemaNode(child, dialect);
      if (compiled === undefined) return undefined;
      output[key] = compiled;
      continue;
    }
    if (key === "anyOf" || key === "oneOf") {
      if (!Array.isArray(child)) return undefined;
      const compiled = child.map((entry) =>
        compileStrictSchemaNode(entry, dialect),
      );
      if (compiled.some((entry) => entry === undefined)) return undefined;
      output.anyOf = [
        ...((output.anyOf as unknown[] | undefined) ?? []),
        ...compiled,
      ];
      continue;
    }
    if (key === "const") {
      if (!("enum" in node)) output.enum = [child];
      continue;
    }
    output[key] = child;
  }
  const isUnionWrapper = Array.isArray(node.anyOf) || Array.isArray(node.oneOf);
  if (dialect === "deepseek" && isUnionWrapper) {
    // DeepSeek strict treats type/properties/items on an anyOf wrapper as an
    // intersection with every variant (a guaranteed 400). Keep anyOf only.
    // `projectProviderBindingSchema` often injects `type: "object"` when every
    // variant is an object; drop that wrapper keyword instead of refusing the
    // whole tool (needed for commit_topic_material display unions).
    delete output.type;
    delete output.properties;
    delete output.required;
    delete output.additionalProperties;
    delete output.items;
  }
  if (node.type === "object" && !isUnionWrapper) {
    const properties = output.properties as Record<string, unknown> | undefined;
    if (!properties) return undefined;
    if (dialect === "deepseek" && output.additionalProperties !== false) {
      return undefined;
    }
    output.additionalProperties = false;
    const originallyRequired = new Set(
      Array.isArray(node.required)
        ? node.required.filter((key): key is string => typeof key === "string")
        : [],
    );
    if (dialect === "openai") {
      output.properties = Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => [
          name,
          originallyRequired.has(name) ? schema : asNullable(schema),
        ]),
      );
    }
    output.required = Object.keys(properties);
  }
  return output;
}

function localSchemaRef(
  root: Record<string, unknown>,
  ref: unknown,
): Record<string, unknown> | undefined {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const rawPart of ref.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isSchemaObject(current)) return undefined;
    current = current[part];
  }
  return isSchemaObject(current) ? current : undefined;
}

function normalizeStrictCandidateNode(
  value: unknown,
  schema: unknown,
  root: Record<string, unknown>,
): unknown {
  if (!isSchemaObject(schema)) return value;
  const referenced = localSchemaRef(root, schema.$ref);
  if (referenced) return normalizeStrictCandidateNode(value, referenced, root);
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined;
  if (variants) {
    return variants.reduce(
      (candidate, variant) =>
        normalizeStrictCandidateNode(candidate, variant, root),
      value,
    );
  }
  if (Array.isArray(value) && schema.items) {
    return value.map((item) =>
      normalizeStrictCandidateNode(item, schema.items, root),
    );
  }
  if (!isSchemaObject(value)) return value;
  const properties = isSchemaObject(schema.properties)
    ? schema.properties
    : undefined;
  if (!properties) return value;
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const normalized = { ...value };
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (normalized[key] === null && !required.has(key)) {
      delete normalized[key];
      continue;
    }
    if (key in normalized) {
      normalized[key] = normalizeStrictCandidateNode(
        normalized[key],
        propertySchema,
        root,
      );
    }
  }
  return normalized;
}

export function compileStrictBindingSchema(
  schema: Parameters<typeof projectProviderBindingSchema>[0],
  dialect: StrictBindingDialect,
): Record<string, unknown> | null {
  const compiled = compileStrictSchemaNode(
    projectProviderBindingSchema(schema),
    dialect,
  );
  return isSchemaObject(compiled) ? compiled : null;
}

export function compileOpenAiStrictBindingSchema(
  schema: Parameters<typeof projectProviderBindingSchema>[0],
): Record<string, unknown> | null {
  return compileStrictBindingSchema(schema, "openai");
}

export function isOpenAiStrictSchemaCompatible(
  schema: Parameters<typeof projectProviderBindingSchema>[0],
): boolean {
  return compileOpenAiStrictBindingSchema(schema) != null;
}

/** Drop transport nulls for fields that were optional on the projected schema. */
export function normalizeStrictBindingCandidate(
  candidate: unknown,
  schema: Parameters<typeof projectProviderBindingSchema>[0],
): unknown {
  const projected = projectProviderBindingSchema(schema);
  return normalizeStrictCandidateNode(candidate, projected, projected);
}
