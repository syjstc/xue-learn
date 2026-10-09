import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  applyCertifiedChemistryAction,
  createChemistryScene,
  createPhysicsScene,
  evaluateCertifiedManifest,
  getChemistryExperiment,
  getPhysicsExperiment,
  normalizeChemistryLabDefinition,
  normalizeCertifiedParameters,
  validateCertifiedManifest,
  validateCertifiedParameter,
  LabRuntimeController,
  type ChemistryOperation,
  type ChemistryLabSnapshot,
  type LabInteractionEvent,
  type LabSceneDefinition,
} from "@xue-learn/core/lab-engine";
import {
  LAB_HELLO_TYPE,
  LAB_PROTOCOL_NAME,
  LAB_PROTOCOL_VERSION,
  createLabEnvelope,
  hostCommandSchema,
  isLabHandshake,
  labEnvelopeSchema,
  validateLabManifest,
  type LabEnvelope,
  type LabEvent,
  type LabManifestV1,
  type LabState,
} from "@xue-learn/core/lab-protocol";
import { LabCanvas } from "./lab-canvas.tsx";

type RuntimeState = { simTime: number };
type DomainState = {
  parameters: Record<string, number>;
  observations: readonly { id: string; label: string; value: number | string; unit?: string }[];
  chemistrySnapshot?: ChemistryLabSnapshot;
};

function initialDomainState(manifest: LabManifestV1): DomainState {
  const parameters = normalizeCertifiedParameters(
    manifest.domain,
    manifest.experimentId,
    manifest.experimentVersion,
    manifest.parameters,
  ) ?? manifest.parameters;
  const evaluated = evaluateCertifiedManifest(
    manifest.domain,
    manifest.experimentId,
    manifest.experimentVersion,
    parameters,
  );
  return {
    parameters,
    observations: evaluated?.observations ?? [],
    chemistrySnapshot: evaluated?.chemistrySnapshot,
  };
}

function operationForAction(
  manifest: LabManifestV1,
  state: DomainState,
  actionId: string,
): ChemistryOperation | null {
  if (manifest.domain !== "chemistry") return null;
  const volume = state.parameters.volumeMl ?? 10;
  switch (actionId) {
    case "add-phenolphthalein": return { kind: "add_reagent", vesselId: "sample", substance: "phenolphthalein", amountMl: 1 };
    case "add-acid": return { kind: "add_reagent", vesselId: "sample", substance: "hydrochloric_acid", amountMl: 2 };
    case "add-base": return { kind: "add_reagent", vesselId: "sample", substance: "sodium_hydroxide", amountMl: 2 };
    case "titrate": return { kind: "titrate", vesselId: "burette", amountMl: 1 };
    case "transfer-silver": return { kind: "transfer", sourceVesselId: "silver", targetVesselId: "mixing", amountMl: volume };
    case "transfer-chloride": return { kind: "transfer", sourceVesselId: "chloride", targetVesselId: "mixing", amountMl: volume };
    case "mix-sample": return { kind: "mix", vesselId: "sample" };
    case "mix-flask": return { kind: "mix", vesselId: "flask" };
    case "mix-mixing": return { kind: "mix", vesselId: "mixing" };
    case "tare-scale": return { kind: "tare_scale" };
    case "measure-closed": return { kind: "measure_mass", vesselId: "closed" };
    case "mix-closed": return { kind: "mix", vesselId: "closed" };
    default: return null;
  }
}

function initialDemoManifest(): LabManifestV1 {
  return {
    type: "lab_manifest",
    protocolVersion: LAB_PROTOCOL_VERSION,
    manifestVersion: 1,
    domain: "physics",
    experimentId: "inclined_plane_friction",
    experimentVersion: 2,
    title: "斜面小车实验",
    summary: "调整斜面参数并观察小车在斜面上的运动。",
    learningIntent: "理解倾角和摩擦力如何影响加速度。",
    targetObservation: "观察加速度与斜面倾角、摩擦力之间的关系。",
    parameters: { mass: 1, angle: 30, mu: 0.15, g: 9.81 },
    actionIds: ["play", "pause", "reset", "finish"],
    scene: {
      version: 1,
      environment: { background: "#edf2f7", grid: true, ground: true, ambientIntensity: 0.72 },
      camera: { position: [6.8, 4.8, 7.4], target: [0, 1.1, 0], fov: 40, minDistance: 3, maxDistance: 14 },
      lights: [{ kind: "directional", position: [4, 8, 5], intensity: 1.25, castShadow: true }],
      components: [
        { id: "reference-plane", type: "reference_plane", position: [0, -0.02, 0], props: { width: 8, depth: 4.8 } },
        { id: "platform", type: "platform", position: [0, -0.24, 0], props: { width: 6.8, depth: 2.4, height: 0.32, color: "#b9c9dc" } },
        { id: "incline", type: "ramp", position: [-2.6, 0.05, 0], props: { length: 5.2, width: 1.65, thickness: 0.24, angleDeg: 30, color: "#dc9560" }, interaction: { id: "incline-play", label: "斜面", actionId: "play", mode: "activate" } },
        { id: "cart", type: "cart", position: [1.1, 1.0, 0], props: { width: 0.78, depth: 0.62, height: 0.34, wheelRadius: 0.15, color: "#4f7cc7" } },
      ],
      labels: [{ id: "title", text: "斜面小车", position: [0, 2.8, 0], emphasis: true }],
    },
  };
}

function sceneFromManifest(
  manifest: LabManifestV1,
  domainState?: DomainState | null,
  simTime = 0,
): LabSceneDefinition {
  if (manifest.domain === "physics") {
    return {
      ...createPhysicsScene(
        manifest.experimentId,
        domainState?.parameters ?? manifest.parameters,
        simTime,
      ),
      capabilities: {
        controls: manifest.actionIds,
        observations: [],
        renderMode: "3d",
        supportsSampling: true,
        supportsAnalysis: false,
      },
    };
  }
  if (manifest.domain === "chemistry") {
    const definition = normalizeChemistryLabDefinition({
      experimentId: manifest.experimentId,
      experimentVersion: manifest.experimentVersion,
      title: manifest.title,
      summary: manifest.summary,
      parameters: domainState?.parameters ?? manifest.parameters,
      snapshot: domainState?.chemistrySnapshot,
    });
    if (definition) {
      const live = createChemistryScene(definition);
      return {
        ...live,
        capabilities: {
          controls: manifest.actionIds,
          observations: live.capabilities?.observations ?? [],
          renderMode: "3d",
          supportsSampling: true,
          supportsAnalysis: false,
        },
      };
    }
  }
  return {
    ...manifest.scene,
    capabilities: {
      controls: manifest.actionIds,
      observations: [],
      renderMode: "3d",
      supportsSampling: true,
      supportsAnalysis: false,
    },
    components: manifest.scene.components.map((component) => ({
      ...component,
      interaction: component.interaction
        ? {
            id: component.interaction.id,
            label: component.interaction.label,
            actionLabel: component.interaction.label,
            mode: component.interaction.mode,
            allowedTargetIds: component.interaction.allowedTargetIds,
            disabled: component.interaction.disabled,
          }
        : undefined,
    })),
  };
}

export function LabRuntimeApp() {
  const [manifest, setManifest] = useState<LabManifestV1 | null>(() =>
    new URLSearchParams(window.location.search).has("demo") ? initialDemoManifest() : null,
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<DomainState["observations"]>(() =>
    manifest ? initialDomainState(manifest).observations : [],
  );
  const [simTime, setSimTime] = useState(0);
  const [parameters, setParameters] = useState<Record<string, number>>(() =>
    manifest ? initialDomainState(manifest).parameters : {},
  );
  const portRef = useRef<MessagePort | null>(null);
  const sessionRef = useRef<string | null>(null);
  const manifestRef = useRef<LabManifestV1 | null>(manifest);
  const runningRef = useRef(false);
  const domainStateRef = useRef<DomainState | null>(manifest ? initialDomainState(manifest) : null);
  const lastObservationPublishRef = useRef(Number.NEGATIVE_INFINITY);
  const outgoingSequence = useRef(0);
  const handleCommandRef = useRef<(
    command: ReturnType<typeof hostCommandSchema.parse>,
    messageId: string,
  ) => void>(() => undefined);
  const runtime = useMemo(
    () =>
      new LabRuntimeController<RuntimeState>({
        fixedStepSeconds: 1 / 60,
        maxFrameDeltaSeconds: 0.1,
        initialState: { simTime: 0 },
        cloneState: (state) => ({ ...state }),
        step: (state, dt) => ({ simTime: Math.min(60, state.simTime + dt) }),
      }),
    [],
  );

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    const unsubscribe = runtime.subscribe((state) => setSimTime(state.simTime));
    setSimTime(runtime.currentState.simTime);
    return () => {
      unsubscribe();
    };
  }, [runtime]);

  const post = useCallback((kind: LabEnvelope["kind"], payload: unknown, messageId?: string) => {
    const port = portRef.current;
    const currentSession = sessionRef.current;
    if (!port || !currentSession) return;
    port.postMessage(
      createLabEnvelope(currentSession, messageId ?? `lab-${crypto.randomUUID()}`, outgoingSequence.current++, kind, payload as LabEnvelope["payload"]),
    );
  }, []);

  const emit = useCallback((event: LabEvent) => post("event", event), [post]);

  const statePayload = useCallback((): LabState | null => {
    const currentManifest = manifestRef.current;
    const domainState = domainStateRef.current;
    if (!currentManifest || !domainState) return null;
    return {
      experimentId: currentManifest.experimentId,
      running: runningRef.current,
      elapsedSeconds: runtime.clock.elapsed,
      parameters: domainState.parameters,
      observations: domainState.observations.map((observation) => ({
        id: observation.id,
        value: observation.value,
        ...(observation.unit ? { unit: observation.unit } : {}),
      })),
    };
  }, [runtime]);

  const publishObservations = useCallback((observations: DomainState["observations"]) => {
    const now = performance.now();
    // Observations are domain facts, not render telemetry. Keep bursts from
    // slider/action input below 20 messages per second; requestState always
    // exposes the latest values when a host needs an immediate snapshot.
    if (now - lastObservationPublishRef.current < 50) return;
    lastObservationPublishRef.current = now;
    for (const observation of observations) {
      emit({
        type: "observation.changed",
        id: observation.id,
        value: observation.value,
        ...(observation.unit ? { unit: observation.unit } : {}),
      });
    }
  }, [emit]);

  const setDomainState = useCallback((next: DomainState | null) => {
    domainStateRef.current = next;
    setObservations(next?.observations ?? []);
    setParameters(next?.parameters ?? {});
  }, []);

  useEffect(() => {
    const expectedNonce = new URLSearchParams(window.location.search).get("nonce") ?? "";
    const announce = () => {
      if (sessionRef.current) return;
      window.parent.postMessage(
        {
          type: LAB_HELLO_TYPE,
          protocol: LAB_PROTOCOL_NAME,
          version: LAB_PROTOCOL_VERSION,
          nonce: expectedNonce,
        },
        "*",
      );
    };
    const handleWindowMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isLabHandshake(event.data) || event.data.protocol !== LAB_PROTOCOL_NAME) return;
      if (expectedNonce && event.data.nonce !== expectedNonce) return;
      const port = event.ports[0];
      if (!port) return;
      portRef.current?.close();
      portRef.current = port;
      sessionRef.current = event.data.sessionId;
      outgoingSequence.current = 0;
      setSessionId(event.data.sessionId);
      setError(null);
      port.onmessage = (messageEvent: MessageEvent) => {
        const envelope = labEnvelopeSchema.safeParse(messageEvent.data).success
          ? messageEvent.data as LabEnvelope
          : null;
        if (!envelope || envelope.sessionId !== event.data.sessionId || envelope.kind !== "command") return;
        const command = hostCommandSchema.safeParse(envelope.payload);
        if (!command.success) {
          port.postMessage(createLabEnvelope(event.data.sessionId, envelope.id, outgoingSequence.current++, "ack", { type: "ack", accepted: false, error: { code: "invalid_command", message: "无法识别实验室指令" } }));
          return;
        }
        handleCommandRef.current(command.data, envelope.id);
      };
      port.start();
      emit({ type: "ready", capabilities: ["physics", "chemistry", "scene", "actions"] });
    };
    window.addEventListener("message", handleWindowMessage);
    announce();
    const helloTimer = window.setInterval(announce, 250);
    return () => {
      window.clearInterval(helloTimer);
      window.removeEventListener("message", handleWindowMessage);
      portRef.current?.close();
      portRef.current = null;
      sessionRef.current = null;
    };
  }, [emit]);

  const handleCommand = async (command: ReturnType<typeof hostCommandSchema.parse>, messageId: string) => {
    const ack = (accepted: boolean, errorValue?: { code: string; message: string }) => {
      post("ack", { type: "ack", accepted, ...(errorValue ? { error: errorValue } : {}) }, messageId);
    };
    switch (command.type) {
      case "loadManifest": {
        const result = validateLabManifest(command.manifest);
        if (!result.success) {
          setError(result.errors.join("; "));
          ack(false, { code: "invalid_manifest", message: result.errors[0] ?? "实验定义无效" });
          emit({ type: "runtime.failed", code: "invalid_manifest", message: result.errors[0] ?? "实验定义无效", recoverable: true });
          return;
        }
        const certificationErrors = validateCertifiedManifest(result.data);
        if (certificationErrors.length > 0) {
          const message = certificationErrors[0] ?? "认证实验定义无效";
          setError(message);
          ack(false, { code: "incompatible_experiment", message });
          emit({ type: "runtime.failed", code: "incompatible_experiment", message, recoverable: true });
          return;
        }
        setManifest(result.data);
        manifestRef.current = result.data;
        setDomainState(initialDomainState(result.data));
        runningRef.current = false;
        setRunning(false);
        runtime.reset();
        ack(true);
        emit({ type: "manifest.loaded", experimentId: result.data.experimentId });
        publishObservations(domainStateRef.current?.observations ?? []);
        return;
      }
      case "play": runtime.start(); runningRef.current = true; setRunning(true); emit({ type: "runtime.started" }); ack(true); return;
      case "pause": runtime.pause(); runningRef.current = false; setRunning(false); emit({ type: "runtime.paused" }); ack(true); return;
      case "reset": {
        runtime.reset();
        runningRef.current = false;
        setRunning(false);
        if (manifestRef.current) {
          setDomainState(initialDomainState(manifestRef.current));
          publishObservations(domainStateRef.current?.observations ?? []);
        }
        emit({ type: "runtime.reset" });
        ack(true);
        return;
      }
      case "setParameter": {
        const currentManifest = manifestRef.current;
        const currentDomainState = domainStateRef.current;
        if (!currentManifest || !currentDomainState || typeof command.value !== "number") {
          ack(false, { code: "invalid_parameter", message: "参数不在实验定义中" });
          return;
        }
        const parameterValidation = validateCertifiedParameter(
          currentManifest.domain,
          currentManifest.experimentId,
          currentManifest.experimentVersion,
          command.id,
          command.value,
        );
        if (!parameterValidation.valid) {
          ack(false, { code: parameterValidation.code, message: parameterValidation.message });
          return;
        }
        const nextParameters = { ...currentDomainState.parameters, [command.id]: command.value };
        const nextManifest = { ...currentManifest, parameters: nextParameters };
        const nextDomainState = initialDomainState(nextManifest);
        setDomainState(nextDomainState);
        manifestRef.current = nextManifest;
        setManifest(nextManifest);
        emit({ type: "parameter.changed", id: command.id, value: command.value });
        publishObservations(nextDomainState.observations);
        ack(true);
        return;
      }
      case "performAction": {
        const currentManifest = manifestRef.current;
        if (!currentManifest || !currentManifest.actionIds.includes(command.actionId)) {
          ack(false, { code: "unknown_action", message: "实验不支持该动作" });
          emit({ type: "action.rejected", actionId: command.actionId, code: "unknown_action", message: "实验不支持该动作" });
          return;
        }
        if (command.actionId === "play") { runtime.start(); runningRef.current = true; setRunning(true); emit({ type: "runtime.started" }); }
        else if (command.actionId === "pause") { runtime.pause(); runningRef.current = false; setRunning(false); emit({ type: "runtime.paused" }); }
        else if (command.actionId === "reset") {
          runtime.reset();
          runningRef.current = false;
          setRunning(false);
          const resetState = initialDomainState(currentManifest);
          setDomainState(resetState);
          emit({ type: "runtime.reset" });
          publishObservations(resetState.observations);
        }
        else if (command.actionId === "finish") emit({ type: "finish.requested", reason: "lab-action" });
        else {
          const currentDomainState = domainStateRef.current;
          if (!currentDomainState) {
            ack(false, { code: "not_loaded", message: "实验尚未加载" });
            return;
          }
          const operation = operationForAction(currentManifest, currentDomainState, command.actionId);
          if (!operation) {
            ack(false, { code: "unsupported_action", message: "当前实验尚未注册该动作。" });
            emit({ type: "action.rejected", actionId: command.actionId, code: "unsupported_action", message: "当前实验尚未注册该动作。" });
            return;
          }
          const definition = normalizeChemistryLabDefinition({
            experimentId: currentManifest.experimentId,
            experimentVersion: currentManifest.experimentVersion,
            parameters: currentDomainState.parameters,
            snapshot: currentDomainState.chemistrySnapshot,
          });
          if (!definition) {
            ack(false, { code: "experiment_unavailable", message: "认证实验版本不可用。" });
            return;
          }
          const result = applyCertifiedChemistryAction(definition, operation);
          if (!result.accepted) {
            ack(false, { code: "operation_rejected", message: result.message });
            emit({ type: "action.rejected", actionId: command.actionId, code: "operation_rejected", message: result.message });
            return;
          }
          const evaluated = evaluateCertifiedManifest(
            currentManifest.domain,
            currentManifest.experimentId,
            currentManifest.experimentVersion,
            currentDomainState.parameters,
            result.state,
          );
          const nextDomainState: DomainState = {
            parameters: currentDomainState.parameters,
            observations: evaluated?.observations ?? [],
            chemistrySnapshot: evaluated?.chemistrySnapshot ?? result.state,
          };
          setDomainState(nextDomainState);
          emit({ type: "action.applied", actionId: command.actionId, observationIds: nextDomainState.observations.map((observation) => observation.id) });
          publishObservations(nextDomainState.observations);
        }
        ack(true);
        return;
      }
      case "requestState": {
        const state = statePayload();
        if (state) post("state", { type: "state", state });
        ack(Boolean(state), state ? undefined : { code: "not_loaded", message: "实验尚未加载" });
        return;
      }
      case "setLocale":
      case "setTheme":
        ack(true);
        return;
      case "destroy":
        runtime.pause();
        ack(true);
        portRef.current?.close();
        portRef.current = null;
        sessionRef.current = null;
        setSessionId(null);
        return;
    }
    void messageId;
  };
  handleCommandRef.current = handleCommand;

  const scene = manifest ? sceneFromManifest(manifest, domainStateRef.current, simTime) : null;
  const parameterSpecs =
    manifest?.domain === "physics"
      ? getPhysicsExperiment(manifest.experimentId, manifest.experimentVersion)?.parameters ?? []
      : manifest?.domain === "chemistry"
        ? getChemistryExperiment(manifest.experimentId, manifest.experimentVersion)?.parameters ?? []
        : [];
  return (
    <main style={{ minHeight: "100vh", background: "#11181d", color: "#e8eef2", fontFamily: "system-ui, sans-serif" }}>
      {error ? <div role="alert" style={{ padding: 16, color: "#fecdd3", background: "#4c0519" }}>{error}</div> : null}
      {!manifest ? (
        <div style={{ display: "grid", minHeight: "100vh", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 520, textAlign: "center" }}>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>会学实验室</h1>
            <p style={{ color: "#9aa8b0" }}>等待主应用加载一个已验证的实验定义。</p>
          </div>
        </div>
      ) : (
        <section style={{ display: "grid", gridTemplateRows: "auto auto 1fr auto auto", minHeight: "100vh" }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid #243038" }}>
            <div><strong>{manifest.title}</strong><div style={{ fontSize: 12, color: "#9aa8b0" }}>{manifest.summary}</div></div>
            <div style={{ display: "flex", gap: 8 }}>
              {manifest.actionIds.includes("play") ? (
                <button type="button" onClick={() => void handleCommand({ type: running ? "pause" : "play" }, `control-${running ? "pause" : "play"}`)} style={chromeButton}>{running ? "暂停" : "开始"}</button>
              ) : null}
              <button type="button" onClick={() => emit({ type: "finish.requested", reason: "header" })} style={chromeButton}>完成实验</button>
            </div>
          </header>
          {manifest.actionIds.some((actionId) => !["play", "pause", "reset", "finish"].includes(actionId)) ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px" }} aria-label="实验操作">
              {manifest.actionIds.filter((actionId) => !["play", "pause", "reset", "finish"].includes(actionId)).map((actionId) => (
                <button key={actionId} type="button" onClick={() => void handleCommand({ type: "performAction", actionId }, `control-${actionId}`)} style={chromeButton}>
                  {actionLabel(actionId)}
                </button>
              ))}
            </div>
          ) : <div />}
          <div style={{ minHeight: 420, background: "#1a2328" }}>
            <LabCanvas
              scene={scene!}
              runtime={runtime}
              className="h-full w-full"
              onInteraction={(event: LabInteractionEvent) => {
                const componentId = "componentId" in event ? event.componentId : null;
                const component = componentId
                  ? (scene?.components.find((item) => item.id === componentId) ??
                    manifest.scene.components.find((item) => item.id === componentId))
                  : undefined;
                const actionId =
                  event.type === "activate" || event.type === "drop"
                    ? event.interactionId
                    : component?.interaction?.id;
                if (event.type === "select") {
                  emit({ type: "selection.changed", componentId: event.componentId });
                } else if (actionId) {
                  void handleCommand({ type: "performAction", actionId }, `interaction-${event.type}`);
                }
              }}
              fallback={<div style={{ display: "grid", minHeight: 420, placeItems: "center", color: "#9aa8b0" }}>当前设备无法启动 3D 视图，请使用主应用提供的参数与读数。</div>}
            />
          </div>
          {parameterSpecs.length > 0 ? (
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", padding: "8px 12px", borderTop: "1px solid #243038" }}>
              {parameterSpecs.map((spec) => {
                const value = parameters[spec.id] ?? manifest.parameters[spec.id] ?? spec.default;
                return (
                  <label key={spec.id} style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", color: "#c5d0d6" }}>
                      {spec.label}
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{value} {spec.unit}</span>
                    </span>
                    <input
                      type="range"
                      min={spec.min}
                      max={spec.max}
                      step={spec.step}
                      value={value}
                      onChange={(event) => void handleCommand({ type: "setParameter", id: spec.id, value: Number(event.target.value) }, `param-${spec.id}`)}
                    />
                  </label>
                );
              })}
            </div>
          ) : <div />}
          {observations.length > 0 ? (
            <section aria-label="实验观察" style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", padding: "8px 12px 12px" }}>
              {observations.map((observation) => (
                <div key={observation.id} style={{ border: "1px solid #2b3940", borderRadius: 10, background: "#182126", padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: "#9aa8b0" }}>{observation.label}</div>
                  <div style={{ marginTop: 2, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
                    {typeof observation.value === "number" ? Number(observation.value.toFixed(4)).toString() : observation.value}
                    {observation.unit ? ` ${observation.unit}` : ""}
                  </div>
                </div>
              ))}
            </section>
          ) : <div />}
        </section>
      )}
    </main>
  );
}

const chromeButton: CSSProperties = {
  border: "1px solid #3a4a52",
  background: "#1c262c",
  color: "#e8eef2",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12,
  cursor: "pointer",
};

function actionLabel(actionId: string) {
  const labels: Record<string, string> = {
    "add-phenolphthalein": "加入酚酞",
    "add-acid": "滴加酸",
    "add-base": "滴加碱",
    titrate: "滴定 1 mL",
    "transfer-silver": "转移硝酸银",
    "transfer-chloride": "转移氯化钠",
    "mix-sample": "混匀样品",
    "mix-flask": "摇匀观察",
    "mix-mixing": "混合反应",
    "tare-scale": "天平归零",
    "measure-closed": "称量密闭容器",
    "mix-closed": "混合并封闭",
  };
  return labels[actionId] ?? actionId;
}
