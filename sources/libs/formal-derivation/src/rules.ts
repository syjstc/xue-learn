import {
  decompileAuthoringTree,
  type AuthoringTree,
  type FormalDocument,
  type SubjectRef,
} from "../../formal-expression-core/src/index.js";
import { findAuthoringNode, tok } from "./authoring.js";
import { DerivationError } from "./errors.js";
import { REGISTERED_RULE_IDS } from "./limits.js";
import type { FormulaTransformV1, MaterializedDerivationStateV1 } from "./types.js";

export interface RuleApplication {
  validationLevel: "formal" | "rule_checked";
  establishedFacts?: string[];
  replacement?: AuthoringTree;
}

export interface RuleContext {
  ruleId: string;
  transform?: FormulaTransformV1;
  formulaId?: string;
  document?: FormalDocument;
  target?: SubjectRef;
  state: MaterializedDerivationStateV1;
}

function factSet(state: MaterializedDerivationStateV1) {
  return new Set(state.facts);
}

function nodeValue(document: FormalDocument, target?: SubjectRef): string | undefined {
  if (!target || target.type !== "node") return undefined;
  const node = document.nodes[target.id];
  if (!node) return undefined;
  return node.value == null ? undefined : String(node.value);
}

function requireTargetValue(
  document: FormalDocument | undefined,
  target: SubjectRef | undefined,
  expected: string | string[],
  message: string,
) {
  if (!document || !target) {
    throw new DerivationError({ code: "rule_precondition", message });
  }
  const value = nodeValue(document, target);
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!value || !allowed.includes(value)) {
    throw new DerivationError({
      code: "rule_precondition",
      message,
    });
  }
}

export function assertRegisteredRule(ruleId: string) {
  if (!REGISTERED_RULE_IDS.includes(ruleId)) {
    throw new DerivationError({
      code: "unknown_rule",
      message: `Unknown ruleId ${ruleId}.`,
    });
  }
}

export function applyRegisteredRule(context: RuleContext): RuleApplication {
  assertRegisteredRule(context.ruleId);
  const facts = factSet(context.state);
  switch (context.ruleId) {
    case "define_secant_slope":
      return {
        validationLevel: "rule_checked",
        establishedFacts: ["slope_defined"],
      };
    case "define_auxiliary_function": {
      const established = ["phi_defined"];
      if (facts.has("f_continuous_ab")) established.push("phi_continuous");
      if (facts.has("f_differentiable_ab")) established.push("phi_differentiable");
      return { validationLevel: "rule_checked", establishedFacts: established };
    }
    case "substitute_endpoint": {
      requireTargetValue(
        context.document,
        context.target,
        "x",
        "Endpoint substitution must target the variable x.",
      );
      const binding =
        context.transform?.type === "substitute" ? context.transform.binding : undefined;
      const boundValue =
        binding && binding.kind === "token" ? String(binding.value) : undefined;
      if (boundValue !== "a" && boundValue !== "b") {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Endpoint substitution binding must be a or b.",
        });
      }
      return {
        validationLevel: "rule_checked",
        establishedFacts: [`phi_at_${boundValue}_substituted`],
        replacement: binding,
      };
    }
    case "substitute_definition": {
      if (!facts.has("slope_defined")) {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Cannot substitute the secant slope before it is defined.",
        });
      }
      requireTargetValue(
        context.document,
        context.target,
        "m",
        "Definition substitution must target m.",
      );
      return {
        validationLevel: "rule_checked",
        establishedFacts: ["slope_substituted"],
        replacement:
          context.transform?.type === "substitute"
            ? context.transform.binding
            : undefined,
      };
    }
    case "cancel_nonzero_factor": {
      if (!facts.has("b_minus_a_nonzero")) {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Cannot cancel b-a until b-a ≠ 0 has been established.",
        });
      }
      if (!context.document || !context.target || context.target.type !== "node") {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Cancellation requires a b-a factor target.",
        });
      }
      const tree = decompileAuthoringTree(context.document);
      const targetNode = findAuthoringNode(tree, context.target.id);
      if (!targetNode) {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Cancellation target is not in this formula.",
        });
      }
      return {
        validationLevel: "rule_checked",
        establishedFacts: ["canceled_b_minus_a"],
      };
    }
    case "differentiate_difference": {
      if (!facts.has("phi_defined")) {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Differentiate the auxiliary function only after it is defined.",
        });
      }
      return {
        validationLevel: "rule_checked",
        establishedFacts: ["phi_differentiated"],
      };
    }
    case "rolle_theorem": {
      const missing: string[] = [];
      if (!facts.has("phi_continuous")) missing.push("continuity of φ on [a,b]");
      if (!facts.has("phi_differentiable")) missing.push("differentiability of φ on (a,b)");
      if (!facts.has("phi_endpoints_equal")) missing.push("φ(a)=φ(b)");
      if (missing.length) {
        throw new DerivationError({
          code: "rule_precondition",
          message: `Rolle's theorem requires: ${missing.join("; ")}.`,
        });
      }
      return {
        validationLevel: "rule_checked",
        establishedFacts: ["rolle_applied"],
      };
    }
    case "solve_linear_equality": {
      if (!facts.has("rolle_applied")) {
        throw new DerivationError({
          code: "rule_precondition",
          message: "Solve the derivative equality only after Rolle's theorem is applied.",
        });
      }
      return {
        validationLevel: "rule_checked",
        establishedFacts: ["linear_equality_solved"],
      };
    }
    default:
      throw new DerivationError({
        code: "unknown_rule",
        message: `Unknown ruleId ${context.ruleId}.`,
      });
  }
}

export function seedFactsFromRequirement(text: string, assumptions: string[] = []): string[] {
  const blob = [text, ...assumptions].join("\n");
  const facts: string[] = [];
  if (/连续|continuous/i.test(blob)) facts.push("f_continuous_ab");
  if (/可导|differentiable/i.test(blob)) facts.push("f_differentiable_ab");
  if (/a\s*<\s*b/.test(blob)) facts.push("interval_ordered");
  return facts;
}

function treeSignature(tree: AuthoringTree): string {
  if (tree.kind === "token") return `token:${String(tree.value)}`;
  if (tree.kind === "operator") {
    return `op:${tree.token}:${tree.operands.map((item) => treeSignature(item.node)).join(",")}`;
  }
  if (tree.kind === "container") {
    return `container:${tree.renderer}:${tree.slots
      .map((slot) => `${slot.name}:${treeSignature(slot.node)}`)
      .join(",")}`;
  }
  if (tree.kind === "placeholder") return `placeholder:${tree.label ?? ""}`;
  return `ref:${tree.targetId}`;
}

export function equalityRhs(document: FormalDocument): string | undefined {
  const tree = decompileAuthoringTree(document);
  if (tree.kind !== "operator" || tree.token !== "=") return undefined;
  const right = tree.operands[1]?.node;
  return right ? treeSignature(right) : undefined;
}

export function maybeEstablishEndpointEquality(
  state: MaterializedDerivationStateV1,
): string[] {
  const phiA = state.formulas.phi_at_a;
  const phiB = state.formulas.phi_at_b;
  if (!phiA || !phiB) return [];
  const left = equalityRhs(phiA.document);
  const right = equalityRhs(phiB.document);
  if (left && right && left === right) return ["phi_endpoints_equal"];
  return [];
}

export function tokenReplacement(value: string, id?: string): AuthoringTree {
  return tok(value, id);
}
