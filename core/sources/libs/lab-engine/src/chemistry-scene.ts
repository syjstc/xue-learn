import type { ChemistryLabDefinition } from "../../domain/src/chemistry-lab.js";
import type { LabManifestV1 } from "../../lab-protocol/src/index.js";
import type { LabComponentInstance, LabSceneDefinition } from "./types.js";

/**
 * Certified chemistry bench layout. Domain state stays in the definition;
 * this only maps vessels and tools onto registered scene components.
 */
export function createChemistryScene(
  block: ChemistryLabDefinition,
): LabSceneDefinition {
  const snapshot = block.snapshot;
  const reaction = snapshot?.vessels.find((vessel) =>
    ["sample", "mixing", "flask", "closed"].includes(vessel.id),
  );
  const targetId = "reaction-vessel";
  const tool = (
    id: string,
    type: string,
    position: readonly [number, number, number],
    label: string,
    actionLabel: string,
    interactionId: string,
    color: string,
    animation: string = "pour",
  ): LabComponentInstance => ({
    id,
    type,
    position,
    props: {
      color,
      label,
      labelOffsetY: type === "reagent_bottle" ? 1.15 : 1.22,
      labelScale: type === "reagent_bottle" ? 0.72 : 0.86,
      animation,
      animationKey: snapshot?.step ?? 0,
    },
    interaction: {
      id: interactionId,
      label,
      actionLabel,
      mode: "drag",
      allowedTargetIds: [targetId],
    },
  });
  const mixInteraction =
    block.experimentId === "acid_base_titration"
      ? "mix-flask"
      : block.experimentId === "precipitation_reaction"
        ? "mix-mixing"
        : block.experimentId === "mass_conservation"
          ? "mix-closed"
          : "mix-sample";
  const components: LabComponentInstance[] = [
    {
      id: "lab-room",
      type: "lab_backdrop",
      position: [0, 0, 0],
      props: { width: 9 },
    },
    {
      id: "lab-bench",
      type: "lab_bench",
      position: [0, 0, 0],
      props: {
        width: 7.6,
        depth: 2.55,
        height: 0.92,
        color: "#4f6d6a",
      },
    },
    { id: "task-tray", type: "lab_tray", position: [0, 0.96, 0.18] },
    {
      id: targetId,
      type: "beaker",
      position: [0, 1.02, 0.12],
      props: {
        width: 1.1,
        height: 1.45,
        volumeMl: reaction?.volumeMl ?? 0,
        maxVolumeMl: 100,
        liquidColor: chemistryColor(snapshot?.indicatorColor),
        precipitateG: snapshot?.precipitateG ?? 0,
        label: "反应烧杯",
        labelOffsetY: 1.72,
        animation: "mix",
        animationKey: snapshot?.step ?? 0,
      },
      interaction: {
        id: mixInteraction,
        label: "反应烧杯",
        actionLabel: "混匀观察",
        mode: "target",
      },
    },
  ];
  if (block.experimentId === "acid_base_indicator") {
    components.push(
      tool(
        "indicator-dropper",
        "dropper",
        [-1.9, 1.0, 0.08],
        "酚酞滴管",
        "滴加酚酞",
        "add-phenolphthalein",
        "#c04d72",
      ),
      tool(
        "acid-bottle",
        "reagent_bottle",
        [1.45, 1.0, 0.08],
        "盐酸",
        "滴加盐酸",
        "add-acid",
        "#b8824d",
      ),
      tool(
        "base-bottle",
        "reagent_bottle",
        [2.15, 1.0, 0.08],
        "氢氧化钠",
        "滴加氢氧化钠",
        "add-base",
        "#688fa0",
      ),
    );
  }
  if (block.experimentId === "acid_base_titration") {
    components.push(
      {
        id: "burette-stand",
        type: "burette_stand",
        position: [-1.35, 0.96, 0.08],
      },
      {
        id: "burette",
        type: "burette",
        position: [-1.55, 1.34, 0.08],
        props: {
          height: 2.7,
          volumeMl: snapshot?.titrantVolumeMl ?? 0,
          maxVolumeMl: 100,
          liquidColor: "#e7c66b",
          label: "滴定管",
          labelOffsetY: 3.05,
          animation: "pour",
          animationKey: snapshot?.step ?? 0,
        },
        interaction: {
          id: "titrate",
          label: "滴定管",
          actionLabel: "打开滴定管活塞",
          mode: "activate",
        },
      },
    );
  }
  if (block.experimentId === "precipitation_reaction") {
    components.push(
      tool(
        "silver-bottle",
        "reagent_bottle",
        [-1.8, 1.0, 0.08],
        "硝酸银",
        "转移硝酸银",
        "transfer-silver",
        "#8e7764",
      ),
      tool(
        "chloride-bottle",
        "reagent_bottle",
        [1.8, 1.0, 0.08],
        "氯化钠",
        "转移氯化钠",
        "transfer-chloride",
        "#7298a1",
      ),
    );
  }
  if (block.experimentId === "mass_conservation") {
    components.push({
      id: "balance",
      type: "balance",
      position: [1.8, 0.96, 0.08],
      props: {
        width: 1.7,
        depth: 1.15,
        height: 0.25,
        display: snapshot?.measuredMassG ?? 0,
        label: "电子天平",
        labelOffsetY: 1.05,
        animationKey: snapshot?.step ?? 0,
      },
      interaction: {
        id: snapshot?.scaleZeroed ? "measure-closed" : "tare-scale",
        label: "电子天平",
        actionLabel: snapshot?.scaleZeroed ? "称量密闭容器" : "将天平归零",
        mode: "activate",
      },
    });
  }
  return {
    version: 1,
    capabilities: {
      controls: block.controls ?? [],
      observations: (block.observations ?? []).map((item) => item.id),
      renderMode: "3d",
      supportsSampling: false,
      supportsAnalysis: false,
    },
    environment: {
      background: "#1a2328",
      grid: false,
      ground: false,
      ambientIntensity: 0.38,
    },
    camera: {
      position: [5.8, 3.9, 6.6],
      target: [0, 1.15, 0.1],
      fov: 34,
      minDistance: 3.6,
      maxDistance: 11,
    },
    lights: [
      {
        kind: "directional",
        position: [4.2, 8.4, 3.6],
        intensity: 2.2,
        castShadow: true,
      },
      {
        kind: "point",
        position: [-2.8, 3.6, 1.6],
        color: "#b9e4df",
        intensity: 0.95,
      },
      { kind: "directional", position: [-5, 2.8, -2.4], color: "#8aa7c4", intensity: 0.48 },
    ],
    components,
  };
}

export function chemistrySceneToManifestScene(
  scene: LabSceneDefinition,
): LabManifestV1["scene"] {
  return {
    version: 1,
    ...(scene.environment ? { environment: { ...scene.environment } } : {}),
    ...(scene.camera
      ? {
          camera: stripUndefined({
            ...(scene.camera.position ? { position: [...scene.camera.position] } : {}),
            ...(scene.camera.target ? { target: [...scene.camera.target] } : {}),
            ...(scene.camera.fov !== undefined ? { fov: scene.camera.fov } : {}),
            ...(scene.camera.minDistance !== undefined
              ? { minDistance: scene.camera.minDistance }
              : {}),
            ...(scene.camera.maxDistance !== undefined
              ? { maxDistance: scene.camera.maxDistance }
              : {}),
          }),
        }
      : {}),
    ...(scene.lights
      ? {
          lights: scene.lights.map((light) =>
            stripUndefined({
              kind: light.kind,
              ...(light.position ? { position: [...light.position] } : {}),
              ...(light.color ? { color: light.color } : {}),
              ...(light.intensity !== undefined ? { intensity: light.intensity } : {}),
              ...(light.castShadow !== undefined ? { castShadow: light.castShadow } : {}),
            }),
          ),
        }
      : {}),
    components: scene.components.map((component) =>
      stripUndefined({
        id: component.id,
        type: component.type,
        ...(component.props ? { props: { ...component.props } } : {}),
        ...(component.position ? { position: [...component.position] } : {}),
        ...(component.rotation ? { rotation: [...component.rotation] } : {}),
        ...(component.scale ? { scale: [...component.scale] } : {}),
        ...(component.visible !== undefined ? { visible: component.visible } : {}),
        ...(component.interaction
          ? {
              interaction: stripUndefined({
                id: component.interaction.id,
                label: component.interaction.label,
                actionId: component.interaction.id,
                mode: component.interaction.mode,
                ...(component.interaction.allowedTargetIds
                  ? { allowedTargetIds: [...component.interaction.allowedTargetIds] }
                  : {}),
                ...(component.interaction.disabled !== undefined
                  ? { disabled: component.interaction.disabled }
                  : {}),
              }),
            }
          : {}),
      }),
    ),
    ...(scene.vectors ? { vectors: [...scene.vectors] } : {}),
    ...(scene.trails ? { trails: [...scene.trails] } : {}),
    ...(scene.labels ? { labels: [...scene.labels] } : {}),
  } as LabManifestV1["scene"];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function chemistryColor(indicatorColor: string | undefined) {
  if (indicatorColor?.includes("粉")) return "#f58bb3";
  if (indicatorColor?.includes("红")) return "#ef4444";
  if (indicatorColor?.includes("黄")) return "#facc15";
  if (indicatorColor?.includes("橙")) return "#fb923c";
  return "#9ac9d1";
}
