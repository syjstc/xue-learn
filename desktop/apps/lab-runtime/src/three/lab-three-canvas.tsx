"use client";

import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type {
  LabComponentInstance,
  LabInteractionEvent,
  LabLabelOverlay,
  LabSceneDefinition,
  LabTrailOverlay,
  LabVector3,
  LabVectorOverlay,
} from "@xue-learn/core/lab-engine";
import { LabComponentRegistry } from "@xue-learn/core/lab-engine";
import { getLabAsset } from "./lab-asset-registry.ts";

type RuntimeHandle = { advance: (deltaSeconds: number) => number };

export type LabThreeCanvasProps = {
  scene: LabSceneDefinition;
  runtime?: RuntimeHandle;
  className?: string;
  fallback?: ReactNode;
  onRendererError?: (error: unknown) => void;
  onInteraction?: (event: LabInteractionEvent) => void;
  showInteractionHud?: boolean;
};

function useWebGLAvailability() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const context =
        canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
        canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
      setAvailable(Boolean(context));
      const loseContext = context?.getExtension("WEBGL_lose_context");
      loseContext?.loseContext();
    } catch {
      setAvailable(false);
    }
  }, []);
  return available;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function LabThreeCanvas({
  scene,
  runtime,
  className,
  fallback = <ThreeFallback />,
  onRendererError,
  onInteraction,
  showInteractionHud = true,
}: LabThreeCanvasProps) {
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    null,
  );
  const webglAvailable = useWebGLAvailability();
  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    if (
      selectedComponentId &&
      !scene.components.some(
        (component) => component.id === selectedComponentId,
      )
    ) {
      setSelectedComponentId(null);
    }
  }, [scene.components, selectedComponentId]);
  if (webglAvailable === false) return <>{fallback}</>;
  if (webglAvailable === null) {
    return (
      <div
        className={className ?? "h-[360px]"}
        style={{ minHeight: 360, width: "100%" }}
        aria-busy="true"
      >
        <div
          className="flex h-full min-h-[280px] items-center justify-center text-xs text-[var(--course-content-muted)]"
          style={{
            display: "flex",
            height: "100%",
            minHeight: 280,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "var(--course-content-muted, #5f6f75)",
          }}
        >
          正在准备实验视图…
        </div>
      </div>
    );
  }
  const sceneErrors = validatePrimitiveScene(scene);
  if (sceneErrors.length > 0) {
    return <ThreeFallback message="实验组件定义无法验证，请返回课程后重试。" />;
  }

  return (
    <div
      className={`relative ${className ?? "h-[360px]"}`}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 420 }}
      role="group"
      aria-label="3D 虚拟实验视图"
    >
      <RendererBoundary fallback={fallback} onError={onRendererError}>
        <Canvas
          style={{ position: "absolute", inset: 0 }}
          shadows
          dpr={[1, 1.75]}
          frameloop={reducedMotion ? "demand" : "always"}
          camera={{
            position: scene.camera?.position ?? [7, 5, 8],
            fov: scene.camera?.fov ?? 42,
            near: 0.1,
            far: 100,
          }}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.08,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          onCreated={({ gl }) => {
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            gl.setClearColor(scene.environment?.background ?? "#1a2328", 1);
          }}
        >
          <ThreeScene
            scene={scene}
            runtime={runtime}
            reducedMotion={reducedMotion}
            selectedComponentId={selectedComponentId}
            onInteraction={onInteraction}
            onSelectionChange={setSelectedComponentId}
          />
        </Canvas>
      </RendererBoundary>
      {showInteractionHud && (
        <LabInteractionHud
          scene={scene}
          selectedComponentId={selectedComponentId}
          onInteraction={onInteraction}
          onClearSelection={() => setSelectedComponentId(null)}
        />
      )}
    </div>
  );
}

class RendererBoundary extends Component<
  {
    fallback: ReactNode;
    onError?: (error: unknown) => void;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ThreeScene({
  scene,
  runtime,
  reducedMotion,
  selectedComponentId,
  onInteraction,
  onSelectionChange,
}: {
  scene: LabSceneDefinition;
  runtime?: RuntimeHandle;
  reducedMotion: boolean;
  selectedComponentId: string | null;
  onInteraction?: (event: LabInteractionEvent) => void;
  onSelectionChange?: (componentId: string | null) => void;
}) {
  const componentsById = useMemo(
    () =>
      new Map(scene.components.map((component) => [component.id, component])),
    [scene.components],
  );
  const hasLabRoom = scene.components.some((component) => component.type === "lab_backdrop");
  const interact = (component: LabComponentInstance) => {
    const interaction = component.interaction;
    if (!interaction || interaction.disabled) return;
    const selected = selectedComponentId
      ? componentsById.get(selectedComponentId)
      : undefined;
    if (
      interaction.mode === "target" &&
      selected?.interaction?.allowedTargetIds?.includes(component.id)
    ) {
      onInteraction?.({
        type: "drop",
        componentId: selected.id,
        targetId: component.id,
        interactionId: selected.interaction.id,
      });
      onSelectionChange?.(null);
      return;
    }
    const next =
      selectedComponentId === component.id &&
      interaction.mode !== "activate" &&
      interaction.mode !== "target"
        ? null
        : component.id;
    onSelectionChange?.(next);
    onInteraction?.({ type: "select", componentId: next });
  };
  return (
    <>
      {runtime && !reducedMotion && <RuntimeDriver runtime={runtime} />}
      <LabEnvironmentRig />
      <hemisphereLight args={["#e8f2ff", "#2a3338", 0.55]} />
      <ambientLight intensity={scene.environment?.ambientIntensity ?? 0.4} />
      {(scene.lights ?? []).map((light, index) => {
        const position = light.position ?? [4, 7, 4];
        if (light.kind === "point") {
          return (
            <pointLight
              key={`${light.kind}-${index}`}
              color={light.color}
              intensity={light.intensity ?? 1}
              position={position}
              castShadow={light.castShadow}
              decay={1.6}
              distance={18}
            />
          );
        }
        return (
          <directionalLight
            key={`${light.kind}-${index}`}
            color={light.color}
            intensity={light.intensity ?? 1}
            position={position}
            castShadow={light.castShadow}
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0002}
            shadow-camera-near={0.5}
            shadow-camera-far={28}
            shadow-camera-left={-8}
            shadow-camera-right={8}
            shadow-camera-top={8}
            shadow-camera-bottom={-8}
          />
        );
      })}
      {scene.environment?.grid && !hasLabRoom && (
        <gridHelper args={[12, 24, "#5c6d7a", "#314049"]} />
      )}
      {scene.environment?.ground && !hasLabRoom && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          position={[0, -0.02, 0]}
        >
          <planeGeometry args={[18, 18]} />
          <meshStandardMaterial color="#1e272d" roughness={0.92} />
        </mesh>
      )}
      <group>
        {scene.components.map((component) => (
          <PrimitiveComponent
            key={component.id}
            component={component}
            selected={selectedComponentId === component.id}
            reducedMotion={reducedMotion}
            onInteract={() => interact(component)}
          />
        ))}
        {(scene.vectors ?? []).map((vector) => (
          <VectorOverlay key={vector.id} vector={vector} />
        ))}
        {(scene.trails ?? []).map((trail) => (
          <TrailOverlay key={trail.id} trail={trail} />
        ))}
        {(scene.labels ?? []).map((label) => (
          <LabelOverlay key={label.id} label={label} />
        ))}
      </group>
      <CameraControls
        cameraDefinition={scene.camera}
        reducedMotion={reducedMotion}
      />
    </>
  );
}

function RuntimeDriver({ runtime }: { runtime: RuntimeHandle }) {
  useFrame((_, delta) => runtime.advance(delta));
  return null;
}

function LabEnvironmentRig() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const env = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.72;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function LabInteractionHud({
  scene,
  selectedComponentId,
  onInteraction,
  onClearSelection,
}: {
  scene: LabSceneDefinition;
  selectedComponentId: string | null;
  onInteraction?: (event: LabInteractionEvent) => void;
  onClearSelection: () => void;
}) {
  const selectedComponent = selectedComponentId
    ? scene.components.find((component) => component.id === selectedComponentId)
    : undefined;
  const interaction = selectedComponent?.interaction;
  if (!selectedComponent || !interaction || interaction.disabled) return null;

  const objectLabel = stringProp(
    selectedComponent.props ?? {},
    "label",
    interaction.label,
  );
  const actionLabel = interaction.actionLabel ?? interaction.label;
  const isDrag = interaction.mode === "drag";
  const actionDescription = isDrag
    ? "已拿起器材，再点击反应容器即可完成操作"
    : "点击动作，让实验继续进行";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}
    >
      <div
        className="pointer-events-auto absolute left-1/2 top-3 w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/70 bg-slate-950/82 p-3 text-white shadow-2xl backdrop-blur-md dark:border-slate-700/80"
        style={{
          pointerEvents: "auto",
          position: "absolute",
          left: "50%",
          top: 12,
          width: "min(22rem, calc(100% - 1.5rem))",
          transform: "translateX(-50%)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.7)",
          background: "rgba(2, 6, 23, 0.82)",
          padding: 12,
          color: "white",
          boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.45)",
        }}
      >
        <div className="flex items-start justify-between gap-3" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div className="min-w-0" style={{ minWidth: 0 }}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-200/80" style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", color: "rgba(153, 246, 228, 0.8)" }}>
              已选器材
            </p>
            <p className="truncate text-sm font-semibold text-white" style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 600 }}>
              {objectLabel}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300" style={{ margin: "4px 0 0", fontSize: 11, lineHeight: 1.5, color: "#cbd5e1" }}>
              {actionDescription}
            </p>
            {isDrag ? (
              <p className="mt-1 text-[11px] font-medium text-teal-100" style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 500, color: "#ccfbf1" }}>
                将执行：{actionLabel}
              </p>
            ) : null}
          </div>
          <span className="mt-0.5 shrink-0 rounded-full border border-teal-300/30 bg-teal-300/10 px-2 py-1 text-[10px] text-teal-100" style={{ marginTop: 2, flexShrink: 0, borderRadius: 999, border: "1px solid rgba(94, 234, 212, 0.3)", background: "rgba(94, 234, 212, 0.1)", padding: "4px 8px", fontSize: 10, color: "#ccfbf1" }}>
            {isDrag ? "拖放" : "动作"}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          {!isDrag && interaction.mode !== "select" ? (
            <button
              type="button"
              className="flex-1 rounded-lg bg-teal-300 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-teal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200"
              style={{ flex: 1, borderRadius: 8, border: 0, background: "#5eead4", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#020617", cursor: "pointer" }}
              onClick={() =>
                onInteraction?.({
                  type: "activate",
                  componentId: selectedComponent.id,
                  interactionId: interaction.id,
                })
              }
            >
              {actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200"
            style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", padding: "8px 12px", fontSize: 12, color: "#e2e8f0", cursor: "pointer" }}
            onClick={() => {
              onClearSelection();
              onInteraction?.({ type: "select", componentId: null });
            }}
          >
            取消选择
          </button>
        </div>
      </div>
    </div>
  );
}

function CameraControls({
  cameraDefinition,
  reducedMotion,
}: {
  cameraDefinition: LabSceneDefinition["camera"];
  reducedMotion: boolean;
}) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<ThreeOrbitControls | null>(null);
  useEffect(() => {
    const instance = new ThreeOrbitControls(camera, gl.domElement);
    const requestRender = () => invalidate();
    instance.enableDamping = !reducedMotion;
    instance.minDistance = cameraDefinition?.minDistance ?? 3;
    instance.maxDistance = cameraDefinition?.maxDistance ?? 18;
    const target = cameraDefinition?.target ?? [0, 1, 0];
    instance.target.set(...target);
    instance.update();
    if (reducedMotion) instance.addEventListener("change", requestRender);
    controls.current = instance;
    return () => {
      if (reducedMotion) instance.removeEventListener("change", requestRender);
      instance.dispose();
      controls.current = null;
    };
  }, [camera, gl.domElement, invalidate, reducedMotion]);
  useFrame(() => {
    if (!reducedMotion) controls.current?.update();
  });
  return null;
}

function PrimitiveComponent({
  component,
  selected = false,
  reducedMotion = false,
  onInteract,
}: {
  component: LabComponentInstance;
  selected?: boolean;
  reducedMotion?: boolean;
  onInteract?: () => void;
}) {
  const props = component.props ?? {};
  const position = component.position ?? [0, 0, 0];
  const rotation = component.rotation ?? [0, 0, 0];
  const scale = component.scale ?? [1, 1, 1];
  const groupRef = useRef<THREE.Group>(null);
  const animationProgress = useRef(1);
  const pulseKey = animationKeyProp(props);
  const animation = stringProp(props, "animation", "pulse");
  const objectLabel = stringProp(props, "label", "");
  const labelOffsetY = numberProp(props, "labelOffsetY", 1.2);
  const labelScale = numberProp(props, "labelScale", 0.92);

  useEffect(() => {
    if (!reducedMotion && pulseKey !== undefined) animationProgress.current = 0;
  }, [pulseKey, reducedMotion]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    if (reducedMotion || animationProgress.current >= 1) {
      group.position.set(...position);
      group.rotation.set(...rotation);
      return;
    }
    animationProgress.current = Math.min(
      1,
      animationProgress.current + delta * 3.8,
    );
    const progress = animationProgress.current;
    const envelope = Math.sin(progress * Math.PI);
    group.position.set(
      position[0],
      position[1] + envelope * (animation === "mix" ? 0.035 : 0.06),
      position[2],
    );
    group.rotation.set(
      rotation[0],
      rotation[1],
      rotation[2] +
        (animation === "mix"
          ? Math.sin(progress * Math.PI * 4) * 0.055
          : -envelope * 0.14),
    );
  });
  if (component.visible === false) return null;

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={(event) => {
        if (!component.interaction || component.interaction.disabled) return;
        event.stopPropagation();
        onInteract?.();
      }}
      onPointerOver={(event) => {
        if (!component.interaction || component.interaction.disabled) return;
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      {selected && <SelectionHalo reducedMotion={reducedMotion} />}
      {objectLabel && (
        <BillboardLabel
          text={objectLabel}
          position={[0, labelOffsetY, 0]}
          color={selected ? "#5eead4" : "#e8f1f6"}
          scale={selected ? labelScale * 1.12 : labelScale}
        />
      )}
      {component.type === "asset_model" && <AssetModel props={props} />}
      {component.type === "lab_bench" && <LabBench props={props} />}
      {component.type === "lab_backdrop" && <LabBackdrop props={props} />}
      {component.type === "lab_tray" && <LabTray props={props} />}
      {component.type === "reagent_bottle" && <ReagentBottle props={props} />}
      {component.type === "dropper" && <Dropper props={props} />}
      {component.type === "burette_stand" && <BuretteStand />}
      {component.type === "platform" && <Platform props={props} />}
      {component.type === "ramp" && <Ramp props={props} />}
      {component.type === "cart" && <Cart props={props} />}
      {component.type === "rail" && <Rail props={props} />}
      {component.type === "reference_plane" && <ReferencePlane props={props} />}
      {component.type === "beaker" && <Beaker props={props} />}
      {component.type === "test_tube" && <TestTube props={props} />}
      {component.type === "burette" && <Burette props={props} />}
      {component.type === "balance" && <Balance props={props} />}
      {component.type === "sphere" && <Sphere props={props} />}
      {component.type === "cylinder" && <CylinderPrim props={props} />}
      {component.type === "spring" && <SpringPrim props={props} />}
      {component.type === "lens" && <LensPrim props={props} />}
      {component.type === "screen" && <ScreenPrim props={props} />}
      {component.type === "wave_source" && <WaveSource props={props} />}
      {component.type === "field_arrow" && <FieldArrow props={props} />}
      {component.type === "potential_well" && <PotentialWell props={props} />}
      {component.type === "charge" && <ChargeSphere props={props} />}
      {component.type === "double_slit" && <DoubleSlit props={props} />}
      {component.type === "coil" && <CoilPrim props={props} />}
      {component.type === "magnet" && <MagnetPrim props={props} />}
      {component.type === "pendulum_bob" && <PendulumBob props={props} />}
      {component.type === "trajectory_arc" && <TrajectoryArc props={props} />}
    </group>
  );
}

function SelectionHalo({ reducedMotion }: { reducedMotion: boolean }) {
  const haloRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const halo = haloRef.current;
    if (!halo || reducedMotion) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 4.5) * 0.07;
    halo.scale.set(pulse, pulse, pulse);
    const material = halo.material as THREE.MeshBasicMaterial;
    material.opacity = 0.7 + Math.sin(clock.elapsedTime * 4.5) * 0.12;
  });
  return (
    <mesh ref={haloRef} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.48, 0.62, 40]} />
      <meshBasicMaterial color="#14b8a6" transparent opacity={0.82} />
    </mesh>
  );
}

function AssetModel({ props }: { props: Record<string, unknown> }) {
  const asset = getLabAsset(stringProp(props, "assetId", ""));
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!asset) return;
    let active = true;
    setFailed(false);
    new GLTFLoader().load(
      asset.url,
      (gltf) => {
        if (!active) return;
        setObject(gltf.scene.clone(true));
      },
      undefined,
      () => {
        if (!active) return;
        setObject(null);
        setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [asset]);
  if (!asset || failed || !object) {
    return asset && !failed && !object ? null : (
      <ProceduralLabBench props={props} />
    );
  }
  return (
    <primitive
      object={object}
      position={asset.position ?? [0, 0, 0]}
      rotation={asset.rotation ?? [0, 0, 0]}
      scale={asset.scale}
    />
  );
}

function GlassMaterial({
  color = "#d7eef4",
  transmission = 0.88,
}: {
  color?: string;
  transmission?: number;
}) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.06}
      metalness={0.04}
      transmission={transmission}
      thickness={0.42}
      ior={1.5}
      transparent
      opacity={1}
      envMapIntensity={1.15}
      clearcoat={0.9}
      clearcoatRoughness={0.12}
      side={THREE.DoubleSide}
    />
  );
}

function LabBench({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 7.6);
  const depth = numberProp(props, "depth", 2.55);
  const height = numberProp(props, "height", 0.92);
  const color = stringProp(props, "color", "#4f6d6a");
  const topY = height;
  return (
    <group>
      <mesh position={[0, topY, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.08, depth]} />
        <meshPhysicalMaterial
          color="#6f8b86"
          roughness={0.18}
          metalness={0.08}
          clearcoat={0.55}
          clearcoatRoughness={0.2}
        />
      </mesh>
      <mesh position={[0, topY - 0.07, 0]} receiveShadow>
        <boxGeometry args={[width + 0.04, 0.04, depth + 0.04]} />
        <meshStandardMaterial color="#2f3c3a" roughness={0.7} />
      </mesh>
      <mesh position={[0, height / 2 - 0.04, 0]} receiveShadow>
        <boxGeometry args={[width * 0.98, height - 0.16, depth * 0.9]} />
        <meshStandardMaterial color={color} roughness={0.78} />
      </mesh>
      {[-0.32, 0, 0.32].map((offset) => (
        <mesh
          key={offset}
          position={[width * offset, height * 0.38, depth * 0.38]}
          castShadow
        >
          <boxGeometry args={[width * 0.22, height * 0.42, 0.06]} />
          <meshStandardMaterial color="#3b4d4a" roughness={0.62} metalness={0.12} />
        </mesh>
      ))}
      {[
        [-width * 0.44, -depth * 0.38],
        [width * 0.44, -depth * 0.38],
        [-width * 0.44, depth * 0.38],
        [width * 0.44, depth * 0.38],
      ].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, height / 2 - 0.08, z]} castShadow>
          <boxGeometry args={[0.12, height - 0.08, 0.12]} />
          <meshStandardMaterial color="#2a3331" roughness={0.55} metalness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function ProceduralLabBench({ props }: { props: Record<string, unknown> }) {
  return <LabBench props={props} />;
}

function LabBackdrop({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 10);
  const height = numberProp(props, "height", 5.2);
  const variant = stringProp(props, "variant", "chemistry");
  const floor = variant === "physics" ? "#2a333b" : "#3a4643";
  const wall = variant === "physics" ? "#44535c" : "#d8e3de";
  const accent = variant === "physics" ? "#1d8cff" : "#7fd1c7";
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0.55]} receiveShadow>
        <planeGeometry args={[width + 8, 12]} />
        <meshStandardMaterial color={floor} roughness={0.92} />
      </mesh>
      {Array.from({ length: 8 }, (_, column) =>
        Array.from({ length: 6 }, (_, row) => (
          <mesh
            key={`${column}:${row}`}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[
              -width / 2 + 0.7 + column * 1.15,
              0.001,
              -1.4 + row * 1.15,
            ]}
            receiveShadow
          >
            <planeGeometry args={[1.08, 1.08]} />
            <meshStandardMaterial
              color={(column + row) % 2 === 0 ? "#4a5754" : "#3e4b48"}
              roughness={0.86}
            />
          </mesh>
        )),
      )}
      <mesh position={[0, height / 2 - 0.1, -2.15]} receiveShadow>
        <boxGeometry args={[width + 1.2, height, 0.18]} />
        <meshStandardMaterial color={wall} roughness={0.88} />
      </mesh>
      <mesh position={[-(width / 2) - 0.08, height / 2 - 0.1, 0.35]} receiveShadow>
        <boxGeometry args={[0.16, height, 5.2]} />
        <meshStandardMaterial color={wall} roughness={0.9} />
      </mesh>
      <mesh position={[width / 2 + 0.08, height / 2 - 0.1, 0.35]} receiveShadow>
        <boxGeometry args={[0.16, height, 5.2]} />
        <meshStandardMaterial color={wall} roughness={0.9} />
      </mesh>
      <mesh position={[0, height - 0.08, 0.2]} receiveShadow>
        <boxGeometry args={[width + 1.4, 0.12, 5.4]} />
        <meshStandardMaterial color="#1c2428" roughness={0.7} />
      </mesh>
      {[-1.8, 1.8].map((x) => (
        <group key={x}>
          <mesh position={[x, 2.55, -2.02]}>
            <boxGeometry args={[1.7, 1.35, 0.06]} />
            <meshPhysicalMaterial
              color="#cfe8ff"
              transmission={0.7}
              roughness={0.08}
              thickness={0.2}
              transparent
            />
          </mesh>
          <mesh position={[x, 2.55, -2.06]}>
            <boxGeometry args={[1.82, 1.48, 0.04]} />
            <meshStandardMaterial color="#2f3b40" roughness={0.45} metalness={0.3} />
          </mesh>
        </group>
      ))}
      {[-2.2, 0, 2.2].map((x) => (
        <group key={`lamp-${x}`} position={[x, height - 0.42, 0.4]}>
          <mesh>
            <boxGeometry args={[1.6, 0.08, 0.42]} />
            <meshStandardMaterial color="#dce7e4" roughness={0.35} metalness={0.2} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <boxGeometry args={[1.48, 0.04, 0.32]} />
            <meshStandardMaterial
              color="#fff6d8"
              emissive={accent}
              emissiveIntensity={0.55}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.85, -2.02]} receiveShadow>
        <boxGeometry args={[width * 0.86, 0.08, 0.34]} />
        <meshStandardMaterial color="#5d6d68" roughness={0.5} metalness={0.25} />
      </mesh>
    </group>
  );
}

function LabTray({ props }: { props: Record<string, unknown> }) {
  const color = stringProp(props, "color", "#c5d0cf");
  return (
    <group>
      <mesh receiveShadow>
        <boxGeometry args={[2.35, 0.05, 1.45]} />
        <meshPhysicalMaterial color={color} metalness={0.55} roughness={0.28} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={`x-${x}`} position={[x * 1.16, 0.08, 0]}>
          <boxGeometry args={[0.05, 0.16, 1.45]} />
          <meshPhysicalMaterial color={color} metalness={0.5} roughness={0.3} />
        </mesh>
      ))}
      {[-1, 1].map((z) => (
        <mesh key={`z-${z}`} position={[0, 0.08, z * 0.7]}>
          <boxGeometry args={[2.35, 0.16, 0.05]} />
          <meshPhysicalMaterial color={color} metalness={0.5} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function ReagentBottle({ props }: { props: Record<string, unknown> }) {
  const color = stringProp(props, "color", "#b77948");
  return (
    <group>
      <mesh position={[0, 0.38, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.76, 48, 1, true]} />
        <GlassMaterial color="#d9eef2" transmission={0.82} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.2, 0.23, 0.58, 48]} />
        <meshPhysicalMaterial
          color={color}
          roughness={0.12}
          transmission={0.35}
          thickness={0.3}
          transparent
        />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, 0.18, 32]} />
        <GlassMaterial color="#e7f4f6" />
      </mesh>
      <mesh position={[0, 0.96, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 0.1, 24]} />
        <meshStandardMaterial color="#1f2a28" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.44, 0.255]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.3, 0.22]} />
        <meshStandardMaterial color="#f7f1e4" roughness={0.85} />
      </mesh>
    </group>
  );
}

function Dropper({ props }: { props: Record<string, unknown> }) {
  return (
    <group rotation={[0, 0, -0.12]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.028, 0.82, 24, 1, true]} />
        <GlassMaterial />
      </mesh>
      <mesh position={[0, 0.88, 0]} castShadow>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshPhysicalMaterial
          color={stringProp(props, "color", "#b94d5d")}
          roughness={0.38}
          clearcoat={0.4}
        />
      </mesh>
      <mesh position={[0, -0.02, 0]}>
        <coneGeometry args={[0.02, 0.12, 12]} />
        <GlassMaterial />
      </mesh>
    </group>
  );
}

function BuretteStand() {
  return (
    <group>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[1.25, 0.1, 0.75]} />
        <meshStandardMaterial
          color="#4c5657"
          metalness={0.55}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0.48, 1.55, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 3, 16]} />
        <meshStandardMaterial
          color="#697574"
          metalness={0.72}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0.22, 1.9, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.55, 16]} />
        <meshStandardMaterial
          color="#697574"
          metalness={0.72}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

function Platform({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 5);
  const depth = numberProp(props, "depth", 2.4);
  const height = numberProp(props, "height", 0.35);
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={stringProp(props, "color", "#3d4a57")}
          roughness={0.48}
          metalness={0.18}
        />
      </mesh>
      <mesh position={[0, height / 2 + 0.01, 0]} receiveShadow>
        <boxGeometry args={[width * 0.96, 0.02, depth * 0.9]} />
        <meshPhysicalMaterial color="#6e7f8d" roughness={0.32} metalness={0.22} />
      </mesh>
    </group>
  );
}

function Ramp({ props }: { props: Record<string, unknown> }) {
  const length = numberProp(props, "length", 4.8);
  const width = numberProp(props, "width", 1.7);
  const thickness = numberProp(props, "thickness", 0.22);
  const angle = (numberProp(props, "angleDeg", 30) * Math.PI) / 180;
  return (
    <group rotation={[0, 0, angle]}>
      <mesh position={[length / 2, thickness / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, thickness, width]} />
        <meshStandardMaterial
          color={stringProp(props, "color", "#c47a3a")}
          roughness={0.46}
        />
      </mesh>
      <mesh position={[length / 2, thickness + 0.012, 0]} receiveShadow>
        <boxGeometry args={[length, 0.02, width * 0.72]} />
        <meshStandardMaterial color="#e2a15c" roughness={0.38} metalness={0.08} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[length / 2, thickness + 0.05, side * width * 0.46]}
          castShadow
        >
          <boxGeometry args={[length, 0.08, 0.05]} />
          <meshStandardMaterial color="#8a5a2e" roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function Cart({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 0.8);
  const height = numberProp(props, "height", 0.35);
  const depth = numberProp(props, "depth", 0.65);
  const wheelRadius = numberProp(props, "wheelRadius", 0.16);
  const color = stringProp(props, "color", "#3f7ecf");
  return (
    <group>
      <mesh position={[0, wheelRadius + height / 2, 0]} castShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshPhysicalMaterial
          color={color}
          roughness={0.28}
          metalness={0.22}
          clearcoat={0.45}
        />
      </mesh>
      <mesh position={[0, wheelRadius + height + 0.04, 0]} castShadow>
        <boxGeometry args={[width * 0.72, 0.08, depth * 0.72]} />
        <meshStandardMaterial color="#1f2c3d" roughness={0.5} />
      </mesh>
      {[-1, 1].map((x) =>
        [-1, 1].map((z) => (
          <group
            key={`${x}-${z}`}
            position={[x * width * 0.32, wheelRadius, z * depth * 0.42]}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[wheelRadius, wheelRadius, 0.1, 28]} />
              <meshStandardMaterial color="#1a1f27" roughness={0.55} metalness={0.2} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[wheelRadius * 0.42, wheelRadius * 0.42, 0.12, 16]} />
              <meshStandardMaterial color="#9aa7b4" roughness={0.3} metalness={0.6} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

function Rail({ props }: { props: Record<string, unknown> }) {
  const length = numberProp(props, "length", 5.5);
  return (
    <mesh position={[length / 2, 0.08, 0]} receiveShadow>
      <boxGeometry args={[length, 0.12, 1.2]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#9aaabd")}
        roughness={0.8}
      />
    </mesh>
  );
}

function ReferencePlane({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 6);
  const depth = numberProp(props, "depth", 4);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#e8eef6")}
        transparent
        opacity={0.76}
      />
    </mesh>
  );
}

function Beaker({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 1.2);
  const height = numberProp(props, "height", 1.5);
  const fill = clampProp(
    numberProp(props, "volumeMl", 0) / numberProp(props, "maxVolumeMl", 100),
    0,
    1,
  );
  const liquidHeight = Math.max(0.04, (height - 0.12) * fill);
  const precipitate = numberProp(props, "precipitateG", 0);
  const animationKey = numberProp(props, "animationKey", 0);
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[width / 2, width / 2.12, height, 48, 1, true]} />
        <GlassMaterial />
      </mesh>
      <mesh position={[0, height - 0.04, 0]}>
        <torusGeometry args={[width / 2, 0.035, 12, 48]} />
        <GlassMaterial color="#eaf6f8" />
      </mesh>
      <mesh position={[0, 0.06 + liquidHeight / 2, 0]}>
        <cylinderGeometry args={[width / 2.12, width / 2.18, liquidHeight, 48]} />
        <meshPhysicalMaterial
          color={stringProp(props, "liquidColor", "#7ec8d8")}
          roughness={0.08}
          transmission={0.28}
          thickness={0.4}
          transparent
        />
      </mesh>
      {precipitate > 0 && (
        <mesh position={[0, 0.09, 0]}>
          <cylinderGeometry args={[width / 2.2, width / 2.24, 0.09, 32]} />
          <meshStandardMaterial color="#f4f1e6" roughness={0.95} />
        </mesh>
      )}
      <ChemistryBubbles
        active={animationKey > 0}
        width={width * 0.72}
        height={Math.max(0.25, liquidHeight - 0.08)}
      />
    </group>
  );
}

function TestTube({ props }: { props: Record<string, unknown> }) {
  const height = numberProp(props, "height", 1.7);
  const radius = numberProp(props, "width", 0.48) / 2;
  const fill = clampProp(
    numberProp(props, "volumeMl", 0) / numberProp(props, "maxVolumeMl", 100),
    0,
    1,
  );
  const liquidHeight = Math.max(0.04, (height - radius) * fill);
  const animationKey = numberProp(props, "animationKey", 0);
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, height, 36, 1, true]} />
        <GlassMaterial />
      </mesh>
      <mesh position={[0, 0.08 + liquidHeight / 2, 0]}>
        <cylinderGeometry
          args={[radius * 0.86, radius * 0.88, liquidHeight, 24]}
        />
        <meshStandardMaterial
          color={stringProp(props, "liquidColor", "#b8d8ea")}
          transparent
          opacity={0.86}
        />
      </mesh>
      <ChemistryBubbles
        active={animationKey > 0}
        width={radius * 1.25}
        height={Math.max(0.25, liquidHeight - 0.08)}
      />
    </group>
  );
}

function ChemistryBubbles({
  active,
  width,
  height,
}: {
  active: boolean;
  width: number;
  height: number;
}) {
  const bubbles = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    if (!active) return;
    const time = clock.elapsedTime;
    bubbles.current.forEach((bubble, index) => {
      if (!bubble) return;
      const progress = (time * (0.42 + index * 0.08) + index * 0.27) % 1;
      bubble.position.set(
        Math.sin(time * 1.8 + index) * width * 0.24,
        0.1 + progress * height,
        Math.cos(time * 1.4 + index) * width * 0.12,
      );
      bubble.scale.setScalar(0.72 + Math.sin(time * 3 + index) * 0.2);
      (bubble.material as THREE.MeshBasicMaterial).opacity =
        0.2 + (1 - progress) * 0.45;
    });
  });
  if (!active) return null;
  return (
    <group>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          ref={(node) => {
            bubbles.current[index] = node;
          }}
        >
          <sphereGeometry args={[0.035 + index * 0.008, 10, 10]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Burette({ props }: { props: Record<string, unknown> }) {
  const height = numberProp(props, "height", 2.5);
  const radius = numberProp(props, "width", 0.18) / 2;
  const fill = clampProp(
    numberProp(props, "volumeMl", 0) / numberProp(props, "maxVolumeMl", 100),
    0,
    1,
  );
  const liquidHeight = Math.max(0.03, height * fill);
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, height, 28, 1, true]} />
        <GlassMaterial />
      </mesh>
      <mesh position={[0, height - liquidHeight / 2, 0]}>
        <cylinderGeometry
          args={[radius * 0.76, radius * 0.76, liquidHeight, 20]}
        />
        <meshStandardMaterial
          color={stringProp(props, "liquidColor", "#f2c36b")}
          transparent
          opacity={0.82}
        />
      </mesh>
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[radius * 1.8, 0.16, radius * 1.8]} />
        <meshStandardMaterial color="#526579" />
      </mesh>
    </group>
  );
}

function Balance({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 1.8);
  const depth = numberProp(props, "depth", 1.2);
  const height = numberProp(props, "height", 0.25);
  const display = numberProp(props, "display", 0);
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshPhysicalMaterial color="#8b9bad" roughness={0.28} metalness={0.42} />
      </mesh>
      <mesh position={[0, height + 0.04, 0]} receiveShadow>
        <boxGeometry args={[width * 0.78, 0.06, depth * 0.68]} />
        <meshStandardMaterial color="#e8eef4" roughness={0.35} />
      </mesh>
      <mesh position={[0, height + 0.18, -depth * 0.32]}>
        <boxGeometry args={[width * 0.42, 0.16, 0.12]} />
        <meshStandardMaterial color="#111827" roughness={0.4} />
      </mesh>
      <BillboardLabel
        text={`${display.toFixed(2)} g`}
        position={[0, height + 0.42, 0]}
        color="#e8f4ff"
      />
    </group>
  );
}

function Sphere({ props }: { props: Record<string, unknown> }) {
  const radius = numberProp(props, "radius", 0.3);
  return (
    <mesh castShadow>
      <sphereGeometry args={[radius, 28, 28]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#4f7cc7")}
        roughness={0.45}
      />
    </mesh>
  );
}

function CylinderPrim({ props }: { props: Record<string, unknown> }) {
  const radiusTop = numberProp(
    props,
    "radiusTop",
    numberProp(props, "radius", 0.25),
  );
  const radiusBottom = numberProp(props, "radiusBottom", radiusTop);
  const height = numberProp(props, "height", 0.6);
  return (
    <mesh castShadow position={[0, height / 2, 0]}>
      <cylinderGeometry args={[radiusTop, radiusBottom, height, 24]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#d94b6b")}
        roughness={0.5}
      />
    </mesh>
  );
}

function SpringPrim({ props }: { props: Record<string, unknown> }) {
  const length = numberProp(props, "length", 2);
  const radius = numberProp(props, "radius", 0.15);
  const coils = numberProp(props, "coils", 12);
  const color = stringProp(props, "color", "#8b9bad");
  const points: [number, number, number][] = [];
  for (let i = 0; i <= coils * 8; i++) {
    const t = i / (coils * 8);
    const angle = t * coils * Math.PI * 2;
    points.push([
      Math.cos(angle) * radius,
      t * length - length / 2,
      Math.sin(angle) * radius,
    ]);
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((p) => new THREE.Vector3(...p)),
  );
  const line = useMemo(
    () => new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })),
    [geometry, color],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );
  return <primitive object={line} />;
}

function LensPrim({ props }: { props: Record<string, unknown> }) {
  const height = numberProp(props, "height", 2);
  const width = numberProp(props, "width", 0.6);
  const color = stringProp(props, "color", "#b8d8ea");
  return (
    <group>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.5}
          roughness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(width, height)]} />
        <lineBasicMaterial color="#6a8ba0" />
      </lineSegments>
    </group>
  );
}

function ScreenPrim({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 2.8);
  const height = numberProp(props, "height", 2.4);
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#f7f9fc")}
        roughness={0.9}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function WaveSource({ props }: { props: Record<string, unknown> }) {
  const radius = numberProp(props, "radius", 0.15);
  return (
    <mesh>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#ed9b35")}
        roughness={0.6}
        emissive="#ed9b35"
        emissiveIntensity={0.3}
      />
    </mesh>
  );
}

function FieldArrow({ props }: { props: Record<string, unknown> }) {
  const length = numberProp(props, "length", 0.6);
  return (
    <mesh rotation={[0, 0, -Math.PI / 2]}>
      <coneGeometry args={[0.08, length, 8]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#2a9d8f")}
        roughness={0.5}
      />
    </mesh>
  );
}

function PotentialWell({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 3);
  const height = numberProp(props, "height", 1.6);
  const barrierWidth = numberProp(props, "barrierWidth", 0.6);
  const barrierHeight = numberProp(props, "barrierHeight", 1.2);
  const baseY = -height / 2;
  return (
    <group>
      {/* Base line */}
      <mesh position={[0, baseY, 0]}>
        <boxGeometry args={[width, 0.04, 0.3]} />
        <meshStandardMaterial color="#6a8ba0" roughness={0.6} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-width / 2 + 0.04, baseY + height / 2, 0]}>
        <boxGeometry args={[0.08, height, 0.3]} />
        <meshStandardMaterial color="#8b9bad" roughness={0.6} />
      </mesh>
      {/* Right wall */}
      <mesh position={[width / 2 - 0.04, baseY + height / 2, 0]}>
        <boxGeometry args={[0.08, height, 0.3]} />
        <meshStandardMaterial color="#8b9bad" roughness={0.6} />
      </mesh>
      {/* Barrier */}
      <mesh position={[0, baseY + barrierHeight / 2, 0]}>
        <boxGeometry args={[barrierWidth, barrierHeight, 0.3]} />
        <meshStandardMaterial
          color={stringProp(props, "barrierColor", "#d94b6b")}
          roughness={0.6}
          opacity={0.7}
          transparent
        />
      </mesh>
    </group>
  );
}

function ChargeSphere({ props }: { props: Record<string, unknown> }) {
  const radius = numberProp(props, "radius", 0.25);
  const sign = stringProp(props, "sign", "+");
  const color = stringProp(props, "color", "#d94b6b");
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color={color}
          roughness={0.3}
          emissive={color}
          emissiveIntensity={0.12}
        />
      </mesh>
      <BillboardLabel text={sign} position={[0, 0, 0]} color="#fff" />
    </group>
  );
}

function DoubleSlit({ props }: { props: Record<string, unknown> }) {
  const width = numberProp(props, "width", 1.8);
  const height = numberProp(props, "height", 1.6);
  const slitWidth = numberProp(props, "slitWidth", 0.06);
  const slitSep = numberProp(props, "slitSeparation", 0.3);
  return (
    <group>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#34445a"
          roughness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Two slits as gaps */}
      <mesh position={[0, slitSep / 2, 0.001]}>
        <planeGeometry args={[slitWidth, 0.04]} />
        <meshStandardMaterial color="#f7f9fc" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -slitSep / 2, 0.001]}>
        <planeGeometry args={[slitWidth, 0.04]} />
        <meshStandardMaterial color="#f7f9fc" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function CoilPrim({ props }: { props: Record<string, unknown> }) {
  const height = numberProp(props, "height", 0.6);
  const radius = numberProp(props, "radius", 0.4);
  const color = stringProp(props, "color", "#ed9b35");
  const points: [number, number, number][] = [];
  const turns = 6;
  const segmentsPerTurn = 12;
  for (let i = 0; i <= turns * segmentsPerTurn; i++) {
    const t = i / (turns * segmentsPerTurn);
    const angle = t * turns * Math.PI * 2;
    points.push([
      Math.cos(angle) * radius,
      t * height - height / 2,
      Math.sin(angle) * radius,
    ]);
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((p) => new THREE.Vector3(...p)),
  );
  const line = useMemo(
    () =>
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color, linewidth: 2 }),
      ),
    [geometry, color],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );
  return <primitive object={line} />;
}

function MagnetPrim({ props }: { props: Record<string, unknown> }) {
  const height = numberProp(props, "height", 0.5);
  const radius = numberProp(props, "radius", 0.25);
  return (
    <group>
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, height, 20]} />
        <meshStandardMaterial
          color={stringProp(props, "color", "#d94b6b")}
          roughness={0.4}
        />
      </mesh>
      {/* N/S labels */}
      <BillboardLabel
        text="N"
        position={[0, height / 2 + 0.15, 0]}
        color="#d94b6b"
      />
      <BillboardLabel
        text="S"
        position={[0, -height / 2 - 0.15, 0]}
        color="#4f7cc7"
      />
    </group>
  );
}

function PendulumBob({ props }: { props: Record<string, unknown> }) {
  const radius = numberProp(props, "radius", 0.12);
  return (
    <mesh castShadow>
      <sphereGeometry args={[radius, 20, 20]} />
      <meshStandardMaterial
        color={stringProp(props, "color", "#d94b6b")}
        roughness={0.45}
        metalness={0.5}
      />
    </mesh>
  );
}

function TrajectoryArc({ props }: { props: Record<string, unknown> }) {
  const color = stringProp(props, "color", "#4f7cc7");
  const points3 = (props.points as Array<[number, number, number]>) ?? [];
  if (points3.length < 2) return null;
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points3.map((p) => new THREE.Vector3(...p)),
  );
  const line = useMemo(
    () =>
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color, linewidth: 2 }),
      ),
    [geometry, color],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );
  return <primitive object={line} />;
}

function VectorOverlay({ vector }: { vector: LabVectorOverlay }) {
  const origin = useMemo(
    () => new THREE.Vector3(...vector.origin),
    [vector.origin],
  );
  const direction = useMemo(
    () => new THREE.Vector3(...vector.vector),
    [vector.vector],
  );
  const length = direction.length() * (vector.scale ?? 1);
  const arrow = useMemo(() => {
    if (length <= 0.001) return null;
    const normalized = direction.clone().normalize();
    return new THREE.ArrowHelper(
      normalized,
      origin,
      length,
      vector.color ?? "#d94b6b",
      Math.min(0.22, length * 0.2),
      Math.min(0.12, length * 0.1),
    );
  }, [direction, length, origin, vector.color]);
  useEffect(
    () => () => {
      if (!arrow) return;
      arrow.line.geometry.dispose();
      (arrow.line.material as THREE.Material).dispose();
      arrow.cone.geometry.dispose();
      (arrow.cone.material as THREE.Material).dispose();
    },
    [arrow],
  );
  if (!arrow) return null;
  return (
    <>
      <primitive object={arrow} />
      {vector.label && (
        <BillboardLabel
          text={vector.label}
          position={[
            origin.x + direction.x * length,
            origin.y + direction.y * length + 0.16,
            origin.z + direction.z * length,
          ]}
          color={vector.color ?? "#d94b6b"}
        />
      )}
    </>
  );
}

function TrailOverlay({ trail }: { trail: LabTrailOverlay }) {
  const points = trail.points.map((point) => new THREE.Vector3(...point));
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry().setFromPoints(points);
    return value;
  }, [trail.points]);
  const line = useMemo(() => {
    const material = new THREE.LineBasicMaterial({
      color: trail.color ?? "#4f7cc7",
      linewidth: trail.width ?? 2,
    });
    return new THREE.Line(geometry, material);
  }, [geometry, trail.color, trail.width]);
  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );
  return <primitive object={line} />;
}

function LabelOverlay({ label }: { label: LabLabelOverlay }) {
  return (
    <BillboardLabel
      text={label.text}
      position={label.position}
      color={label.color ?? "#34445a"}
      scale={label.emphasis ? 1.15 : 1}
    />
  );
}

function BillboardLabel({
  text,
  position,
  color,
  scale = 1,
}: {
  text: string;
  position: LabVector3;
  color: string;
  scale?: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = "600 28px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = color;
      context.fillText(text, canvas.width / 2, canvas.height / 2);
    }
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    return value;
  }, [color, text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[1.35 * scale, 0.34 * scale, 1]}>
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </sprite>
  );
}

function numberProp(
  props: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringProp(
  props: Record<string, unknown>,
  key: string,
  fallback: string,
) {
  const value = props[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function animationKeyProp(props: Record<string, unknown>) {
  const value = props.animationKey;
  return typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

function ThreeFallback({
  message = "当前设备无法启动 3D 实验视图。你仍可以使用下方的参数和读数完成本实验。",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-[280px] items-center justify-center rounded-lg bg-[var(--course-content-surface-muted)] p-6 text-center text-xs leading-relaxed text-[var(--course-content-muted)]">
      {message}
    </div>
  );
}

const primitiveRegistry = new LabComponentRegistry();
for (const type of [
  "asset_model",
  "lab_bench",
  "lab_backdrop",
  "lab_tray",
  "reagent_bottle",
  "dropper",
  "burette_stand",
  "platform",
  "ramp",
  "cart",
  "rail",
  "reference_plane",
  "beaker",
  "test_tube",
  "burette",
  "balance",
  "sphere",
  "cylinder",
  "spring",
  "lens",
  "screen",
  "wave_source",
  "field_arrow",
  "potential_well",
  "charge",
  "double_slit",
  "coil",
  "magnet",
  "pendulum_bob",
  "trajectory_arc",
]) {
  primitiveRegistry.register({
    type,
    validate: (props) => validatePrimitiveProps(props),
  });
}

function validatePrimitiveScene(scene: LabSceneDefinition) {
  return scene.components.flatMap((component) =>
    primitiveRegistry.validate(component.type, component.props ?? {}),
  );
}

function validatePrimitiveProps(props: unknown) {
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return ["component props must be a JSON object"];
  }
  const values = props as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of [
    "width",
    "depth",
    "height",
    "length",
    "thickness",
    "wheelRadius",
    "maxVolumeMl",
  ]) {
    if (
      values[key] !== undefined &&
      (typeof values[key] !== "number" ||
        !Number.isFinite(values[key]) ||
        values[key] <= 0)
    ) {
      errors.push(`${key} must be a positive number`);
    }
  }
  for (const key of ["volumeMl", "precipitateG", "display"]) {
    if (
      values[key] !== undefined &&
      (typeof values[key] !== "number" ||
        !Number.isFinite(values[key]) ||
        values[key] < 0)
    ) {
      errors.push(`${key} must be a non-negative number`);
    }
  }
  if (
    values.angleDeg !== undefined &&
    (typeof values.angleDeg !== "number" ||
      !Number.isFinite(values.angleDeg) ||
      values.angleDeg <= 0 ||
      values.angleDeg >= 90)
  ) {
    errors.push("angleDeg must be between 0 and 90 degrees");
  }
  if (
    values.color !== undefined &&
    (typeof values.color !== "string" || values.color.length > 32)
  ) {
    errors.push("color must be a short string");
  }
  return errors;
}

function clampProp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export type { LabVector3 };
