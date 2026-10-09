import {
  anchorContextSnippet,
  anchorLabel,
  parseMaterialAnchor,
  resolveBlockIndex,
  type MaterialAnchor,
} from "../domain/material-anchor.js";
import { parseLearningMaterial } from "../graph/unit-session.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import type { FlashCardSourcePayload } from "./types.js";

export function resolveFlashCardSource(
  material: LearningMaterialContent | null,
  anchor: MaterialAnchor,
  sourceExcerpt: string,
  unitTitle: string,
): FlashCardSourcePayload {
  const label = anchorLabel(anchor, material);
  let excerpt = sourceExcerpt;
  let stale = false;
  let blockIndex: number | undefined;
  let highlightKey = anchor.highlightKey;

  if (material) {
    if (anchor.scope === 'block') {
      const idx = resolveBlockIndex(material, anchor);
      if (idx == null) {
        stale = true;
      } else {
        blockIndex = idx;
        excerpt = anchorContextSnippet(material, anchor);
        highlightKey = highlightKey ?? `block:${idx}`;
      }
    } else if (anchor.scope === 'introduction' || anchor.scope === 'key_takeaway') {
      excerpt = anchorContextSnippet(material, anchor);
      if (anchor.scope === 'introduction') {
        highlightKey = highlightKey ?? 'intro';
      } else {
        highlightKey = highlightKey ?? `takeaway:${anchor.takeawayIndex ?? 0}`;
      }
    }
  } else if (anchor.scope === 'block' && anchor.blockKey) {
    stale = true;
  }

  return {
    label,
    excerpt: excerpt || sourceExcerpt,
    anchor,
    material,
    unitTitle,
    highlightKey,
    blockIndex,
    stale,
  };
}

export function parseAnchorFromJson(raw: string): MaterialAnchor {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseMaterialAnchor(parsed) ?? { scope: 'introduction' };
  } catch {
    return { scope: 'introduction' };
  }
}

export function resolveFlashCardSourceFromRow(
  row: {
    anchorJson: string;
    sourceExcerpt: string;
    unit: {
      id: string;
      goalId: string;
      title: string;
      learningMaterial: {
        introduction: string;
        sections: string;
        keyTakeaways: string;
      } | null;
    };
  },
): FlashCardSourcePayload {
  const anchor = parseAnchorFromJson(row.anchorJson);
  const material = row.unit.learningMaterial
    ? parseLearningMaterial(row.unit.learningMaterial)
    : null;
  return resolveFlashCardSource(
    material,
    anchor,
    row.sourceExcerpt,
    row.unit.title,
  );
}
