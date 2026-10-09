import {
  validateLabManifest,
  type LabManifestV1,
} from "../../../lab-protocol/src/index.js";
import { getChemistryExperiment } from "../../../domain/src/chemistry-lab.js";
import { getPhysicsExperiment } from "../../../domain/src/physics-lab.js";

type LegacyLabBlock = {
  type?: unknown;
  experimentId?: unknown;
  experimentVersion?: unknown;
  title?: unknown;
  summary?: unknown;
  targetObservation?: unknown;
  parameters?: unknown;
};

const stringValue = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const parametersValue = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      typeof item === "number" && Number.isFinite(item) ? [[key, item]] : [],
    ),
  );
};

/** Deterministic migration/fallback manifest. LLM authored scenes can replace
 * this scene later, but scientific identity and parameters remain stable. */
export function manifestFromLegacyLabBlock(block: LegacyLabBlock): LabManifestV1 | null {
  const domain = block.type === "chemistry_lab" ? "chemistry" : block.type === "physics_lab" ? "physics" : null;
  if (!domain || typeof block.experimentId !== "string") return null;
  const experimentId = block.experimentId;
  const experimentVersion = typeof block.experimentVersion === "number"
    ? block.experimentVersion
    : domain === "physics" ? 2 : 1;
  const certified = domain === "physics"
    ? getPhysicsExperiment(experimentId, experimentVersion)
    : getChemistryExperiment(experimentId, experimentVersion);
  if (!certified) return null;
  const actionIds = domain === "chemistry"
    ? chemistryActionIds(experimentId)
    : ["play", "pause", "reset", "finish"];
  const scene = domain === "chemistry"
    ? {
        version: 1 as const,
        environment: { background: "#d7e1dd", grid: false, ground: false, ambientIntensity: 0.62 },
        camera: { position: [6.7, 4.25, 7.4] as [number, number, number], target: [0, 1.25, 0] as [number, number, number], fov: 37, minDistance: 4, maxDistance: 12 },
        components: [
          { id: "lab-room", type: "lab_backdrop", props: { width: 9 } },
          { id: "lab-bench", type: "lab_tray", position: [0, 0.78, 0.1] as [number, number, number] },
          { id: "reaction-vessel", type: experimentId === "precipitation_reaction" ? "test_tube" : "beaker", position: [0, 0.84, 0.05] as [number, number, number], interaction: { id: "mix", label: "反应容器", actionId: chemistryMixAction(experimentId), mode: "activate" as const } },
        ],
      }
    : {
        version: 1 as const,
        environment: { background: "#edf2f7", grid: true, ground: true, ambientIntensity: 0.72 },
        camera: { position: [6.8, 4.8, 7.4] as [number, number, number], target: [0, 1.1, 0] as [number, number, number], fov: 40, minDistance: 3, maxDistance: 14 },
        lights: [{ kind: "directional" as const, position: [4, 8, 5] as [number, number, number], intensity: 1.25, castShadow: true }],
        components: [
          { id: "reference-plane", type: "reference_plane", position: [0, -0.02, 0] as [number, number, number], props: { width: 8, depth: 4.8 } },
          { id: "platform", type: "platform", position: [0, -0.24, 0] as [number, number, number], props: { width: 6.8, depth: 2.4, height: 0.32, color: "#b9c9dc" } },
          { id: "experiment", type: "ramp", position: [-2.6, 0.05, 0] as [number, number, number], props: { length: 5.2, width: 1.65, thickness: 0.24, color: "#dc9560" }, interaction: { id: "play", label: "开始实验", actionId: "play", mode: "activate" as const } },
          { id: "cart", type: "cart", position: [1.1, 1, 0] as [number, number, number], props: { width: 0.78, depth: 0.62, height: 0.34, color: "#4f7cc7" } },
        ],
      };
  const candidate = {
    type: "lab_manifest" as const,
    protocolVersion: 1 as const,
    manifestVersion: 1 as const,
    domain,
    experimentId,
    experimentVersion,
    title: stringValue(block.title, "互动实验"),
    summary: stringValue(block.summary, "互动实验"),
    learningIntent: stringValue(block.targetObservation, stringValue(block.summary, "观察实验现象")),
    parameters: parametersValue(block.parameters),
    actionIds,
    scene,
    ...(typeof block.targetObservation === "string" ? { targetObservation: block.targetObservation } : {}),
  };
  const result = validateLabManifest(candidate);
  return result.success ? result.data : null;
}

function chemistryActionIds(experimentId: string) {
  switch (experimentId) {
    case "acid_base_indicator": return ["add-phenolphthalein", "add-acid", "add-base", "mix-sample", "reset", "finish"];
    case "acid_base_titration": return ["titrate", "mix-flask", "reset", "finish"];
    case "precipitation_reaction": return ["transfer-silver", "transfer-chloride", "mix-mixing", "reset", "finish"];
    case "mass_conservation": return ["tare-scale", "measure-closed", "mix-closed", "reset", "finish"];
    default: return ["reset", "finish"];
  }
}

function chemistryMixAction(experimentId: string) {
  switch (experimentId) {
    case "acid_base_indicator": return "mix-sample";
    case "acid_base_titration": return "mix-flask";
    case "precipitation_reaction": return "mix-mixing";
    case "mass_conservation": return "mix-closed";
    default: return "finish";
  }
}

/** Server-side authority check layered on top of the transport manifest schema. */
export function validateCertifiedLabManifest(manifest: LabManifestV1): string[] {
  const experiment = manifest.domain === "physics"
    ? getPhysicsExperiment(manifest.experimentId, manifest.experimentVersion)
    : getChemistryExperiment(manifest.experimentId, manifest.experimentVersion);
  if (!experiment) return [`unknown certified experiment: ${manifest.domain}/${manifest.experimentId}@${manifest.experimentVersion}`];
  const allowedActions = manifest.domain === "physics"
    ? new Set(["play", "pause", "reset", "finish"])
    : new Set(chemistryActionIds(manifest.experimentId));
  const errors = manifest.actionIds
    .filter((actionId) => !allowedActions.has(actionId))
    .map((actionId) => `action is not compatible with experiment: ${actionId}`);
  for (const spec of experiment.parameters) {
    const value = manifest.parameters[spec.id];
    if (value !== undefined && (!Number.isFinite(value) || value < spec.min || value > spec.max)) {
      errors.push(`parameter is out of bounds: ${spec.id}`);
    }
  }
  return errors;
}
