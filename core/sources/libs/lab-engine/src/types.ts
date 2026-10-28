/** A JSON-safe vector used by scene definitions. */
export type LabVector3 = readonly [number, number, number];

export type LabColor = string;

export type LabEnvironmentDefinition = {
  background?: LabColor;
  grid?: boolean;
  ground?: boolean;
  ambientIntensity?: number;
};

export type LabCameraDefinition = {
  position?: LabVector3;
  target?: LabVector3;
  fov?: number;
  minDistance?: number;
  maxDistance?: number;
};

export type LabLightDefinition = {
  kind: "ambient" | "directional" | "point";
  position?: LabVector3;
  color?: LabColor;
  intensity?: number;
  castShadow?: boolean;
};

export type LabComponentInstance = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  position?: LabVector3;
  rotation?: LabVector3;
  scale?: LabVector3;
  visible?: boolean;
  interaction?: LabComponentInteraction;
};

export type LabComponentInteraction = {
  id: string;
  label: string;
  actionLabel?: string;
  mode: "select" | "activate" | "drag" | "target";
  allowedTargetIds?: readonly string[];
  disabled?: boolean;
};

export type LabVectorOverlay = {
  id: string;
  origin: LabVector3;
  vector: LabVector3;
  color?: LabColor;
  label?: string;
  scale?: number;
};

export type LabTrailOverlay = {
  id: string;
  points: readonly LabVector3[];
  color?: LabColor;
  width?: number;
};

export type LabLabelOverlay = {
  id: string;
  text: string;
  position: LabVector3;
  color?: LabColor;
  emphasis?: boolean;
};

export type LabSceneDefinition = {
  version: 1;
  capabilities?: LabCapabilities;
  environment?: LabEnvironmentDefinition;
  camera?: LabCameraDefinition;
  lights?: readonly LabLightDefinition[];
  components: readonly LabComponentInstance[];
  vectors?: readonly LabVectorOverlay[];
  trails?: readonly LabTrailOverlay[];
  labels?: readonly LabLabelOverlay[];
};

export type LabInteractionEvent =
  | { type: "select"; componentId: string | null }
  | { type: "drag"; componentId: string; position: LabVector3 }
  | { type: "activate"; componentId: string; interactionId: string }
  | {
      type: "drop";
      componentId: string;
      targetId: string;
      interactionId: string;
    }
  | { type: "parameter"; id: string; value: number | string | boolean }
  | { type: "play" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "camera"; preset: string };

export type LabObservation = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  kind?: "scalar" | "vector" | "text";
  vector?: LabVector3;
};

/** Capabilities exposed by an experiment to a renderer or host UI. */
export type LabCapabilities = {
  controls: readonly string[];
  observations: readonly string[];
  renderMode: "2d" | "3d" | "hybrid";
  supportsSampling?: boolean;
  supportsAnalysis?: boolean;
};

export type LabBudget = {
  maxRuntimeSeconds?: number;
  maxSamples?: number;
  maxTrajectoryPoints?: number;
  maxComponents?: number;
};

export type LabSample<TState = unknown> = {
  elapsedSeconds: number;
  state: TState;
};

export type LabSnapshot<TState> = {
  version: 1;
  state: TState;
  elapsedSeconds: number;
  running: boolean;
  speed?: number;
  seed?: number;
  samples?: readonly LabSample<TState>[];
};

export type LabRuntimeListener<TState> = (
  state: TState,
  elapsedSeconds: number,
) => void;
