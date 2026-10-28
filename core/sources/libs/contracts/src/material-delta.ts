export type MaterialLike<TBlock = unknown> = {
  introduction: string;
  blocks: TBlock[];
  keyTakeaways: string[];
};

export type ArraySpliceDelta<T> = {
  index: number;
  deleteCount: number;
  items: T[];
};

export type TextSpliceDelta = {
  index: number;
  deleteCount: number;
  insert: string;
};

export type MaterialBlockTextDelta = {
  index: number;
  field: "svg" | "svgSource";
  splice: TextSpliceDelta;
  /** Complete non-text fields for the replacement block. */
  block: Record<string, unknown>;
};

export type MaterialDelta<TBlock = unknown> = {
  introduction?: { append: string } | { replace: string };
  blocks?: ArraySpliceDelta<TBlock>;
  blockText?: MaterialBlockTextDelta;
  keyTakeaways?: ArraySpliceDelta<string>;
};

/** Close the complete SVG tokens received so far in a renderable copy. */
export function progressiveCourseSvgMarkup(value: string): string | null {
  const source = value
    .replace(/^\uFEFF/u, "")
    // Match final server normalization so inert model-authored wrappers do
    // not make the last canonical frame replace the remainder of the SVG.
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<\?[\s\S]*?\?>/gu, "")
    .trimStart();
  const tokenPattern = /<[^>]+>/gu;
  const stack: Array<{ name: string; closeName: string }> = [];
  let rootStart = -1;
  let completeEnd = -1;
  let rootComplete = false;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(source))) {
    const token = match[0];
    if (rootStart < 0) {
      if (!/^<svg\b/iu.test(token)) continue;
      rootStart = match.index;
    }
    if (/^<\?|^<!/u.test(token)) continue;
    const closing = token.match(/^<\/\s*([A-Za-z][\w:.-]*)\s*>$/u);
    if (closing) {
      const name = closing[1]!.toLowerCase();
      if (stack.at(-1)?.name !== name) break;
      stack.pop();
      completeEnd = tokenPattern.lastIndex;
      if (stack.length === 0) {
        rootComplete = true;
        break;
      }
      continue;
    }
    const opening = token.match(/^<\s*([A-Za-z][\w:.-]*)\b/u);
    if (!opening) continue;
    if (!token.endsWith("/>")) {
      stack.push({
        name: opening[1]!.toLowerCase(),
        closeName: opening[1]!,
      });
    }
    completeEnd = tokenPattern.lastIndex;
  }

  if (
    rootStart < 0 ||
    completeEnd < 0 ||
    (!rootComplete && stack[0]?.name !== "svg")
  ) {
    return null;
  }
  const completePrefix = source.slice(rootStart, completeEnd);
  const trailingText = source.slice(completeEnd);
  const textContainer = /^(?:text|tspan|title|desc)$/u.test(
    stack.at(-1)?.name ?? "",
  );
  const progressiveText =
    textContainer && trailingText && !trailingText.includes("<")
      ? trailingText
          .replace(/&/gu, "&amp;")
          .replace(/</gu, "&lt;")
          .replace(/>/gu, "&gt;")
      : "";
  return `${completePrefix}${progressiveText}${[...stack]
    .reverse()
    .map(({ closeName }) => `</${closeName}>`)
    .join("")}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function createArraySpliceDelta<T>(
  previous: readonly T[],
  next: readonly T[],
): ArraySpliceDelta<T> | undefined {
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    sameValue(previous[prefix], next[prefix])
  ) {
    prefix += 1;
  }
  if (prefix === previous.length && prefix === next.length) return undefined;

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    sameValue(
      previous[previous.length - 1 - suffix],
      next[next.length - 1 - suffix],
    )
  ) {
    suffix += 1;
  }
  return {
    index: prefix,
    deleteCount: previous.length - prefix - suffix,
    items: next.slice(prefix, next.length - suffix),
  };
}

function createTextSpliceDelta(
  previous: string,
  next: string,
): TextSpliceDelta {
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    index: prefix,
    deleteCount: previous.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

function createSvgBlockTextDelta<TBlock>(
  previous: readonly TBlock[],
  blocks: ArraySpliceDelta<TBlock>,
): MaterialBlockTextDelta | undefined {
  if (blocks.deleteCount !== 1 || blocks.items.length !== 1) return undefined;
  const previousBlock = previous[blocks.index];
  const nextBlock = blocks.items[0];
  if (
    !previousBlock ||
    !nextBlock ||
    typeof previousBlock !== "object" ||
    typeof nextBlock !== "object" ||
    Array.isArray(previousBlock) ||
    Array.isArray(nextBlock)
  ) {
    return undefined;
  }
  const previousRecord = previousBlock as Record<string, unknown>;
  const nextRecord = nextBlock as Record<string, unknown>;
  if (nextRecord.type === "svg" && typeof nextRecord.svgSource === "string") {
    const previousSource =
      previousRecord.type === "svg" &&
      typeof previousRecord.svgSource === "string"
        ? previousRecord.svgSource
        : "";
    const { svg: _svg, svgSource: _svgSource, ...block } = nextRecord;
    return {
      index: blocks.index,
      field: "svgSource",
      splice: createTextSpliceDelta(previousSource, nextRecord.svgSource),
      block,
    };
  }
  if (
    previousRecord.type !== "svg" ||
    nextRecord.type !== "svg" ||
    typeof previousRecord.svg !== "string" ||
    typeof nextRecord.svg !== "string" ||
    !previousRecord.svg.trimStart().startsWith("<svg") ||
    !nextRecord.svg.trimStart().startsWith("<svg")
  ) {
    return undefined;
  }
  const { svg: _svg, ...block } = nextRecord;
  return {
    index: blocks.index,
    field: "svg",
    splice: createTextSpliceDelta(previousRecord.svg, nextRecord.svg),
    block,
  };
}

/** Create the smallest contiguous material patch needed by a JIT client. */
export function createMaterialDelta<TBlock>(
  previous: MaterialLike<TBlock> | null,
  next: MaterialLike<TBlock>,
): MaterialDelta<TBlock> {
  const prior = previous ?? { introduction: "", blocks: [], keyTakeaways: [] };
  const delta: MaterialDelta<TBlock> = {};
  if (prior.introduction !== next.introduction) {
    delta.introduction = next.introduction.startsWith(prior.introduction)
      ? { append: next.introduction.slice(prior.introduction.length) }
      : { replace: next.introduction };
  }
  const blocks = createArraySpliceDelta(prior.blocks, next.blocks);
  if (blocks) {
    const blockText = createSvgBlockTextDelta(prior.blocks, blocks);
    if (blockText) delta.blockText = blockText;
    else delta.blocks = blocks;
  }
  const keyTakeaways = createArraySpliceDelta(
    prior.keyTakeaways,
    next.keyTakeaways,
  );
  if (keyTakeaways) delta.keyTakeaways = keyTakeaways;
  return delta;
}

/** Apply a server material patch while retaining unchanged block identities. */
export function applyMaterialDelta<TBlock>(
  current: MaterialLike<TBlock> | null,
  delta: MaterialDelta<TBlock>,
): MaterialLike<TBlock> {
  const next: MaterialLike<TBlock> = current
    ? {
        ...current,
        blocks: [...current.blocks],
        keyTakeaways: [...current.keyTakeaways],
      }
    : { introduction: "", blocks: [], keyTakeaways: [] };
  if (delta.introduction) {
    next.introduction =
      "append" in delta.introduction
        ? next.introduction + delta.introduction.append
        : delta.introduction.replace;
  }
  if (delta.blocks) {
    next.blocks.splice(
      delta.blocks.index,
      delta.blocks.deleteCount,
      ...delta.blocks.items,
    );
  }
  if (delta.blockText) {
    const currentBlock = next.blocks[delta.blockText.index];
    if (
      currentBlock &&
      typeof currentBlock === "object" &&
      !Array.isArray(currentBlock)
    ) {
      const currentRecord = currentBlock as Record<string, unknown>;
      const currentText = currentRecord[delta.blockText.field];
      if (
        typeof currentText === "string" ||
        delta.blockText.field === "svgSource"
      ) {
        const { index, deleteCount, insert } = delta.blockText.splice;
        const previousText = typeof currentText === "string" ? currentText : "";
        const text =
          previousText.slice(0, index) +
          insert +
          previousText.slice(index + deleteCount);
        if (delta.blockText.field === "svgSource") {
          const svg = progressiveCourseSvgMarkup(text);
          next.blocks[delta.blockText.index] = {
            ...delta.blockText.block,
            ...(svg
              ? { svg }
              : typeof currentRecord.svg === "string"
                ? { svg: currentRecord.svg }
                : {}),
            svgSource: text,
          } as TBlock;
        } else {
          next.blocks[delta.blockText.index] = {
            ...delta.blockText.block,
            [delta.blockText.field]: text,
          } as TBlock;
        }
      }
    }
  }
  if (delta.keyTakeaways) {
    next.keyTakeaways.splice(
      delta.keyTakeaways.index,
      delta.keyTakeaways.deleteCount,
      ...delta.keyTakeaways.items,
    );
  }
  return next;
}
