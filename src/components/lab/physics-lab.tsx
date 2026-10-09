"use client";

import { useMemo } from "react";
import type { PhysicsLabDefinition } from "@xue-learn/core/domain";
import { LabFrameHost } from "./lab-frame-host.tsx";
import { physicsLabManifest } from "@/shared/domain/lab-manifest";

/** Host chrome for certified physics experiments. Rendering lives in lab-runtime. */
export function PhysicsLabBlock({
  block,
  compact = false,
}: {
  block: PhysicsLabDefinition;
  compact?: boolean;
}) {
  const manifest = useMemo(() => physicsLabManifest(block), [block]);
  return (
    <LabFrameHost
      manifest={manifest}
      title={block.title}
      className={compact ? "h-[360px] w-full rounded-xl border-0" : "h-[560px] w-full rounded-xl border-0"}
      fallback={
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{block.title}</p>
          <p className="mt-1">{block.summary}</p>
        </div>
      }
    />
  );
}
