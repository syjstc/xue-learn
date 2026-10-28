import type { LearningMaterialContent } from "../llm/schemas.js";

function fnv1a(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function computeFlashcardSourceHash(
  material: LearningMaterialContent
): string {
  return fnv1a(JSON.stringify(material.blocks));
}
