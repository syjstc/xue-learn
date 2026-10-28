import { hashSource } from "./hash.js";
import { parseLatexSyntax } from "./syntax.js";
import { mergeRanges, nodeFingerprint } from "./tree.js";
import type {
  ChildRole,
  DisplayAttachment,
  FormulaAnalysis,
  FormulaChild,
  FormulaDiagnostic,
  FormulaNode,
  FormulaNodeKind,
  LatexSyntaxNode,
  ParseStatus,
  SourceRange,
  SymbolContext,
  SymbolKind,
} from "./types.js";
import { ANALYZER_VERSION, PARSER_VERSION } from "./versions.js";

const NAMED_FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "arccot",
  "sinh",
  "cosh",
  "tanh",
  "ln",
  "log",
  "exp",
  "det",
  "dim",
  "ker",
  "gcd",
  "lcm",
  "min",
  "max",
  "arg",
  "deg",
  "Pr",
]);

const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  partial: "∂",
  ell: "ℓ",
  hbar: "ℏ",
};

const LOGICAL_RELATIONS = new Set([
  "iff", "implies", "Rightarrow", "Leftrightarrow", "Longrightarrow", "Longleftrightarrow",
]);
const RELATIONS = new Set([
  "=",
  "<",
  ">",
  "neq",
  "ne",
  "leq",
  "le",
  "geq",
  "ge",
  "approx",
  "equiv",
  "in",
  "notin",
  "subset",
  "subseteq",
  "sim",
  "simeq",
  "cong",
  "propto",
  "to",
  "rightarrow",
  "mapsto",
  "iff",
  "implies",
  "Rightarrow",
  "Leftrightarrow",
  "neq",
  ...LOGICAL_RELATIONS,
]);

const MUL_OPS = new Set(["cdot", "times", "*", "oslash", "odot"]);
const ADD_OPS = new Set(["+", "-"]);
const SKIP_MACROS = new Set([
  ",",
  ";",
  ":",
  "!",
  " ",
  "quad",
  "qquad",
  "hspace",
  "vspace",
  "displaystyle",
  "textstyle",
  "scriptstyle",
  "nolimits",
  "limits",
]);

type Atom =
  | { type: "node"; node: FormulaNode }
  | { type: "op"; op: string; source: SourceRange }
  | { type: "rel"; op: string; source: SourceRange }
  | { type: "open"; delim: string; source: SourceRange }
  | { type: "close"; delim: string; source: SourceRange }
  | { type: "func"; name: string; source: SourceRange }
  | { type: "script"; kind: "sup" | "sub"; node: FormulaNode; source: SourceRange };

class Factory {
  variables = new Set<string>();
  private nextId = 1;
  node(input: {
    kind: FormulaNodeKind;
    operator?: string;
    value?: string;
    children?: readonly FormulaChild[];
    sourceRanges: readonly SourceRange[];
    parseStatus?: ParseStatus;
    display?: readonly DisplayAttachment[];
    opaqueKey?: string;
  }): FormulaNode {
    const children = input.children ?? [];
    const parseStatus = input.parseStatus ?? inheritStatus(children);
    const node: FormulaNode = {
      nodeId: `n${this.nextId}`,
      kind: input.kind,
      operator: input.operator,
      value: input.value,
      children,
      sourceRanges: mergeRanges(input.sourceRanges),
      parseStatus,
      fingerprint: "",
      display: input.display,
    };
    this.nextId += 1;
    const fingerprint = nodeFingerprint({
      kind: node.kind,
      operator: node.operator,
      value: node.value,
      parseStatus: node.parseStatus,
      children: node.children,
      opaqueKey: input.opaqueKey ?? sliceRanges(node.sourceRanges),
    });
    return { ...node, fingerprint };
  }
}

function inheritStatus(children: readonly FormulaChild[]): ParseStatus {
  if (children.some((child) => child.node.parseStatus === "opaque")) {
    return "recognized";
  }
  if (children.some((child) => child.node.parseStatus === "ambiguous")) {
    return "ambiguous";
  }
  return "recognized";
}

function sliceRanges(ranges: readonly SourceRange[]): string {
  return ranges.map((range) => `${range.start}:${range.end}`).join(",");
}

function src(node: LatexSyntaxNode): SourceRange {
  return node.source;
}

function flatten(node: LatexSyntaxNode | undefined): LatexSyntaxNode[] {
  if (!node) return [];
  if (node.kind === "group" || node.kind === "root") {
    return [...(node.children ?? [])];
  }
  return [node];
}

export function analyzeFormula(
  source: string,
  symbolContext: SymbolContext = {},
): FormulaAnalysis {
  const diagnostics: FormulaDiagnostic[] = [];
  const { root: syntax, balanced } = parseLatexSyntax(source);
  const factory = new Factory();
  const declared = new Map<string, SymbolKind>();
  for (const symbol of symbolContext.symbols ?? []) {
    // Greek declarations may use their TeX spelling, command name or glyph.
    // The written formula stays untouched; declarations only resolve meaning.
    const styled = symbol.name.match(/^\\?(?:mathrm|mathbf|mathbb|mathcal|mathit|mathsf|mathtt)\s*(?:\{\s*([A-Za-z]+)\s*\}|([A-Za-z]))$/);
    const name = styled?.[1] ?? styled?.[2] ?? GREEK[symbol.name.replace(/^\\/, "")] ?? symbol.name;
    declared.set(name, symbol.kind);
    if (symbol.kind === "variable") factory.variables.add(name);
  }
  let root: FormulaNode;
  let syntaxStatus: FormulaAnalysis["syntaxStatus"] = balanced ? "ok" : "invalid";
  try {
    const atoms = syntaxToAtoms(syntax, factory, declared, diagnostics);
    root = parseExpression(atoms, factory, diagnostics) ?? opaqueAll(factory, source, syntax);
  } catch {
    syntaxStatus = "invalid";
    root = opaqueAll(factory, source, syntax);
  }
  if (!balanced) {
    diagnostics.push({
      code: "unbalanced_tex",
      message: "LaTeX grouping is unbalanced.",
    });
    syntaxStatus = "invalid";
  }
  const analysisStatus = statusOf(root);
  return {
    source,
    sourceHash: hashSource(source),
    parserVersion: PARSER_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    syntax,
    root,
    analysisStatus,
    syntaxStatus,
    diagnostics,
  };
}

function statusOf(root: FormulaNode): FormulaAnalysis["analysisStatus"] {
  if (root.parseStatus === "opaque" && root.kind === "opaque") return "opaque";
  let opaque = false;
  let ambiguous = false;
  const visit = (node: FormulaNode) => {
    if (node.parseStatus === "opaque") opaque = true;
    if (node.parseStatus === "ambiguous") ambiguous = true;
    for (const child of node.children) visit(child.node);
  };
  visit(root);
  if (opaque || ambiguous) return "partial";
  return "complete";
}

function opaqueAll(
  factory: Factory,
  source: string,
  syntax: LatexSyntaxNode,
): FormulaNode {
  return factory.node({
    kind: "opaque",
    value: source,
    sourceRanges: [syntax.source],
    parseStatus: "opaque",
    opaqueKey: source,
  });
}

function syntaxToAtoms(
  node: LatexSyntaxNode,
  factory: Factory,
  declared: Map<string, SymbolKind>,
  diagnostics: FormulaDiagnostic[],
): Atom[] {
  if (node.kind === "root" || node.kind === "group") {
    const inner: Atom[] = [];
    for (const child of node.children ?? []) {
      const atoms = syntaxToAtoms(child, factory, declared, diagnostics);
      // TeX braces after a named function are its argument boundary. Keep
      // that source span without changing ordinary script/numerator paths.
      if (child.kind === 'group' && !child.name && inner.at(-1)?.type === 'func') {
        const argument = parseExpression(atoms, factory, diagnostics);
        if (argument) {
          inner.push({type: 'node', node: factory.node({kind: 'group',
            children: [{role: 'operand', node: argument}], sourceRanges: [child.source]})});
          continue;
        }
      }
      inner.push(...atoms);
    }
    if (node.kind === "group") {
      if (node.name === "leftright" || looksLikeParenGroup(node)) {
        return [
          {
            type: "node",
            node: wrapGroup(factory, inner, node, diagnostics),
          },
        ];
      }
      return inner;
    }
    return inner;
  }
  if (node.kind === "string") {
    return stringAtoms(node, factory, declared);
  }
  if (node.kind === "superscript" || node.kind === "subscript") {
    const inner = parseExpression(
      (node.children ?? []).flatMap((child) =>
        syntaxToAtoms(child, factory, declared, diagnostics),
      ),
      factory,
      diagnostics,
    );
    if (!inner) return [];
    return [
      {
        type: "script",
        kind: node.kind === "superscript" ? "sup" : "sub",
        node: inner,
        source: node.source,
      },
    ];
  }
  if (node.kind === "macro") {
    return macroAtoms(node, factory, declared, diagnostics);
  }
  if (node.kind === "environment") {
    return [environmentAtom(node, factory, declared, diagnostics)];
  }
  return [];
}

function looksLikeParenGroup(node: LatexSyntaxNode): boolean {
  return node.name === "leftright";
}

function wrapGroup(
  factory: Factory,
  atoms: Atom[],
  syntax: LatexSyntaxNode,
  diagnostics: FormulaDiagnostic[],
): FormulaNode {
  const inner =
    parseExpression(atoms, factory, diagnostics) ??
    factory.node({
      kind: "opaque",
      sourceRanges: [syntax.source],
      parseStatus: "opaque",
      opaqueKey: `group:${syntax.source.start}`,
    });
  const delim = syntax.value ?? "()";
  return factory.node({
    kind: "group",
    children: [{ role: "operand", node: inner }],
    sourceRanges: [syntax.source],
    display: [
      {
        kind: delim.includes("{") ? "brace" : delim.includes("[") ? "bracket" : "paren",
        left: delim[0],
        right: delim[1] ?? delim[0],
        sourceRanges: [syntax.source],
      },
    ],
  });
}

function stringAtoms(
  node: LatexSyntaxNode,
  factory: Factory,
  declared: Map<string, SymbolKind>,
): Atom[] {
  const value = node.value ?? "";
  if (!value) return [];
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    return [
      {
        type: "node",
        node: factory.node({
          kind: "number",
          value,
          sourceRanges: [node.source],
        }),
      },
    ];
  }
  if (value === "(" || value === "[" || value === "{") {
    return [{ type: "open", delim: value, source: node.source }];
  }
  if (value === ")" || value === "]" || value === "}") {
    return [{ type: "close", delim: value, source: node.source }];
  }
  if (value === "=" || value === "<" || value === ">") {
    return [{ type: "rel", op: value, source: node.source }];
  }
  if (value === "+" || value === "-" || value === "*" || value === "/") {
    return [{ type: "op", op: value, source: node.source }];
  }
  if (value === "&" || value === "\\\\") return [];
  if (/^[A-Za-z]$/.test(value)) {
    if (declared.get(value) === "function" || NAMED_FUNCTIONS.has(value)) {
      return [{ type: "func", name: value, source: node.source }];
    }
    return [
      {
        type: "node",
        node: factory.node({
          kind: "symbol",
          value,
          sourceRanges: [node.source],
        }),
      },
    ];
  }
  return [
    {
      type: "node",
      node: factory.node({
        kind: "opaque",
        value,
        sourceRanges: [node.source],
        parseStatus: "opaque",
        opaqueKey: value,
      }),
    },
  ];
}

function macroAtoms(
  node: LatexSyntaxNode,
  factory: Factory,
  declared: Map<string, SymbolKind>,
  diagnostics: FormulaDiagnostic[],
): Atom[] {
  const name = node.name ?? "";
  if (SKIP_MACROS.has(name)) return [];
  if (name === "frac" || name === "dfrac" || name === "tfrac") {
    const numerator = argExpr(node.args?.[0], factory, declared, diagnostics);
    const denominator = argExpr(node.args?.[1], factory, declared, diagnostics);
    return [
      {
        type: "node",
        node: factory.node({
          kind: "fraction",
          operator: "/",
          children: [
            { role: "numerator", node: numerator },
            { role: "denominator", node: denominator },
          ],
          sourceRanges: [node.source],
          display: [{ kind: "bar", sourceRanges: [node.source] }],
        }),
      },
    ];
  }
  if (name === "sqrt") {
    const radicand = argExpr(node.args?.[0], factory, declared, diagnostics);
    const index = node.optionalArg
      ? argExpr(node.optionalArg, factory, declared, diagnostics)
      : undefined;
    return [
      {
        type: "node",
        node: factory.node({
          kind: "radical",
          operator: "sqrt",
          children: [
            ...(index ? [{ role: "index" as const, node: index }] : []),
            { role: "radicand", node: radicand },
          ],
          sourceRanges: [node.source],
        }),
      },
    ];
  }
  if (
    name === "mathrm" ||
    name === "mathbf" ||
    name === "mathbb" ||
    name === "mathcal" ||
    name === "mathit" ||
    name === "mathsf" ||
    name === "mathtt" ||
    name === "text" ||
    name === "textrm" ||
    name === "textbf"
  ) {
    const letters = flatten(node.args?.[0])
      .map((child) => child.value ?? "")
      .join("");
    if (letters && declared.get(letters) === 'function') {
      return [{type: 'func', name: letters, source: node.source}];
    }
    if (letters === "d" || letters === "dx") {
      return [
        {
          type: "node",
          node: factory.node({
            kind: "symbol",
            value: letters === "dx" ? "dx" : "d",
            operator: "differential",
            sourceRanges: [node.source],
          }),
        },
      ];
    }
    return [
      {
        type: "node",
        node: factory.node({
          kind: "symbol",
          value: letters || name,
          sourceRanges: [node.source],
        }),
      },
    ];
  }
  if (name === "operatorname") {
    const op = flatten(node.args?.[0])
      .map((child) => child.value ?? "")
      .join("");
    return [{ type: "func", name: op || "operatorname", source: node.source }];
  }
  if (NAMED_FUNCTIONS.has(name)) {
    return [{ type: "func", name, source: node.source }];
  }
  if (name === "int" || name === "oint" || name === "iint") {
    return [
      {
        type: "node",
        node: factory.node({
          kind: "integral",
          operator: name,
          sourceRanges: [node.source],
          children: [],
        }),
      },
    ];
  }
  if (name === "sum" || name === "prod") {
    return [
      {
        type: "node",
        node: factory.node({
          kind: "sum",
          operator: name,
          sourceRanges: [node.source],
          children: [],
        }),
      },
    ];
  }
  if (name === "lim") {
    return [
      {
        type: "node",
        node: factory.node({
          kind: "limit",
          operator: "lim",
          sourceRanges: [node.source],
          children: [],
        }),
      },
    ];
  }
  if (GREEK[name]) {
    if (declared.get(GREEK[name]!) === "function") {
      return [{type: "func", name: GREEK[name]!, source: node.source}];
    }
    return [
      {
        type: "node",
        node: factory.node({
          kind: "symbol",
          value: GREEK[name],
          operator: name,
          sourceRanges: [node.source],
        }),
      },
    ];
  }
  if (RELATIONS.has(name)) {
    return [{ type: "rel", op: name, source: node.source }];
  }
  if (MUL_OPS.has(name)) {
    return [{ type: "op", op: name === "*" ? "*" : name, source: node.source }];
  }
  if (name === "div" || name === "over") {
    return [{ type: "op", op: "/", source: node.source }];
  }
  if (name === "pm" || name === "mp") {
    return [{ type: "op", op: name, source: node.source }];
  }
  if (
    name === "hat" ||
    name === "widehat" ||
    name === "bar" ||
    name === "vec" ||
    name === "tilde" ||
    name === "widetilde" ||
    name === "overline" ||
    name === "dot"
  ) {
    const inner = argExpr(node.args?.[0], factory, declared, diagnostics);
    return [
      {
        type: "node",
        node: factory.node({
          kind: "unary",
          operator: name,
          children: [{ role: "operand", node: inner }],
          sourceRanges: [node.source],
        }),
      },
    ];
  }
  diagnostics.push({
    code: "opaque_macro",
    message: `Unsupported macro \\${name} kept as an opaque node.`,
    range: node.source,
  });
  const args = (node.args ?? []).map((arg) =>
    argExpr(arg, factory, declared, diagnostics),
  );
  return [
    {
      type: "node",
      node: factory.node({
        kind: "opaque",
        operator: name,
        value: name,
        children: args.map((arg) => ({ role: "operand" as const, node: arg })),
        sourceRanges: [node.source],
        parseStatus: "opaque",
        opaqueKey: `macro:${name}:${node.source.start}:${node.source.end}`,
      }),
    },
  ];
}

function environmentAtom(
  node: LatexSyntaxNode,
  factory: Factory,
  declared: Map<string, SymbolKind>,
  diagnostics: FormulaDiagnostic[],
): Atom {
  const env = node.name ?? "";
  if (env === "cases") {
    const rows = splitRows(node.children ?? []);
    const children = rows.map((row) => ({
      role: "row" as const,
      node: parseExpression(
        row.flatMap((child) => syntaxToAtoms(child, factory, declared, diagnostics)),
        factory,
        diagnostics,
      ) ??
        factory.node({
          kind: "opaque",
          sourceRanges: [node.source],
          parseStatus: "opaque",
        }),
    }));
    return {
      type: "node",
      node: factory.node({
        kind: "piecewise",
        operator: "cases",
        children,
        sourceRanges: [node.source],
        parseStatus: children.some((child) => child.node.parseStatus !== "recognized")
          ? "opaque"
          : "recognized",
      }),
    };
  }
  if (
    env === "matrix" ||
    env === "pmatrix" ||
    env === "bmatrix" ||
    env === "vmatrix" ||
    env === "smallmatrix"
  ) {
    const rows = splitRows(node.children ?? []);
    const children = rows.map((row) => {
      const cells = splitCells(row).map((cell) => ({
        role: "cell" as const,
        node:
          parseExpression(
            cell.flatMap((child) =>
              syntaxToAtoms(child, factory, declared, diagnostics),
            ),
            factory,
            diagnostics,
          ) ??
          factory.node({
            kind: "opaque",
            sourceRanges: [node.source],
            parseStatus: "opaque",
          }),
      }));
      return {
        role: "row" as const,
        node: factory.node({
          kind: "nary",
          operator: "row",
          children: cells,
          sourceRanges: mergeRanges(cells.flatMap((cell) => cell.node.sourceRanges)),
        }),
      };
    });
    return {
      type: "node",
      node: factory.node({
        kind: "matrix",
        operator: env,
        children,
        sourceRanges: [node.source],
      }),
    };
  }
  diagnostics.push({
    code: "opaque_environment",
    message: `Unsupported environment ${env} kept as an opaque node.`,
    range: node.source,
  });
  return {
    type: "node",
    node: factory.node({
      kind: "opaque",
      operator: env,
      sourceRanges: [node.source],
      parseStatus: "opaque",
      opaqueKey: `env:${env}:${node.source.start}`,
    }),
  };
}

function splitRows(nodes: readonly LatexSyntaxNode[]): LatexSyntaxNode[][] {
  const rows: LatexSyntaxNode[][] = [[]];
  for (const node of nodes) {
    if (node.kind === "macro" && node.name === "\\") {
      rows.push([]);
      continue;
    }
    rows[rows.length - 1]!.push(node);
  }
  return rows.filter((row) => row.length > 0);
}

function splitCells(nodes: readonly LatexSyntaxNode[]): LatexSyntaxNode[][] {
  const cells: LatexSyntaxNode[][] = [[]];
  for (const node of nodes) {
    if (node.kind === "string" && node.value === "&") {
      cells.push([]);
      continue;
    }
    cells[cells.length - 1]!.push(node);
  }
  return cells;
}

function argExpr(
  node: LatexSyntaxNode | undefined,
  factory: Factory,
  declared: Map<string, SymbolKind>,
  diagnostics: FormulaDiagnostic[],
): FormulaNode {
  if (!node) {
    return factory.node({
      kind: "opaque",
      sourceRanges: [{ start: 0, end: 0 }],
      parseStatus: "opaque",
      opaqueKey: "missing-arg",
    });
  }
  return (
    parseExpression(
      syntaxToAtoms(node, factory, declared, diagnostics),
      factory,
      diagnostics,
    ) ??
    factory.node({
      kind: "opaque",
      sourceRanges: [node.source],
      parseStatus: "opaque",
      opaqueKey: `arg:${node.source.start}`,
    })
  );
}

function parseExpression(
  atoms: Atom[],
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): FormulaNode | null {
  const prepared = attachScriptsAndLargeOps(atoms, factory);
  if (prepared.length === 0) return null;
  const [node] = parseLogicalRelation(prepared, 0, factory, diagnostics);
  return node;
}

function attachScriptsAndLargeOps(atoms: Atom[], factory: Factory): Atom[] {
  const out: Atom[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i]!;
    if (atom.type === "script") {
      const prev = out[out.length - 1];
      if (prev?.type === "node") {
        out[out.length - 1] = {
          type: "node",
          node: applyScript(factory, prev.node, atom),
        };
        continue;
      }
    }
    out.push(atom);
  }
  return attachLargeOpBodies(out, factory);
}

function applyScript(
  factory: Factory,
  base: FormulaNode,
  script: Extract<Atom, { type: "script" }>,
): FormulaNode {
  const existing = base.kind === "script" ? base : null;
  if (existing) {
    const role: ChildRole = script.kind === "sup" ? "exponent" : "subscript";
    return factory.node({
      kind: "script",
      operator: existing.operator,
      children: [...existing.children, { role, node: script.node }],
      sourceRanges: [...existing.sourceRanges, script.source],
    });
  }
  if (base.kind === "integral" || base.kind === "sum" || base.kind === "limit") {
    const role: ChildRole =
      script.kind === "sup"
        ? "upper"
        : base.kind === "limit"
          ? "approach"
          : "lower";
    return factory.node({
      kind: base.kind,
      operator: base.operator,
      children: [...base.children, { role, node: script.node }],
      sourceRanges: [...base.sourceRanges, script.source],
    });
  }
  return factory.node({
    kind: "script",
    operator: script.kind === "sup" ? "^" : "_",
    children: [
      { role: "base", node: base },
      {
        role: script.kind === "sup" ? "exponent" : "subscript",
        node: script.node,
      },
    ],
    sourceRanges: [...base.sourceRanges, script.source],
  });
}

function attachLargeOpBodies(atoms: Atom[], factory: Factory): Atom[] {
  const out: Atom[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i]!;
    if (
      atom.type === "node" &&
      (atom.node.kind === "integral" ||
        atom.node.kind === "sum" ||
        atom.node.kind === "limit") &&
      !atom.node.children.some((child) =>
        ["integrand", "summand", "body"].includes(child.role),
      )
    ) {
      const rest = atoms.slice(i + 1);
      const { body, consumed, variable } = takeLargeOpBody(rest, factory, atom.node.kind);
      if (body) {
        const roles: FormulaChild[] = [...atom.node.children];
        if (atom.node.kind === "integral") {
          roles.push({ role: "integrand", node: body });
          if (variable) roles.push({ role: "variable", node: variable });
        } else if (atom.node.kind === "sum") {
          roles.push({ role: "summand", node: body });
        } else {
          roles.push({ role: "body", node: body });
        }
        out.push({
          type: "node",
          node: factory.node({
            kind: atom.node.kind,
            operator: atom.node.operator,
            children: roles,
            sourceRanges: [
              ...atom.node.sourceRanges,
              ...body.sourceRanges,
              ...(variable?.sourceRanges ?? []),
            ],
            parseStatus: body.parseStatus === "opaque" ? "opaque" : "recognized",
          }),
        });
        i += consumed;
        continue;
      }
      out.push({
        type: "node",
        node: factory.node({
          kind: atom.node.kind,
          operator: atom.node.operator,
          children: atom.node.children,
          sourceRanges: atom.node.sourceRanges,
          parseStatus: "opaque",
          opaqueKey: `${atom.node.kind}-scope`,
        }),
      });
      continue;
    }
    out.push(atom);
  }
  return out;
}

function takeLargeOpBody(
  rest: Atom[],
  factory: Factory,
  kind: FormulaNodeKind,
): { body: FormulaNode | null; consumed: number; variable?: FormulaNode } {
  if (rest.length === 0) return { body: null, consumed: 0 };
  if (kind !== "integral") {
    const [body, consumed] = parseMul(rest, 0, factory, []);
    return { body, consumed };
  }
  const dxAt = rest.findIndex(
    (atom) =>
      atom.type === "node" &&
      atom.node.kind === "symbol" &&
      (atom.node.operator === "differential" ||
        atom.node.value === "dx" ||
        atom.node.value === "d"),
  );
  if (dxAt < 0) {
    return { body: null, consumed: 0 };
  }
  const integrandAtoms = rest.slice(0, dxAt);
  const dx = rest[dxAt] as Extract<Atom, { type: "node" }>;
  let variable = dx.node.value === "dx" ? dx.node : undefined;
  let consumed = dxAt + 1;
  if (!variable && rest[dxAt + 1]?.type === "node") {
    const next = rest[dxAt + 1] as Extract<Atom, { type: "node" }>;
    if (next.node.kind === "symbol") {
      variable = next.node;
      consumed += 1;
    }
  }
  const integrand =
    parseExpression(integrandAtoms, factory, []) ??
    factory.node({
      kind: "opaque",
      sourceRanges: dx.node.sourceRanges,
      parseStatus: "opaque",
    });
  return { body: integrand, consumed, variable };
}

function parseLogicalRelation(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  let [current, i] = parseRel(atoms, start, factory, diagnostics);
  if (!current) return [null, start];
  while (atoms[i]?.type === "rel" && LOGICAL_RELATIONS.has((atoms[i] as Extract<Atom, {type: "rel"}>).op)) {
    const relation = atoms[i] as Extract<Atom, {type: "rel"}>;
    const [right, next] = parseRel(atoms, i + 1, factory, diagnostics);
    if (!right) break;
    current = factory.node({
      kind: "relation", operator: relation.op,
      children: [{role: "left", node: current}, {role: "right", node: right}],
      sourceRanges: [...current.sourceRanges, relation.source, ...right.sourceRanges],
    });
    i = next;
  }
  return [current, i];
}

function parseRel(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  const [left, i1] = parseAdd(atoms, start, factory, diagnostics);
  if (!left) return [null, start];
  let i = i1;
  const operands: FormulaChild[] = [{ role: "left", node: left }];
  let op: string | undefined;
  while (atoms[i]?.type === "rel") {
    const rel = atoms[i] as Extract<Atom, { type: "rel" }>;
    if (LOGICAL_RELATIONS.has(rel.op)) break;
    op = rel.op;
    i += 1;
    const [right, next] = parseAdd(atoms, i, factory, diagnostics);
    if (!right) break;
    operands.push({ role: "right", node: right });
    i = next;
  }
  if (operands.length === 1) return [left, i1];
  return [
    factory.node({
      kind: "relation",
      operator: op,
      children: operands,
      sourceRanges: operands.flatMap((child) => child.node.sourceRanges),
    }),
    i,
  ];
}

function parseAdd(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  const [first, i1] = parseMul(atoms, start, factory, diagnostics);
  if (!first) return [null, start];
  let i = i1;
  let current = first;
  while (atoms[i]?.type === "op" && ADD_OPS.has((atoms[i] as Extract<Atom, { type: "op" }>).op)) {
    const op = (atoms[i] as Extract<Atom, { type: "op" }>).op;
    i += 1;
    const [right, next] = parseMul(atoms, i, factory, diagnostics);
    if (!right) break;
    current = factory.node({
      kind: "nary",
      operator: op === "-" ? "-" : "+",
      children: [
        { role: "left", node: current },
        { role: "right", node: right },
      ],
      sourceRanges: [...current.sourceRanges, ...right.sourceRanges],
    });
    i = next;
  }
  return [current, i];
}

function parseMul(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  const [first, i1] = parseUnary(atoms, start, factory, diagnostics);
  if (!first) return [null, start];
  let i = i1;
  let current = first;
  while (i < atoms.length) {
    const atom = atoms[i]!;
    if (atom.type === "op" && (MUL_OPS.has(atom.op) || atom.op === "/")) {
      const explicit = atom.op;
      i += 1;
      const [right, next] = parseUnary(atoms, i, factory, diagnostics);
      if (!right) break;
      current = factory.node({
        kind: explicit === "/" ? "nary" : "nary",
        operator: explicit === "cdot" || explicit === "times" ? "mul" : explicit,
        children: [
          { role: explicit === "/" ? "numerator" : "left", node: current },
          { role: explicit === "/" ? "denominator" : "right", node: right },
        ],
        sourceRanges: [...current.sourceRanges, ...right.sourceRanges],
      });
      i = next;
      continue;
    }
    if (canImplicitMul(current, atom, atoms, i, factory, diagnostics)) {
      const [right, next] = parseUnary(atoms, i, factory, diagnostics);
      if (!right) break;
      const ambiguousCall = isAmbiguousCall(current, right, atom) && !factory.variables.has(current.value ?? "");
      current = factory.node({
        kind: "nary",
        operator: "implicit_mul",
        children: [
          { role: "left", node: current },
          { role: "right", node: right },
        ],
        sourceRanges: [...current.sourceRanges, ...right.sourceRanges],
        parseStatus: ambiguousCall ? "ambiguous" : "recognized",
      });
      i = next;
      continue;
    }
    break;
  }
  return [current, i];
}

function canImplicitMul(
  left: FormulaNode,
  atom: Atom,
  atoms: Atom[],
  index: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): boolean {
  void factory;
  void diagnostics;
  void atoms;
  void index;
  if (atom.type === "op" || atom.type === "rel" || atom.type === "close" || atom.type === "script") {
    return false;
  }
  if (atom.type === "func" || atom.type === "open" || atom.type === "node") {
    if (left.kind === "relation") return false;
    return true;
  }
  return false;
}

function isAmbiguousCall(left: FormulaNode, right: FormulaNode, atom: Atom): boolean {
  return (
    left.kind === "symbol" &&
    (right.kind === "group" || (atom.type === "open" && atom.delim === "("))
  );
}

function parseUnary(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  const atom = atoms[start];
  if (!atom) return [null, start];
  if (atom.type === "op" && (atom.op === "+" || atom.op === "-" || atom.op === "pm" || atom.op === "mp")) {
    const [inner, next] = parseUnary(atoms, start + 1, factory, diagnostics);
    if (!inner) return [null, start];
    return [
      factory.node({
        kind: "unary",
        operator: atom.op,
        children: [{ role: "operand", node: inner }],
        sourceRanges: [atom.source, ...inner.sourceRanges],
      }),
      next,
    ];
  }
  return parsePostfix(atoms, start, factory, diagnostics);
}

function parsePostfix(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  const [primary, i1] = parsePrimary(atoms, start, factory, diagnostics);
  if (!primary) return [null, start];
  // A plain parenthesized expression becomes a node only in parsePrimary.
  // Its trailing script cannot be consumed by the earlier atom-only pass.
  let current = primary, i = i1;
  while (atoms[i]?.type === "script") {
    current = applyScript(factory, current, atoms[i] as Extract<Atom, { type: "script" }>);
    i += 1;
  }
  return [current, i];
}

function parsePrimary(
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode | null, number] {
  const atom = atoms[start];
  if (!atom) return [null, start];
  if (atom.type === "node") return [atom.node, start + 1];
  if (atom.type === "func") {
    return parseCall(atom, atoms, start + 1, factory, diagnostics);
  }
  if (atom.type === "open") {
    const closeAt = findClose(atoms, start + 1, atom.delim);
    const innerAtoms = atoms.slice(start + 1, closeAt);
    const inner =
      parseExpression(innerAtoms, factory, diagnostics) ??
      factory.node({
        kind: "opaque",
        sourceRanges: [atom.source],
        parseStatus: "opaque",
      });
    const consumed = closeAt < atoms.length ? closeAt + 1 : closeAt;
    const close = atoms[closeAt];
    return [
      factory.node({
        kind: "group",
        children: [{ role: "operand", node: inner }],
        sourceRanges: [
          atom.source,
          ...inner.sourceRanges,
          ...(close && close.type === "close" ? [close.source] : []),
        ],
        display: [
          {
            kind: atom.delim === "[" ? "bracket" : atom.delim === "{" ? "brace" : "paren",
            left: atom.delim,
            right: matchingClose(atom.delim),
            sourceRanges: [atom.source],
          },
        ],
      }),
      consumed,
    ];
  }
  return [null, start];
}

function matchingClose(open: string): string {
  if (open === "(") return ")";
  if (open === "[") return "]";
  if (open === "{") return "}";
  return open;
}

function findClose(atoms: Atom[], start: number, open: string): number {
  const close = matchingClose(open);
  let depth = 1;
  for (let i = start; i < atoms.length; i += 1) {
    const atom = atoms[i]!;
    if (atom.type === "open" && atom.delim === open) depth += 1;
    if (atom.type === "close" && atom.delim === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return atoms.length;
}

function parseCall(
  func: Extract<Atom, { type: "func" }>,
  atoms: Atom[],
  start: number,
  factory: Factory,
  diagnostics: FormulaDiagnostic[],
): [FormulaNode, number] {
  let fn = factory.node({
    kind: "symbol",
    value: func.name,
    sourceRanges: [func.source],
  });
  // The atom pass cannot attach scripts to a function token. Consume them
  // here before reading the argument so p_theta(x) and E_q[log p_theta(x)]
  // each remain a complete call, including their exact written subscripts.
  while (atoms[start]?.type === "script") {
    fn = applyScript(factory, fn, atoms[start] as Extract<Atom, {type: "script"}>);
    start += 1;
  }
  if (atoms[start]?.type === "open") {
    const [argGroup, next] = parsePrimary(atoms, start, factory, diagnostics);
    const arg =
      argGroup?.kind === "group" ? argGroup.children[0]?.node ?? argGroup : argGroup;
    if (arg) {
      return [
        factory.node({
          kind: "call",
          operator: "call",
          parseStatus: "recognized",
          children: [
            { role: "function", node: fn },
            { role: "argument", node: arg },
          ],
          sourceRanges: [...fn.sourceRanges, ...(argGroup?.sourceRanges ?? arg.sourceRanges)],
        }),
        next,
      ];
    }
  }
  const [arg, next] = parseUnary(atoms, start, factory, diagnostics);
  if (!arg) {
    return [fn, start];
  }
  return [
    factory.node({
      kind: "call",
      operator: "call",
      parseStatus: "recognized",
      children: [
        { role: "function", node: fn },
        { role: "argument", node: arg },
      ],
      sourceRanges: [...fn.sourceRanges, ...arg.sourceRanges],
    }),
    next,
  ];
}
