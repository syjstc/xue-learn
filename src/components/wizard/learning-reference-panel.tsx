"use client";

import type { LearningMaterialContent, SqPreview } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import { AnchoredLearningMaterial } from "./anchored-learning-material.tsx";
import {
  CornellReferenceContent,
  ReferenceSection,
  SqReferenceContent,
  type CornellPreview,
} from "./learning-reference-sections.tsx";

export function LearningReferencePanel({
  unitId,
  goalId,
  sq,
  material,
  materialSources = [],
  cornell,
  className = "",
  onMaterialChange,
}: {
  unitId: string;
  goalId?: string;
  sq: SqPreview | null;
  material: LearningMaterialContent | null;
  materialSources?: ContentSource[];
  cornell: CornellPreview | null;
  className?: string;
  onMaterialChange?: (material: LearningMaterialContent) => void;
}) {
  if (!sq && !material && !cornell) return null;

  return (
    <aside
      className={`rounded-xl border border-border/80 bg-card shadow-sm ${className}`}
      aria-label="学习资料"
    >
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">学习资料</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          练习时可随时查阅正文与笔记
        </p>
      </div>
      <div className="max-h-[calc(100vh-10rem)] space-y-0.5 overflow-y-auto p-2">
        {sq && (
          <ReferenceSection title="预习">
            <SqReferenceContent sq={sq} compact />
          </ReferenceSection>
        )}

        {material && (
          <ReferenceSection title="学习正文">
            <AnchoredLearningMaterial
              unitId={unitId}
              sectionId="legacy-material"
              goalId={goalId}
              material={material}
              contextSources={materialSources}
              compact
              onMaterialChange={onMaterialChange}
            />
          </ReferenceSection>
        )}

        {cornell && (
          <ReferenceSection title="学习笔记">
            <CornellReferenceContent cornell={cornell} compact />
          </ReferenceSection>
        )}
      </div>
    </aside>
  );
}

/** @deprecated Use InteractiveMaterialBody */
export { InteractiveMaterialBody as MaterialBody } from "./interactive-material-body.tsx";
