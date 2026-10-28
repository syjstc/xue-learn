import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { isInteropZodSchema } from "@langchain/core/utils/types";

/** Whether LangChain can convert this schema for native structured output. */
export function isJsonSchemaCompatible(schema: unknown): boolean {
  if (schema == null) return false;
  if (typeof schema === "object" && !isInteropZodSchema(schema)) {
    return true;
  }
  try {
    toJsonSchema(schema);
    return true;
  } catch {
    return false;
  }
}
