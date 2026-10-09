import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { isInteropZodSchema } from "@langchain/core/utils/types";
import type { z } from "zod";

const OMITTED_PROVIDER_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

/** Named schema dictionaries — not themselves JSON Schema nodes. */
const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

function projectNode(
  value: unknown,
  role: "schema" | "map" = "schema",
): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => projectNode(child, "schema"));
  }
  if (!value || typeof value !== "object") return value;
  const projected = Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (OMITTED_PROVIDER_KEYWORDS.has(key)) return [];
      const childRole = SCHEMA_MAP_KEYS.has(key) ? "map" : "schema";
      return [[key, projectNode(child, childRole)] as const];
    }),
  );
  if (role === "map") return projected;
  const variants = Array.isArray(projected.anyOf)
    ? projected.anyOf
    : Array.isArray(projected.oneOf)
      ? projected.oneOf
      : undefined;
  if (variants && typeof projected.type === "undefined") {
    const variantTypes = variants.flatMap((variant) => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        return [];
      }
      const type = (variant as Record<string, unknown>).type;
      return typeof type === "string" ? [type] : [];
    });
    const uniqueTypes = [...new Set(variantTypes)];
    if (uniqueTypes.length === 1) {
      projected.type = uniqueTypes[0];
    } else if (
      uniqueTypes.length === 2 &&
      uniqueTypes.includes("string") &&
      uniqueTypes.includes("number")
    ) {
      // Some OpenAI-compatible tool endpoints require every schema node to
      // declare one concrete type even when it carries a union. This disposable
      // binding can safely represent numeric chart values as strings; the
      // authoritative server schema still accepts and validates native numbers.
      projected.type = "string";
    }
  }
  // MiniMax/DeepSeek/OpenAI-compatible tool APIs reject schema nodes that have
  // none of `type` / `anyOf` / `$ref`. Zod `unknown()` compiles to `{}`.
  if (
    typeof projected.type === "undefined" &&
    !Array.isArray(projected.anyOf) &&
    !Array.isArray(projected.oneOf) &&
    typeof projected.$ref !== "string" &&
    !("const" in projected) &&
    !Array.isArray(projected.enum)
  ) {
    projected.type = "object";
  }
  return projected;
}

/**
 * Build a disposable provider-facing JSON Schema. Application Zod schemas stay
 * authoritative and retain every length/cardinality constraint.
 */
export function projectProviderBindingSchema(
  schema: z.ZodType | Record<string, unknown>,
): Record<string, unknown> {
  const jsonSchema = isInteropZodSchema(schema)
    ? (toJsonSchema(schema) as Record<string, unknown>)
    : schema;
  return projectNode(jsonSchema) as Record<string, unknown>;
}

export function containsOmittedProviderKeyword(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsOmittedProviderKeyword);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      OMITTED_PROVIDER_KEYWORDS.has(key) ||
      containsOmittedProviderKeyword(child),
  );
}
