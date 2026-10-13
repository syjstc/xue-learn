import { musicStepTarget } from "./material-music.js";
import type { MusicCueAction } from "./material-music-teaching.js";
import { materialVisualTarget } from "./material-visual.js";
import { readMaterialTeaching, materialTeachingSteps, materialTeachingTarget } from "./material-teaching.js";
import {materialTeachingFocusTargets, materialTeachingFocusTarget} from "./material-teaching-focus.js";
import { materialCalloutDetails } from "./material-callout-details.js";
import { displayDocumentTargets } from "./material-display.js";

export const MATERIAL_STAGE_LAYOUTS = [
  "split-h",
  "split-v",
  "main+rail",
  "stack",
] as const;
export type MaterialStageLayout = (typeof MATERIAL_STAGE_LAYOUTS)[number];

export const MATERIAL_CUE_OPS = ["highlight", "window"] as const;
export type MaterialCueOp = (typeof MATERIAL_CUE_OPS)[number];

export const MATERIAL_NAMED_CUE_TARGETS = [
  "whole",
  "left",
  "right",
  "top",
  "bottom",
  "main",
  "rail",
] as const;
export type MaterialNamedCueTarget = (typeof MATERIAL_NAMED_CUE_TARGETS)[number];

const MATERIAL_LAYOUT_CUE_TARGET =
  /^(whole|left|right|top|bottom|main|rail|side-\d+|item-\d+)$/;

/** Paragraph `cue.target` is a layout slot, never a figure/object id. */
export function isMaterialLayoutCueTarget(value: string): boolean {
  return MATERIAL_LAYOUT_CUE_TARGET.test(value.trim());
}

export type MaterialCue = Readonly<{
  /** Stable authored Display timeline cue, retained across narration clocks. */
  timelineCueId?: string;
  music?: MusicCueAction;
  target: string;
  /** One or more addressable object ids on the board (display, figure, side, region). */
  targetIds?: readonly string[];
  op?: MaterialCueOp;
  regionIds?: readonly string[];
  /** Stable id of the atomic display or a stage figure this beat narrates. */
  figureId?: string;
}>;

export type MaterialCodeRegion = Readonly<{
  id: string;
  match: string;
}>;

export type MaterialCodePart = Readonly<{
  id?: string;
  text: string;
}>;

export const MAX_CODE_PART_IDS = 16;
export const MAX_CODE_PARTS = 24;

export type CodeMatchSpan = Readonly<{
  id: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
}>;

export type ResolvedMaterialCue = Readonly<{
  targetIds: readonly string[];
  op: MaterialCueOp;
  regionSpans: readonly CodeMatchSpan[];
  window?: Readonly<{ startLine: number; endLine: number }>;
  figureId?: string;
}>;

const FORBIDDEN_STAGE_FIGURE_TYPES = new Set([
  "heading",
  "paragraph",
  "check",
  "stage",
]);

export function isMaterialStageLayout(
  value: string,
): value is MaterialStageLayout {
  return (MATERIAL_STAGE_LAYOUTS as readonly string[]).includes(value);
}

export function isForbiddenStageFigureType(type: string): boolean {
  return FORBIDDEN_STAGE_FIGURE_TYPES.has(type);
}

export function isPlainCodeLanguage(language?: string): boolean {
  const normalized = language?.trim().toLowerCase() ?? "";
  return (
    normalized === "text" ||
    normalized === "plain" ||
    normalized === "txt" ||
    normalized === "plaintext"
  );
}

export function rangeToCodeSpan(
  source: string,
  start: number,
  end: number,
): Omit<CodeMatchSpan, "id"> {
  const prefix = source.slice(0, start);
  const matched = source.slice(start, Math.max(start, end));
  const startLine = prefix.split("\n").length;
  const endLine = startLine + Math.max(1, matched.split("\n").length) - 1;
  const startCol = prefix.slice(prefix.lastIndexOf("\n") + 1).length;
  const lastNl = matched.lastIndexOf("\n");
  const endCol =
    lastNl < 0 ? startCol + matched.length : matched.length - lastNl - 1;
  return { start, end, startLine, endLine, startCol, endCol };
}

export function locateUniqueMatch(
  source: string,
  match: string,
): Omit<CodeMatchSpan, "id"> | null {
  const needle = match;
  if (!needle) return null;
  const start = source.indexOf(needle);
  if (start < 0) return null;
  if (source.indexOf(needle, start + needle.length) >= 0) return null;
  return rangeToCodeSpan(source, start, start + needle.length);
}

export function concatCodeParts(
  parts: readonly MaterialCodePart[] | undefined,
): string {
  if (!parts?.length) return "";
  return parts.map((part) => part.text).join("");
}

/**
 * Resolve the one source of truth for a code board.
 *
 * New authoring may send both the complete `code` field and line-addressable
 * `parts`. Parts are useful only when they are an exact partition of that
 * source. Do not let prose annotations in `parts` replace a valid program.
 */
export function resolveCodeBoardSource(
  code: unknown,
  rawParts: unknown,
): { code: string; parts?: MaterialCodePart[] } | undefined {
  const explicitCode =
    typeof code === "string" && code.trim().length > 0 ? code : "";
  const parts = sanitizeCodeParts(rawParts);

  if (explicitCode) {
    return parts?.length && concatCodeParts(parts) === explicitCode
      ? { code: explicitCode, parts }
      : { code: explicitCode };
  }
  if (!parts?.length) return undefined;
  return { code: concatCodeParts(parts), parts };
}

export function resolveCodeRegions(
  code: string,
  regions: readonly MaterialCodeRegion[] | undefined,
): CodeMatchSpan[] {
  if (!regions?.length) return [];
  const seen = new Set<string>();
  const resolved: CodeMatchSpan[] = [];
  for (const region of regions) {
    const id = region.id.trim();
    const match = region.match;
    if (!id || seen.has(id) || !match) continue;
    const span = locateUniqueMatch(code, match);
    if (!span) continue;
    seen.add(id);
    resolved.push({ id, ...span });
  }
  return resolved;
}

export function sanitizeCodeRegions(
  code: string,
  regions: unknown,
): MaterialCodeRegion[] | undefined {
  if (!Array.isArray(regions)) return undefined;
  const cleaned: MaterialCodeRegion[] = [];
  const seen = new Set<string>();
  for (const item of regions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as { id?: unknown; match?: unknown };
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const match = typeof record.match === "string" ? record.match : "";
    if (!id || seen.has(id) || !match) continue;
    if (!locateUniqueMatch(code, match)) continue;
    seen.add(id);
    cleaned.push({ id, match });
    if (cleaned.length >= MAX_CODE_PART_IDS) break;
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

export function sanitizeCodeParts(raw: unknown): MaterialCodePart[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned: MaterialCodePart[] = [];
  const seen = new Set<string>();
  let idCount = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as { id?: unknown; text?: unknown; code?: unknown };
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.code === "string"
          ? record.code
          : "";
    if (!text) continue;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (id && (seen.has(id) || idCount >= MAX_CODE_PART_IDS)) {
      cleaned.push({ text });
    } else if (id) {
      seen.add(id);
      idCount += 1;
      cleaned.push({ id, text });
    } else {
      cleaned.push({ text });
    }
    if (cleaned.length >= MAX_CODE_PARTS) break;
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

export function resolveCodePartSpans(
  parts: readonly MaterialCodePart[] | undefined,
): CodeMatchSpan[] {
  if (!parts?.length) return [];
  const source = concatCodeParts(parts);
  const resolved: CodeMatchSpan[] = [];
  let offset = 0;
  for (const part of parts) {
    const start = offset;
    const end = start + part.text.length;
    if (part.id) {
      resolved.push({ id: part.id, ...rangeToCodeSpan(source, start, end) });
    }
    offset = end;
  }
  return resolved;
}

function numberedSlot(prefix: "side" | "item", value: string): number | null {
  const match = value.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function layoutSlots(
  layout: MaterialStageLayout,
  figureCount: number,
): string[] {
  if (layout === "split-h") return ["left", "right"].slice(0, figureCount);
  if (layout === "split-v") return ["top", "bottom"].slice(0, figureCount);
  if (layout === "main+rail") return ["main", "rail"].slice(0, figureCount);
  return Array.from(
    { length: Math.max(0, figureCount) },
    (_, index) => `item-${index}`,
  );
}

function compareSlotIndex(target: string, sideCount: number): number | "whole" | null {
  if (target === "whole") return "whole";
  if (target === "left") return 0;
  if (target === "right") return sideCount > 1 ? 1 : null;
  const side = numberedSlot("side", target);
  if (side == null) return null;
  return side < sideCount ? side : null;
}

function stageSlotIndex(
  layout: MaterialStageLayout,
  target: string,
  figureCount: number,
): number | "whole" | null {
  if (target === "whole") return "whole";
  const slots = layoutSlots(layout, figureCount);
  const named = slots.indexOf(target);
  if (named >= 0) return named;
  const item = numberedSlot("item", target);
  if (item != null && item < figureCount) return item;
  if (target === "left" && slots[0] === "left") return 0;
  if (target === "right" && slots[1] === "right") return 1;
  return null;
}

export function classroomCompareTargetId(index: number): string {
  if (index === 0) return "compare-left";
  if (index === 1) return "compare-right";
  return `compare-side-${index}`;
}

export function classroomStageTargetId(
  layout: MaterialStageLayout,
  index: number,
): string {
  const slot = layoutSlots(layout, index + 1)[index];
  return slot ? `stage-${slot}` : `stage-item-${index}`;
}

export function classroomCodeTargetId(regionId: string): string {
  return `code:${regionId}`;
}

export function classroomFigureScopedTargetId(
  figureId: string,
  innerId: string,
): string {
  return `fig:${figureId}:${innerId}`;
}

function uniqueIds(
  values: readonly string[] | undefined,
  limit = MAX_CODE_PART_IDS,
): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function parseCue(raw: unknown): MaterialCue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as {
    timelineCueId?: unknown;
    target?: unknown;
    targetIds?: unknown;
    op?: unknown;
    regionIds?: unknown;
    figureId?: unknown;
    music?: MusicCueAction;
  };
  const figureId =
    typeof record.figureId === "string" ? record.figureId.trim() : "";
  const targetIds = Array.isArray(record.targetIds)
    ? uniqueIds(
        record.targetIds.filter((item): item is string => typeof item === "string"),
      )
    : [];
  const target =
    typeof record.target === "string" && record.target.trim()
      ? record.target.trim()
      : targetIds.length === 1
        ? targetIds[0]!
        : figureId || targetIds.length > 0
          ? "whole"
          : "";
  if (!target) return null;
  const op =
    record.op === "window" || record.op === "highlight" ? record.op : undefined;
  const regionIds = Array.isArray(record.regionIds)
    ? uniqueIds(
        record.regionIds.filter((item): item is string => typeof item === "string"),
      )
    : [];
  return {
    target,
    ...(typeof record.timelineCueId === 'string' && record.timelineCueId.trim() ? {timelineCueId: record.timelineCueId.trim()} : {}),
    ...(record.music ? { music: record.music } : {}),
    ...(targetIds.length > 0 ? { targetIds } : {}),
    ...(figureId ? { figureId } : {}),
    ...(op ? { op } : {}),
    ...(regionIds.length > 0 ? { regionIds } : {}),
  };
}

export function sanitizeParagraphCue(raw: unknown): MaterialCue | undefined {
  return parseCue(raw) ?? undefined;
}

type CueDisplay = Readonly<{
  document?: unknown;
  templateId?: unknown;
  content?: unknown;
  title?: unknown;
  version?: unknown;
  notes?: readonly unknown[];
  views?: readonly unknown[];
  marks?: readonly unknown[];
  clips?: readonly unknown[];
  body?: unknown;
  id?: unknown;
  type?: unknown;
  code?: unknown;
  language?: unknown;
  regions?: unknown;
  parts?: unknown;
  items?: unknown;
  steps?: unknown;
  layout?: unknown;
  figures?: unknown;
  left?: unknown;
  right?: unknown;
  sides?: unknown;
  guidedImage?: { segmentation: { regions: readonly { id: string }[] } };
}>;

function compareSideCount(display: CueDisplay): number {
  if (Array.isArray(display.sides) && display.sides.length >= 2) {
    return display.sides.length;
  }
  return 2;
}

function figureAt(
  display: CueDisplay,
  index: number,
): CueDisplay | null {
  if (!Array.isArray(display.figures)) return null;
  const figure = display.figures[index];
  if (!figure || typeof figure !== "object" || Array.isArray(figure)) {
    return null;
  }
  return figure as CueDisplay;
}

function codeFromDisplay(display: CueDisplay): string {
  if (typeof display.code === "string" && display.code) return display.code;
  const parts = sanitizeCodeParts(display.parts);
  return parts ? concatCodeParts(parts) : "";
}

export function resolveCodeFigureSpans(
  display: CueDisplay | null | undefined,
): CodeMatchSpan[] {
  if (!display) return [];
  const parts = sanitizeCodeParts(display.parts);
  if (parts?.length) return resolveCodePartSpans(parts);
  return resolveCodeRegions(
    codeFromDisplay(display),
    Array.isArray(display.regions)
      ? (display.regions as MaterialCodeRegion[])
      : undefined,
  );
}

export function codeBoardParts(
  display: CueDisplay | null | undefined,
): MaterialCodePart[] {
  if (!display) return [];
  const parts = sanitizeCodeParts(display.parts);
  if (parts?.length) return [...parts];
  const code = codeFromDisplay(display);
  return code ? [{ text: code }] : [];
}

function displayId(display: CueDisplay | null | undefined): string {
  return typeof display?.id === "string" ? display.id.trim() : "";
}

export type MaterialCueObjectKind =
  | "callout-detail"
  | "display"
  | "figure"
  | "compare-side"
  | "code-region"
  | "image-region"
  | "visual-item"
  | "teaching-step"
  | "teaching-focus"
  | "music-step";

export type MaterialCueObject = Readonly<{
  id: string;
  kind: MaterialCueObjectKind;
  lightingIds: readonly string[];
}>;

function recordId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id.trim() : "";
}

function compareSideEntries(display: CueDisplay): Array<{ id: string; index: number }> {
  const raw =
    Array.isArray(display.sides) && display.sides.length >= 2
      ? display.sides
      : [display.left, display.right];
  const entries: Array<{ id: string; index: number }> = [];
  raw.forEach((side, index) => {
    if (!side || typeof side !== "object" || Array.isArray(side)) return;
    const fallback = index === 0 ? "left" : index === 1 ? "right" : `side-${index}`;
    entries.push({ id: recordId(side) || fallback, index });
  });
  return entries;
}

function addCueObject(
  objects: MaterialCueObject[],
  seen: Set<string>,
  object: MaterialCueObject,
) {
  if (!object.id || seen.has(object.id)) return;
  seen.add(object.id);
  objects.push(object);
}

function collectFigureCueObjects(
  figure: CueDisplay,
  lightingPrefix: readonly string[],
  objects: MaterialCueObject[],
  seen: Set<string>,
  nested: boolean,
) {
  const figureId = displayId(figure);
  const type = typeof figure.type === "string" ? figure.type : "";
  if (type === "display" && figure.document) {
    for (const id of displayDocumentTargets(figure.document as import("../../display/src/types.js").DisplayDocument))
      addCueObject(objects, seen, {id, kind: "display", lightingIds: [...lightingPrefix, id]});
  }
  for (const detail of materialCalloutDetails(figure)) {
    addCueObject(objects, seen, {
      id: detail.id,
      kind: "callout-detail",
      lightingIds: [...lightingPrefix, detail.id],
    });
  }
  if (type === "compare") {
    for (const side of compareSideEntries(figure)) {
      const slotId = classroomCompareTargetId(side.index);
      const lightingIds = nested
        ? [
            ...lightingPrefix,
            classroomFigureScopedTargetId(figureId || "display", slotId),
          ]
        : figureId
          ? [classroomFigureScopedTargetId(figureId, slotId)]
          : [slotId];
      addCueObject(objects, seen, {
        id: side.id,
        kind: "compare-side",
        lightingIds,
      });
      const alias =
        side.index === 0 ? "left" : side.index === 1 ? "right" : `side-${side.index}`;
      if (!nested && alias !== side.id) {
        addCueObject(objects, seen, {
          id: alias,
          kind: "compare-side",
          lightingIds,
        });
      }
    }
  }
  if (type === "music" && Array.isArray(figure.steps)) {
    for (const step of figure.steps) {
      const id = recordId(step);
      addCueObject(objects, seen, { id, kind: "music-step", lightingIds: [...lightingPrefix, musicStepTarget(figureId, id)] });
    }
  }
  if (type === "music" && figure.version === 2) {
    for (const item of [...(figure.notes ?? []), ...(figure.views ?? []), ...(figure.marks ?? []), ...(figure.clips ?? [])]) {
      const id = recordId(item);
      addCueObject(objects, seen, { id, kind: "music-step", lightingIds: [...lightingPrefix, musicStepTarget(figureId, id)] });
    }
  }
  if (type === "visual" && Array.isArray(figure.items)) {
    for (const item of figure.items) {
      const id = recordId(item);
      addCueObject(objects, seen, { id, kind: "visual-item",
        lightingIds: [...lightingPrefix, materialVisualTarget(figureId, id)] });
    }
  }
  if (type === "teaching") {
    const teaching = readMaterialTeaching(figure);
    if (teaching) for (const step of materialTeachingSteps(teaching)) {
      addCueObject(objects, seen, { id: materialTeachingTarget(teaching.id, step.id), kind: "teaching-step",
        lightingIds: [...lightingPrefix, materialTeachingTarget(teaching.id, step.id)] });
      // Atomic boards may use short operation IDs; composed boards use the
      // scoped identity so two animations cannot address each other's steps.
      if (!nested) addCueObject(objects, seen, { id: step.id, kind: "teaching-step",
        lightingIds: [...lightingPrefix, materialTeachingTarget(teaching.id, step.id)] });
    }
    if (teaching) for (const focus of materialTeachingFocusTargets(teaching)) {
      const scoped = materialTeachingFocusTarget(teaching.id, focus.id);
      addCueObject(objects, seen, {id: scoped, kind: 'teaching-focus', lightingIds: [...lightingPrefix, scoped]});
      if (!nested) addCueObject(objects, seen, {id: focus.id, kind: 'teaching-focus', lightingIds: [...lightingPrefix, scoped]});
    }
  }
  if (type === "illustration" && figure.guidedImage) {
    for (const region of figure.guidedImage.segmentation.regions) {
      addCueObject(objects, seen, {
        id: region.id,
        kind: "image-region",
        lightingIds: [...lightingPrefix, `image:${region.id}`],
      });
    }
  }
  if (type === "code") {
    const regions = resolveCodeFigureSpans(figure);
    for (const region of regions) {
      addCueObject(objects, seen, {
        id: region.id,
        kind: "code-region",
        lightingIds: nested
          ? [
              ...lightingPrefix,
              classroomFigureScopedTargetId(
                figureId || "display",
                classroomCodeTargetId(region.id),
              ),
            ]
          : [...lightingPrefix, classroomCodeTargetId(region.id)],
      });
    }
  }
}

/** Addressable ids the authoring agent can put on `cue.targetIds`. */
export function collectMaterialCueObjects(
  display: CueDisplay | null | undefined,
): MaterialCueObject[] {
  if (!display) return [];
  const objects: MaterialCueObject[] = [];
  const seen = new Set<string>();
  const type = typeof display.type === "string" ? display.type : "";
  const rootId = displayId(display) || "display";
  const wholeLighting =
    type === "compare"
      ? displayId(display)
        ? (["whole", classroomFigureScopedTargetId(displayId(display), "compare")] as const)
        : (["whole", "compare"] as const)
      : (["whole"] as const);
  addCueObject(objects, seen, {
    id: rootId,
    kind: "display",
    lightingIds: [...wholeLighting],
  });
  if (rootId !== "display") {
    addCueObject(objects, seen, {
      id: "display",
      kind: "display",
      lightingIds: [...wholeLighting],
    });
  }
  addCueObject(objects, seen, {
    id: "whole",
    kind: "display",
    lightingIds: [...wholeLighting],
  });

  if (type === "stage") {
    const layout = isMaterialStageLayout(String(display.layout ?? ""))
      ? (display.layout as MaterialStageLayout)
      : "stack";
    const figureCount = Array.isArray(display.figures) ? display.figures.length : 0;
    for (let index = 0; index < figureCount; index += 1) {
      const figure = figureAt(display, index);
      if (!figure) continue;
      const boardTarget = classroomStageTargetId(layout, index);
      const figureId = displayId(figure) || `f${index + 1}`;
      addCueObject(objects, seen, {
        id: figureId,
        kind: "figure",
        lightingIds: [boardTarget],
      });
      collectFigureCueObjects(figure, [boardTarget], objects, seen, true);
    }
    return objects;
  }

  collectFigureCueObjects(display, [], objects, seen, false);
  return objects;
}

export function collectMaterialCueObjectIds(
  display: CueDisplay | null | undefined,
): string[] {
  return collectMaterialCueObjects(display).map((object) => object.id);
}

function wantedObjectIds(cue: MaterialCue): string[] {
  const merged = uniqueIds([...(cue.targetIds ?? []), ...(cue.regionIds ?? [])]);
  if (merged.length > 0) return merged;
  if (cue.target === "whole") {
    return cue.figureId ? [cue.figureId] : ["whole"];
  }
  if (cue.target) return [cue.target];
  return cue.figureId ? [cue.figureId] : [];
}

function resolveCueByObjectIds(
  display: CueDisplay,
  cue: MaterialCue,
): ResolvedMaterialCue | null {
  const catalog = collectMaterialCueObjects(display);
  if (catalog.length === 0) return null;
  let wanted = wantedObjectIds(cue);
  if (wanted.length === 0) return null;
  const byId = new Map(catalog.map((object) => [object.id, object]));
  wanted = wanted.filter((id) => byId.has(id));
  if (wanted.length === 0) return null;
  const hasRegion = wanted.some((id) => byId.get(id)?.kind === "code-region");
  if (hasRegion) {
    wanted = wanted.filter((id) => byId.get(id)?.kind === "code-region");
  }
  const selected = wanted
    .map((id) => byId.get(id))
    .filter((object): object is MaterialCueObject => Boolean(object));
  if (selected.length === 0) return null;
  const specific = selected.filter((object) => object.kind !== "display");
  const lighting: string[] = [];
  const seenLighting = new Set<string>();
  const pushLighting = (ids: readonly string[]) => {
    for (const id of ids) {
      if (seenLighting.has(id)) continue;
      seenLighting.add(id);
      lighting.push(id);
    }
  };
  // `display` / `whole` mean the entire board only when the cue did not also
  // name a pane. Authoring often sends both (`["display", "left"]`); lighting
  // the whole compare then makes every card look focused.
  if (specific.length > 0) {
    for (const object of specific) pushLighting(object.lightingIds);
  } else {
    const whole = selected.find((object) => object.kind === "display");
    if (whole) pushLighting(whole.lightingIds);
    else for (const object of selected) pushLighting(object.lightingIds);
  }
  const regionIds = selected
    .filter((object) => object.kind === "code-region")
    .map((object) => object.id);
  if (regionIds.length > 0) {
    return resolveCodeCue(
      findCodeDisplayForRegions(display, regionIds) ?? display,
      { ...cue, regionIds },
      lighting.filter((id) => !id.startsWith("code:")),
    );
  }
  const op: MaterialCueOp = cue.op === "window" ? "window" : "highlight";
  return { targetIds: lighting, op, regionSpans: [] };
}

function findCodeDisplayForRegions(
  display: CueDisplay,
  regionIds: readonly string[],
): CueDisplay | null {
  if (typeof display.type === "string" && display.type === "code") {
    return display;
  }
  if (!Array.isArray(display.figures)) return null;
  for (const figure of display.figures) {
    if (!figure || typeof figure !== "object" || Array.isArray(figure)) continue;
    const nested = figure as CueDisplay;
    if (nested.type !== "code") continue;
    const regions = resolveCodeFigureSpans(nested);
    if (regionIds.every((id) => regions.some((region) => region.id === id))) {
      return nested;
    }
  }
  return null;
}

function scopeResolvedCue(
  resolved: ResolvedMaterialCue,
  figureId: string | undefined,
  nested: boolean,
): ResolvedMaterialCue {
  if (!figureId) return resolved;
  const targetIds = nested
    ? resolved.targetIds.map((id) =>
        id === "whole" || id.startsWith("stage-")
          ? id
          : classroomFigureScopedTargetId(figureId, id),
      )
    : resolved.targetIds.map((id) =>
        id === "whole" ? id : classroomFigureScopedTargetId(figureId, id),
      );
  return { ...resolved, targetIds, figureId };
}

function findCuedFigure(
  display: CueDisplay,
  figureId: string,
): Readonly<{
  figure: CueDisplay;
  extraTargetIds: readonly string[];
  nested: boolean;
}> | null {
  if (displayId(display) === figureId) {
    return { figure: display, extraTargetIds: [], nested: false };
  }
  if (typeof display.type === "string" && display.type !== "stage") {
    return null;
  }
  if (!Array.isArray(display.figures)) return null;
  const layout = isMaterialStageLayout(String(display.layout ?? ""))
    ? (display.layout as MaterialStageLayout)
    : "stack";
  for (let index = 0; index < display.figures.length; index += 1) {
    const figure = figureAt(display, index);
    if (!figure || displayId(figure) !== figureId) continue;
    return {
      figure,
      extraTargetIds: [classroomStageTargetId(layout, index)],
      nested: true,
    };
  }
  return null;
}

function resolveCueAgainstDisplay(
  display: CueDisplay,
  cue: MaterialCue,
): ResolvedMaterialCue | null {
  const type = typeof display.type === "string" ? display.type : "";
  const op: MaterialCueOp = cue.op === "window" ? "window" : "highlight";

  if (type === "compare") {
    const slot = compareSlotIndex(cue.target, compareSideCount(display));
    if (slot == null) return null;
    if (slot === "whole") {
      return { targetIds: ["whole", "compare"], op, regionSpans: [] };
    }
    return {
      targetIds: [classroomCompareTargetId(slot)],
      op,
      regionSpans: [],
    };
  }

  if (type === "stage") {
    const layout = isMaterialStageLayout(String(display.layout ?? ""))
      ? (display.layout as MaterialStageLayout)
      : "stack";
    const figureCount = Array.isArray(display.figures)
      ? display.figures.length
      : 0;
    const slot = stageSlotIndex(layout, cue.target, figureCount);
    if (slot == null) return null;
    if (slot === "whole") {
      return { targetIds: ["whole"], op, regionSpans: [] };
    }
    const figure = figureAt(display, slot);
    const boardTarget = classroomStageTargetId(layout, slot);
    if (figure && figure.type === "code" && cue.regionIds?.length) {
      return resolveCodeCue(figure, cue, [boardTarget]);
    }
    if (figure && figure.type === "compare") {
      const inner = resolveCueAgainstDisplay(figure, {
        ...cue,
        target:
          cue.target === "left" ||
          cue.target === "right" ||
          cue.target.startsWith("side-")
            ? cue.target
            : "whole",
      });
      if (!inner) {
        return { targetIds: [boardTarget], op, regionSpans: [] };
      }
      return {
        ...inner,
        targetIds: [boardTarget, ...inner.targetIds],
      };
    }
    return { targetIds: [boardTarget], op, regionSpans: [] };
  }

  if (type === "code") {
    if (cue.target !== "whole" && cue.target !== "left" && cue.target !== "main") {
      if (!cue.regionIds?.length) return null;
    }
    const resolved = resolveCodeCue(
      display,
      cue,
      cue.target === "whole" || !cue.regionIds?.length ? ["whole"] : [],
    );
    if (!resolved) return null;
    if (
      cue.target !== "whole" &&
      cue.target !== "left" &&
      cue.target !== "main" &&
      resolved.regionSpans.length === 0
    ) {
      return null;
    }
    return resolved;
  }

  if (cue.target !== "whole") return null;
  return { targetIds: ["whole"], op, regionSpans: [] };
}

function resolveCodeCue(
  display: CueDisplay,
  cue: MaterialCue,
  extraTargetIds: readonly string[],
): ResolvedMaterialCue | null {
  const regions = resolveCodeFigureSpans(display);
  const wanted = cue.regionIds ?? [];
  const spans = wanted.length
    ? regions.filter((region) => wanted.includes(region.id))
    : [];
  if (wanted.length > 0 && spans.length === 0) {
    return null;
  }
  const op: MaterialCueOp =
    cue.op === "window" || spans.length > 0 ? (cue.op ?? "highlight") : "highlight";
  const window =
    spans.length > 0
      ? {
          startLine: Math.min(...spans.map((span) => span.startLine)),
          endLine: Math.max(...spans.map((span) => span.endLine)),
        }
      : undefined;
  return {
    targetIds: [
      ...extraTargetIds,
      ...spans.map((span) => classroomCodeTargetId(span.id)),
    ],
    op,
    regionSpans: spans,
    ...(window ? { window } : {}),
  };
}

export function resolveParagraphCue(
  display: CueDisplay | null | undefined,
  rawCue: unknown,
): ResolvedMaterialCue | null {
  if (!display) return null;
  const cue = parseCue(rawCue);
  if (!cue) return null;
  const byObject = resolveCueByObjectIds(display, cue);
  if (byObject) return byObject;
  if (cue.figureId) {
    const located = findCuedFigure(display, cue.figureId);
    if (!located) return null;
    const innerCue: MaterialCue = located.nested
      ? {
          ...cue,
          target:
            cue.target === "left" ||
            cue.target === "right" ||
            cue.target.startsWith("side-") ||
            Boolean(cue.regionIds?.length)
              ? cue.target
              : "whole",
        }
      : cue;
    const resolved = resolveCueAgainstDisplay(located.figure, innerCue);
    if (!resolved) return null;
    const withBoard: ResolvedMaterialCue = located.extraTargetIds.length
      ? {
          ...resolved,
          targetIds: [...located.extraTargetIds, ...resolved.targetIds],
        }
      : resolved;
    return scopeResolvedCue(withBoard, cue.figureId, located.nested);
  }
  return resolveCueAgainstDisplay(display, cue);
}

export function materialCueNodeLit(
  activeTargetIds: readonly string[] | undefined,
  nodeId: string,
  figureId?: string,
): boolean {
  if (!activeTargetIds?.length) return true;
  if (activeTargetIds.includes("whole")) return true;
  if (activeTargetIds.includes(nodeId)) return true;
  const fig = figureId?.trim();
  return Boolean(
    fig &&
      activeTargetIds.includes(classroomFigureScopedTargetId(fig, nodeId)),
  );
}

/** Summary takeaway cards: empty recap cues stay unfocused; a point cue lights only that card. */
export function classroomSummaryPointLit(
  activeTargetIds: readonly string[] | undefined,
  index: number,
): boolean {
  if (!activeTargetIds?.length) return false;
  if (activeTargetIds.includes("whole")) return true;
  return materialCueNodeLit(
    activeTargetIds,
    `point${index + 1}`,
  );
}

/** Compare panes: empty heading/bridge cues stay unfocused; a side cue lights only that side. */
export function classroomCompareSideLit(
  activeTargetIds: readonly string[] | undefined,
  sideIndex: 0 | 1,
  figureId?: string,
): boolean {
  if (!activeTargetIds?.length) return false;
  if (activeTargetIds.includes("whole")) return true;
  const nodeId = classroomCompareTargetId(sideIndex);
  const alias = sideIndex === 0 ? "left" : "right";
  return (
    materialCueNodeLit(activeTargetIds, nodeId, figureId) ||
    materialCueNodeLit(activeTargetIds, alias, figureId)
  );
}

/** Line/region highlight: empty cues mean no region emphasis (unlike board nodes). */
export function materialCueCodeRegionLit(
  activeTargetIds: readonly string[] | undefined,
  regionId: string,
  figureId?: string,
): boolean {
  if (!activeTargetIds?.length) return false;
  return materialCueNodeLit(
    activeTargetIds,
    classroomCodeTargetId(regionId),
    figureId,
  );
}

/** Stable identity for a resolved cue (`op` + optional figureId + targetIds). */
export function materialCueIdentity(
  targetIds: readonly string[] | undefined,
  op: MaterialCueOp | string = "highlight",
  figureId?: string,
): string {
  if (!targetIds?.length) return "";
  const fig = figureId?.trim();
  return fig
    ? `${op}:${fig}:${[...targetIds].join("|")}`
    : `${op}:${[...targetIds].join("|")}`;
}

export type MaterialFigureCaption = Readonly<{
  figureId?: string;
  target: string;
  targetIds?: readonly string[];
  text: string;
  paragraphIndex: number;
}>;

export function blockFigureId(
  block: unknown,
): string {
  if (!block || typeof block !== "object") return "";
  const id = (block as { id?: unknown }).id;
  return typeof id === "string" ? id.trim() : "";
}

/**
 * Spoken cue captions that belong under a display (and its stage figures).
 * `throughParagraphIndex` limits chat-mode reveal to already-visible beats.
 */
export function figureCaptionsForDisplay(
  blocks: readonly Readonly<{
    type?: unknown;
    text?: unknown;
    cue?: unknown;
    id?: unknown;
  }>[],
  displayIndex: number,
  throughParagraphIndex?: number,
): MaterialFigureCaption[] {
  const captions: MaterialFigureCaption[] = [];
  const end =
    throughParagraphIndex == null
      ? blocks.length
      : Math.min(blocks.length, throughParagraphIndex + 1);
  for (let index = displayIndex + 1; index < end; index += 1) {
    const block = blocks[index];
    const type = block?.type;
    if (type === "heading") break;
    if (type !== "paragraph" && type !== "check") break;
    if (type !== "paragraph") continue;
    const text = typeof block?.text === "string" ? block.text.trim() : "";
    if (!text) continue;
    const cue = parseCue(block?.cue) ?? { target: "whole" };
    const targetIds =
      cue.targetIds && cue.targetIds.length > 0
        ? cue.targetIds
        : cue.target
          ? [cue.target]
          : undefined;
    captions.push({
      ...(cue.figureId ? { figureId: cue.figureId } : {}),
      target: cue.target,
      ...(targetIds ? { targetIds } : {}),
      text,
      paragraphIndex: index,
    });
  }
  return captions;
}

export function captionsForFigure(
  captions: readonly MaterialFigureCaption[],
  figureId: string | undefined,
  target?: string,
): MaterialFigureCaption[] {
  return captions.filter((caption) => {
    if (figureId && caption.figureId && caption.figureId !== figureId) {
      return false;
    }
    const ids =
      caption.targetIds && caption.targetIds.length > 0
        ? caption.targetIds
        : [caption.target];
    if (!target) return true;
    if (target === "whole") {
      const exclusivePane =
        ids.length === 1 &&
        ids[0] !== "whole" &&
        ids[0] !== figureId &&
        ids[0] !== "display";
      return !exclusivePane;
    }
    return (
      caption.target === target ||
      (ids.length === 1 && ids[0] === target)
    );
  });
}

export function precedingDisplayIndex(
  blocks: readonly Readonly<{ type?: unknown }>[],
  paragraphIndex: number,
): number | null {
  for (let index = paragraphIndex - 1; index >= 0; index -= 1) {
    const type = blocks[index]?.type;
    if (type === "heading") return null;
    if (type === "paragraph" || type === "check") continue;
    return index;
  }
  return null;
}

export function comboDisplayCueTargetIds(
  blocks: readonly Readonly<{ type?: unknown; cue?: unknown }>[],
  displayIndex: number,
): readonly string[] {
  let lastParagraphIndex: number | null = null;
  for (let index = displayIndex + 1; index < blocks.length; index += 1) {
    const type = blocks[index]?.type;
    if (type === "heading") break;
    if (type !== "paragraph" && type !== "check") break;
    if (type === "paragraph") lastParagraphIndex = index;
  }
  if (lastParagraphIndex == null) return [];
  const paragraph = blocks[lastParagraphIndex];
  const display = blocks[displayIndex];
  const cue =
    paragraph && typeof paragraph === "object" && "cue" in paragraph
      ? paragraph.cue
      : undefined;
  return resolveParagraphCue(display, cue)?.targetIds ?? [];
}
