export type MathRange = [number, number];
export type MathPoint2 = [number, number];
export type MathPoint3 = [number, number, number];

export type MathSceneStyle = {
  color?: string;
  dashed?: boolean;
  opacity?: number;
};

export type MathSceneParameter = {
  id: string;
  name: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

type MathSceneObjectBase = MathSceneStyle & {
  id: string;
  label?: string;
  /** Lets the learner move the object's primary 2D handle. */
  draggable?: boolean;
};

export type MathSceneVectorRelation =
  | {
      operation: "sum" | "difference";
      operands: [string, string];
    }
  | {
      operation: "scale";
      operand: string;
      factor: number;
      /** Optional scene parameter that overrides factor at render time. */
      factorParameter?: string;
    };

export type MathSceneObject =
  | (MathSceneObjectBase & {
      kind: "point";
      position: MathPoint2 | MathPoint3;
    })
  | (MathSceneObjectBase & {
      kind: "vector";
      start?: MathPoint2 | MathPoint3;
      end: MathPoint2 | MathPoint3;
      /** Recomputes this vector from learner-draggable source vectors. */
      relation?: MathSceneVectorRelation;
    })
  | (MathSceneObjectBase & {
      kind: "segment";
      from: MathPoint2 | MathPoint3;
      to: MathPoint2 | MathPoint3;
    })
  | (MathSceneObjectBase & {
      kind: "function";
      expression: string;
      variable: "x";
      domain: MathRange;
    })
  | (MathSceneObjectBase & {
      kind: "parametric";
      xExpression: string;
      yExpression: string;
      zExpression?: string;
      parameter: "t";
      domain: MathRange;
    })
  | (MathSceneObjectBase & {
      kind: "polar_function";
      expression: string;
      variable: "theta";
      domain: MathRange;
    })
  | (MathSceneObjectBase & {
      kind: "surface";
      expression: string;
      variables: ["x", "y"];
      xDomain: MathRange;
      yDomain: MathRange;
    });

export type MathScene = {
  type: "math_scene";
  title: string;
  dimension: "2d" | "3d";
  coordinateSystem: "cartesian" | "polar";
  xRange: MathRange;
  yRange: MathRange;
  zRange?: MathRange;
  objects: MathSceneObject[];
  parameters?: MathSceneParameter[];
  showGrid: boolean;
  showAxes: boolean;
  camera?: {
    azimuth: number;
    elevation: number;
  };
  summary: string;
};

export type MathScene2dDragPositions = Readonly<
  Record<string, MathPoint2 | undefined>
>;

/**
 * Removes a static object when a parameter-driven object with the same label
 * is present. Authoring may include a fixed preview of a derived result next
 * to its live version; rendering both produces coincident geometry and a
 * duplicate legend entry.
 */
export function removeStaticMathSceneDuplicates(
  objects: readonly MathSceneObject[],
  parameterIds: readonly string[],
): MathSceneObject[] {
  if (parameterIds.length === 0) return [...objects];

  const byId = new Map(objects.map((object) => [object.id, object]));
  const parameterNames = new Set(parameterIds);
  const parameterDriven = new Map<string, boolean>();
  const checking = new Set<string>();
  const expressionUsesParameter = (expression: string | undefined) =>
    Boolean(
      expression
        ?.match(/[A-Za-z_][A-Za-z0-9_]*/g)
        ?.some((token) => parameterNames.has(token)),
    );
  const isParameterDriven = (id: string): boolean => {
    const cached = parameterDriven.get(id);
    if (cached !== undefined) return cached;
    if (checking.has(id)) return false;
    const object = byId.get(id);
    if (!object) return false;
    checking.add(id);

    let driven = false;
    if (object.kind === "vector" && object.relation) {
      if (object.relation.operation === "scale") {
        driven =
          Boolean(object.relation.factorParameter) ||
          isParameterDriven(object.relation.operand);
      } else {
        driven = object.relation.operands.some(isParameterDriven);
      }
    } else if (
      object.kind === "function" ||
      object.kind === "polar_function" ||
      object.kind === "surface"
    ) {
      driven = expressionUsesParameter(object.expression);
    } else if (object.kind === "parametric") {
      driven = [
        object.xExpression,
        object.yExpression,
        object.zExpression,
      ].some(expressionUsesParameter);
    }

    checking.delete(id);
    parameterDriven.set(id, driven);
    return driven;
  };

  const dynamicLabels = new Set(
    objects.flatMap((object) => {
      const label = object.label?.trim();
      return label && isParameterDriven(object.id) ? [label] : [];
    }),
  );

  return objects.filter((object) => {
    const label = object.label?.trim();
    return !label || !dynamicLabels.has(label) || isParameterDriven(object.id);
  });
}

/**
 * Applies learner drag positions and then resolves vector arithmetic. Keeping
 * this in the domain package gives web and native renderers the same math and
 * avoids inferring relationships from translated labels such as `a+b`.
 */
export function resolveMathSceneObjects(
  objects: readonly MathSceneObject[],
  dragPositions: MathScene2dDragPositions = {},
  parameterValues: Readonly<Record<string, number>> = {},
): MathSceneObject[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const resolved = new Map<string, MathSceneObject>();
  const resolving = new Set<string>();

  const resolve = (id: string): MathSceneObject | undefined => {
    const cached = resolved.get(id);
    if (cached) return cached;
    const object = byId.get(id);
    if (!object || resolving.has(id)) return object;
    resolving.add(id);

    let next: MathSceneObject = object;
    const dragged = dragPositions[id];
    if (dragged && object.draggable) {
      if (object.kind === "point") next = { ...object, position: dragged };
      if (object.kind === "vector") next = { ...object, end: dragged };
      if (object.kind === "segment") next = { ...object, to: dragged };
    }

    if (next.kind === "vector" && next.relation) {
      const vectorDelta = (
        sourceId: string,
      ): MathPoint2 | MathPoint3 | null => {
        const source = resolve(sourceId);
        if (!source || source.kind !== "vector") return null;
        const end = source.end;
        const start = source.start ?? end.map(() => 0);
        return end.map((value, index) => value - (start[index] ?? 0)) as
          MathPoint2 | MathPoint3;
      };
      const start = next.start ?? next.end.map(() => 0);
      if (next.relation.operation === "scale") {
        const delta = vectorDelta(next.relation.operand);
        if (delta) {
          const factor = next.relation.factorParameter
            ? (parameterValues[next.relation.factorParameter] ??
              next.relation.factor)
            : next.relation.factor;
          next = {
            ...next,
            end: start.map(
              (value, index) => value + (delta[index] ?? 0) * factor,
            ) as MathPoint2 | MathPoint3,
          };
        }
      } else {
        const left = vectorDelta(next.relation.operands[0]);
        const right = vectorDelta(next.relation.operands[1]);
        if (left && right) {
          const direction = next.relation.operation === "sum" ? 1 : -1;
          next = {
            ...next,
            end: start.map(
              (value, index) =>
                value + (left[index] ?? 0) + (right[index] ?? 0) * direction,
            ) as MathPoint2 | MathPoint3,
          };
        }
      }
    }

    resolving.delete(id);
    resolved.set(id, next);
    return next;
  };

  return objects.map((object) => resolve(object.id) ?? object);
}

/** @deprecated Prefer resolveMathSceneObjects for dimension-neutral scenes. */
export const resolveMathScene2dObjects = resolveMathSceneObjects;

export function mathScene2dViewport(scene: MathScene): {
  xRange: MathRange;
  yRange: MathRange;
} {
  const points: MathPoint2[] = [];
  for (const object of scene.objects) {
    if (object.kind === "point") points.push(object.position as MathPoint2);
    if (object.kind === "vector") {
      points.push(
        (object.start ?? [0, 0]) as MathPoint2,
        object.end as MathPoint2,
      );
    }
    if (object.kind === "segment") {
      points.push(object.from as MathPoint2, object.to as MathPoint2);
    }
  }

  const includePoints = (range: MathRange, axis: 0 | 1): MathRange => {
    if (points.length === 0) return range;
    const padding = (range[1] - range[0]) * 0.06;
    const minimum = Math.min(...points.map((point) => point[axis]));
    const maximum = Math.max(...points.map((point) => point[axis]));
    return [
      minimum < range[0] ? minimum - padding : range[0],
      maximum > range[1] ? maximum + padding : range[1],
    ];
  };

  return {
    xRange: includePoints(scene.xRange, 0),
    yRange: includePoints(scene.yRange, 1),
  };
}

export function mathSceneObjectsInPaintOrder(
  objects: readonly MathSceneObject[],
): Array<{ object: MathSceneObject; originalIndex: number }> {
  return objects
    .map((object, originalIndex) => ({ object, originalIndex }))
    .sort((left, right) => {
      if (left.object.kind !== "vector" || right.object.kind !== "vector") {
        return 0;
      }
      const lengthSquared = (
        object: Extract<MathSceneObject, { kind: "vector" }>,
      ) => {
        const start = object.start ?? object.end.map(() => 0);
        return object.end.reduce(
          (sum, value, index) => sum + (value - start[index]!) ** 2,
          0,
        );
      };
      return lengthSquared(right.object) - lengthSquared(left.object);
    });
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" | "^" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "comma" };

type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; operator: "+" | "-"; value: ExpressionNode }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "^";
      left: ExpressionNode;
      right: ExpressionNode;
    }
  | { kind: "call"; name: string; args: ExpressionNode[] };

const FUNCTIONS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = { e: Math.E, pi: Math.PI };
const EXPRESSION_CACHE = new Map<
  string,
  (scope: Record<string, number>) => number
>();

function tokenize(expression: string): Token[] {
  if (!expression.trim() || expression.length > 200) {
    throw new Error("Expression must contain 1-200 characters");
  }
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ kind: "name", value: name[0].toLowerCase() });
      index += name[0].length;
      continue;
    }
    const char = expression[index]!;
    if (
      char === "+" ||
      char === "-" ||
      char === "*" ||
      char === "/" ||
      char === "^"
    ) {
      tokens.push({ kind: "operator", value: char });
    } else if (char === "(") {
      tokens.push({ kind: "left" });
    } else if (char === ")") {
      tokens.push({ kind: "right" });
    } else if (char === ",") {
      tokens.push({ kind: "comma" });
    } else {
      throw new Error(`Unsupported expression character: ${char}`);
    }
    index += 1;
    if (tokens.length > 160) throw new Error("Expression is too complex");
  }
  return tokens;
}

function parseExpression(
  expression: string,
  allowedVariables: Set<string>,
): ExpressionNode {
  const tokens = tokenize(expression);
  let cursor = 0;
  let depth = 0;

  const primary = (): ExpressionNode => {
    const token = tokens[cursor++];
    if (!token) throw new Error("Unexpected end of expression");
    if (token.kind === "number") return { kind: "number", value: token.value };
    if (
      token.kind === "operator" &&
      (token.value === "+" || token.value === "-")
    ) {
      return { kind: "unary", operator: token.value, value: primary() };
    }
    if (token.kind === "left") {
      depth += 1;
      if (depth > 16) throw new Error("Expression nesting is too deep");
      const value = binary(0);
      if (tokens[cursor++]?.kind !== "right")
        throw new Error("Missing closing parenthesis");
      depth -= 1;
      return value;
    }
    if (token.kind !== "name")
      throw new Error("Expected a number, variable, or function");
    if (tokens[cursor]?.kind !== "left") {
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, token.value)) {
        return { kind: "number", value: CONSTANTS[token.value]! };
      }
      if (!allowedVariables.has(token.value)) {
        throw new Error(`Unknown variable: ${token.value}`);
      }
      return { kind: "variable", name: token.value };
    }
    if (!FUNCTIONS[token.value])
      throw new Error(`Unsupported function: ${token.value}`);
    cursor += 1;
    const args: ExpressionNode[] = [];
    if (tokens[cursor]?.kind !== "right") {
      while (true) {
        args.push(binary(0));
        if (tokens[cursor]?.kind !== "comma") break;
        cursor += 1;
      }
    }
    if (tokens[cursor++]?.kind !== "right")
      throw new Error("Missing closing parenthesis");
    if (args.length === 0 || args.length > 4)
      throw new Error("Functions require 1-4 arguments");
    return { kind: "call", name: token.value, args };
  };

  const precedence = (operator: string) =>
    operator === "+" || operator === "-"
      ? 1
      : operator === "*" || operator === "/"
        ? 2
        : 3;
  const binary = (minimumPrecedence: number): ExpressionNode => {
    let left = primary();
    while (tokens[cursor]?.kind === "operator") {
      const operator = (tokens[cursor] as Extract<Token, { kind: "operator" }>)
        .value;
      const currentPrecedence = precedence(operator);
      if (currentPrecedence < minimumPrecedence) break;
      cursor += 1;
      const right = binary(currentPrecedence + (operator === "^" ? 0 : 1));
      left = { kind: "binary", operator, left, right };
    }
    return left;
  };

  const root = binary(0);
  if (cursor !== tokens.length) throw new Error("Unexpected expression token");
  return root;
}

function evaluateNode(
  node: ExpressionNode,
  scope: Record<string, number>,
): number {
  if (node.kind === "number") return node.value;
  if (node.kind === "variable") return scope[node.name] ?? Number.NaN;
  if (node.kind === "unary") {
    const value = evaluateNode(node.value, scope);
    return node.operator === "-" ? -value : value;
  }
  if (node.kind === "call") {
    return FUNCTIONS[node.name]!(
      ...node.args.map((arg) => evaluateNode(arg, scope)),
    );
  }
  const left = evaluateNode(node.left, scope);
  const right = evaluateNode(node.right, scope);
  switch (node.operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? Number.NaN : left / right;
    case "^":
      return left ** right;
  }
}

export function compileMathExpression(
  expression: string,
  variables: readonly string[],
): (scope: Record<string, number>) => number {
  const normalizedVariables = [
    ...new Set(variables.map((value) => value.toLowerCase())),
  ].sort();
  const cacheKey = `${normalizedVariables.join(",")}:${expression}`;
  const cached = EXPRESSION_CACHE.get(cacheKey);
  if (cached) return cached;
  const root = parseExpression(expression, new Set(normalizedVariables));
  const evaluator = (scope: Record<string, number>) =>
    evaluateNode(root, scope);
  EXPRESSION_CACHE.set(cacheKey, evaluator);
  if (EXPRESSION_CACHE.size > 200)
    EXPRESSION_CACHE.delete(EXPRESSION_CACHE.keys().next().value!);
  return evaluator;
}

export function validateMathExpression(
  expression: string,
  variables: readonly string[],
): string | null {
  try {
    const evaluator = compileMathExpression(expression, variables);
    const sample = evaluator(
      Object.fromEntries(variables.map((variable) => [variable, 0.5])),
    );
    if (!Number.isFinite(sample))
      return "Expression is not finite in its sample domain";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid expression";
  }
}

export function sampleMathExpression(
  expression: string,
  variable: string,
  domain: MathRange,
  count = 96,
  parameters: Readonly<Record<string, number>> = {},
): MathPoint2[] {
  const evaluate = compileMathExpression(expression, [
    variable,
    ...Object.keys(parameters),
  ]);
  const sampleCount = Math.max(2, Math.min(count, 160));
  return Array.from({ length: sampleCount }, (_, index) => {
    const value =
      domain[0] + ((domain[1] - domain[0]) * index) / (sampleCount - 1);
    return [
      value,
      evaluate({ ...parameters, [variable]: value }),
    ] as MathPoint2;
  }).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

export function sampleParametricExpression(
  object: Extract<MathSceneObject, { kind: "parametric" }>,
  count = 96,
  parameters: Readonly<Record<string, number>> = {},
): Array<MathPoint2 | MathPoint3> {
  const variables = [object.parameter, ...Object.keys(parameters)];
  const x = compileMathExpression(object.xExpression, variables);
  const y = compileMathExpression(object.yExpression, variables);
  const z = object.zExpression
    ? compileMathExpression(object.zExpression, variables)
    : null;
  const sampleCount = Math.max(2, Math.min(count, 160));
  return Array.from({ length: sampleCount }, (_, index) => {
    const value =
      object.domain[0] +
      ((object.domain[1] - object.domain[0]) * index) / (sampleCount - 1);
    const scope = { ...parameters, [object.parameter]: value };
    return z
      ? ([x(scope), y(scope), z(scope)] as MathPoint3)
      : ([x(scope), y(scope)] as MathPoint2);
  }).filter((point) => point.every(Number.isFinite));
}

export function samplePolarExpression(
  object: Extract<MathSceneObject, { kind: "polar_function" }>,
  count = 120,
  parameters: Readonly<Record<string, number>> = {},
): MathPoint2[] {
  const radius = compileMathExpression(object.expression, [
    object.variable,
    ...Object.keys(parameters),
  ]);
  const sampleCount = Math.max(2, Math.min(count, 180));
  return Array.from({ length: sampleCount }, (_, index) => {
    const theta =
      object.domain[0] +
      ((object.domain[1] - object.domain[0]) * index) / (sampleCount - 1);
    const r = radius({ ...parameters, [object.variable]: theta });
    return [r * Math.cos(theta), r * Math.sin(theta)] as MathPoint2;
  }).filter((point) => point.every(Number.isFinite));
}

export function sampleSurfaceExpression(
  object: Extract<MathSceneObject, { kind: "surface" }>,
  steps = 15,
  parameters: Readonly<Record<string, number>> = {},
): MathPoint3[][] {
  const evaluate = compileMathExpression(object.expression, [
    ...object.variables,
    ...Object.keys(parameters),
  ]);
  const boundedSteps = Math.max(4, Math.min(steps, 24));
  return Array.from({ length: boundedSteps }, (_, yIndex) =>
    Array.from({ length: boundedSteps }, (_, xIndex) => {
      const x =
        object.xDomain[0] +
        ((object.xDomain[1] - object.xDomain[0]) * xIndex) / (boundedSteps - 1);
      const y =
        object.yDomain[0] +
        ((object.yDomain[1] - object.yDomain[0]) * yIndex) / (boundedSteps - 1);
      return [x, y, evaluate({ ...parameters, x, y })] as MathPoint3;
    }),
  );
}
