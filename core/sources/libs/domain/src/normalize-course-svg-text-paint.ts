const SVG_ROOT_PATTERN = /<svg\b([^>]*)>/iu;
const TEXT_OPENING_TAG_PATTERN = /<text\b([^>]*)>/giu;
const ATTRIBUTE_PATTERN = (name: string) =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "iu");

function attributeValue(attrs: string, name: string): string | null {
  return attrs.match(ATTRIBUTE_PATTERN(name))?.[2] ?? null;
}

function hasAttribute(attrs: string, name: string): boolean {
  return ATTRIBUTE_PATTERN(name).test(attrs);
}

function isNone(value: string | null): boolean {
  return value?.trim().toLowerCase() === "none";
}

function isCurrentColor(value: string | null): boolean {
  return value?.trim().toLowerCase() === "currentcolor";
}

const ADAPTIVE_TEXT_ATTRIBUTE = "data-course-svg-adaptive-text";

/**
 * Prevent root line styling from being inherited by SVG labels.
 *
 * Models often put `fill="none" stroke="currentColor" stroke-width="2"`
 * on the root to style paths and lines. SVG presentation attributes inherit,
 * so an unstyled `<text>` would otherwise become an unfilled, stroked glyph.
 * Labels with their own paint attributes are left untouched.
 */
export function normalizeCourseSvgTextPaint(svg: string): string {
  const rootAttrs = svg.match(SVG_ROOT_PATTERN)?.[1];
  if (rootAttrs == null) return svg;

  const rootFill = attributeValue(rootAttrs, "fill");
  const rootStroke = attributeValue(rootAttrs, "stroke");
  const rootStrokeWidth = attributeValue(rootAttrs, "stroke-width");
  const hasProblematicInheritedPaint =
    isNone(rootFill) ||
    (rootStroke != null && !isNone(rootStroke)) ||
    (rootStrokeWidth != null && rootStrokeWidth.trim() !== "0");
  if (!TEXT_OPENING_TAG_PATTERN.test(svg)) {
    TEXT_OPENING_TAG_PATTERN.lastIndex = 0;
    return svg;
  }
  TEXT_OPENING_TAG_PATTERN.lastIndex = 0;

  return svg.replace(TEXT_OPENING_TAG_PATTERN, (_full, attrs: string) => {
    let normalizedAttrs = attrs;
    const textFill = attributeValue(attrs, "fill");
    const needsFillRepair =
      !hasAttribute(attrs, "fill") && hasProblematicInheritedPaint;
    if (needsFillRepair) {
      normalizedAttrs += ' fill="currentColor"';
    }
    if (needsFillRepair && !hasAttribute(attrs, "stroke")) {
      normalizedAttrs += ' stroke="none"';
      if (!hasAttribute(attrs, "stroke-width")) {
        normalizedAttrs += ' stroke-width="0"';
      }
    }
    const inheritsAdaptiveRootFill =
      textFill == null && (rootFill == null || isCurrentColor(rootFill));
    if (
      !hasAttribute(attrs, ADAPTIVE_TEXT_ATTRIBUTE) &&
      (needsFillRepair || isCurrentColor(textFill) || inheritsAdaptiveRootFill)
    ) {
      normalizedAttrs += ` ${ADAPTIVE_TEXT_ATTRIBUTE}=""`;
    }
    return `<text${normalizedAttrs}>`;
  });
}
