import type { ReactNode } from "react";
import type { LabInteractionEvent, LabSceneDefinition } from "@xue-learn/core/lab-engine";
import { LabThreeCanvas } from "./three/lab-three-canvas.tsx";

type RuntimeHandle = { advance: (deltaSeconds: number) => number };

export function LabCanvas({
  scene,
  runtime,
  className,
  fallback,
  onInteraction,
}: {
  scene: LabSceneDefinition;
  runtime?: RuntimeHandle;
  className?: string;
  fallback?: ReactNode;
  onInteraction?: (event: LabInteractionEvent) => void;
}) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 420 }}>
      <LabThreeCanvas
        scene={scene}
        runtime={runtime}
        className={className}
        fallback={fallback}
        onInteraction={onInteraction}
        showInteractionHud
      />
    </div>
  );
}
