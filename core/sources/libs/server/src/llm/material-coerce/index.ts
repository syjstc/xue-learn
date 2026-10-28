import {
  collectMaterialCueObjectIds,
  isMaterialLayoutCueTarget,
  resolveCodeBoardSource,
  sanitizeCodeParts,
  sanitizeCodeRegions,
} from "../../../../domain/src/index.js";

export function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function trimId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function coerceAuthoredHeadingLevel(raw: unknown): 2 | 3 {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 3 ? 3 : 2;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\n+|；|;|。/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function coerceCompareSide(value: unknown): {
  label: string;
  points: string[];
} {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { label: "对照", points: ["对照"] };
    const points = stringList(text);
    return { label: text.slice(0, 32), points: points.length > 0 ? points : [text] };
  }
  const side = asRecord(value);
  if (!side) return { label: "对照", points: ["对照"] };
  const label =
    firstNonEmptyString(side.label, side.title, side.name) || "对照";
  const rawPoints = Array.isArray(side.points)
    ? side.points
    : Array.isArray(side.items)
      ? side.items
      : Array.isArray(side.bullets)
        ? side.bullets
        : side.points;
  const points = stringList(rawPoints);
  if (points.length > 0) return { ...side, label, points };
  const body = firstNonEmptyString(side.text, side.body, side.content);
  return { ...side, label, points: [body || label] };
}

function compareSideHasContent(side: {
  label: string;
  points: string[];
}): boolean {
  const points = side.points.map((point) => point.trim()).filter(Boolean);
  if (points.length === 0) return false;
  return !(side.label === "对照" && points.length === 1 && points[0] === "对照");
}

function sameCompareSide(
  left: { label: string; points: string[] },
  right: { label: string; points: string[] },
): boolean {
  return (
    left.label === right.label &&
    left.points.join("\n") === right.points.join("\n")
  );
}

function collectAuthoredCompareSides(
  record: Record<string, unknown>,
): ReturnType<typeof coerceCompareSide>[] {
  const fromArray = (
    Array.isArray(record.sides) ? record.sides : []
  )
    .map((side) => coerceCompareSide(side))
    .filter(compareSideHasContent);
  const fromPair = [record.left ?? record.a, record.right ?? record.b]
    .filter((value) => value != null && value !== "")
    .map((value) => coerceCompareSide(value))
    .filter(compareSideHasContent);
  if (fromArray.length >= 2) return fromArray;
  if (fromPair.length >= 2) return fromPair;
  const merged = [...fromArray];
  for (const side of fromPair) {
    if (!merged.some((existing) => sameCompareSide(existing, side))) {
      merged.push(side);
    }
  }
  return merged;
}

function compareFigureToCallout(
  record: Record<string, unknown>,
  side: ReturnType<typeof coerceCompareSide> | undefined,
): Record<string, unknown> {
  const {
    left: _left,
    right: _right,
    sides: _sides,
    a: _a,
    b: _b,
    type: _type,
    ...rest
  } = record;
  const label = side?.label?.trim() ?? "";
  const body =
    side?.points.map((point) => point.trim()).filter(Boolean).join("\n") ||
    label ||
    firstNonEmptyString(record.body, record.title, record.caption) ||
    "要点";
  const id = trimId(record.id) || trimId(asRecord(side)?.id);
  return {
    ...rest,
    type: "callout",
    variant: "definition",
    ...(id ? { id } : {}),
    ...(label && label !== body ? { title: label } : {}),
    body,
  };
}

export function fallbackCallout(body: string): Record<string, unknown> {
  return {
    type: "callout",
    variant: "tip",
    body: body.trim() || "要点",
  };
}

const TOPIC_CALLOUT_ALIASES = new Set([
  "tip",
  "warning",
  "definition",
  "example",
  "text",
  "markdown",
  "note",
]);
const TOPIC_IMAGE_ALIASES = new Set([
  "image",
  "picture",
  "diagram",
  "photo",
  "figure",
]);
const TOPIC_VISIBLE_DISPLAY_TYPES = new Set([
  "teaching",
  "music",
  "visual",
  "code",
  "conversation",
  "callout",
  "accordion",
  "illustration",
  "compare",
  "stage",
  "svg_slot",
]);

function illustrationStyle(
  value: unknown,
): "diagram" | "process" | "concept" | "comparison" | null {
  return value === "diagram" ||
    value === "process" ||
    value === "concept" ||
    value === "comparison"
    ? value
    : null;
}

function coerceIllustrationShapedDisplay(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  const prompt = firstNonEmptyString(record.prompt);
  const caption = firstNonEmptyString(
    record.caption,
    record.alt,
    record.title,
  );
  if (!prompt || !caption) return null;
  return {
    ...record,
    type: "illustration",
    prompt,
    caption,
    style: illustrationStyle(record.style) ?? "diagram",
  };
}

export function coerceTopicDisplay(display: unknown): unknown {
  let record = asRecord(display);
  if (!record) return display;
  // A plugin document is already a typed tree. Never reduce it to a text card.
  if (record.type === "display") return record;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (TOPIC_CALLOUT_ALIASES.has(type)) {
    record = {
      ...record,
      variant: type === "text" || type === "markdown" || type === "note" ? "tip" : type,
      type: "callout",
      body:
        firstNonEmptyString(record.body, record.text, record.content, record.caption) ||
        "要点",
    };
  } else if (!type || TOPIC_IMAGE_ALIASES.has(type)) {
    record =
      coerceIllustrationShapedDisplay(record) ??
      (type
        ? fallbackCallout(
            firstNonEmptyString(
              record.caption,
              record.alt,
              record.title,
              record.prompt,
            ),
          )
        : record);
  } else if (type === "compare") {
    const sides = collectAuthoredCompareSides(record);
    if (sides.length < 2) {
      record = compareFigureToCallout(record, sides[0]);
    } else {
      record = {
        ...record,
        left: sides[0],
        right: sides[1],
        sides,
      };
    }
  } else if (type === "stage") {
    const figures = Array.isArray(record.figures)
      ? record.figures.filter(
          (figure) => figure && typeof figure === "object" && !Array.isArray(figure),
        )
      : [];
    const coercedFigures = figures
      .map((figure) => coerceTopicDisplay(figure))
      .filter((figure) => {
        const nested = asRecord(figure);
        return nested && nested.type !== "heading" && nested.type !== "paragraph";
      });
    if (coercedFigures.length <= 1) {
      return coerceTopicDisplay(
        coercedFigures[0] ??
          fallbackCallout(firstNonEmptyString(record.caption, record.title)),
      );
    }
    record = {
      ...record,
      layout:
        record.layout === "split-h" ||
        record.layout === "split-v" ||
        record.layout === "main+rail" ||
        record.layout === "stack"
          ? record.layout
          : "stack",
      figures: coercedFigures.slice(0, 4),
    };
  } else if (type === "heading" || type === "paragraph") {
    record = fallbackCallout(firstNonEmptyString(record.text, record.body));
  } else if (type && !TOPIC_VISIBLE_DISPLAY_TYPES.has(type)) {
    record = fallbackCallout(
      firstNonEmptyString(
        record.body,
        record.text,
        record.prompt,
        record.title,
        record.caption,
      ),
    );
  }
  return record;
}

export function assignCodeBoard(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (record.type !== "code") return record;
  const source = resolveCodeBoardSource(record.code, record.parts);
  if (!source) return record;
  const { parts: _parts, ...withoutParts } = record;
  // Some providers return taught snippets instead of an exact source partition.
  // Preserve an id only when its original text matches one unambiguous source
  // region. Never rewrite code or invent a target from prose/ambiguous matches.
  const recovered = !source.parts ? sanitizeCodeRegions(source.code, [
    ...(Array.isArray(record.regions) ? record.regions : []),
    ...(sanitizeCodeParts(record.parts) ?? []).filter(part => part.id).map(part => ({ id: part.id, match: part.text })),
  ]) : undefined;
  return {
    ...withoutParts,
    code: source.code,
    ...(source.parts ? { parts: source.parts } : {}),
    ...(recovered ? { regions: recovered } : {}),
  };
}

export function assignCompareSideIds(
  record: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  if (record.type !== "compare") return record;
  const assignSide = (side: unknown, fallback: string) => {
    const item = asRecord(side) ?? {};
    return { ...item, id: trimId(item.id) || `${prefix}${fallback}` };
  };
  if (Array.isArray(record.sides) && record.sides.length >= 2) {
    const sides = record.sides.map((side, index) =>
      assignSide(
        side,
        index === 0 ? "left" : index === 1 ? "right" : `side-${index}`,
      ),
    );
    return { ...record, left: sides[0], right: sides[1], sides };
  }
  return {
    ...record,
    left: assignSide(record.left, "left"),
    right: assignSide(record.right, "right"),
  };
}

export function assignTopicDisplayIds(display: unknown): unknown {
  const record = asRecord(display);
  if (!record) return display;
  if (record.type === "stage" && Array.isArray(record.figures)) {
    return {
      ...record,
      id: trimId(record.id) || "display",
      figures: record.figures.map((figure, index) => {
        const nested = asRecord(figure) ?? { figure };
        const id = trimId(nested.id) || `f${index + 1}`;
        return assignCodeBoard(
          assignCompareSideIds({ ...nested, id }, `${id}-`),
        );
      }),
    };
  }
  return assignCodeBoard(
    assignCompareSideIds(
      {
        ...record,
        id: trimId(record.id) || "display",
      },
      "",
    ),
  );
}

export function uniqueCueIds(values: unknown): string[] {
  const source = Array.isArray(values)
    ? values
    : typeof values === "string" && values.trim()
      ? [values]
      : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of source) {
    const id = trimId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 16) break;
  }
  return ids;
}

export function collectDisplayFigureIds(display: unknown): Set<string> {
  const ids = new Set<string>();
  const record = asRecord(display);
  if (!record) return ids;
  const own = trimId(record.id);
  if (own) ids.add(own);
  if (Array.isArray(record.figures)) {
    for (const figure of record.figures) {
      const nested = asRecord(figure);
      const id = trimId(nested?.id);
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function defaultTopicCueFigureId(display: unknown): string {
  const record = asRecord(display);
  if (!record) return "display";
  if (record.type === "stage" && Array.isArray(record.figures)) {
    const first = asRecord(record.figures[0]);
    return trimId(first?.id) || "f1";
  }
  return trimId(record.id) || "display";
}

export function collectDisplayObjectIds(display: unknown): Set<string> {
  return new Set(
    collectMaterialCueObjectIds(
      display as Parameters<typeof collectMaterialCueObjectIds>[0],
    ),
  );
}

export { isMaterialLayoutCueTarget };
