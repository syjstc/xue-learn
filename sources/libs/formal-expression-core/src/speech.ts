import {
  normalizeFormalGlyph,
  type AuthoringTree,
} from "./authoring.js";

function treeRenderer(tree: AuthoringTree): string {
  return "renderer" in tree && typeof tree.renderer === "string"
    ? tree.renderer
    : "";
}

const GREEK: Record<string, string> = {
  α: "阿尔法",
  β: "贝塔",
  γ: "伽马",
  δ: "德尔塔",
  ε: "伊普西龙",
  θ: "西塔",
  λ: "兰姆达",
  μ: "缪",
  ξ: "克西",
  π: "派",
  σ: "西格马",
  φ: "斐",
  ϕ: "斐",
  ψ: "普西",
  ω: "欧米伽",
  Δ: "大德尔塔",
  Γ: "大伽马",
  Σ: "大西格马",
  Φ: "大斐",
  Ω: "大欧米伽",
};

const OPERATOR_WORDS: Record<string, string> = {
  "+": "加",
  "-": "减",
  "−": "减",
  "=": "等于",
  "≠": "不等于",
  "<": "小于",
  ">": "大于",
  "≤": "小于等于",
  "≥": "大于等于",
  "×": "乘",
  "·": "乘",
  "⋅": "乘",
  "*": "乘",
  "∗": "乘",
  "∘": "复合",
  "∈": "属于",
  "∉": "不属于",
  "→": "趋向",
  "←": "从",
  "⊂": "包含于",
  "⊃": "包含",
  "∩": "交",
  "∪": "并",
  "∧": "且",
  "∨": "或",
  "⇒": "蕴含",
  "⇔": "等价于",
  "↔": "当且仅当",
  "⊢": "推出",
  "⊨": "满足",
  "⟹": "蕴含",
  "⟺": "等价于",
  "±": "正负",
  "≈": "约等于",
  "≡": "恒等于",
  "∣": "整除",
};

const LARGE_OP: Record<string, string> = {
  lim: "极限",
  limit: "极限",
  max: "最大",
  min: "最小",
  inf: "下确界",
  sup: "上确界",
  sum: "求和",
  prod: "连乘",
  "∑": "求和",
  "∏": "连乘",
};

const PRODUCT = new Set(["×", "·", "⋅", "*", "∗", "mul", "multiply"]);
const ADDITIVE = new Set(["+", "-", "−"]);
const APPLY = new Set(["apply", "call"]);
const POWER_RENDERERS = new Set([
  "superscript",
  "super",
  "power",
  "supscript",
  "exponent",
]);
const DIVISION = new Set(["/", "÷", "／"]);

function joinSpoken(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("");
}

function isSimpleTree(tree: AuthoringTree): boolean {
  if (tree.kind === "token") return true;
  if (tree.kind === "placeholder") return true;
  if (tree.kind === "container" && (tree.renderer === "group" || tree.layout?.kind === "surround")) {
    return tree.slots.length === 1 && tree.slots[0]
      ? isSimpleTree(tree.slots[0].node)
      : false;
  }
  return false;
}

function speakGlyph(value: unknown): string {
  const glyph = normalizeFormalGlyph(value);
  if (!glyph) return "";
  if (GREEK[glyph]) return GREEK[glyph];
  if (OPERATOR_WORDS[glyph]) return OPERATOR_WORDS[glyph];
  if (LARGE_OP[glyph] || LARGE_OP[glyph.toLowerCase()]) {
    return LARGE_OP[glyph] ?? LARGE_OP[glyph.toLowerCase()] ?? glyph;
  }
  if (glyph === "∞") return "无穷";
  if (glyph === "∅") return "空集";
  if (glyph === "'" || glyph === "′") return "撇";
  if (glyph === "∫") return "积分";
  if (glyph === "∬") return "二重积分";
  if (glyph === "∭") return "三重积分";
  if (glyph === "∮") return "环路积分";
  if (glyph === "√") return "根号";
  if (glyph === "∂") return "偏导";
  if (glyph === "―") return "";
  if (APPLY.has(glyph)) return "";
  return glyph;
}

function slotNamed(tree: Extract<AuthoringTree, { kind: "container" }>, name: string) {
  return tree.slots.find((slot) => slot.name === name)?.node;
}

function speakApply(tree: Extract<AuthoringTree, { kind: "operator" | "container" }>): string {
  const callee =
    tree.kind === "operator" ? tree.operands[0]?.node : tree.slots[0]?.node;
  const args =
    tree.kind === "operator"
      ? tree.operands.slice(1).map((item) => item.node)
      : tree.slots.slice(1).map((item) => item.node);
  const name = callee ? speakTree(callee, { skipGroup: true }) : "";
  if (args.length === 1 && args[0] && isSimpleTree(args[0])) {
    return joinSpoken([name, "在", speakTree(args[0], { skipGroup: true }), "处"]);
  }
  const inner = joinSpoken(
    args.flatMap((arg, index) =>
      index === 0 ? [speakTree(arg, { skipGroup: true })] : ["，", speakTree(arg, { skipGroup: true })],
    ),
  );
  return joinSpoken([name, "括号", inner, "括号关"]);
}

function speakPower(base: AuthoringTree, exponent: AuthoringTree): string {
  const spokenBase = speakTree(base);
  const spokenExp = speakTree(exponent, { skipGroup: true });
  if (spokenExp === "2") return joinSpoken([spokenBase, "的平方"]);
  if (spokenExp === "3") return joinSpoken([spokenBase, "的立方"]);
  return joinSpoken([spokenBase, "的", spokenExp, "次方"]);
}

function speakFraction(numerator: AuthoringTree, denominator: AuthoringTree): string {
  if (isSimpleTree(numerator) && isSimpleTree(denominator)) {
    return joinSpoken([
      speakTree(denominator, { skipGroup: true }),
      "分之",
      speakTree(numerator, { skipGroup: true }),
    ]);
  }
  return joinSpoken([
    speakTree(numerator),
    "除以",
    speakTree(denominator),
  ]);
}

function speakScripts(tree: Extract<AuthoringTree, { kind: "container" }>): string {
  const base = slotNamed(tree, "base") ?? tree.slots[0]?.node;
  const sub = slotNamed(tree, "sub") ?? slotNamed(tree, "subscript");
  const sup = slotNamed(tree, "super") ?? slotNamed(tree, "sup") ?? slotNamed(tree, "superscript");
  const parts = [base ? speakTree(base) : ""];
  if (sub) parts.push("下标", speakTree(sub, { skipGroup: true }));
  if (sup) {
    const spokenExp = speakTree(sup, { skipGroup: true });
    if (spokenExp === "2") parts.push("的平方");
    else if (spokenExp === "3") parts.push("的立方");
    else parts.push("的", spokenExp, "次方");
  }
  return joinSpoken(parts);
}

function isApplyTree(tree: AuthoringTree): boolean {
  const renderer = treeRenderer(tree).toLowerCase();
  if (renderer === "function" || renderer === "apply" || renderer === "call") {
    return true;
  }
  if (tree.kind !== "operator") return false;
  return APPLY.has(normalizeFormalGlyph(tree.token));
}

function isPrimeTree(tree: AuthoringTree): boolean {
  if (tree.kind !== "operator") return false;
  const glyph = normalizeFormalGlyph(tree.token);
  return glyph === "'" || glyph === "′";
}

function isPowerTree(tree: AuthoringTree): boolean {
  const renderer = treeRenderer(tree).toLowerCase();
  if (POWER_RENDERERS.has(renderer)) return true;
  if (tree.kind !== "operator") return false;
  return normalizeFormalGlyph(tree.token) === "^";
}

function speakOperator(tree: Extract<AuthoringTree, { kind: "operator" }>): string {
  if (isApplyTree(tree)) return speakApply(tree);
  if (isPrimeTree(tree)) {
    const base = tree.operands[0]?.node;
    const extra = tree.operands.slice(1);
    return joinSpoken([
      base ? speakTree(base) : "",
      "撇",
      ...extra.map((item) => speakTree(item.node)),
    ]);
  }
  if (isPowerTree(tree) && tree.operands[0] && tree.operands[1]) {
    return speakPower(tree.operands[0].node, tree.operands[1].node);
  }
  const glyph = normalizeFormalGlyph(tree.token);
  if (DIVISION.has(glyph) && tree.operands.length === 2 && tree.operands[0] && tree.operands[1]) {
    return speakFraction(tree.operands[0].node, tree.operands[1].node);
  }
  const operands = tree.operands.map((item) => item.node);
  if (tree.renderer === "integral" || glyph === "∫") {
    return joinSpoken(["积分", ...operands.map((node) => speakTree(node))]);
  }
  const word = speakGlyph(tree.token);
  if (operands.length === 0) return word;
  if (operands.length === 1) {
    if (ADDITIVE.has(glyph)) return joinSpoken(["负", speakTree(operands[0]!)]);
    return joinSpoken([word, speakTree(operands[0]!)]);
  }
  if (PRODUCT.has(glyph) || tree.renderer === "invisible") {
    return joinSpoken(
      operands.flatMap((node, index) =>
        index === 0 ? [speakTree(node)] : ["乘", speakTree(node)],
      ),
    );
  }
  return joinSpoken(
    operands.flatMap((node, index) =>
      index === 0 ? [speakTree(node)] : [word, speakTree(node)],
    ),
  );
}

function speakContainer(
  tree: Extract<AuthoringTree, { kind: "container" }>,
  options: { skipGroup?: boolean },
): string {
  const renderer = (tree.renderer ?? "").toLowerCase();
  if (renderer === "fraction") {
    const numerator = slotNamed(tree, "numerator") ?? tree.slots[0]?.node;
    const denominator =
      slotNamed(tree, "denominator") ??
      tree.slots.find((slot) => slot.name !== "separator" && slot.node !== numerator)
        ?.node;
    if (numerator && denominator) return speakFraction(numerator, denominator);
  }
  if (renderer === "board") {
    return tree.slots
      .map((slot) => speakTree(slot.node))
      .filter(Boolean)
      .join("。同时，");
  }
  if (renderer === "group" || tree.layout?.kind === "surround") {
    const inner = tree.slots
      .map((slot) => speakTree(slot.node, { skipGroup: true }))
      .filter(Boolean)
      .join("");
    if (options.skipGroup || renderer === "group") {
      return options.skipGroup ? inner : joinSpoken(["括号", inner, "括号关"]);
    }
    const left = String(tree.layout?.props?.left ?? "(");
    if (left === "(" || left === "[" || left === "{") {
      return joinSpoken(["括号", inner, "括号关"]);
    }
    return inner;
  }
  if (renderer === "radical" || renderer === "sqrt" || renderer === "root") {
    const radicand = slotNamed(tree, "radicand") ?? tree.slots[0]?.node;
    return joinSpoken(["根号", radicand ? speakTree(radicand, { skipGroup: true }) : ""]);
  }
  if (renderer === "scripts") return speakScripts(tree);
  if (renderer === "lim" || renderer === "limit") {
    const approach =
      slotNamed(tree, "approach") ?? slotNamed(tree, "sub") ?? tree.slots[0]?.node;
    const value = slotNamed(tree, "value") ?? tree.slots[1]?.node;
    return joinSpoken([
      "当",
      approach ? speakTree(approach) : "",
      "时",
      value ? speakTree(value) : "",
      "的极限",
    ]);
  }
  if (isApplyTree(tree)) return speakApply(tree);
  return joinSpoken(
    tree.slots
      .filter((slot) => treeRenderer(slot.node) !== "fraction-bar")
      .map((slot) => speakTree(slot.node)),
  );
}

function speakTree(
  tree: AuthoringTree,
  options: { skipGroup?: boolean } = {},
): string {
  if (tree.kind === "token") return speakGlyph(tree.value);
  if (tree.kind === "placeholder") return tree.label?.trim() || "空位";
  if (tree.kind === "reference") return "";
  if (tree.kind === "operator") return speakOperator(tree);
  return speakContainer(tree, options);
}

/**
 * Deterministic Chinese classroom reading of an authored formula tree.
 * Disabled for now.
 */
export function speakAuthoringTree(_tree: AuthoringTree): string {
  return "";
}
