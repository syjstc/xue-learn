import type { LearningMaterialContent } from "../llm/schemas.js";
import { readyReadingContext } from "./context.js";

const metadata = new Set(["id", "type", "variant", "componentType", "dependsOn",
  "imageUrl", "svg", "sourceArtifactId", "correctIndex", "correctIndices"]);

function prose(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(prose);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => metadata.has(key) ? [] : prose(child));
}

/** Read-only teaching context for the shared questions, notes and assessment flow.
 * Reading self-checks never become graded material checks. */
export async function readyReadingMaterial(owner: string, unit: string, section: string): Promise<LearningMaterialContent | null> {
  const context = await readyReadingContext(owner, unit, section);
  if (!context) return null;
  try {
    const document = JSON.parse(context);
    if (!Array.isArray(document.blocks)) return null;
    const blocks: LearningMaterialContent["blocks"] = document.blocks.flatMap((block: Record<string, unknown>) => {
      if (!block || block.type === "check") return [];
      const text = prose(block).join("\n\n");
      if (!text) return [];
      return [block.type === "heading" ? {type: "heading", level: 2, text} : {type: "paragraph", text}];
    });
    return blocks.length ? {introduction: "", blocks, keyTakeaways: []} : null;
  } catch { return null; }
}
