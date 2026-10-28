export type ParseStatus = "recognized" | "ambiguous" | "opaque";

export type FormulaAnalysisStatus = "complete" | "partial" | "opaque";

export type FormulaSyntaxStatus = "ok" | "invalid";

export type FormulaNodeKind =
  | "number"
  | "symbol"
  | "unary"
  | "nary"
  | "relation"
  | "group"
  | "fraction"
  | "radical"
  | "script"
  | "call"
  | "limit"
  | "integral"
  | "sum"
  | "matrix"
  | "piecewise"
  | "opaque";

export type ChildRole =
  | "operand"
  | "left"
  | "right"
  | "numerator"
  | "denominator"
  | "radicand"
  | "index"
  | "base"
  | "exponent"
  | "subscript"
  | "argument"
  | "function"
  | "lower"
  | "upper"
  | "integrand"
  | "summand"
  | "variable"
  | "body"
  | "row"
  | "cell"
  | "condition"
  | "approach";

export type SourceRange = Readonly<{
  start: number;
  end: number;
}>;

export type DisplayAttachment = Readonly<{
  kind: "paren" | "bar" | "brace" | "bracket";
  left?: string;
  right?: string;
  sourceRanges: readonly SourceRange[];
}>;

export type FormulaChild = Readonly<{
  role: ChildRole;
  node: FormulaNode;
}>;

export type FormulaNode = Readonly<{
  nodeId: string;
  kind: FormulaNodeKind;
  operator?: string;
  value?: string;
  children: readonly FormulaChild[];
  sourceRanges: readonly SourceRange[];
  parseStatus: ParseStatus;
  fingerprint: string;
  display?: readonly DisplayAttachment[];
}>;

export type SymbolKind = "variable" | "function";

export type SymbolDeclaration = Readonly<{
  name: string;
  kind: SymbolKind;
}>;

export type SymbolContext = Readonly<{
  symbols?: readonly SymbolDeclaration[];
}>;

export type LatexSyntaxKind =
  | "root"
  | "string"
  | "whitespace"
  | "macro"
  | "group"
  | "environment"
  | "superscript"
  | "subscript";

export type LatexSyntaxNode = Readonly<{
  kind: LatexSyntaxKind;
  name?: string;
  value?: string;
  children?: readonly LatexSyntaxNode[];
  args?: readonly LatexSyntaxNode[];
  optionalArg?: LatexSyntaxNode;
  source: SourceRange;
}>;

export type FormulaDiagnostic = Readonly<{
  code: string;
  message: string;
  range?: SourceRange;
}>;

export type FormulaAnalysis = Readonly<{
  source: string;
  sourceHash: string;
  parserVersion: string;
  analyzerVersion: string;
  syntax: LatexSyntaxNode;
  root: FormulaNode;
  analysisStatus: FormulaAnalysisStatus;
  syntaxStatus: FormulaSyntaxStatus;
  diagnostics: readonly FormulaDiagnostic[];
}>;

export type CorrespondenceReason =
  | "identical_source"
  | "same_role"
  | "unique_subtree";

export type FormulaCorrespondencePair = Readonly<{
  correspondenceId: string;
  beforeNodeId: string;
  afterNodeId: string;
  reason: CorrespondenceReason;
}>;

export type FormulaCorrespondence = Readonly<{
  matcherVersion: string;
  pairs: readonly FormulaCorrespondencePair[];
  unmatchedBefore: readonly string[];
  unmatchedAfter: readonly string[];
}>;

export type TransitionOp = "hold" | "move" | "enter" | "exit" | "crossfade";

export type FormulaTransitionRegion = Readonly<{
  op: TransitionOp;
  beforeNodeId?: string;
  afterNodeId?: string;
  correspondenceId?: string;
}>;

export type FormulaAnimationStatus = "node" | "region" | "formula";

export type FormulaTransition = Readonly<{
  compilerVersion: string;
  regions: readonly FormulaTransitionRegion[];
  animationStatus: FormulaAnimationStatus;
}>;
