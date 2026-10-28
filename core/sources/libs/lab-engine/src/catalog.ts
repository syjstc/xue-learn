import {
  applyChemistryOperation,
  getChemistryExperiment,
  normalizeChemistryLabDefinition,
  type ChemistryLabDefinition,
  type ChemistryLabSnapshot,
  type ChemistryOperation,
} from "../../domain/src/chemistry-lab.js";
import {
  getPhysicsExperiment,
  normalizePhysicsLabDefinition,
  type PhysicsLabDefinition,
} from "../../domain/src/physics-lab.js";
import type { LabManifestV1 } from "../../lab-protocol/src/index.js";

/**
 * The certified experiment boundary consumed by the standalone Lab runtime.
 * This module deliberately exposes only deterministic catalog operations; it
 * has no UI, persistence, network, learner, or model dependencies.
 */
export {
  applyChemistryOperation,
  getChemistryExperiment,
  normalizeChemistryLabDefinition,
  getPhysicsExperiment,
  normalizePhysicsLabDefinition,
};
export type {
  ChemistryLabDefinition,
  ChemistryLabSnapshot,
  ChemistryOperation,
  PhysicsLabDefinition,
};

export type CertifiedLabEvaluation = {
  observations: readonly { id: string; label: string; value: number | string; unit?: string; kind?: string }[];
  chemistrySnapshot?: ChemistryLabSnapshot;
};

export function evaluateCertifiedManifest(
  domain: "physics" | "chemistry",
  experimentId: string,
  experimentVersion: number,
  parameters: Record<string, number>,
  chemistrySnapshot?: ChemistryLabSnapshot,
): CertifiedLabEvaluation | null {
  if (domain === "physics") {
    const experiment = getPhysicsExperiment(experimentId, experimentVersion);
    if (!experiment) return null;
    return experiment.evaluate(parameters);
  }
  const definition = normalizeChemistryLabDefinition({
    experimentId,
    experimentVersion,
    parameters,
    snapshot: chemistrySnapshot,
  });
  if (!definition) return null;
  return { observations: definition.observations ?? [], chemistrySnapshot: definition.snapshot };
}

export function normalizeCertifiedParameters(
  domain: "physics" | "chemistry",
  experimentId: string,
  experimentVersion: number,
  parameters: Record<string, number>,
) {
  if (domain === "physics") {
    const experiment = getPhysicsExperiment(experimentId, experimentVersion);
    if (!experiment) return null;
    const definition = normalizePhysicsLabDefinition({
      experimentId: experiment.id,
      experimentVersion: experiment.version,
      parameters,
    });
    return definition?.parameters ?? null;
  }
  const experiment = getChemistryExperiment(experimentId, experimentVersion);
  if (!experiment) return null;
  const definition = normalizeChemistryLabDefinition({
    experimentId: experiment.id,
    experimentVersion: experiment.version,
    parameters,
  });
  return definition?.parameters ?? null;
}

export function validateCertifiedParameter(
  domain: "physics" | "chemistry",
  experimentId: string,
  experimentVersion: number,
  id: string,
  value: number,
) {
  const experiment = domain === "physics"
    ? getPhysicsExperiment(experimentId, experimentVersion)
    : getChemistryExperiment(experimentId, experimentVersion);
  const spec = experiment?.parameters.find((candidate) => candidate.id === id);
  if (!spec) return { valid: false as const, code: "unknown_parameter", message: "实验不支持该参数。" };
  if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
    return { valid: false as const, code: "parameter_out_of_bounds", message: `${spec.label}必须在 ${spec.min} 到 ${spec.max} ${spec.unit} 范围内。` };
  }
  return { valid: true as const, spec };
}

export function certifiedActionIds(domain: "physics" | "chemistry", experimentId: string) {
  if (domain === "physics") return new Set(["play", "pause", "reset", "finish"]);
  const actions: Record<string, readonly string[]> = {
    acid_base_indicator: ["add-phenolphthalein", "add-acid", "add-base", "mix-sample", "reset", "finish"],
    acid_base_titration: ["titrate", "mix-flask", "reset", "finish"],
    precipitation_reaction: ["transfer-silver", "transfer-chloride", "mix-mixing", "reset", "finish"],
    mass_conservation: ["tare-scale", "measure-closed", "mix-closed", "reset", "finish"],
  };
  return new Set(actions[experimentId] ?? ["reset", "finish"]);
}

export function validateCertifiedManifest(manifest: LabManifestV1) {
  const errors: string[] = [];
  const experiment = manifest.domain === "physics"
    ? getPhysicsExperiment(manifest.experimentId, manifest.experimentVersion)
    : getChemistryExperiment(manifest.experimentId, manifest.experimentVersion);
  if (!experiment) return [`unknown certified experiment: ${manifest.domain}/${manifest.experimentId}@${manifest.experimentVersion}`];
  const allowedActions = certifiedActionIds(manifest.domain, manifest.experimentId);
  for (const actionId of manifest.actionIds) {
    if (!allowedActions.has(actionId)) errors.push(`action is not compatible with experiment: ${actionId}`);
  }
  for (const spec of experiment.parameters) {
    const value = manifest.parameters[spec.id];
    if (value !== undefined && (!Number.isFinite(value) || value < spec.min || value > spec.max)) {
      errors.push(`parameter is out of bounds: ${spec.id}`);
    }
  }
  return errors;
}

export function applyCertifiedChemistryAction(
  definition: ChemistryLabDefinition,
  operation: ChemistryOperation,
) {
  return applyChemistryOperation(definition, operation);
}
