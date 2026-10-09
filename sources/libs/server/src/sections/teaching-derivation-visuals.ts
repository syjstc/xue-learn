import { teachingVisualAssetSchema, teachingVisualDisplaySchema, type TeachingVisualAssetV1, type TeachingVisualDisplayV1 } from "../../../teaching-derivation/src/index.js";
import { collectMaterialCueObjects, resolveParagraphCue } from "../../../domain/src/material-cue.js";
import { resolveMusicCue } from "../../../domain/src/material-music-teaching.js";
import { readMaterialTeaching } from "../../../domain/src/material-teaching.js";
import { readMaterialVisual } from "../../../domain/src/material-visual.js";
import type { CourseDisplayBlock } from "../../../domain/src/course-display.js";

type AcceptedMaterial = { title: string; blocks: readonly CourseDisplayBlock[] };
const plain = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
function sceneFor(display: CourseDisplayBlock, title: string) {
 const type = display.type;
 const templateId = type === "compare" ? "content.compare" : type === "callout" ? "content.focus" : type === "stage" ? "content.stage" : type === "conversation" ? "content.conversation" : "content.media";
 return { templateId, title, slots: { caption: title, mediaKind: type, ...(type === "stage" ? { layout: String(display.layout ?? "stack") } : {}) } };
}
/** Collect full accepted course displays directly, without a video compiler or timeline. */
export function collectTeachingVisualCatalog(materials: readonly AcceptedMaterial[]) {
 const visualAssets: TeachingVisualAssetV1[] = [], visualDisplays: TeachingVisualDisplayV1[] = [];
 for (const material of materials) {
  let title = material.title;
  const groups: { display: CourseDisplayBlock; title: string; narration: CourseDisplayBlock[] }[] = [];
  let current: typeof groups[number] | undefined;
  let leading: CourseDisplayBlock[] = [];
  for (const block of material.blocks) {
   if (block.type === "heading") { title = String(block.text ?? block.title ?? material.title); current = undefined; leading = []; }
   else if (block.type === "paragraph") { (current?.narration ?? leading).push(block); }
   else if (block.type !== "check") { current = { display: block, title, narration: leading }; groups.push(current); leading = []; }
  }
  for (const group of groups) {
   const display = group.display;
   const figures = display.type === "stage" && Array.isArray(display.figures) ? display.figures as CourseDisplayBlock[] : [display];
   for (const figure of figures) {
    const image = plain(figure.guidedImage);
    if (!image.image || !image.segmentation) continue;
    const asset = teachingVisualAssetSchema.safeParse({ id: `image_${visualAssets.length + 1}`, title: String(figure.title ?? group.title), image: image.image, segmentation: image.segmentation });
    if (asset.success) visualAssets.push(asset.data);
   }
   if (display.type === "teaching" && !readMaterialTeaching(display) || display.type === "visual" && !readMaterialVisual(display)) continue;
   if (["html", "interactive_html", "mechanics_sandbox", "circuit_sandbox", "step_sort", "illustration"].includes(display.type)) continue;
   // A silent visual companion cannot invent another rendition of a performance.
   if (group.narration.some(paragraph => resolveMusicCue(display, plain(paragraph.cue).music))) continue;
   const cueTargets = group.narration.flatMap(paragraph => resolveParagraphCue(display, paragraph.cue)?.targetIds ?? []);
   const targetIds = [...new Set([...cueTargets, ...collectMaterialCueObjects(display).flatMap(object => object.lightingIds)])];
   const parsed = teachingVisualDisplaySchema.safeParse({ id: `display_${visualDisplays.length + 1}`, title: group.title, display, scene: sceneFor(display, group.title), targetIds });
   if (parsed.success) visualDisplays.push(parsed.data);
  }
 }
 return { ...(visualAssets.length ? { visualAssets } : {}), ...(visualDisplays.length ? { visualDisplays } : {}) };
}
export function teachingVisualCatalogPrompt(catalog: { visualAssets?: readonly TeachingVisualAssetV1[]; visualDisplays?: readonly TeachingVisualDisplayV1[] }) {
 return JSON.stringify({ visualAssets: catalog.visualAssets?.map(asset => ({ id: asset.id, title: asset.title, targets: asset.segmentation.regions.map(region => ({ id: region.id, label: region.label, evidence: region.observedDescription })) })) ?? [], visualDisplays: catalog.visualDisplays?.map(resource => ({ id: resource.id, title: resource.title, display: resource.display, targetIds: resource.targetIds })) ?? [] });
}
