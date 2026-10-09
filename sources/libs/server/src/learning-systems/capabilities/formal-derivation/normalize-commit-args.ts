function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value : [value];
}

function coerceNonNegativeInt(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return value;
}

function normalizeTree(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  if (Array.isArray(next.operands)) {
    next.operands = next.operands.map(normalizeOperand);
  }
  if (Array.isArray(next.slots)) {
    next.slots = next.slots.map(normalizeSlot);
  }
  return next;
}

function normalizeOperand(operand: unknown): unknown {
  if (!isRecord(operand)) return operand;
  if ("node" in operand) {
    return { ...operand, node: normalizeTree(operand.node) };
  }
  if (typeof operand.kind === "string") {
    return { node: normalizeTree(operand) };
  }
  return operand;
}

function normalizeSlot(slot: unknown): unknown {
  if (!isRecord(slot)) return slot;
  if ("node" in slot) {
    return { ...slot, node: normalizeTree(slot.node) };
  }
  if (typeof slot.kind === "string") {
    return {
      name: typeof slot.name === "string" && slot.name.trim() ? slot.name : "slot",
      node: normalizeTree(slot),
    };
  }
  return slot;
}

function normalizeFormulaSeed(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (!("tree" in value) && typeof value.kind === "string") {
    const { id, label, display, ...tree } = value;
    return {
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof label === "string" ? { label } : {}),
      ...(display && typeof display === "object" ? { display } : {}),
      tree: normalizeTree(tree),
    };
  }
  return {
    ...value,
    tree: "tree" in value ? normalizeTree(value.tree) : value.tree,
  };
}

function normalizeTransform(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  if ("replacement" in next) next.replacement = normalizeTree(next.replacement);
  if ("binding" in next) next.binding = normalizeTree(next.binding);
  if (Array.isArray(next.substitutions)) {
    next.substitutions = next.substitutions.map((item) => {
      if (!isRecord(item)) return item;
      return { ...item, binding: normalizeTree(item.binding) };
    });
  }
  return next;
}

const ACTION_TYPE_ALIASES: Record<string, string> = {
  formula_add: "formula.add",
  "formula-add": "formula.add",
  formula_transform: "formula.transform",
  "formula-transform": "formula.transform",
  formula_set_metadata: "formula.set_metadata",
  subject_set_attribute: "subject.set_attribute",
};

function normalizeAction(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const rawType = typeof value.type === "string" ? value.type : undefined;
  const type = rawType ? (ACTION_TYPE_ALIASES[rawType] ?? rawType) : value.type;
  const next: Record<string, unknown> = { ...value, type };
  if (type === "formula.add") {
    next.formula = normalizeFormulaSeed(next.formula);
  }
  if (type === "formula.transform") {
    next.baseFormulaRevision = coerceNonNegativeInt(next.baseFormulaRevision);
    next.transform = normalizeTransform(next.transform);
  }
  return next;
}

function argsAreEmpty(args: Record<string, unknown>): boolean {
  return Object.keys(args).length === 0;
}

/** Heal transport-shaped commit payloads before the authoritative Zod gate. */
export function normalizeCommitDerivationStepArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (argsAreEmpty(args)) return args;
  const actions = asArray(args.actions)?.map(normalizeAction);
  return {
    ...args,
    baseRevision: coerceNonNegativeInt(args.baseRevision),
    ...(actions ? { actions } : {}),
    presentation: args.presentation == null ? {} : args.presentation,
  };
}
