"use client";
import { translateCurrent } from "@xue-learn/core/i18n";

import { useT } from "@xue-learn/core/i18n";

import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import {
  calculate1DCollision,
  calculateInclinedPlane,
  calculateSimplePendulum,
  type MechanicsSandbox,
} from "@xue-learn/core/domain";
import { LabShell } from "./lab-shell.tsx";
import { Slider } from "@/components/ui/slider";
import { LabFrameHost, type LabFrameHandle } from "./lab-frame-host.tsx";
import { physicsLabManifest } from "@/shared/domain/lab-manifest";

export function MechanicsSandboxBlock({
  block,
  compact = false,
}: {
  block: MechanicsSandbox;
  compact?: boolean;
}) {
  const t = useT();

  // Object parameters
  const obj1 = block.objects[0] ?? {
    id: "obj1",
    name: translateCurrent("desktop.copy.objectA"),
    mass: 1,
    initialVelocity: 2,
  };
  const obj2 = block.objects[1] ?? {
    id: "obj2",
    name: translateCurrent("desktop.copy.objectB"),
    mass: 1,
    initialVelocity: 0,
  };

  const [m1, setM1] = useState(obj1.mass);
  const [v1, setV1] = useState(obj1.initialVelocity ?? 2);
  const [m2, setM2] = useState(obj2.mass);
  const [v2, setV2] = useState(obj2.initialVelocity ?? 0);
  const [restitution, setRestitution] = useState(1); // 1 = elastic, 0 = inelastic

  // Pendulum / incline parameters
  const [inclineAngle, setInclineAngle] = useState(30);
  const [pendulumLength, setPendulumLength] = useState(1);

  // Simulation animation state
  const [isPlaying, setIsPlaying] = useState(false);
  const [simTime, setSimTime] = useState(0);
  const [inclineResetVersion, setInclineResetVersion] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Collision calculation
  const collisionResult = useMemo(
    () => calculate1DCollision(m1, v1, m2, v2, restitution),
    [m1, v1, m2, v2, restitution],
  );

  // Inclined plane calculation
  const inclineResult = useMemo(
    () => calculateInclinedPlane(m1, inclineAngle),
    [m1, inclineAngle],
  );

  // Pendulum calculation
  const pendulumResult = useMemo(
    () => calculateSimplePendulum(m1, pendulumLength),
    [m1, pendulumLength],
  );

  // Animation Loop
  useEffect(() => {
    if (block.sandboxType === "inclined_plane") return;
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    lastTimeRef.current = performance.now();

    const loop = (time: number) => {
      const dt = Math.min(0.05, (time - lastTimeRef.current) / 1000);
      lastTimeRef.current = time;

      setSimTime((prev) => {
        const next = prev + dt;
        if (block.sandboxType === "collision_1d" && next > 4) {
          setIsPlaying(false);
          return 4;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, block.sandboxType]);

  const handleReset = () => {
    setIsPlaying(false);
    setSimTime(0);
    setM1(obj1.mass);
    setV1(obj1.initialVelocity ?? 2);
    setM2(obj2.mass);
    setV2(obj2.initialVelocity ?? 0);
    setRestitution(1);
    setInclineAngle(30);
    setPendulumLength(1);
    setInclineResetVersion((version) => version + 1);
  };

  // Render Visual Simulation viewport based on sandboxType
  const renderSimulationViewport = (): ReactNode => {
    if (block.sandboxType === "collision_1d") {
      const trackWidth = 560;
      const trackY = 160;
      const initialPos1 = 120;
      const initialPos2 = 320;
      const collisionTime =
        (initialPos2 - initialPos1 - 50) / Math.max(0.1, v1 - v2);

      let curPos1 = initialPos1;
      let curPos2 = initialPos2;
      let curV1 = v1;
      let curV2 = v2;

      if (simTime < collisionTime) {
        curPos1 = initialPos1 + v1 * simTime * 50;
        curPos2 = initialPos2 + v2 * simTime * 50;
        curV1 = v1;
        curV2 = v2;
      } else {
        const tAfter = simTime - collisionTime;
        const collisionX = initialPos1 + v1 * collisionTime * 50;
        curPos1 = collisionX + collisionResult.v1Final * tAfter * 50;
        curPos2 = collisionX + 50 + collisionResult.v2Final * tAfter * 50;
        curV1 = collisionResult.v1Final;
        curV2 = collisionResult.v2Final;
      }

      const r1 = Math.min(30, Math.max(16, 16 + m1 * 4));
      const r2 = Math.min(30, Math.max(16, 16 + m2 * 4));

      return (
        <svg viewBox="0 0 600 240" className="w-full h-auto select-none">
          {/* Frictionless Track */}
          <line
            x1="20"
            y1={trackY}
            x2="580"
            y2={trackY}
            stroke="var(--course-content-border-accent)"
            strokeWidth="4"
          />
          {/* Ground dashes */}
          {Array.from({ length: 28 }).map((_, i) => (
            <line
              key={i}
              x1={20 + i * 20}
              y1={trackY}
              x2={10 + i * 20}
              y2={trackY + 10}
              stroke="var(--course-content-border-accent)"
              strokeWidth="1.5"
            />
          ))}

          {/* Cart / Sphere 1 */}
          <g transform={`translate(${curPos1}, ${trackY - r1})`}>
            <circle
              cx="0"
              cy="0"
              r={r1}
              fill="var(--color-primary)"
              fillOpacity="0.85"
              stroke="currentColor"
              strokeWidth="2"
            />
            <text
              x="0"
              y="4"
              fill="white"
              fontSize="11"
              fontWeight="bold"
              textAnchor="middle"
            >
              {m1}kg
            </text>
            {/* Velocity arrow */}
            {Math.abs(curV1) > 0.05 && (
              <g transform={`translate(0, ${-r1 - 12})`}>
                <line
                  x1="0"
                  y1="0"
                  x2={curV1 * 20}
                  y2="0"
                  stroke="var(--color-primary)"
                  strokeWidth="2.5"
                  markerEnd="url(#arrow)"
                />
                <text
                  x={curV1 * 10}
                  y="-6"
                  fill="var(--color-primary)"
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  v₁={curV1.toFixed(1)}m/s
                </text>
              </g>
            )}
          </g>

          {/* Cart / Sphere 2 */}
          <g transform={`translate(${curPos2}, ${trackY - r2})`}>
            <circle
              cx="0"
              cy="0"
              r={r2}
              fill="var(--color-accent)"
              fillOpacity="0.85"
              stroke="currentColor"
              strokeWidth="2"
            />
            <text
              x="0"
              y="4"
              fill="white"
              fontSize="11"
              fontWeight="bold"
              textAnchor="middle"
            >
              {m2}kg
            </text>
            {/* Velocity arrow */}
            {Math.abs(curV2) > 0.05 && (
              <g transform={`translate(0, ${-r2 - 12})`}>
                <line
                  x1="0"
                  y1="0"
                  x2={curV2 * 20}
                  y2="0"
                  stroke="var(--color-accent)"
                  strokeWidth="2.5"
                  markerEnd="url(#arrow)"
                />
                <text
                  x={curV2 * 10}
                  y="-6"
                  fill="var(--color-accent)"
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  v₂={curV2.toFixed(1)}m/s
                </text>
              </g>
            )}
          </g>
        </svg>
      );
    }

    if (block.sandboxType === "inclined_plane") {
      return (
        <InclinedPlaneLabFrame
          mass={m1}
          angleDeg={inclineAngle}
          isPlaying={isPlaying}
          resetVersion={inclineResetVersion}
        />
      );
    }

    if (block.sandboxType === "pendulum") {
      const theta = pendulumResult.angleAtTime(simTime);
      const pivotX = 300;
      const pivotY = 30;
      const lengthPx = 130 * pendulumLength;
      const bobX = pivotX + lengthPx * Math.sin(theta);
      const bobY = pivotY + lengthPx * Math.cos(theta);

      return (
        <svg viewBox="0 0 600 240" className="w-full h-auto select-none">
          {/* Pivot */}
          <line
            x1="260"
            y1="30"
            x2="340"
            y2="30"
            stroke="var(--course-content-border-accent)"
            strokeWidth="4"
          />
          <circle cx={pivotX} cy={pivotY} r="4" fill="currentColor" />
          {/* Rod */}
          <line
            x1={pivotX}
            y1={pivotY}
            x2={bobX}
            y2={bobY}
            stroke="currentColor"
            strokeWidth="2"
          />
          {/* Bob */}
          <circle
            cx={bobX}
            cy={bobY}
            r={16}
            fill="var(--color-primary)"
            stroke="currentColor"
            strokeWidth="2"
          />
          <text
            x={bobX}
            y={bobY + 4}
            fill="white"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            {m1}kg
          </text>
        </svg>
      );
    }

    return null;
  };

  // Controls UI
  const controlsUi = (
    <div className="flex flex-col gap-3">
      {block.sandboxType === "collision_1d" && (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[var(--course-content)]">
              <span>{t("desktop.ui.mechanicsSandbox.massOfObjectAM")}</span>
              <span className="font-mono font-semibold">{m1} kg</span>
            </div>
            <Slider
              value={[m1]}
              min={0.5}
              max={5}
              step={0.5}
              onValueChange={([val]) => val && setM1(val)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[var(--course-content)]">
              <span>
                {t("desktop.ui.mechanicsSandbox.initialVelocityOfObjectAV")}
              </span>
              <span className="font-mono font-semibold">{v1} m/s</span>
            </div>
            <Slider
              value={[v1]}
              min={0}
              max={5}
              step={0.5}
              onValueChange={([val]) => val !== undefined && setV1(val)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[var(--course-content)]">
              <span>{t("desktop.ui.mechanicsSandbox.massOfObjectBM")}</span>
              <span className="font-mono font-semibold">{m2} kg</span>
            </div>
            <Slider
              value={[m2]}
              min={0.5}
              max={5}
              step={0.5}
              onValueChange={([val]) => val && setM2(val)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[var(--course-content)]">
              <span>
                {t(
                  "desktop.ui.mechanicsSandbox.coefficientOfRestitutionE1Elastic0",
                )}
              </span>
              <span className="font-mono font-semibold">{restitution}</span>
            </div>
            <Slider
              value={[restitution]}
              min={0}
              max={1}
              step={0.1}
              onValueChange={([val]) =>
                val !== undefined && setRestitution(val)
              }
            />
          </div>
        </>
      )}

      {block.sandboxType === "inclined_plane" && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--course-content)]">
            <span>{t("desktop.ui.mechanicsSandbox.inclineAngle")}</span>
            <span className="font-mono font-semibold">{inclineAngle}°</span>
          </div>
          <Slider
            value={[inclineAngle]}
            min={10}
            max={60}
            step={5}
            onValueChange={([val]) => val && setInclineAngle(val)}
          />
        </div>
      )}

      {block.sandboxType === "pendulum" && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--course-content)]">
            <span>{t("desktop.ui.mechanicsSandbox.pendulumLengthL")}</span>
            <span className="font-mono font-semibold">{pendulumLength} m</span>
          </div>
          <Slider
            value={[pendulumLength]}
            min={0.5}
            max={2}
            step={0.1}
            onValueChange={([val]) => val && setPendulumLength(val)}
          />
        </div>
      )}
    </div>
  );

  // Readouts UI
  const readoutsUi = (
    <div className="flex flex-col gap-2.5 text-xs text-[var(--course-content)]">
      {block.sandboxType === "collision_1d" && (
        <>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t("desktop.ui.mechanicsSandbox.velocitiesAfterCollision")}
            </span>
            <span className="font-mono font-medium">
              v₁&apos; = {collisionResult.v1Final} m/s, v₂&apos; ={" "}
              {collisionResult.v2Final} m/s
            </span>
          </div>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t("desktop.ui.mechanicsSandbox.momentumP")}
            </span>
            <span className="font-mono font-medium">
              {collisionResult.initialMomentum} kg·m/s →{" "}
              {collisionResult.finalMomentum} kg·m/s
            </span>
          </div>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t("desktop.ui.mechanicsSandbox.kineticEnergyEK")}
            </span>
            <span className="font-mono font-medium">
              {t("desktop.ui.mechanicsSandbox.initial")}
              {collisionResult.initialKineticEnergy}{" "}
              {t("desktop.ui.mechanicsSandbox.jFinal")}
              {collisionResult.finalKineticEnergy}{" "}
              {t("desktop.ui.mechanicsSandbox.jLoss")}
              {collisionResult.energyLoss} J)
            </span>
          </div>
        </>
      )}

      {block.sandboxType === "inclined_plane" && (
        <>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t("desktop.ui.mechanicsSandbox.accelerationDownSlopeA")}
            </span>
            <span className="font-mono font-medium">
              {inclineResult.acceleration} m/s²
            </span>
          </div>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t(
                "desktop.ui.mechanicsSandbox.normalForceNGravitationalComponent",
              )}
            </span>
            <span className="font-mono font-medium">
              N = {inclineResult.normalForce} N, G_∥ ={" "}
              {inclineResult.gravityParallel} N
            </span>
          </div>
        </>
      )}

      {block.sandboxType === "pendulum" && (
        <>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t("desktop.ui.mechanicsSandbox.pendulumPeriodT")}
            </span>
            <span className="font-mono font-medium">
              {pendulumResult.period} s
            </span>
          </div>
          <div className="flex items-center justify-between rounded bg-[var(--course-content-surface-muted)] px-2.5 py-1.5">
            <span className="text-[var(--course-content-muted)]">
              {t("desktop.ui.mechanicsSandbox.naturalFrequencyF")}
            </span>
            <span className="font-mono font-medium">
              {pendulumResult.frequency} Hz
            </span>
          </div>
        </>
      )}
    </div>
  );

  return (
    <LabShell
      title={block.title}
      summary={block.summary}
      targetObservation={block.targetObservation}
      badge={t("desktop.ui.mechanicsSandbox.physicsSandbox")}
      compact={compact}
      onReset={handleReset}
      controls={controlsUi}
      readouts={readoutsUi}
      headerActions={
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          className="flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90"
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isPlaying
            ? t("presentationPreview.pause")
            : t("desktop.ui.mechanicsSandbox.startSimulation")}
        </button>
      }
    >
      {renderSimulationViewport()}
    </LabShell>
  );
}

function InclinedPlaneLabFrame({
  mass,
  angleDeg,
  isPlaying,
  resetVersion,
}: {
  mass: number;
  angleDeg: number;
  isPlaying: boolean;
  resetVersion: number;
}) {
  const t = useT();
  const hostRef = useRef<LabFrameHandle>(null);
  const manifest = useMemo(
    () =>
      physicsLabManifest({
        type: "physics_lab",
        experimentId: "inclined_plane_friction",
        experimentVersion: 2,
        title: translateCurrent("desktop.ui.mechanicsSandbox.cartOnAnIncline"),
        summary: translateCurrent(
          "desktop.copy.adjustTheInclineAndObserveTheCartSMotion",
        ),
        branch: "mechanics",
        stage: "high_school",
        renderMode: "3d",
        parameters: { mass, angle: angleDeg, mu: 0.15, g: 9.81 },
      }),
    [angleDeg, mass],
  );

  useEffect(() => {
    hostRef.current?.send({ type: "setParameter", id: "mass", value: mass });
  }, [mass]);
  useEffect(() => {
    hostRef.current?.send({
      type: "setParameter",
      id: "angle",
      value: angleDeg,
    });
  }, [angleDeg]);
  useEffect(() => {
    hostRef.current?.send({ type: isPlaying ? "play" : "pause" });
  }, [isPlaying]);
  useEffect(() => {
    if (resetVersion > 0) hostRef.current?.send({ type: "reset" });
  }, [resetVersion]);

  return (
    <LabFrameHost
      ref={hostRef}
      manifest={manifest}
      title={t("desktop.ui.mechanicsSandbox.cartOnAnIncline")}
      className="h-[320px] w-full sm:h-[380px]"
    />
  );
}
