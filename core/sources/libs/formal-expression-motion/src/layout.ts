import {
  collectFormalSubtree,
  type FormalDocument,
  type FormalNode,
  type FormalRelation,
  type LayoutNode,
  type SubjectRef,
} from "../../formal-expression-core/src/index.js";
import {
  arrowRole,
  containmentParentId,
  delimiterRole,
  firstSubject,
  glyphValue,
  axisBinopRole,
  isApplyOperator,
  isCallName,
  isDifferentialSymbol,
  isFractionNode,
  isFractionStack,
  isIncompleteFractionStack,
  isIntegralNode,
  isFunctionRenderer,
  isImplicitProduct,
  isInfixChainOperator,
  isLeftDelimiter,
  isPowerOperator,
  isPrimeOperator,
  isProductOperator,
  isRightDelimiter,
  isStructuralLayoutToken,
  isToArrow,
  limitCommand,
  subjectRef,
  wrapperNodeId,
} from "./classify.js";
import {
  DEFAULT_EM,
  axisHeight,
  gapPx,
  glyphAxisLift,
  glyphFace,
  mathAtom,
  scriptScale,
  texSpace,
} from "./metrics.js";
import { delimiterWidth, radicalHookWidth } from "./paths.js";
import {
  DELIM_GLYPH,
  delimiterBox,
  delimiterExtent,
  fractionPlacement,
  integralBox,
  integralMetrics,
  radicalClearance,
  scriptPlacement,
} from "./tex.js";
import type {
  MotionHitRegion,
  MotionLayoutOptions,
  MotionPrimitive,
  MotionScene,
  StretchRole,
} from "./types.js";

type Piece = {
  id: string;
  subject?: SubjectRef;
  x: number;
  dy: number;
  width: number;
  height: number;
  depth: number;
  em: number;
  italic: boolean;
  text: string;
  role?: StretchRole;
  extent: number;
  rowKey?: string;
};

type Frag = {
  width: number;
  height: number;
  depth: number;
  pieces: Piece[];
};

type Ctx = {
  doc: FormalDocument;
  em: number;
  path: Set<string>;
};

export function layoutFormalMotion(
  doc: FormalDocument,
  options: MotionLayoutOptions = {},
): MotionScene {
  const em = options.em ?? DEFAULT_EM;
  const padding = options.padding ?? em * 0.22;
  const ctx: Ctx = { doc, em, path: new Set() };
  const roots = doc.layoutRoots.map((id) => layoutOf(id, ctx, em));
  const assembled = hlist(roots, em * 1.1);
  const primitives: MotionPrimitive[] = assembled.pieces.map((piece) => ({
    id: piece.id,
    subject: piece.subject,
    x: padding + piece.x,
    y: padding + assembled.height + piece.dy,
    width: piece.width,
    height: piece.height,
    depth: piece.depth,
    opacity: 1,
    em: piece.em,
    italic: piece.italic,
    text: piece.text,
    role: piece.role,
    extent: piece.extent,
    rowKey: piece.rowKey,
  }));
  return packScene(primitives, padding);
}

function layoutOf(id: string, ctx: Ctx, em: number): Frag {
  if (ctx.path.has(id)) return glyphFrag("cycle", "?", em);
  const layout = ctx.doc.layouts[id];
  if (!layout) return glyphFrag(`missing:${id}`, "?", em);
  ctx.path.add(id);
  let result: Frag;
  switch (layout.kind) {
    case "subject":
      result = layoutSubject(id, layout, ctx, em);
      break;
    case "flow":
      result = layoutFlow(id, layout, ctx, em);
      break;
    case "stack":
      result = layoutStack(id, layout, ctx, em);
      break;
    case "attach":
      result = layoutAttach(id, layout, ctx, em);
      break;
    case "surround":
      result = layoutSurround(id, layout, ctx, em);
      break;
    case "grid":
      result = layoutGrid(layout, ctx, em);
      break;
    default:
      result = hlist(
        layout.children.map((child) => layoutOf(child, ctx, em)),
        gapPx(layout.props?.gap, em),
      );
      break;
  }
  ctx.path.delete(id);
  return result;
}

function layoutSubject(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
  em: number,
): Frag {
  if (!layout.subject) {
    return hlist(
      layout.children.map((child) => layoutOf(child, ctx, em)),
      0.08 * em,
    );
  }
  if (layout.subject.type === "relation") return emptyFrag();
  const node = ctx.doc.nodes[layout.subject.id];
  if (!node) return glyphFrag(`missing-node:${layout.subject.id}`, "?", em);
  if (node.kind === "reference") {
    return layoutReference(layout.subject.id, node, ctx, em);
  }
  const limit = limitCommand(node);
  if (limit && layout.children.length) {
    return layoutLimitCluster(
      layout.subject.id,
      limit,
      layout.children,
      ctx,
      em,
    );
  }
  if (isFunctionRenderer(node) && layout.children.length) {
    const callee = nodeGlyph(layout.subject.id, node, em);
    return hlist(
      [callee, ...layout.children.map((child) => layoutOf(child, ctx, em))],
      0.04 * em,
    );
  }
  if (isCallName(node) && layout.children.length === 1) {
    return hlist(
      [
        nodeGlyph(layout.subject.id, node, em),
        wrapCall(layout.children[0], ctx, em),
      ],
      0.02 * em,
    );
  }
  const self = nodeGlyph(layout.subject.id, node, em);
  if (!layout.children.length) return self;
  return hlist(
    [self, ...layout.children.map((child) => layoutOf(child, ctx, em))],
    0.06 * em,
  );
}

function layoutFlow(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
  em: number,
): Frag {
  const ownerId = wrapperNodeId(layoutId);
  const owner = ownerId ? ctx.doc.nodes[ownerId] : undefined;
  const ownerLimit = owner ? limitCommand(owner) : undefined;
  const gap = gapPx(layout.props?.gap, em);

  if (owner && isIntegralNode(owner) && ownerId) {
    return layoutIntegralParts(
      ownerId,
      partitionIntegralParts(layout.children, ownerId, ctx),
      ctx,
      em,
      gap,
    );
  }

  const integralCluster = tryIntegralFlow(layout.children, ctx, em, gap);
  if (integralCluster) return integralCluster;
  const postfixIntegral = tryPostfixIntegral(layout.children, ctx, em, gap);
  if (postfixIntegral) return postfixIntegral;
  const bareIntegral = tryBareIntegralPrefix(layout.children, ctx, em, gap);
  if (bareIntegral) return bareIntegral;

  if (layout.children.length === 3) {
    const power = tryPower(
      layout.children[0],
      layout.children[1],
      layout.children[2],
      ctx,
      em,
    );
    if (power) return power;
  }

  if (ownerLimit && ownerId && layout.children.length) {
    const first = subjectRef(layout.children[0], ctx.doc);
    const infixOwner =
      layout.children.length >= 3 &&
      subjectRef(layout.children[1], ctx.doc)?.id === ownerId;
    if (first?.id !== ownerId && !infixOwner) {
      return layoutLimitCluster(
        ownerId,
        ownerLimit,
        layout.children,
        ctx,
        em,
      );
    }
  }

  const limitSeq = tryLimitSequence(layout.children, ctx, em);
  if (limitSeq) return limitSeq;

  if (layout.children.length === 2) {
    const call = tryUnaryCall(layout.children[0], layout.children[1], ctx, em);
    if (call) return call;
    const prime = tryBinaryPrime(
      layout.children[0],
      layout.children[1],
      ctx,
      em,
    );
    if (prime) return prime;
  }

  if (layout.children.length === 3) {
    const middle = subjectRef(layout.children[1], ctx.doc);
    if (middle && isFractionNode(middle.node)) {
      if (
        isTextPhraseLayout(layout.children[0], ctx) &&
        isTextPhraseLayout(layout.children[2], ctx)
      ) {
        return layoutTextSlash(
          layout.children[0],
          layout.children[2],
          middle.id,
          ctx,
          em,
        );
      }
      return layoutFraction(
        middle,
        layout.children[0],
        layout.children[2],
        ctx,
        em,
      );
    }
    if (middle && isPowerOperator(middle.node)) {
      return layoutPower(layout.children[0], layout.children[2], ctx, em);
    }
    const operator = glyphValue(middle?.node);
    if (
      middle &&
      (middle.node.renderer === "invisible" ||
        isImplicitProduct(middle.node) ||
        isStructuralLayoutToken(middle.node) ||
        operator === "apply" ||
        operator === "call")
    ) {
      if (isApplyOperator(middle.node)) {
        const argument = layout.children[2];
        return hlist(
          [
            layoutOf(layout.children[0], ctx, em),
            wrapApplyArgument(layout.children[0], argument, ctx, em),
          ],
          0.04 * em,
        );
      }
      return hlist(
        [
          layoutOf(layout.children[0], ctx, em),
          layoutOf(layout.children[2], ctx, em),
        ],
        Math.max(0.04 * em, gap * 0.2),
      );
    }
    if (middle && isPrimeOperator(middle.node)) {
      return hlist(
        [
          layoutPostfixPrime(
            layoutOf(layout.children[0], ctx, em),
            layout.children[0],
            middle.id,
            ctx,
            em,
          ),
          wrapCall(layout.children[2], ctx, em),
        ],
        0.04 * em,
      );
    }
    if (middle && isProductOperator(middle.node)) {
      return hlist(
        [
          wrapProduct(layout.children[0], ctx, em),
          layoutOf(layout.children[1], ctx, em),
          wrapProduct(layout.children[2], ctx, em),
        ],
        0.08 * em,
      );
    }
  }

  if (owner && isFunctionRenderer(owner) && layout.children.length) {
    return hlist(
      layout.children.map((child) => layoutOf(child, ctx, em)),
      0.04 * em,
    );
  }

  const infix = layoutInfixChain(layoutId, layout, ctx, em, gap);
  if (infix) return infix;

  return hlist(
    layout.children.map((child) => layoutOf(child, ctx, em)),
    gap,
  );
}

function layoutStack(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
  em: number,
): Frag {
  if (isFractionStack(layout, ctx.doc)) {
    const bar = subjectRef(layout.children[1], ctx.doc)!;
    if (
      isTextPhraseLayout(layout.children[0], ctx) &&
      isTextPhraseLayout(layout.children[2], ctx)
    ) {
      return layoutTextSlash(
        layout.children[0],
        layout.children[2],
        bar.id,
        ctx,
        em,
      );
    }
    return layoutFraction(
      bar,
      layout.children[0],
      layout.children[2],
      ctx,
      em,
    );
  }
  if (isIncompleteFractionStack(layoutId, layout, ctx.doc)) {
    const ownerId = wrapperNodeId(layoutId);
    const owner = ownerId ? ctx.doc.nodes[ownerId] : undefined;
    return layoutFraction(
      {
        id: ownerId ?? layoutId,
        node: owner ?? { kind: "container", renderer: "fraction" },
      },
      layout.children[0],
      layout.children[1],
      ctx,
      em,
    );
  }
  const rows = layout.children.map((child) => {
    const frag = layoutOf(child, ctx, em);
    return {
      ...frag,
      pieces: frag.pieces.map((piece) => ({
        ...piece,
        rowKey: piece.rowKey ?? child,
      })),
    };
  });
  return vlist(rows, 0.55 * em, true);
}

function layoutAttach(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
  em: number,
): Frag {
  const [baseId, firstId, secondId] = layout.children;
  if (!baseId) return emptyFrag();
  const baseLayout = ctx.doc.layouts[baseId];
  const baseNode = subjectRef(baseId, ctx.doc);
  const ownerId = wrapperNodeId(layoutId);
  const owner = ownerId ? ctx.doc.nodes[ownerId] : undefined;
  const ownerLimit = owner ? limitCommand(owner) : undefined;
  const baseLimit = baseNode ? limitCommand(baseNode.node) : undefined;

  if (layout.children.length === 3) {
    const power = tryPower(
      layout.children[0],
      layout.children[1],
      layout.children[2],
      ctx,
      em,
    );
    if (power) return power;
  }

  const integralId =
    baseNode && isIntegralNode(baseNode.node)
      ? baseNode.id
      : owner && isIntegralNode(owner)
        ? ownerId
        : undefined;
  if (integralId) {
    return layoutIntegralParts(
      integralId,
      partitionIntegralParts(layout.children, integralId, ctx),
      ctx,
      em,
      gapPx(layout.props?.gap, em),
    );
  }

  if (baseLimit && baseNode) {
    const kids = [firstId, secondId].filter(Boolean) as string[];
    return layoutLimitCluster(baseNode.id, baseLimit, kids, ctx, em);
  }
  if (ownerLimit && ownerId && !baseLimit) {
    return layoutLimitCluster(ownerId, ownerLimit, layout.children, ctx, em);
  }

  if (baseLayout?.kind === "surround" && isRadicalLayout(baseId, baseLayout, ctx)) {
    return layoutRadical(baseLayout, baseId, firstId, ctx, em);
  }

  if (secondId && owner && isPowerOperator(owner)) {
    return layoutPower(baseId, secondId, ctx, em);
  }

  if (firstId && secondId) {
    return layoutSubSup(
      layoutOf(baseId, ctx, em),
      layoutOf(firstId, ctx, scriptScale(em)),
      layoutOf(secondId, ctx, scriptScale(em)),
      em,
    );
  }

  const base = layoutOf(baseId, ctx, em);
  const attachment = firstId ? layoutOf(firstId, ctx, scriptScale(em)) : emptyFrag();
  const superscriptAnchor =
    layout.props?.anchor === "top-left" ||
    layout.props?.anchor === "top" ||
    layout.props?.anchor === "superscript";
  if (superscriptAnchor) {
    return layoutSuperscript(base, attachment, em, true);
  }
  return layoutSubscript(base, attachment, em);
}

function isRadicalLayout(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
): boolean {
  const symbol = String(layout.props?.symbol ?? "");
  const left = String(layout.props?.left ?? "");
  if (symbol === "√" || left === "√" || left === "sqrt") return true;
  const ownerId = wrapperNodeId(layoutId);
  const owner = ownerId ? ctx.doc.nodes[ownerId] : undefined;
  return owner?.renderer === "radical" || owner?.renderer === "sqrt";
}

function layoutSurround(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
  em: number,
): Frag {
  if (isRadicalLayout(layoutId, layout, ctx)) {
    return layoutRadical(layout, layoutId, undefined, ctx, em);
  }
  const inner = hlist(
    layout.children.map((child) => layoutOf(child, ctx, em)),
    0.06 * em,
  );
  const leftRaw = String(layout.props?.left ?? "(");
  const rightRaw = String(layout.props?.right ?? ")");
  const leftRole = isLeftDelimiter(leftRaw)
    ? delimiterRole(leftRaw, "left")
    : "paren-left";
  const rightRole = isRightDelimiter(rightRaw)
    ? delimiterRole(rightRaw, "right")
    : "paren-right";
  return wrapDelimiters(inner, layoutId, leftRole, rightRole, em, {
    left: leftRaw,
    right: rightRaw,
  });
}

function layoutGrid(layout: LayoutNode, ctx: Ctx, em: number): Frag {
  const cells = layout.children.map((child) => layoutOf(child, ctx, em));
  if (!cells.length) return emptyFrag();
  const columns = Math.max(
    1,
    Math.floor(Number(layout.props?.columns)) || cells.length,
  );
  const colGap = gapPx(layout.props?.columnGap ?? 18, em);
  const rowGap = gapPx(layout.props?.rowGap ?? 10, em);
  const rowCount = Math.ceil(cells.length / columns);
  const colWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      0,
      ...Array.from({ length: rowCount }, (_, row) => {
        return cells[row * columns + column]?.width ?? 0;
      }),
    ),
  );
  const rowMetrics = Array.from({ length: rowCount }, (_, row) => {
    const slice = cells.slice(row * columns, row * columns + columns);
    return {
      height: Math.max(0, ...slice.map((cell) => cell.height)),
      depth: Math.max(0, ...slice.map((cell) => cell.depth)),
    };
  });
  let cursor = 0;
  const rowBaselines: number[] = [];
  for (const [index, metrics] of rowMetrics.entries()) {
    const baseline = cursor + metrics.height;
    rowBaselines.push(baseline);
    cursor = baseline + metrics.depth;
    if (index < rowCount - 1) cursor += rowGap;
  }
  const width =
    colWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
    Math.max(0, columns - 1) * colGap;
  const shiftY = -cursor / 2;
  const pieces: Piece[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    let x = 0;
    for (let column = 0; column < columns; column += 1) {
      const cell = cells[row * columns + column];
      if (cell) {
        const cellX = x + (colWidths[column] - cell.width) / 2;
        pieces.push(
          ...shift(cell, cellX, rowBaselines[row] + shiftY).pieces,
        );
      }
      x += colWidths[column];
      if (column < columns - 1) x += colGap;
    }
  }
  return {
    width,
    height: cursor / 2,
    depth: cursor / 2,
    pieces,
  };
}

function layoutRadical(
  layout: LayoutNode,
  layoutId: string,
  indexLayoutId: string | undefined,
  ctx: Ctx,
  em: number,
): Frag {
  const content = layout.children[0]
    ? layoutOf(layout.children[0], ctx, em)
    : emptyFrag();
  const clear = radicalClearance(em, "D");
  const extent = content.height + content.depth + clear;
  const hookWidth = radicalHookWidth(extent, em);
  const ruleWidth = content.width + 0.12 * em;
  const owner = radicalOwner(layout, ctx.doc);
  const subject: SubjectRef | undefined = owner
    ? { type: "node", id: owner }
    : { type: "layout", id: layoutId };
  const topDy = -(content.height + clear);
  const hook: Piece = {
    id: `stretch:${layoutId}:radical`,
    subject,
    x: 0,
    dy: 0,
    width: hookWidth,
    height: content.height + clear,
    depth: content.depth,
    em,
    italic: false,
    text: "",
    role: "radical",
    extent,
  };
  const vinculum: Piece = {
    id: `stretch:${layoutId}:vinculum`,
    subject,
    x: hookWidth,
    dy: 0,
    width: ruleWidth,
    height: content.height + clear,
    depth: 0,
    em,
    italic: false,
    text: "",
    role: "vinculum",
    extent: ruleWidth,
  };
  const shifted = shift(content, hookWidth + 0.06 * em, 0);
  let pieces = [hook, vinculum, ...shifted.pieces];
  let width = hookWidth + ruleWidth;
  let height = content.height + clear;
  let depth = content.depth;
  if (indexLayoutId) {
    const index = layoutOf(indexLayoutId, ctx, scriptScale(em) * 0.9);
    const placed = shift(
      index,
      hookWidth * 0.02,
      topDy - index.depth - 0.04 * em,
    );
    pieces = [...placed.pieces, ...pieces];
    height = Math.max(height, -placedMinDy(placed));
    width = Math.max(width, placed.width);
  }
  return { width, height, depth, pieces };
}

function radicalOwner(
  layout: LayoutNode,
  doc: FormalDocument,
): string | undefined {
  const child = layout.children[0]
    ? firstSubject(layout.children[0], doc)
    : undefined;
  return child ? containmentParentId(child, doc) : undefined;
}

function layoutPlainText(layoutId: string, ctx: Ctx): string {
  const layout = ctx.doc.layouts[layoutId];
  if (!layout) return "";
  const own =
    layout.subject?.type === "node"
      ? glyphValue(ctx.doc.nodes[layout.subject.id])
      : "";
  return `${own}${layout.children.map((id) => layoutPlainText(id, ctx)).join("")}`;
}

function isTextPhraseLayout(layoutId: string, ctx: Ctx): boolean {
  return [...layoutPlainText(layoutId, ctx)].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    );
  });
}

function layoutTextSlash(
  numeratorId: string,
  denominatorId: string,
  slashId: string,
  ctx: Ctx,
  em: number,
): Frag {
  return hlist(
    [
      layoutOf(numeratorId, ctx, em),
      glyphFrag(`node:${slashId}`, "/", em, { type: "node", id: slashId }),
      layoutOf(denominatorId, ctx, em),
    ],
    0.12 * em,
  );
}

function layoutFraction(
  bar: { id: string; node: FormalNode },
  numeratorId: string,
  denominatorId: string,
  ctx: Ctx,
  em: number,
): Frag {
  const num = layoutOf(numeratorId, ctx, em);
  const den = layoutOf(denominatorId, ctx, em);
  const place = fractionPlacement(num, den, em, "D");
  const inner = Math.max(num.width, den.width) + 0.18 * em;
  const numX = (inner - num.width) / 2;
  const denX = (inner - den.width) / 2;
  const owner =
    bar.node.renderer === "fraction" || bar.node.renderer === "fraction-bar"
      ? (containmentParentId(bar.id, ctx.doc) ?? bar.id)
      : bar.id;
  const rulePiece: Piece = {
    id: `stretch:${bar.id}:frac-rule`,
    subject: { type: "node", id: owner },
    x: 0,
    dy: place.ruleDy,
    width: inner,
    height: place.rule / 2,
    depth: place.rule / 2,
    em,
    italic: false,
    text: "",
    role: "frac-rule",
    extent: inner,
  };
  return {
    width: inner,
    height: -place.numerDy + num.height,
    depth: place.denomDy + den.depth,
    pieces: [
      ...shift(num, numX, place.numerDy).pieces,
      rulePiece,
      ...shift(den, denX, place.denomDy).pieces,
    ],
  };
}

function layoutLimitCluster(
  nodeId: string,
  command: string,
  childIds: string[],
  ctx: Ctx,
  em: number,
): Frag {
  const op = glyphFrag(`node:${nodeId}`, command, em, { type: "node", id: nodeId });
  if (command === "lim") {
    const end = findContainedApproachEnd(childIds, ctx);
    const approach = hlist(
      childIds.slice(0, end + 1).map((id) => layoutOf(id, ctx, scriptScale(em))),
      0.08 * em,
    );
    const body = hlist(
      childIds.slice(end + 1).map((id) => layoutOf(id, ctx, em)),
      0.1 * em,
    );
    return hlist([layoutUnderscript(op, approach, em), body], 0.22 * em);
  }
  const lower = childIds[0]
    ? layoutOf(childIds[0], ctx, scriptScale(em))
    : emptyFrag();
  const upper = childIds[1]
    ? layoutOf(childIds[1], ctx, scriptScale(em))
    : emptyFrag();
  const limits = attachLimits(op, lower, upper, em);
  const rest = childIds.slice(2).map((id) => layoutOf(id, ctx, em));
  return hlist([limits, ...rest], 0.16 * em);
}

function tryLimitSequence(
  childIds: string[],
  ctx: Ctx,
  em: number,
): Frag | undefined {
  if (childIds.length < 2) return undefined;
  const first = subjectRef(childIds[0], ctx.doc);
  const command = first ? limitCommand(first.node) : undefined;
  if (command !== "lim") return undefined;
  const approachEnd = findLimitApproachEnd(childIds, ctx);
  if (approachEnd == null) return undefined;
  return layoutLimitCluster(
    first!.id,
    command,
    childIds.slice(1),
    ctx,
    em,
  );
}

function findContainedApproachEnd(childIds: string[], ctx: Ctx): number {
  if (layoutHasToArrow(childIds[0], ctx)) return 0;
  for (let i = 0; i < childIds.length; i += 1) {
    const ref = subjectRef(childIds[i], ctx.doc);
    if (ref && isToArrow(ref.node)) {
      return i + 1 < childIds.length ? i + 1 : i;
    }
  }
  return 0;
}

function findLimitApproachEnd(childIds: string[], ctx: Ctx): number | undefined {
  if (childIds.length < 2) return undefined;
  if (layoutHasToArrow(childIds[1], ctx)) return 1;
  for (let i = 1; i < childIds.length; i += 1) {
    const ref = subjectRef(childIds[i], ctx.doc);
    if (ref && isToArrow(ref.node)) {
      return i + 1 < childIds.length ? i + 1 : i;
    }
  }
  return undefined;
}

function layoutHasToArrow(
  layoutId: string,
  ctx: Ctx,
  seen = new Set<string>(),
): boolean {
  if (!layoutId || seen.has(layoutId)) return false;
  seen.add(layoutId);
  const ref = subjectRef(layoutId, ctx.doc);
  if (ref && isToArrow(ref.node)) return true;
  const layout = ctx.doc.layouts[layoutId];
  if (!layout) return false;
  return layout.children.some((child) => layoutHasToArrow(child, ctx, seen));
}

function tryPower(
  leftId: string,
  operatorId: string,
  rightId: string,
  ctx: Ctx,
  em: number,
): Frag | undefined {
  const middle = subjectRef(operatorId, ctx.doc);
  if (!middle || !isPowerOperator(middle.node)) return undefined;
  return layoutPower(leftId, rightId, ctx, em);
}

function layoutPower(
  baseId: string,
  exponentId: string,
  ctx: Ctx,
  em: number,
): Frag {
  return layoutSuperscript(
    wrapPower(baseId, ctx, em),
    layoutOf(exponentId, ctx, scriptScale(em)),
    em,
  );
}

function tryUnaryCall(
  firstId: string,
  secondId: string,
  ctx: Ctx,
  em: number,
): Frag | undefined {
  const first = subjectRef(firstId, ctx.doc);
  const second = subjectRef(secondId, ctx.doc);
  if (second && isDifferentialSymbol(second.node)) {
    return hlist(
      [layoutOf(secondId, ctx, em), layoutOf(firstId, ctx, em)],
      0.02 * em,
    );
  }
  if (first && isDifferentialSymbol(first.node)) {
    return hlist(
      [layoutOf(firstId, ctx, em), layoutOf(secondId, ctx, em)],
      0.02 * em,
    );
  }
  if (second && isCallName(second.node)) {
    return hlist(
      [layoutOf(secondId, ctx, em), wrapCall(firstId, ctx, em)],
      0.02 * em,
    );
  }
  if (first && isCallName(first.node)) {
    return hlist(
      [layoutOf(firstId, ctx, em), wrapCall(secondId, ctx, em)],
      0.02 * em,
    );
  }
  return undefined;
}

function tryBinaryPrime(
  firstId: string,
  secondId: string,
  ctx: Ctx,
  em: number,
): Frag | undefined {
  const second = subjectRef(secondId, ctx.doc);
  if (!second || !isPrimeOperator(second.node)) return undefined;
  return layoutPostfixPrime(
    layoutOf(firstId, ctx, em),
    firstId,
    second.id,
    ctx,
    em,
  );
}

function layoutPostfixPrime(
  base: Frag,
  baseLayoutId: string,
  primeId: string,
  ctx: Ctx,
  em: number,
): Frag {
  const layout = ctx.doc.layouts[baseLayoutId];
  const primed =
    layout?.kind === "surround"
      ? base
      : needsPrimeParens(baseLayoutId, ctx)
        ? wrapDelimiters(base, `${baseLayoutId}:prime`, "paren-left", "paren-right", em)
        : base;
  const prime = primeFrag(`node:${primeId}`, scriptScale(em), {
    type: "node",
    id: primeId,
  });
  return layoutSuperscript(primed, prime, em);
}

function needsPrimeParens(baseLayoutId: string, ctx: Ctx): boolean {
  const layout = ctx.doc.layouts[baseLayoutId];
  const ref = subjectRef(baseLayoutId, ctx.doc);
  const glyph = ref ? glyphValue(ref.node) : "";
  if (
    ref &&
    (layout?.kind === "subject" || !layout?.children.length) &&
    /^(?:[A-Za-zφϕξθπΔδ]+(?:'+)?)$/.test(glyph)
  ) {
    return false;
  }
  return layout?.kind !== "surround";
}

function wrapCall(argumentLayoutId: string, ctx: Ctx, em: number): Frag {
  const layout = ctx.doc.layouts[argumentLayoutId];
  const inner = layoutOf(argumentLayoutId, ctx, em);
  if (layout?.kind === "surround") return inner;
  return wrapDelimiters(
    inner,
    `${argumentLayoutId}:call`,
    "paren-left",
    "paren-right",
    em,
  );
}

function wrapApplyArgument(
  calleeLayoutId: string,
  argumentLayoutId: string,
  ctx: Ctx,
  em: number,
): Frag {
  const callee = subjectRef(calleeLayoutId, ctx.doc);
  if (callee && isDifferentialSymbol(callee.node)) {
    return layoutOf(argumentLayoutId, ctx, em);
  }
  const calleeLayout = ctx.doc.layouts[calleeLayoutId];
  if (calleeLayout && isFractionStack(calleeLayout, ctx.doc)) {
    const numerator = subjectRef(calleeLayout.children[0]!, ctx.doc);
    if (!numerator || !isDifferentialSymbol(numerator.node)) {
      return layoutOf(argumentLayoutId, ctx, em);
    }
  }
  return wrapCall(argumentLayoutId, ctx, em);
}

function layoutInfixChain(
  layoutId: string,
  layout: LayoutNode,
  ctx: Ctx,
  em: number,
  gap: number,
): Frag | undefined {
  if (layout.children.length < 3) return undefined;
  const ownerId = wrapperNodeId(layoutId);
  const middle = subjectRef(layout.children[1], ctx.doc);
  if (!ownerId || middle?.id !== ownerId) return undefined;
  if (!isInfixChainOperator(middle.node)) return undefined;

  const operands = [layout.children[0]!, ...layout.children.slice(2)];
  const implicit = isImplicitProduct(middle.node);
  const product = implicit || isProductOperator(middle.node);
  const parts: Frag[] = [];
  for (let index = 0; index < operands.length; index += 1) {
    if (index > 0 && !implicit) {
      const operator = layoutOf(layout.children[1]!, ctx, em);
      parts.push(
        index === 1 ? operator : withPieceSuffix(operator, `:nary-${index}`),
      );
    }
    const operand = operands[index]!;
    parts.push(
      product ? wrapProduct(operand, ctx, em) : layoutOf(operand, ctx, em),
    );
  }
  const itemGap = implicit
    ? Math.max(0.04 * em, gap * 0.2)
    : isProductOperator(middle.node)
      ? 0.08 * em
      : gap;
  return hlist(parts, itemGap);
}

function withPieceSuffix(frag: Frag, suffix: string): Frag {
  return {
    ...frag,
    pieces: frag.pieces.map((piece) => ({
      ...piece,
      id: `${piece.id}${suffix}`,
    })),
  };
}

function wrapProduct(layoutId: string, ctx: Ctx, em: number): Frag {
  const layout = ctx.doc.layouts[layoutId];
  const inner = layoutOf(layoutId, ctx, em);
  if (!layout || layout.kind === "surround" || layout.kind === "stack")
    return inner;
  if (layout.kind !== "flow" || layout.children.length < 3) return inner;
  const middle = subjectRef(layout.children[1], ctx.doc);
  const glyph = middle ? glyphValue(middle.node) : "";
  if (glyph !== "+" && glyph !== "-" && glyph !== "−") return inner;
  if (middle?.node.renderer === "invisible") return inner;
  return wrapDelimiters(inner, `${layoutId}:product`, "paren-left", "paren-right", em);
}

function wrapPower(layoutId: string, ctx: Ctx, em: number): Frag {
  const inner = layoutOf(layoutId, ctx, em);
  if (!needsPowerParens(layoutId, ctx)) return inner;
  return wrapDelimiters(
    inner,
    `${layoutId}:power`,
    "paren-left",
    "paren-right",
    em,
  );
}

function needsPowerParens(layoutId: string, ctx: Ctx): boolean {
  const layout = ctx.doc.layouts[layoutId];
  if (!layout) return false;
  if (layout.kind === "surround") return layout.props?.symbol === "√";
  if (layout.kind === "stack" || layout.kind === "attach" || layout.kind === "grid")
    return true;
  if (layout.kind === "subject") return layout.children.length > 0;
  if (layout.kind === "flow") {
    if (layout.children.length <= 1) {
      const only = layout.children[0];
      return only ? needsPowerParens(only, ctx) : false;
    }
    return true;
  }
  return false;
}

function wrapDelimiters(
  inner: Frag,
  key: string,
  leftRole: StretchRole,
  rightRole: StretchRole,
  em: number,
  glyphs?: { left?: string; right?: string },
): Frag {
  const extent = delimiterExtent(inner, em, "D");
  const box = delimiterBox(extent, em);
  const leftW = delimiterWidth(leftRole, extent, em);
  const rightW = delimiterWidth(rightRole, extent, em);
  const left: Piece = {
    id: `stretch:${key}:${leftRole}`,
    subject: { type: "layout", id: key.split(":")[0] },
    x: 0,
    dy: 0,
    width: leftW,
    height: box.height,
    depth: box.depth,
    em,
    italic: false,
    text: glyphs?.left ?? DELIM_GLYPH[leftRole] ?? "(",
    role: leftRole,
    extent,
  };
  const right: Piece = {
    ...left,
    id: `stretch:${key}:${rightRole}`,
    x: leftW + inner.width + 0.1 * em,
    role: rightRole,
    width: rightW,
    text: glyphs?.right ?? DELIM_GLYPH[rightRole] ?? ")",
  };
  return {
    width: leftW + inner.width + rightW + 0.2 * em,
    height: Math.max(inner.height, extent / 2 + axisHeight(em)),
    depth: Math.max(inner.depth, extent / 2 - axisHeight(em)),
    pieces: [left, ...shift(inner, leftW + 0.1 * em, 0).pieces, right],
  };
}

function layoutSuperscript(
  base: Frag,
  exp: Frag,
  em: number,
  pre = false,
): Frag {
  const { superDy } = scriptPlacement(base, { super: exp }, em, "D");
  if (pre) {
    const placed = shift(exp, 0, superDy);
    return {
      width: exp.width + 0.04 * em + base.width,
      height: Math.max(base.height, -superDy + exp.height),
      depth: base.depth,
      pieces: [...placed.pieces, ...shift(base, exp.width + 0.04 * em, 0).pieces],
    };
  }
  const placed = shift(exp, base.width + 0.04 * em, superDy);
  return {
    width: base.width + exp.width + 0.08 * em,
    height: Math.max(base.height, -superDy + exp.height),
    depth: base.depth,
    pieces: [...base.pieces, ...placed.pieces],
  };
}

function layoutSubscript(base: Frag, sub: Frag, em: number): Frag {
  const { subDy } = scriptPlacement(base, { sub }, em, "D");
  const x = base.width + 0.04 * em;
  const placed = shift(sub, x, subDy);
  return {
    width: x + sub.width + 0.04 * em,
    height: base.height,
    depth: Math.max(base.depth, subDy + sub.depth),
    pieces: [...base.pieces, ...placed.pieces],
  };
}

function layoutSubSup(base: Frag, sub: Frag, sup: Frag, em: number): Frag {
  const { superDy, subDy } = scriptPlacement(
    base,
    { super: sup, sub },
    em,
    "D",
  );
  const x = base.width + 0.04 * em;
  return {
    width: x + Math.max(sub.width, sup.width) + 0.04 * em,
    height: Math.max(base.height, -superDy + sup.height),
    depth: Math.max(base.depth, subDy + sub.depth),
    pieces: [
      ...base.pieces,
      ...shift(sup, x, superDy).pieces,
      ...shift(sub, x, subDy).pieces,
    ],
  };
}

function layoutUnderscript(base: Frag, script: Frag, em: number): Frag {
  const dy = base.depth + 0.12 * em + script.height;
  const width = Math.max(base.width, script.width);
  const baseX = (width - base.width) / 2;
  const scriptX = (width - script.width) / 2;
  return {
    width,
    height: base.height,
    depth: dy + script.depth,
    pieces: [
      ...shift(base, baseX, 0).pieces,
      ...shift(script, scriptX, dy).pieces,
    ],
  };
}

const INTEGRAL_LOWER_SLOTS = new Set([
  "lower",
  "from",
  "sub",
  "subscript",
  "bottom",
]);
const INTEGRAL_UPPER_SLOTS = new Set([
  "upper",
  "to",
  "sup",
  "superscript",
  "top",
]);
const INTEGRAL_BODY_SLOTS = new Set([
  "body",
  "integrand",
  "argument",
  "arg",
  "expr",
  "tail",
  "differential",
  "measure",
]);

type IntegralParts = {
  lower?: string;
  upper?: string;
  body: string[];
};

function relationSlotName(relation: FormalRelation): string {
  if (relation.kind === "containment") {
    return String(relation.role || relation.slot || "").toLowerCase();
  }
  return String(relation.role || relation.port || "").toLowerCase();
}

function childSlotName(
  layoutId: string,
  ownerId: string | undefined,
  ctx: Ctx,
): string {
  if (!ownerId) return "";
  const nodeId =
    subjectRef(layoutId, ctx.doc)?.id ?? firstSubject(layoutId, ctx.doc);
  if (!nodeId) return "";
  const relation = Object.values(ctx.doc.relations).find((candidate) => {
    if (candidate.kind === "containment") {
      return candidate.parent === ownerId && candidate.child === nodeId;
    }
    return (
      candidate.kind === "connection" &&
      candidate.connector === ownerId &&
      candidate.participant === nodeId
    );
  });
  return relation ? relationSlotName(relation) : "";
}

function isIntegralSubjectLayout(layoutId: string, ctx: Ctx): boolean {
  const ref = subjectRef(layoutId, ctx.doc);
  return Boolean(ref && isIntegralNode(ref.node));
}

function isSimpleBoundLayout(layoutId: string, ctx: Ctx): boolean {
  const ref = subjectRef(layoutId, ctx.doc);
  if (ref) {
    if (isIntegralNode(ref.node) || isApplyOperator(ref.node)) return false;
    if (isDifferentialSymbol(ref.node) || isCallName(ref.node)) return false;
    const glyph = glyphValue(ref.node);
    if (!glyph || glyph.length > 2) return false;
    return /^[A-Za-zα-ωΑ-Ω0-9∞]$/u.test(glyph) || glyph.length === 1;
  }
  const layout = ctx.doc.layouts[layoutId];
  if (!layout) return false;
  if (layout.children.length === 1) {
    return isSimpleBoundLayout(layout.children[0]!, ctx);
  }
  return false;
}

function boundPairLayouts(
  layoutId: string,
  ctx: Ctx,
): [string, string] | undefined {
  const layout = ctx.doc.layouts[layoutId];
  if (!layout) return undefined;
  if (layout.children.length === 1) {
    return boundPairLayouts(layout.children[0]!, ctx);
  }
  const kids = layout.children.filter(
    (id) => !isIntegralSubjectLayout(id, ctx),
  );
  if (kids.length === 2 && kids.every((id) => isSimpleBoundLayout(id, ctx))) {
    return [kids[0]!, kids[1]!];
  }
  if (kids.length === 3) {
    const mid = subjectRef(kids[1]!, ctx.doc);
    const glyph = mid ? glyphValue(mid.node) : "";
    const invisible =
      mid &&
      (mid.node.renderer === "invisible" ||
        glyph === "," ||
        glyph === "" ||
        glyph === " ");
    if (
      isSimpleBoundLayout(kids[0]!, ctx) &&
      isSimpleBoundLayout(kids[2]!, ctx) &&
      invisible
    ) {
      return [kids[0]!, kids[2]!];
    }
  }
  return undefined;
}

function looksLikeIntegrand(layoutId: string, ctx: Ctx): boolean {
  if (isSimpleBoundLayout(layoutId, ctx)) return false;
  if (boundPairLayouts(layoutId, ctx)) return false;
  const ref = subjectRef(layoutId, ctx.doc);
  if (ref) {
    if (isIntegralNode(ref.node)) return false;
    if (
      isApplyOperator(ref.node) ||
      isCallName(ref.node) ||
      isDifferentialSymbol(ref.node)
    ) {
      return true;
    }
    const glyph = glyphValue(ref.node);
    if (glyph.length > 2) return true;
  }
  const layout = ctx.doc.layouts[layoutId];
  if (!layout) return Boolean(ref);
  if (layout.kind === "surround" || layout.kind === "stack") return true;
  return layout.children.some((id) => {
    const child = subjectRef(id, ctx.doc);
    return Boolean(
      child &&
        (isDifferentialSymbol(child.node) ||
          isApplyOperator(child.node) ||
          isCallName(child.node) ||
          looksLikeIntegrand(id, ctx)),
    );
  });
}

function partitionIntegralParts(
  childIds: string[],
  ownerId: string | undefined,
  ctx: Ctx,
): IntegralParts {
  const parts = childIds.filter((id) => !isIntegralSubjectLayout(id, ctx));
  let lower: string | undefined;
  let upper: string | undefined;
  const body: string[] = [];
  const unused: string[] = [];
  for (const id of parts) {
    const slot = childSlotName(id, ownerId, ctx);
    if (INTEGRAL_LOWER_SLOTS.has(slot)) lower = id;
    else if (INTEGRAL_UPPER_SLOTS.has(slot)) upper = id;
    else if (INTEGRAL_BODY_SLOTS.has(slot)) body.push(id);
    else unused.push(id);
  }

  const takePair = (id: string): boolean => {
    const pair = boundPairLayouts(id, ctx);
    if (!pair || lower || upper) return false;
    lower = pair[0];
    upper = pair[1];
    return true;
  };

  if (lower || upper) {
    for (const id of unused) {
      if (!takePair(id)) body.push(id);
    }
    return { lower, upper, body };
  }

  if (unused.length === 1 && takePair(unused[0]!)) {
    return { lower, upper, body };
  }

  if (unused.length === 2) {
    const [left, right] = unused;
    const pairLeft = boundPairLayouts(left!, ctx);
    const pairRight = boundPairLayouts(right!, ctx);
    if (pairRight && (looksLikeIntegrand(left!, ctx) || !pairLeft)) {
      return { lower: pairRight[0], upper: pairRight[1], body: [...body, left!] };
    }
    if (pairLeft && (looksLikeIntegrand(right!, ctx) || !pairRight)) {
      return { lower: pairLeft[0], upper: pairLeft[1], body: [...body, right!] };
    }
    if (isSimpleBoundLayout(left!, ctx) && isSimpleBoundLayout(right!, ctx)) {
      return { lower: left, upper: right, body };
    }
    if (isSimpleBoundLayout(left!, ctx) && looksLikeIntegrand(right!, ctx)) {
      return { lower: left, body: [...body, right!] };
    }
    if (looksLikeIntegrand(left!, ctx) && isSimpleBoundLayout(right!, ctx)) {
      return { upper: right, body: [...body, left!] };
    }
    if (looksLikeIntegrand(left!, ctx) && looksLikeIntegrand(right!, ctx)) {
      return { body: [...body, left!, right!] };
    }
  }

  if (unused.length >= 3) {
    const first = unused[0]!;
    const second = unused[1]!;
    const last = unused[unused.length - 1]!;
    const prev = unused[unused.length - 2]!;
    if (isSimpleBoundLayout(first, ctx) && isSimpleBoundLayout(second, ctx)) {
      return { lower: first, upper: second, body: [...body, ...unused.slice(2)] };
    }
    if (
      looksLikeIntegrand(first, ctx) &&
      isSimpleBoundLayout(prev, ctx) &&
      isSimpleBoundLayout(last, ctx)
    ) {
      return {
        lower: prev,
        upper: last,
        body: [...body, ...unused.slice(0, -2)],
      };
    }
    if (
      looksLikeIntegrand(first, ctx) &&
      isSimpleBoundLayout(second, ctx) &&
      unused[2] &&
      isSimpleBoundLayout(unused[2], ctx)
    ) {
      return {
        lower: second,
        upper: unused[2],
        body: [...body, first, ...unused.slice(3)],
      };
    }
  }

  return { lower, upper, body: [...body, ...unused] };
}

function layoutIntegralParts(
  integralId: string,
  parts: IntegralParts,
  ctx: Ctx,
  em: number,
  gap: number,
): Frag {
  const lower = parts.lower
    ? layoutOf(parts.lower, ctx, scriptScale(em))
    : emptyFrag();
  const upper = parts.upper
    ? layoutOf(parts.upper, ctx, scriptScale(em))
    : emptyFrag();
  const body = parts.body.length
    ? hlist(
        parts.body.map((id) => layoutOf(id, ctx, em)),
        Math.max(0.12 * em, gap),
      )
    : emptyFrag();
  const needed = Math.max(
    delimiterExtent(body, em, "D"),
    body.height + body.depth,
  );
  const limits = attachLimits(
    integralGlyph(integralId, em, needed),
    lower,
    upper,
    em,
  );
  return body.pieces.length
    ? hlist([limits, body], Math.max(0.16 * em, gap))
    : limits;
}

function attachLimits(op: Frag, lower: Frag, upper: Frag, em: number): Frag {
  const { superDy, subDy } = scriptPlacement(
    op,
    { super: upper, sub: lower },
    em,
    "D",
  );
  const isIntegral = op.pieces.some((p) => p.role === "integral");
  const upX = isIntegral ? op.width + 0.12 * em : op.width + 0.02 * em;
  const downX = isIntegral
    ? Math.max(0.18 * em, op.width - 0.45 * em)
    : op.width + 0.02 * em;
  const up = upper.pieces.length ? shift(upper, upX, superDy) : emptyFrag();
  const down = lower.pieces.length ? shift(lower, downX, subDy) : emptyFrag();
  const rightEdge = Math.max(
    op.width,
    upper.pieces.length ? upX + upper.width : 0,
    lower.pieces.length ? downX + lower.width : 0,
  );
  return {
    width: rightEdge + (isIntegral ? 0.08 * em : 0.04 * em),
    height: Math.max(
      op.height,
      upper.pieces.length ? -superDy + upper.height : 0,
    ),
    depth: Math.max(op.depth, lower.pieces.length ? subDy + lower.depth : 0),
    pieces: [...op.pieces, ...up.pieces, ...down.pieces],
  };
}

function tryIntegralFlow(
  childIds: string[],
  ctx: Ctx,
  em: number,
  gap: number,
): Frag | undefined {
  if (childIds.length < 2) return undefined;
  const limitsLayout = ctx.doc.layouts[childIds[0]];
  if (limitsLayout?.kind === "attach" && limitsLayout.children[0]) {
    const base = subjectRef(limitsLayout.children[0], ctx.doc);
    if (base && isIntegralNode(base.node)) {
      const inner = partitionIntegralParts(
        limitsLayout.children,
        base.id,
        ctx,
      );
      return layoutIntegralParts(
        base.id,
        { ...inner, body: [...inner.body, ...childIds.slice(1)] },
        ctx,
        em,
        gap,
      );
    }
  }

  const first = subjectRef(childIds[0], ctx.doc);
  if (first && isIntegralNode(first.node)) {
    return layoutIntegralParts(
      first.id,
      partitionIntegralParts(childIds, first.id, ctx),
      ctx,
      em,
      gap,
    );
  }
  return undefined;
}

function tryPostfixIntegral(
  childIds: string[],
  ctx: Ctx,
  em: number,
  gap: number,
): Frag | undefined {
  if (childIds.length !== 2) return undefined;
  const last = subjectRef(childIds[1], ctx.doc);
  if (!last || !isIntegralNode(last.node)) return undefined;
  const first = subjectRef(childIds[0], ctx.doc);
  if (first && isIntegralNode(first.node)) return undefined;
  return tryBareIntegralPrefix([childIds[1], childIds[0]], ctx, em, gap);
}

function tryBareIntegralPrefix(
  childIds: string[],
  ctx: Ctx,
  em: number,
  gap: number,
): Frag | undefined {
  if (childIds.length < 2) return undefined;
  const firstLayout = ctx.doc.layouts[childIds[0]];
  if (firstLayout?.kind === "attach") return undefined;
  const first = subjectRef(childIds[0], ctx.doc);
  if (!first || !isIntegralNode(first.node)) return undefined;
  for (const id of childIds.slice(1)) {
    const node = subjectRef(id, ctx.doc)?.node;
    if (node && (isIntegralNode(node) || glyphValue(node) === "=")) {
      return undefined;
    }
  }
  const body = hlist(
    childIds.slice(1).map((id) => layoutOf(id, ctx, em)),
    Math.max(0.12 * em, gap),
  );
  const needed = Math.max(
    delimiterExtent(body, em, "D"),
    body.height + body.depth,
  );
  return hlist(
    [integralGlyph(first.id, em, needed), body],
    Math.max(0.16 * em, gap),
  );
}

function integralGlyph(id: string, em: number, extent = 0): Frag {
  const native = integralMetrics(em);
  const span = Math.max(native.extent, extent);
  const box = integralBox(span, em);
  return {
    width: native.width,
    height: box.height,
    depth: box.depth,
    pieces: [
      {
        id: `stretch:${id}:integral`,
        subject: { type: "node", id },
        x: 0,
        dy: 0,
        width: native.width,
        height: box.height,
        depth: box.depth,
        em,
        italic: false,
        text: DELIM_GLYPH.integral,
        role: "integral",
        extent: span,
      },
    ],
  };
}

function layoutIdForNode(nodeId: string, ctx: Ctx): string | undefined {
  const full = `layout-${nodeId}`;
  if (ctx.doc.layouts[full]) return full;
  const subject = `layout-${nodeId}-subject`;
  if (ctx.doc.layouts[subject]) return subject;
  return undefined;
}

function layoutReference(
  nodeId: string,
  node: FormalNode,
  ctx: Ctx,
  em: number,
): Frag {
  const targetId = String(node.attributes?.targetId ?? "").trim();
  if (!targetId || targetId === nodeId) return emptyFrag();
  const layoutId = layoutIdForNode(targetId, ctx);
  if (!layoutId) return emptyFrag();
  return layoutOf(layoutId, ctx, em);
}

function nodeGlyph(id: string, node: FormalNode, em: number): Frag {
  if (node.kind === "reference") return emptyFrag();
  if (node.renderer === "integral" || isIntegralNode(node)) {
    return integralGlyph(id, em);
  }
  const arrow = arrowRole(node);
  if (arrow) {
    const width = delimiterWidth(arrow, em, em);
    const height = 0.28 * em;
    const depth = 0.22 * em;
    return {
      width,
      height,
      depth,
      pieces: [
        {
          id: `stretch:${id}:${arrow}`,
          subject: { type: "node", id },
          x: 0,
          dy: 0,
          width,
          height,
          depth,
          em,
          italic: false,
          text: glyphValue(node),
          role: arrow,
          extent: width,
        },
      ],
    };
  }
  if (node.renderer === "placeholder") {
    const face = glyphFace(glyphValue(node) || "?", em);
    return boxFrag(`node:${id}`, face, em, { type: "node", id }, true);
  }
  if (node.renderer === "invisible") {
    return { width: 0.04 * em, height: 0.6 * em, depth: 0, pieces: [] };
  }
  if (isImplicitProduct(node) && !isProductOperator(node)) {
    return emptyFrag();
  }
  if (
    (node.kind === "container" || isFunctionRenderer(node)) &&
    !glyphValue(node)
  ) {
    return emptyFrag();
  }
  const value = glyphValue(node);
  if (!value || isStructuralLayoutToken(node)) return emptyFrag();
  if (isPowerOperator(node) && value === "^") return emptyFrag();
  const axisOp = axisBinopRole(node);
  if (axisOp) {
    const width = delimiterWidth(axisOp, em, em);
    const reach =
      axisOp === "times" ? 0.22 * em : axisOp === "circ" ? 0.14 * em : 0.06 * em;
    const axis = axisHeight(em);
    return {
      width,
      height: axis + reach,
      depth: Math.max(0, reach - axis),
      pieces: [
        {
          id: `node:${id}`,
          subject: { type: "node", id },
          x: 0,
          dy: 0,
          width,
          height: axis + reach,
          depth: Math.max(0, reach - axis),
          em,
          italic: false,
          text: value,
          role: axisOp,
          extent: width,
        },
      ],
    };
  }
  const roman =
    node.renderer === "chem" ||
    node.contentType === "chem" ||
    node.renderer === "chemical-formula";
  return glyphFrag(`node:${id}`, value, em, { type: "node", id }, roman);
}

function isPrimeGlyph(text: string): boolean {
  return text === "'" || text === "′";
}

function primeFrag(id: string, em: number, subject?: SubjectRef): Frag {
  const width = delimiterWidth("prime", em, em);
  const height = 0.56 * em;
  return {
    width,
    height,
    depth: 0.02 * em,
    pieces: [
      {
        id,
        subject,
        x: 0,
        dy: 0,
        width,
        height,
        depth: 0.02 * em,
        em,
        italic: false,
        text: "'",
        role: "prime",
        extent: height,
      },
    ],
  };
}

function glyphFrag(
  id: string,
  raw: string,
  em: number,
  subject?: SubjectRef,
  roman = false,
): Frag {
  if (isPrimeGlyph(raw)) return primeFrag(id, em, subject);
  const differential = /^(?<op>d|∂)(?<rest>[A-Za-zφϕξθπΔδ])$/.exec(raw);
  if (differential?.groups) {
    return hlist(
      [
        glyphFrag(`${id}:d`, differential.groups.op, em, subject, false),
        glyphFrag(`${id}:var`, differential.groups.rest, em, subject, false),
      ],
      0.02 * em,
    );
  }
  const attached = /^(?<base>[A-Za-zφϕξθπΔδ]+)(?<marks>'+)$/.exec(raw);
  if (attached?.groups) {
    let frag = glyphFrag(`${id}:base`, attached.groups.base, em, subject, roman);
    const marks = attached.groups.marks.length;
    for (let index = 0; index < marks; index += 1) {
      frag = layoutSuperscript(
        frag,
        primeFrag(`${id}:prime${index}`, scriptScale(em), subject),
        em,
      );
    }
    return frag;
  }
  const face = glyphFace(raw, em, roman);
  return boxFrag(id, face, em, subject, false);
}

function boxFrag(
  id: string,
  face: ReturnType<typeof glyphFace>,
  em: number,
  subject: SubjectRef | undefined,
  boxed: boolean,
): Frag {
  const pad = boxed ? 0.12 * em : 0;
  const lift = glyphAxisLift(face.text, em);
  return {
    width: face.width + pad * 2,
    height: face.height + pad + Math.max(0, -lift),
    depth: face.depth + pad + Math.max(0, lift),
    pieces: [
      {
        id,
        subject,
        x: pad,
        dy: lift,
        width: face.width,
        height: face.height,
        depth: face.depth,
        em,
        italic: face.italic,
        text: face.text,
        role: undefined,
        extent: 0,
      },
    ],
  };
}

function emptyFrag(): Frag {
  return { width: 0, height: 0, depth: 0, pieces: [] };
}

function hlist(items: Frag[], gap: number): Frag {
  const present = items.filter((item) => item.width > 0 || item.pieces.length);
  let x = 0;
  const pieces: Piece[] = [];
  let height = 0;
  let depth = 0;
  let prevItalic = false;
  for (const [index, item] of present.entries()) {
    const next = present[index + 1];
    const em = item.pieces[0]?.em ?? DEFAULT_EM;
    const italicCorr =
      prevItalic && !item.pieces[0]?.role ? 0.08 * em : 0;
    const placed = shift(item, x + italicCorr, 0);
    pieces.push(...placed.pieces);
    height = Math.max(height, item.height);
    depth = Math.max(depth, item.depth);
    x += italicCorr + item.width;
    if (next) {
      x += Math.max(
        gap,
        texSpace(fragAtom(item, "end"), fragAtom(next, "start"), em),
      );
    }
    prevItalic = item.pieces.some((piece) => piece.italic && !piece.role);
  }
  return { width: x, height, depth, pieces };
}

function fragAtom(item: Frag, side: "start" | "end") {
  const piece =
    side === "start" ? item.pieces[0] : item.pieces[item.pieces.length - 1];
  return mathAtom(piece?.text ?? "", piece?.role);
}

function vlist(rows: Frag[], gap: number, centerOnAxis: boolean): Frag {
  const present = rows.filter((row) => row.width > 0 || row.pieces.length);
  if (!present.length) return emptyFrag();
  const width = Math.max(...present.map((row) => row.width));
  let cursor = 0;
  const pieces: Piece[] = [];
  for (const [index, row] of present.entries()) {
    const x = 0;
    const baseline = cursor + row.height;
    pieces.push(...shift(row, x, baseline).pieces);
    cursor = baseline + row.depth;
    if (index < present.length - 1) cursor += gap;
  }
  const mid = cursor / 2;
  const axis = 0;
  const shiftY = centerOnAxis ? axis - mid : 0;
  return {
    width,
    height: mid - shiftY,
    depth: cursor - mid + shiftY,
    pieces: pieces.map((piece) => ({ ...piece, dy: piece.dy + shiftY })),
  };
}

function shift(frag: Frag, dx: number, dy: number): Frag {
  return {
    ...frag,
    pieces: frag.pieces.map((piece) => ({
      ...piece,
      x: piece.x + dx,
      dy: piece.dy + dy,
    })),
  };
}

function packScene(
  primitives: MotionPrimitive[],
  padding: number,
): MotionScene {
  if (primitives.length === 0) {
    return { width: padding * 2, height: padding * 2, primitives, hits: [] };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const primitive of primitives) {
    const ink = inkOf(primitive);
    minX = Math.min(minX, ink.left);
    minY = Math.min(minY, ink.top);
    maxX = Math.max(maxX, ink.right);
    maxY = Math.max(maxY, ink.bottom);
  }
  const dx = padding - minX;
  const dy = padding - minY;
  const packed =
    Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05
      ? primitives
      : primitives.map((primitive) => ({
          ...primitive,
          x: primitive.x + dx,
          y: primitive.y + dy,
        }));
  return {
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
    primitives: packed,
    hits: hitsFromPrimitives(packed),
  };
}

function inkOf(primitive: MotionPrimitive): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  if (
    primitive.role === "cdot" ||
    primitive.role === "times" ||
    primitive.role === "circ"
  ) {
    const axis = axisHeight(primitive.em);
    const half =
      primitive.role === "times"
        ? 0.22 * primitive.em
        : primitive.role === "circ"
          ? 0.14 * primitive.em
          : 0.06 * primitive.em;
    const cy = primitive.y - axis;
    return {
      left: primitive.x,
      top: cy - half,
      right: primitive.x + primitive.width,
      bottom: cy + half,
    };
  }
  return {
    left: primitive.x,
    top: primitive.y - primitive.height,
    right: primitive.x + primitive.width,
    bottom: primitive.y + primitive.depth,
  };
}

function placedMinDy(frag: Frag): number {
  if (!frag.pieces.length) return 0;
  return Math.min(...frag.pieces.map((piece) => piece.dy - piece.height));
}

export function hitsFromPrimitives(
  primitives: MotionPrimitive[],
): MotionHitRegion[] {
  const grouped = new Map<string, MotionHitRegion>();
  for (const primitive of primitives) {
    if (!primitive.subject) continue;
    const key = `${primitive.subject.type}:${primitive.subject.id}`;
    const ink = inkOf(primitive);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        subject: primitive.subject,
        x: ink.left,
        y: ink.top,
        width: ink.right - ink.left,
        height: ink.bottom - ink.top,
      });
      continue;
    }
    const left = Math.min(current.x, ink.left);
    const top = Math.min(current.y, ink.top);
    const right = Math.max(current.x + current.width, ink.right);
    const bottom = Math.max(current.y + current.height, ink.bottom);
    grouped.set(key, {
      subject: primitive.subject,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }
  return [...grouped.values()];
}

export type MotionEmphasisBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function subjectKey(subject: SubjectRef) {
  return `${subject.type}:${subject.id}`;
}

export function expandedEmphasisNodeIds(
  doc: FormalDocument,
  subject: SubjectRef,
): Set<string> {
  if (subject.type !== "node" || !doc.nodes[subject.id]) return new Set();
  return new Set(collectFormalSubtree(doc, subject.id, "expression"));
}

export function primitiveMatchesEmphasis(
  primitive: MotionPrimitive,
  doc: FormalDocument,
  nodeIds: Set<string>,
  exactKey: string,
): boolean {
  if (!primitive.subject) return false;
  if (subjectKey(primitive.subject) === exactKey) return true;
  if (primitive.subject.type === "node") {
    return nodeIds.has(primitive.subject.id);
  }
  if (primitive.subject.type === "layout") {
    const first = firstSubject(primitive.subject.id, doc);
    return Boolean(first && nodeIds.has(first));
  }
  return false;
}

export function primitiveCoveredByEmphasis(
  primitive: MotionPrimitive,
  doc: FormalDocument,
  subjects: SubjectRef[],
): boolean {
  for (const subject of subjects) {
    if (
      primitiveMatchesEmphasis(
        primitive,
        doc,
        expandedEmphasisNodeIds(doc, subject),
        subjectKey(subject),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** First emphasis target whose subtree covers this glyph (parent product, not only ·). */
export function highlightForCoveredPrimitive<T extends { subject: SubjectRef }>(
  primitive: MotionPrimitive,
  doc: FormalDocument,
  targets: readonly T[],
): T | undefined {
  for (const target of targets) {
    if (primitiveCoveredByEmphasis(primitive, doc, [target.subject])) {
      return target;
    }
  }
  return undefined;
}

/** Padded ink union for a focus/highlight target. Overlay only — does not reflow. */
export function emphasisBoxForSubject(
  doc: FormalDocument,
  primitives: MotionPrimitive[],
  subject: SubjectRef,
): MotionEmphasisBox | undefined {
  const exactKey = subjectKey(subject);
  const nodeIds = expandedEmphasisNodeIds(doc, subject);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let em = DEFAULT_EM;
  let found = false;
  for (const primitive of primitives) {
    if (!primitiveMatchesEmphasis(primitive, doc, nodeIds, exactKey)) continue;
    const ink = inkOf(primitive);
    found = true;
    em = primitive.em;
    minX = Math.min(minX, ink.left);
    minY = Math.min(minY, ink.top);
    maxX = Math.max(maxX, ink.right);
    maxY = Math.max(maxY, ink.bottom);
  }
  if (!found) return undefined;
  const pad = em * 0.18;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}
