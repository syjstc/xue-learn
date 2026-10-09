import { calculateInclinedPlane } from "../../domain/src/index.js";
import type { LabSceneDefinition } from "./types.js";

const PHYSICS_STUDIO = {
  background: "#1b242c",
  grid: false,
  ground: false,
  ambientIntensity: 0.42,
} as const;

/**
 * Certified physics layout. Domain equations stay in evaluate(); this only
 * maps parameters and elapsed time onto registered scene components.
 */
export function createPhysicsScene(
  experimentId: string,
  parameters: Record<string, number>,
  simTime = 0,
): LabSceneDefinition {
  if (experimentId === "inclined_plane_friction") {
    return createInclinedPlaneScene({
      mass: parameters.mass ?? 1,
      angleDeg: parameters.angle ?? 30,
      simTime,
    });
  }
  return createPhysicsStudioScene(experimentId);
}

export function createInclinedPlaneScene({
  mass,
  angleDeg,
  simTime,
}: {
  mass: number;
  angleDeg: number;
  simTime: number;
}): LabSceneDefinition {
  const result = calculateInclinedPlane(mass, angleDeg);
  const angle = (angleDeg * Math.PI) / 180;
  const length = 5.2;
  const travel = Math.min(length - 0.9, result.positionAtTime(simTime));
  const alongRamp = length - 0.8 - travel;
  const rampOriginX = -length / 2;
  const cartPosition: [number, number, number] = [
    rampOriginX + alongRamp * Math.cos(angle),
    0.42 + alongRamp * Math.sin(angle),
    0,
  ];
  const trailPoints: Array<[number, number, number]> = [];
  const sampleCount = 16;
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = (simTime * index) / sampleCount;
    const sampleTravel = Math.min(length - 0.9, result.positionAtTime(t));
    const sampleAlongRamp = length - 0.8 - sampleTravel;
    trailPoints.push([
      rampOriginX + sampleAlongRamp * Math.cos(angle),
      0.28 + sampleAlongRamp * Math.sin(angle),
      0.42,
    ]);
  }

  return {
    version: 1,
    capabilities: {
      controls: ["mass", "angle", "mu", "g"],
      observations: ["acceleration", "normal_force", "parallel_force", "friction_force"],
      renderMode: "3d",
      supportsSampling: true,
      supportsAnalysis: false,
    },
    environment: PHYSICS_STUDIO,
    camera: {
      position: [6.4, 4.2, 7.1],
      target: [0, 1.05, 0],
      fov: 36,
      minDistance: 3.2,
      maxDistance: 14,
    },
    lights: [
      { kind: "directional", position: [5.5, 9, 4.2], intensity: 2.1, castShadow: true },
      { kind: "directional", position: [-5, 3.4, -3.2], color: "#8fb4d2", intensity: 0.55 },
      { kind: "point", position: [0.4, 4.6, 2.4], color: "#ffe8c8", intensity: 0.85 },
    ],
    components: [
      {
        id: "lab-room",
        type: "lab_backdrop",
        position: [0, 0, 0],
        props: { width: 11, variant: "physics" },
      },
      {
        id: "platform",
        type: "platform",
        position: [0, -0.18, 0],
        props: { width: 7.2, depth: 2.6, height: 0.28, color: "#3d4a57" },
      },
      {
        id: "incline",
        type: "ramp",
        position: [rampOriginX, 0.08, 0],
        props: { length, width: 1.55, thickness: 0.18, angleDeg, color: "#c47a3a" },
        interaction: {
          id: "play",
          label: "斜面轨道",
          actionLabel: "开始运动",
          mode: "activate",
        },
      },
      {
        id: "cart",
        type: "cart",
        position: cartPosition,
        rotation: [0, 0, angle],
        props: { width: 0.82, depth: 0.58, height: 0.32, wheelRadius: 0.13, color: "#3f7ecf" },
      },
    ],
    vectors: [
      {
        id: "gravity",
        origin: [cartPosition[0], cartPosition[1] + 0.22, 0],
        vector: [0, -1.25, 0],
        color: "#ef5d73",
        label: "G",
      },
      {
        id: "normal",
        origin: [cartPosition[0], cartPosition[1], 0],
        vector: [-Math.sin(angle) * 0.95, Math.cos(angle) * 0.95, 0],
        color: "#2ec9b3",
        label: "N",
      },
      {
        id: "parallel",
        origin: [cartPosition[0], cartPosition[1] + 0.05, 0.05],
        vector: [-Math.cos(angle) * 0.9, -Math.sin(angle) * 0.9, 0],
        color: "#f0a43a",
        label: "G∥",
      },
    ],
    trails: [{ id: "cart-trail", points: trailPoints, color: "#7eb6ff", width: 2.5 }],
    labels: [
      {
        id: "mass-label",
        text: `${mass} kg`,
        position: [cartPosition[0], cartPosition[1] + 0.62, 0],
        color: "#e8f1f6",
        emphasis: true,
      },
      {
        id: "angle-label",
        text: `θ = ${angleDeg}°`,
        position: [rampOriginX + 1.1, 0.22, 0.9],
        color: "#d5e4ee",
      },
    ],
  };
}

function createPhysicsStudioScene(experimentId: string): LabSceneDefinition {
  return {
    version: 1,
    capabilities: {
      controls: ["play", "pause", "reset"],
      observations: [],
      renderMode: "3d",
      supportsSampling: true,
      supportsAnalysis: false,
    },
    environment: PHYSICS_STUDIO,
    camera: {
      position: [6.2, 3.8, 6.8],
      target: [0, 1, 0],
      fov: 38,
      minDistance: 3,
      maxDistance: 14,
    },
    lights: [
      { kind: "directional", position: [4.5, 8, 5], intensity: 1.8, castShadow: true },
      { kind: "point", position: [-2.5, 3.4, 2], color: "#c9e4ff", intensity: 0.6 },
    ],
    components: [
      {
        id: "lab-room",
        type: "lab_backdrop",
        position: [0, 0, 0],
        props: { width: 11, variant: "physics" },
      },
      {
        id: "platform",
        type: "platform",
        position: [0, 0, 0],
        props: { width: 6.2, depth: 2.4, height: 0.28, color: "#3d4a57" },
      },
      {
        id: "apparatus",
        type: "cart",
        position: [0, 0.48, 0],
        props: { width: 0.9, depth: 0.7, height: 0.35, color: "#3f7ecf" },
        interaction: {
          id: "play",
          label: experimentId,
          actionLabel: "开始探索",
          mode: "activate",
        },
      },
    ],
  };
}
