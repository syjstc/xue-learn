import type {
  ChemistryLabDefinition,
  PhysicsLabDefinition,
} from "@xue-learn/core/domain";
import {
  chemistrySceneToManifestScene,
  createChemistryScene,
} from "@xue-learn/core/lab-engine";
import type { LabManifestV1 } from "@xue-learn/core/lab-protocol";

function physicsFallbackScene(block: PhysicsLabDefinition): LabManifestV1["scene"] {
  const inclined = block.experimentId === "inclined_plane_friction";
  return {
    version: 1,
    environment: { background: "#1b242c", grid: false, ground: false, ambientIntensity: 0.42 },
    camera: { position: [6.4, 4.2, 7.1], target: [0, 1.05, 0], fov: 36, minDistance: 3.2, maxDistance: 14 },
    lights: [{ kind: "directional", position: [5.5, 9, 4.2], intensity: 2.1, castShadow: true }],
    components: inclined
      ? [
          { id: "lab-room", type: "lab_backdrop", position: [0, 0, 0], props: { width: 11, variant: "physics" } },
          { id: "platform", type: "platform", position: [0, -0.18, 0], props: { width: 7.2, depth: 2.6, height: 0.28, color: "#3d4a57" } },
          { id: "incline", type: "ramp", position: [-2.6, 0.08, 0], props: { length: 5.2, width: 1.55, thickness: 0.18, angleDeg: block.parameters.angle ?? 30, color: "#c47a3a" }, interaction: { id: "incline-play", label: "斜面", actionId: "play", mode: "activate" as const } },
          { id: "cart", type: "cart", position: [1.1, 1, 0], props: { width: 0.82, depth: 0.58, height: 0.32, wheelRadius: 0.13, color: "#3f7ecf" } },
        ]
      : [
          { id: "lab-room", type: "lab_backdrop", position: [0, 0, 0], props: { width: 11, variant: "physics" } },
          { id: "platform", type: "platform", position: [0, 0, 0], props: { width: 6.2, depth: 2.4, height: 0.28, color: "#3d4a57" } },
          { id: "cart", type: "cart", position: [0, 0.5, 0], props: { width: 0.9, depth: 0.7, height: 0.35, color: "#3f7ecf" }, interaction: { id: "cart-play", label: "实验器材", actionId: "play", mode: "activate" as const } },
        ],
  };
}

export function physicsLabManifest(block: PhysicsLabDefinition): LabManifestV1 {
  return {
    type: "lab_manifest",
    protocolVersion: 1,
    manifestVersion: 1,
    domain: "physics",
    experimentId: block.experimentId,
    experimentVersion: block.experimentVersion,
    title: block.title,
    summary: block.summary,
    learningIntent: block.targetObservation ?? block.summary,
    parameters: block.parameters,
    actionIds: ["play", "pause", "reset", "finish"],
    scene: physicsFallbackScene(block),
    ...(block.targetObservation ? { targetObservation: block.targetObservation } : {}),
  };
}

export function chemistryLabManifest(block: ChemistryLabDefinition): LabManifestV1 {
  const actionIds = block.experimentId === "acid_base_indicator"
    ? ["add-phenolphthalein", "add-acid", "add-base", "mix-sample", "reset", "finish"]
    : block.experimentId === "acid_base_titration"
      ? ["titrate", "mix-flask", "reset", "finish"]
      : block.experimentId === "precipitation_reaction"
        ? ["transfer-silver", "transfer-chloride", "mix-mixing", "reset", "finish"]
        : ["tare-scale", "measure-closed", "mix-closed", "reset", "finish"];
  return {
    type: "lab_manifest",
    protocolVersion: 1,
    manifestVersion: 1,
    domain: "chemistry",
    experimentId: block.experimentId,
    experimentVersion: block.experimentVersion,
    title: block.title,
    summary: block.summary,
    learningIntent: block.targetObservation ?? block.summary,
    parameters: block.parameters,
    actionIds: [...new Set(actionIds)],
    scene: chemistrySceneToManifestScene(createChemistryScene(block)),
    ...(block.targetObservation ? { targetObservation: block.targetObservation } : {}),
  };
}

export function labManifestFromLegacyBlock(block: unknown): LabManifestV1 | null {
  if (!block || typeof block !== "object") return null;
  const value = block as { type?: unknown };
  if (value.type === "physics_lab") return physicsLabManifest(block as PhysicsLabDefinition);
  if (value.type === "chemistry_lab") return chemistryLabManifest(block as ChemistryLabDefinition);
  return null;
}
