import type {
  AuthoringTree,
  JsonObject,
  JsonValue,
} from "../../formal-expression-core/src/index.js";
import { coerceGlyphValue, normalizeAuthoringPresentation } from "../../formal-expression-core/src/index.js";
import { DERIVATION_SCHEMA_VERSION } from "./limits.js";
import { DerivationError } from "./errors.js";
import type {
  CommitDerivationStepArgsV1,
  DerivationActionV1,
  DerivationBranchRoleV1,
  DerivationBranchV1,
  DerivationDocumentV1,
  DerivationExpansionMetaV1,
  DerivationPresentationV1,
  DerivationStepMetadataV1,
  DerivationStepV1,
  DerivationSubjectRef,
  FormulaDisplayRoleV1,
  FormulaSeedV1,
  FormulaTransformV1,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDisplayRole(value: unknown): value is FormulaDisplayRoleV1 {
  return (
    value === "definition" ||
    value === "assumption" ||
    value === "working" ||
    value === "theorem" ||
    value === "result" ||
    value === "reference"
  );
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be a non-empty string.`,
    });
  }
  return value;
}

const AUTHORING_LAYOUT_KINDS = new Set([
  "subject",
  "flow",
  "stack",
  "overlay",
  "grid",
  "attach",
  "surround",
  "free",
]);

function parseAuthoringLayout(
  value: unknown,
  path: string,
  repairInvalidLayout: boolean,
): AuthoringTree["layout"] {
  if (value == null) return undefined;
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be a layout object.`,
    });
  }
  if (!AUTHORING_LAYOUT_KINDS.has(value.kind)) {
    if (repairInvalidLayout && value.kind === "invisible") {
      return {
        kind: "flow",
        props: isRecord(value.props) ? (value.props as JsonObject) : undefined,
        includeSelf:
          typeof value.includeSelf === "boolean"
            ? value.includeSelf
            : undefined,
      };
    }
    throw new DerivationError({
      code: "invalid_layout_kind",
      message: `${path}.kind "${value.kind}" is invalid. Use layout.kind "flow" and renderer "invisible" for function application.`,
      retryable: true,
    });
  }
  return {
    kind: value.kind as NonNullable<AuthoringTree["layout"]>["kind"],
    props: isRecord(value.props) ? (value.props as JsonObject) : undefined,
    includeSelf:
      typeof value.includeSelf === "boolean" ? value.includeSelf : undefined,
  };
}

function parseAuthoringTreeNode(
  value: unknown,
  path: string,
  repairInvalidLayout = false,
): AuthoringTree {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be an authoring tree.`,
    });
  }
  const kind = value.kind;
  if (kind === "token") {
    if (!("value" in value)) {
      throw new DerivationError({
        code: "schema_invalid",
        message: `${path}.value is required.`,
      });
    }
    const glyph = coerceGlyphValue(value.value);
    if (!glyph) {
      throw new DerivationError({
        code: "schema_invalid",
        message: `${path}.value must be a plain glyph string, not a nested object.`,
      });
    }
    return {
      kind: "token",
      id: typeof value.id === "string" ? value.id : undefined,
      value: glyph,
      contentType:
        typeof value.contentType === "string" ? value.contentType : undefined,
      renderer: typeof value.renderer === "string" ? value.renderer : undefined,
      attributes: isRecord(value.attributes)
        ? (value.attributes as JsonObject)
        : undefined,
      layout: parseAuthoringLayout(
        value.layout,
        `${path}.layout`,
        repairInvalidLayout,
      ),
    };
  }
  if (kind === "operator") {
    if (typeof value.token !== "string" || !Array.isArray(value.operands)) {
      throw new DerivationError({
        code: "schema_invalid",
        message: `${path} operator requires token and operands.`,
      });
    }
    return {
      ...value,
      layout: parseAuthoringLayout(
        value.layout,
        `${path}.layout`,
        repairInvalidLayout,
      ),
      operands: value.operands.map((operand, index) => {
        if (!isRecord(operand) || !("node" in operand)) {
          throw new DerivationError({
            code: "schema_invalid",
            message: `${path}.operands[${index}] is invalid.`,
          });
        }
        return {
          ...operand,
          node: parseAuthoringTreeNode(
            operand.node,
            `${path}.operands[${index}].node`,
            repairInvalidLayout,
          ),
        };
      }),
    } as AuthoringTree;
  }
  if (kind === "container") {
    if (typeof value.renderer !== "string" || !Array.isArray(value.slots)) {
      throw new DerivationError({
        code: "schema_invalid",
        message: `${path} container requires renderer and slots.`,
      });
    }
    return {
      ...value,
      layout: parseAuthoringLayout(
        value.layout,
        `${path}.layout`,
        repairInvalidLayout,
      ),
      slots: value.slots.map((slot, index) => {
        if (!isRecord(slot) || typeof slot.name !== "string") {
          throw new DerivationError({
            code: "schema_invalid",
            message: `${path}.slots[${index}] is invalid.`,
          });
        }
        return {
          ...slot,
          node: parseAuthoringTreeNode(
            slot.node,
            `${path}.slots[${index}].node`,
            repairInvalidLayout,
          ),
        };
      }),
    } as AuthoringTree;
  }
  if (kind === "placeholder" || kind === "reference") {
    return {
      ...value,
      layout: parseAuthoringLayout(
        value.layout,
        `${path}.layout`,
        repairInvalidLayout,
      ),
    } as unknown as AuthoringTree;
  }
  throw new DerivationError({
    code: "schema_invalid",
    message: `${path} has unknown authoring kind ${kind}.`,
  });
}

function parseAuthoringTree(
  value: unknown,
  path: string,
  repairInvalidLayout = false,
): AuthoringTree {
  return normalizeAuthoringPresentation(
    parseAuthoringTreeNode(value, path, repairInvalidLayout),
  );
}

export function parseFormulaSeed(
  value: unknown,
  path = "formula",
  repairInvalidLayout = false,
): FormulaSeedV1 {
  if (!isRecord(value)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be an object.`,
    });
  }
  return {
    id: requireString(value.id, `${path}.id`),
    label: typeof value.label === "string" ? value.label : undefined,
    tree: parseAuthoringTree(value.tree, `${path}.tree`, repairInvalidLayout),
    display: isRecord(value.display)
      ? {
          role: isDisplayRole(value.display.role)
            ? value.display.role
            : undefined,
          caption:
            typeof value.display.caption === "string"
              ? value.display.caption
              : undefined,
          pinned:
            typeof value.display.pinned === "boolean"
              ? value.display.pinned
              : undefined,
        }
      : undefined,
  };
}

function parseSubjectRef(value: unknown, path: string) {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.id !== "string"
  ) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be a subject reference.`,
    });
  }
  if (
    value.type !== "node" &&
    value.type !== "relation" &&
    value.type !== "layout"
  ) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path}.type is not a supported subject type.`,
    });
  }
  return { type: value.type, id: value.id } as const;
}

function parseDerivationSubjectRef(
  value: unknown,
  path: string,
): DerivationSubjectRef {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be a derivation subject.`,
    });
  }
  if (value.type === "formula") {
    return {
      type: "formula",
      formulaId: requireString(value.formulaId, `${path}.formulaId`),
    };
  }
  if (value.type === "subject") {
    return {
      type: "subject",
      formulaId: requireString(value.formulaId, `${path}.formulaId`),
      subject: parseSubjectRef(value.subject, `${path}.subject`),
    };
  }
  throw new DerivationError({
    code: "schema_invalid",
    message: `${path}.type is not supported.`,
  });
}

export function parseFormulaTransform(
  value: unknown,
  path = "transform",
): FormulaTransformV1 {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be a transform object.`,
    });
  }
  switch (value.type) {
    case "replace_subtree":
      return {
        type: "replace_subtree",
        target: parseSubjectRef(value.target, `${path}.target`),
        replacement: parseAuthoringTree(
          value.replacement,
          `${path}.replacement`,
        ),
      };
    case "relocate_subtree":
      if (
        !Array.isArray(value.moving) ||
        value.moving.length === 0 ||
        value.moving.length > 8
      ) {
        throw new DerivationError({
          code: "schema_invalid",
          message: `${path}.moving must contain one to eight subject references.`,
        });
      }
      return {
        type: "relocate_subtree",
        target: parseSubjectRef(value.target, `${path}.target`),
        replacement: parseAuthoringTree(
          value.replacement,
          `${path}.replacement`,
        ),
        moving: value.moving.map((item, index) =>
          parseSubjectRef(item, `${path}.moving[${index}]`),
        ),
      };
    case "swap_subtrees":
      return {
        type: "swap_subtrees",
        left: parseSubjectRef(value.left, `${path}.left`),
        right: parseSubjectRef(value.right, `${path}.right`),
      };
    case "substitute":
      return {
        type: "substitute",
        target: parseSubjectRef(value.target, `${path}.target`),
        binding: parseAuthoringTree(value.binding, `${path}.binding`),
      };
    case "substitute_many":
      if (
        !Array.isArray(value.substitutions) ||
        value.substitutions.length < 2 ||
        value.substitutions.length > 8
      ) {
        throw new DerivationError({
          code: "schema_invalid",
          message: `${path}.substitutions must contain two to eight substitutions.`,
        });
      }
      return {
        type: "substitute_many",
        substitutions: value.substitutions.map((item, index) => {
          if (!isRecord(item)) {
            throw new DerivationError({
              code: "schema_invalid",
              message: `${path}.substitutions[${index}] must be an object.`,
            });
          }
          return {
            target: parseSubjectRef(
              item.target,
              `${path}.substitutions[${index}].target`,
            ),
            binding: parseAuthoringTree(
              item.binding,
              `${path}.substitutions[${index}].binding`,
            ),
          };
        }),
      };
    case "expand":
    case "simplify":
    case "rewrite_by_definition":
      return {
        type: value.type,
        target: parseSubjectRef(value.target, `${path}.target`),
        ruleId: requireString(value.ruleId, `${path}.ruleId`),
      };
    case "differentiate":
      return {
        type: "differentiate",
        target: parseSubjectRef(value.target, `${path}.target`),
        variable: requireString(value.variable, `${path}.variable`),
        ruleId: requireString(value.ruleId, `${path}.ruleId`),
      };
    case "apply_theorem":
      if (!Array.isArray(value.targets)) {
        throw new DerivationError({
          code: "schema_invalid",
          message: `${path}.targets must be an array.`,
        });
      }
      return {
        type: "apply_theorem",
        theoremId: requireString(value.theoremId, `${path}.theoremId`),
        targets: value.targets.map((item, index) =>
          parseSubjectRef(item, `${path}.targets[${index}]`),
        ),
      };
    default:
      throw new DerivationError({
        code: "unknown_transform",
        message: `Unknown transform type ${String(value.type)}.`,
      });
  }
}

export function parseDerivationAction(
  value: unknown,
  path = "action",
  repairInvalidLayout = false,
): DerivationActionV1 {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be an action object.`,
    });
  }
  switch (value.type) {
    case "formula.add":
      return {
        type: "formula.add",
        formula: parseFormulaSeed(
          value.formula,
          `${path}.formula`,
          repairInvalidLayout,
        ),
        provenance: isRecord(value.provenance)
          ? {
              derivedFromFormulaId: requireString(
                value.provenance.derivedFromFormulaId,
                `${path}.provenance.derivedFromFormulaId`,
              ),
              kind: requireString(
                value.provenance.kind,
                `${path}.provenance.kind`,
              ) as "copy" | "specialize" | "consequence" | "reference",
              subjectMap: Array.isArray(value.provenance.subjectMap)
                ? value.provenance.subjectMap.map((item, index) => {
                    if (!isRecord(item)) {
                      throw new DerivationError({
                        code: "schema_invalid",
                        message: `${path}.provenance.subjectMap[${index}] is invalid.`,
                      });
                    }
                    return {
                      from: parseSubjectRef(
                        item.from,
                        `${path}.provenance.subjectMap[${index}].from`,
                      ),
                      to: parseSubjectRef(
                        item.to,
                        `${path}.provenance.subjectMap[${index}].to`,
                      ),
                    };
                  })
                : undefined,
            }
          : undefined,
      };
    case "formula.transform":
      return {
        type: "formula.transform",
        formulaId: requireString(value.formulaId, `${path}.formulaId`),
        baseFormulaRevision: Number(value.baseFormulaRevision),
        transform: parseFormulaTransform(value.transform, `${path}.transform`),
      };
    case "formula.set_metadata":
      if (!isRecord(value.patch)) {
        throw new DerivationError({
          code: "schema_invalid",
          message: `${path}.patch must be an object.`,
        });
      }
      return {
        type: "formula.set_metadata",
        formulaId: requireString(value.formulaId, `${path}.formulaId`),
        patch: {
          role:
            typeof value.patch.role === "string"
              ? (value.patch.role as never)
              : undefined,
          caption:
            typeof value.patch.caption === "string"
              ? value.patch.caption
              : undefined,
          pinned:
            typeof value.patch.pinned === "boolean"
              ? value.patch.pinned
              : undefined,
        },
      };
    case "subject.set_attribute":
      return {
        type: "subject.set_attribute",
        formulaId: requireString(value.formulaId, `${path}.formulaId`),
        baseFormulaRevision: Number(value.baseFormulaRevision),
        subject: parseSubjectRef(value.subject, `${path}.subject`),
        key: requireString(value.key, `${path}.key`),
        value: value.value as JsonValue,
      };
    default:
      throw new DerivationError({
        code: "unknown_action",
        message: `Unknown action type ${String(value.type)}.`,
      });
  }
}

function isBranchRole(value: unknown): value is DerivationBranchRoleV1 {
  return value === "split" || value === "case" || value === "join";
}

export function parseDerivationBranch(
  value: unknown,
  path = "branch",
): DerivationBranchV1 {
  if (!isRecord(value) || !isBranchRole(value.role)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path}.role must be split, case, or join.`,
    });
  }
  const splitId = requireString(value.splitId, `${path}.splitId`);
  const cases = Array.isArray(value.cases)
    ? value.cases.map((item, index) => {
        if (!isRecord(item)) {
          throw new DerivationError({
            code: "schema_invalid",
            message: `${path}.cases[${index}] is invalid.`,
          });
        }
        return {
          id: requireString(item.id, `${path}.cases[${index}].id`),
          label: requireString(item.label, `${path}.cases[${index}].label`),
          assumption:
            typeof item.assumption === "string" ? item.assumption : undefined,
        };
      })
    : undefined;
  if (value.role === "split") {
    if (!cases?.length) {
      throw new DerivationError({
        code: "schema_invalid",
        message: `${path}.cases is required when role is "split".`,
      });
    }
    return {
      role: "split",
      splitId,
      label: typeof value.label === "string" ? value.label : undefined,
      assumption:
        typeof value.assumption === "string" ? value.assumption : undefined,
      cases,
    };
  }
  if (value.role === "case") {
    return {
      role: "case",
      splitId,
      caseId: requireString(value.caseId, `${path}.caseId`),
      label: typeof value.label === "string" ? value.label : undefined,
      assumption:
        typeof value.assumption === "string" ? value.assumption : undefined,
    };
  }
  return {
    role: "join",
    splitId,
    label: typeof value.label === "string" ? value.label : undefined,
  };
}

export function parsePresentation(
  value: unknown,
  path = "presentation",
): DerivationPresentationV1 {
  if (value == null) return {};
  if (!isRecord(value)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} must be an object.`,
    });
  }
  return {
    narration: Array.isArray(value.narration)
      ? value.narration.map((item, index) => {
          if (!isRecord(item)) {
            throw new DerivationError({
              code: "schema_invalid",
              message: `${path}.narration[${index}] is invalid.`,
            });
          }
          return {
            id: requireString(item.id, `${path}.narration[${index}].id`),
            text: requireString(item.text, `${path}.narration[${index}].text`),
            related: Array.isArray(item.related)
              ? item.related.map((ref, refIndex) =>
                  parseDerivationSubjectRef(
                    ref,
                    `${path}.narration[${index}].related[${refIndex}]`,
                  ),
                )
              : undefined,
          };
        })
      : undefined,
    formulaVisibility: Array.isArray(value.formulaVisibility)
      ? value.formulaVisibility.map((item, index) => {
          if (!isRecord(item)) {
            throw new DerivationError({
              code: "schema_invalid",
              message: `${path}.formulaVisibility[${index}] is invalid.`,
            });
          }
          const state = item.state;
          if (state !== "visible" && state !== "hidden") {
            throw new DerivationError({
              code: "schema_invalid",
              message: `${path}.formulaVisibility[${index}].state is invalid.`,
            });
          }
          return {
            formulaId: requireString(
              item.formulaId,
              `${path}.formulaVisibility[${index}].formulaId`,
            ),
            state,
          };
        })
      : undefined,
    focus: Array.isArray(value.focus)
      ? value.focus.map((item, index) =>
          parseDerivationSubjectRef(item, `${path}.focus[${index}]`),
        )
      : undefined,
    highlight: Array.isArray(value.highlight)
      ? value.highlight.map((item, index) => {
          if (!isRecord(item)) {
            throw new DerivationError({
              code: "schema_invalid",
              message: `${path}.highlight[${index}] is invalid.`,
            });
          }
          return {
            subject: parseDerivationSubjectRef(
              item.subject,
              `${path}.highlight[${index}].subject`,
            ),
            tone: requireString(
              item.tone,
              `${path}.highlight[${index}].tone`,
            ) as never,
            emphasis: requireString(
              item.emphasis,
              `${path}.highlight[${index}].emphasis`,
            ) as never,
          };
        })
      : undefined,
    dimOthers:
      typeof value.dimOthers === "boolean" ? value.dimOthers : undefined,
    pauseMs: typeof value.pauseMs === "number" ? value.pauseMs : undefined,
  };
}

function parseExpansionMeta(
  value: unknown,
  path: string,
): DerivationExpansionMetaV1 | undefined {
  if (!isRecord(value)) return undefined;
  return {
    expansionId: requireString(value.expansionId, `${path}.expansionId`),
    replacesStepId: requireString(
      value.replacesStepId,
      `${path}.replacesStepId`,
    ),
    index: Number(value.index) || 0,
    count: Number(value.count) || 0,
    depth: Number(value.depth) || 0,
  };
}

function parseStepMetadata(
  value: unknown,
  path: string,
): DerivationStepMetadataV1 | undefined {
  if (!isRecord(value)) return undefined;
  return {
    source:
      value.source === "admin" || value.source === "migration"
        ? value.source
        : "agent",
    toolCallId:
      typeof value.toolCallId === "string" ? value.toolCallId : undefined,
    ruleIds: Array.isArray(value.ruleIds)
      ? value.ruleIds.filter(
          (ruleId): ruleId is string => typeof ruleId === "string",
        )
      : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    expansion: parseExpansionMeta(value.expansion, `${path}.expansion`),
    supersededByExpansionId:
      typeof value.supersededByExpansionId === "string"
        ? value.supersededByExpansionId
        : undefined,
  };
}

export function parseDerivationStep(
  value: unknown,
  path: string,
  repairInvalidLayout = false,
): DerivationStepV1 {
  if (!isRecord(value) || !Array.isArray(value.actions)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: `${path} is invalid.`,
    });
  }
  return {
    id: requireString(value.id, `${path}.id`),
    ordinal: Number(value.ordinal),
    baseRevision: Number(value.baseRevision),
    afterRevision: Number(value.afterRevision),
    kind: value.kind === "summary" ? "summary" : "teaching",
    actions: value.actions.map((action, actionIndex) =>
      parseDerivationAction(
        action,
        `${path}.actions[${actionIndex}]`,
        repairInvalidLayout,
      ),
    ),
    presentation: parsePresentation(value.presentation, `${path}.presentation`),
    branch:
      value.branch == null
        ? undefined
        : parseDerivationBranch(value.branch, `${path}.branch`),
    metadata: parseStepMetadata(value.metadata, `${path}.metadata`),
  };
}

export function parseDerivationDocument(value: unknown): DerivationDocumentV1 {
  if (!isRecord(value)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: "Derivation document must be an object.",
    });
  }
  if (value.schemaVersion !== DERIVATION_SCHEMA_VERSION) {
    throw new DerivationError({
      code: "unsupported_schema_version",
      message: `Unsupported derivation schemaVersion ${String(value.schemaVersion)}.`,
    });
  }
  if (!isRecord(value.requirement)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: "requirement is required.",
    });
  }
  if (!Array.isArray(value.initialFormulas) || !Array.isArray(value.steps)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: "initialFormulas and steps must be arrays.",
    });
  }
  return {
    schemaVersion: DERIVATION_SCHEMA_VERSION,
    id: requireString(value.id, "id"),
    title: requireString(value.title, "title"),
    locale: requireString(value.locale, "locale"),
    revision: Number(value.revision) || 0,
    status:
      value.status === "complete" || value.status === "failed"
        ? value.status
        : "draft",
    requirement: {
      text: requireString(value.requirement.text, "requirement.text"),
      assumptions: Array.isArray(value.requirement.assumptions)
        ? value.requirement.assumptions.filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      target:
        typeof value.requirement.target === "string"
          ? value.requirement.target
          : undefined,
    },
    initialFormulas: value.initialFormulas.map((item, index) =>
      parseFormulaSeed(item, `initialFormulas[${index}]`, true),
    ),
    steps: value.steps.map((item, index) =>
      parseDerivationStep(item, `steps[${index}]`, true),
    ),
    archivedSteps: Array.isArray(value.archivedSteps)
      ? value.archivedSteps.map((item, index) =>
          parseDerivationStep(item, `archivedSteps[${index}]`, true),
        )
      : undefined,
    completion: isRecord(value.completion)
      ? {
          validatedRevision: Number(value.completion.validatedRevision),
          validationLevel:
            value.completion.validationLevel === "rule_checked"
              ? "rule_checked"
              : "formal",
          summary: requireString(
            value.completion.summary,
            "completion.summary",
          ),
          completedAt: requireString(
            value.completion.completedAt,
            "completion.completedAt",
          ),
        }
      : undefined,
  };
}

export function parseCommitDerivationStepArgs(
  value: unknown,
): CommitDerivationStepArgsV1 {
  if (!isRecord(value)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: "commit_derivation_step arguments must be an object.",
    });
  }
  if (!Array.isArray(value.actions)) {
    throw new DerivationError({
      code: "schema_invalid",
      message: "actions must be an array.",
    });
  }
  const source =
    value.source === "admin" ||
    value.source === "migration" ||
    value.source === "agent"
      ? value.source
      : undefined;
  return {
    baseRevision: Number(value.baseRevision),
    summary: requireString(value.summary, "summary"),
    actions: value.actions.map((action, index) =>
      parseDerivationAction(action, `actions[${index}]`),
    ),
    presentation: parsePresentation(value.presentation),
    branch:
      value.branch == null ? undefined : parseDerivationBranch(value.branch),
    kind: value.kind === "summary" ? "summary" : "teaching",
    source,
    toolCallId:
      typeof value.toolCallId === "string" && value.toolCallId.trim()
        ? value.toolCallId
        : undefined,
    ruleIds: Array.isArray(value.ruleIds)
      ? value.ruleIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : undefined,
    stepId:
      typeof value.stepId === "string" && value.stepId.trim()
        ? value.stepId
        : undefined,
  };
}
