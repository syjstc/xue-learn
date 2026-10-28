import type { LatexSyntaxNode, SourceRange } from "./types.js";

/**
 * In-house CJS syntax parse with unified-latex-shaped nodes (groups, macros,
 * scripts, source ranges). Nest ts-node cannot require ESM
 * `@unified-latex/unified-latex-util-parse`.
 */

const MACRO_ARGS: Record<string, { optional: boolean; required: number }> = {
  frac: { optional: false, required: 2 },
  dfrac: { optional: false, required: 2 },
  tfrac: { optional: false, required: 2 },
  sqrt: { optional: true, required: 1 },
  mathrm: { optional: false, required: 1 },
  mathbf: { optional: false, required: 1 },
  mathbb: { optional: false, required: 1 },
  mathcal: { optional: false, required: 1 },
  mathit: { optional: false, required: 1 },
  mathsf: { optional: false, required: 1 },
  mathtt: { optional: false, required: 1 },
  text: { optional: false, required: 1 },
  textrm: { optional: false, required: 1 },
  textbf: { optional: false, required: 1 },
  operatorname: { optional: false, required: 1 },
  overline: { optional: false, required: 1 },
  underline: { optional: false, required: 1 },
  hat: { optional: false, required: 1 },
  widehat: { optional: false, required: 1 },
  bar: { optional: false, required: 1 },
  vec: { optional: false, required: 1 },
  tilde: { optional: false, required: 1 },
  widetilde: { optional: false, required: 1 },
  dot: { optional: false, required: 1 },
  ddot: { optional: false, required: 1 },
  boxed: { optional: false, required: 1 },
  overset: { optional: false, required: 2 },
  underset: { optional: false, required: 2 },
  binom: { optional: false, required: 2 },
};

export function parseLatexSyntax(source: string): {
  root: LatexSyntaxNode;
  balanced: boolean;
} {
  const stripped = stripMathDelimiters(source);
  const lexer = new Lexer(stripped.text, stripped.offset);
  const children: LatexSyntaxNode[] = [];
  let balanced = true;
  try {
    children.push(...parseUntil(lexer, () => lexer.eof()));
  } catch {
    balanced = false;
  }
  if (!lexer.eof()) balanced = false;
  return {
    balanced: balanced && lexer.balance === 0,
    root: {
      kind: "root",
      children,
      source: { start: 0, end: source.length },
    },
  };
}

function stripMathDelimiters(source: string): { text: string; offset: number } {
  const trimmed = source.trim();
  if (
    (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) ||
    (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) ||
    (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2)
  ) {
    const startPad = trimmed.startsWith("$$")
      ? 2
      : trimmed.startsWith("\\[")
        ? 2
        : 1;
    const endPad = startPad;
    const innerStart = source.indexOf(trimmed) + startPad;
    const inner = trimmed.slice(startPad, trimmed.length - endPad);
    return { text: inner, offset: innerStart };
  }
  return { text: source, offset: 0 };
}

class Lexer {
  i = 0;
  balance = 0;
  constructor(
    readonly text: string,
    readonly offset: number,
  ) {}

  eof() {
    return this.i >= this.text.length;
  }

  pos() {
    return this.offset + this.i;
  }

  peek(n = 0) {
    return this.text[this.i + n] ?? "";
  }

  skipIgnored() {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === "%") {
        while (!this.eof() && this.peek() !== "\n") this.i += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        this.i += 1;
        continue;
      }
      break;
    }
  }

  startsCommand(): boolean {
    return this.peek() === "\\";
  }
}

function range(start: number, end: number): SourceRange {
  return { start, end };
}

function parseUntil(
  lexer: Lexer,
  stop: () => boolean,
): LatexSyntaxNode[] {
  const nodes: LatexSyntaxNode[] = [];
  while (!lexer.eof() && !stop()) {
    const node = parseItem(lexer);
    if (!node) break;
    nodes.push(node);
  }
  return nodes;
}

function parseItem(lexer: Lexer): LatexSyntaxNode | null {
  lexer.skipIgnored();
  if (lexer.eof()) return null;
  const start = lexer.pos();
  const ch = lexer.peek();
  if (ch === "{") return parseGroup(lexer);
  if (ch === "^" || ch === "_") {
    lexer.i += 1;
    const arg = parseArgument(lexer);
    return {
      kind: ch === "^" ? "superscript" : "subscript",
      children: arg ? [arg] : [],
      source: range(start, lexer.pos()),
    };
  }
  if (ch === "\\") return parseMacro(lexer);
  if (ch === "}") return null;
  if (/[0-9]/.test(ch)) {
    let value = "";
    while (/[0-9.]/.test(lexer.peek())) {
      value += lexer.peek();
      lexer.i += 1;
    }
    return { kind: "string", value, source: range(start, lexer.pos()) };
  }
  lexer.i += 1;
  return { kind: "string", value: ch, source: range(start, lexer.pos()) };
}

function parseGroup(lexer: Lexer): LatexSyntaxNode {
  const start = lexer.pos();
  lexer.i += 1;
  lexer.balance += 1;
  const children = parseUntil(lexer, () => lexer.peek() === "}" || lexer.eof());
  if (lexer.peek() !== "}") {
    throw new Error("unbalanced brace");
  }
  lexer.i += 1;
  lexer.balance -= 1;
  return { kind: "group", children, source: range(start, lexer.pos()) };
}

function parseArgument(lexer: Lexer): LatexSyntaxNode | null {
  lexer.skipIgnored();
  if (lexer.peek() === "{") return parseGroup(lexer);
  return parseItem(lexer);
}

function parseOptional(lexer: Lexer): LatexSyntaxNode | undefined {
  lexer.skipIgnored();
  if (lexer.peek() !== "[") return undefined;
  const start = lexer.pos();
  lexer.i += 1;
  const children = parseUntil(lexer, () => lexer.peek() === "]" || lexer.eof());
  if (lexer.peek() === "]") lexer.i += 1;
  return { kind: "group", children, source: range(start, lexer.pos()) };
}

function parseMacro(lexer: Lexer): LatexSyntaxNode {
  const start = lexer.pos();
  lexer.i += 1;
  let name = "";
  if (/[a-zA-Z]/.test(lexer.peek())) {
    while (/[a-zA-Z]/.test(lexer.peek())) {
      name += lexer.peek();
      lexer.i += 1;
    }
  } else {
    name = lexer.peek() || " ";
    lexer.i += 1;
  }
  if (name === "begin") return parseEnvironment(lexer, start);
  if (name === "left") return parseLeftRight(lexer, start);
  const spec = MACRO_ARGS[name];
  let optionalArg: LatexSyntaxNode | undefined;
  const args: LatexSyntaxNode[] = [];
  if (spec?.optional) optionalArg = parseOptional(lexer);
  const required = spec?.required ?? 0;
  for (let i = 0; i < required; i += 1) {
    const arg = parseArgument(lexer);
    if (arg) args.push(arg);
  }
  return {
    kind: "macro",
    name,
    args,
    optionalArg,
    source: range(start, lexer.pos()),
  };
}

function parseEnvironment(lexer: Lexer, start: number): LatexSyntaxNode {
  const nameArg = parseArgument(lexer);
  const name =
    nameArg?.kind === "group"
      ? (nameArg.children ?? [])
          .map((child) => child.value ?? "")
          .join("")
      : "";
  const children = parseUntil(lexer, () => {
    if (!lexer.startsCommand()) return false;
    const saved = lexer.i;
    lexer.i += 1;
    let cmd = "";
    while (/[a-zA-Z]/.test(lexer.peek())) {
      cmd += lexer.peek();
      lexer.i += 1;
    }
    const isEnd = cmd === "end";
    lexer.i = saved;
    return isEnd;
  });
  if (lexer.startsCommand()) {
    lexer.i += 1;
    while (/[a-zA-Z]/.test(lexer.peek())) lexer.i += 1;
    parseArgument(lexer);
  }
  return {
    kind: "environment",
    name,
    children,
    source: range(start, lexer.pos()),
  };
}

function parseLeftRight(lexer: Lexer, start: number): LatexSyntaxNode {
  lexer.skipIgnored();
  const left = lexer.peek();
  if (left) lexer.i += 1;
  const children = parseUntil(lexer, () => {
    if (!lexer.startsCommand()) return false;
    const saved = lexer.i;
    lexer.i += 1;
    let cmd = "";
    while (/[a-zA-Z]/.test(lexer.peek())) {
      cmd += lexer.peek();
      lexer.i += 1;
    }
    const isRight = cmd === "right";
    lexer.i = saved;
    return isRight;
  });
  let right = "";
  if (lexer.startsCommand()) {
    lexer.i += 1;
    while (/[a-zA-Z]/.test(lexer.peek())) lexer.i += 1;
    lexer.skipIgnored();
    right = lexer.peek();
    if (right) lexer.i += 1;
  }
  return {
    kind: "group",
    name: "leftright",
    value: `${left}${right}`,
    children,
    source: range(start, lexer.pos()),
  };
}
