import type {MaterialAnchor} from "../domain/material-anchor.js";
import type {AggregatedUnitMaterialContext} from "../sections/index.js";
import {readingDocumentForFollowUp} from "./context.js";

const metadata = new Set(["id", "type", "variant", "componentType", "dependsOn", "jobId",
  "status", "error", "imageUrl", "svg", "sourceId", "correctIndex"]);
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).filter(([key]) => !metadata.has(key)).map(([, child]) => text(child)).filter(Boolean).join("\n");
}

/** Resolve server-owned reading text, even while the rest of the chapter streams. */
export async function readingFollowUpContext(owner: string, unit: string, anchor: MaterialAnchor):
Promise<(AggregatedUnitMaterialContext & {anchorSnippet: string}) | null> {
  if (!anchor.reading || !anchor.sectionId) return null;
  const document = await readingDocumentForFollowUp(owner, unit, anchor.sectionId, anchor.reading.documentId);
  const index = document?.blocks.findIndex(block => block.id === anchor.reading!.blockId) ?? -1;
  if (!document || index < 0) return null;
  const blockText = text(document.blocks[index]);
  const surrounding = document.blocks.slice(Math.max(0, index - 1), index + 3).map(text).join("\n\n");
  const anchorSnippet = [
    `【阅读章节】${document.title}`,
    `【阅读正文】\n${blockText}`,
    anchor.selectedText?.trim() ? `【用户选中】\n${anchor.selectedText.trim()}` : "",
    `【相邻阅读内容】\n${surrounding}`,
  ].filter(Boolean).join("\n\n");
  return {
    material: {introduction: document.title, blocks: [{type: "paragraph", text: blockText}], keyTakeaways: []},
    contextSources: [], anchorSnippet,
  };
}
