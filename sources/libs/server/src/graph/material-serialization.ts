import { sanitizeDbString } from "../../../common/src/index.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import {
  type ContentSource,
  serializeContentSources,
} from "../rag/content-sources.js";
import { dedupeExactMaterialBlocks } from "../llm/normalize-learning-material.js";

/** Postgres text/json fields cannot store NUL bytes or lone surrogates. */
export function sanitizeLearningMaterialText(value: string): string {
  return sanitizeDbString(value);
}

function sanitizeJsonTextValues<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeLearningMaterialText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonTextValues(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeJsonTextValues(item),
      ]),
    ) as T;
  }
  return value;
}

export function serializeMaterialContextSources(
  sources: ContentSource[],
): string {
  return serializeContentSources(sanitizeJsonTextValues(sources));
}

/** Serialize blocks for DB `sections` column and Cornell context. */
export function serializeLearningMaterialBlocks(
  material: LearningMaterialContent,
): string {
  return JSON.stringify(
    sanitizeJsonTextValues(dedupeExactMaterialBlocks(material.blocks)),
  );
}

export function serializeLearningMaterialKeyTakeaways(
  keyTakeaways: string[] | null | undefined,
): string {
  return JSON.stringify(sanitizeJsonTextValues(keyTakeaways ?? []));
}
