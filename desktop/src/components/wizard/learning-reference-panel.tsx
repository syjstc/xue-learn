"use client";
import { useT } from "@xue-learn/core/i18n";

import type {
  LearningMaterialContent,
  SqPreview,
} from "@xue-learn/core/schemas";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
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
  const t = useT();
  if (!sq && !material && !cornell) return null;

  return (
    <aside
      className={`rounded-xl border border-border/80 bg-card shadow-sm ${className}`}
      aria-label={t("goalDocuments.title")}
    >
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("goalDocuments.title")}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t(
            "desktop.ui.learningReferencePanel.referToLessonContentAndNotesWhile",
          )}
        </p>
      </div>
      <div className="max-h-[calc(100vh-10rem)] space-y-0.5 overflow-y-auto p-2">
        {sq && (
          <ReferenceSection title={t("learningJourney.preview")}>
            <SqReferenceContent sq={sq} compact />
          </ReferenceSection>
        )}

        {material && (
          <ReferenceSection title={t("wizard.steps.structured.materialTitle")}>
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
          <ReferenceSection title={t("learningJourney.notes")}>
            <CornellReferenceContent cornell={cornell} compact />
          </ReferenceSection>
        )}
      </div>
    </aside>
  );
}

/** @deprecated Use InteractiveMaterialBody */
export { InteractiveMaterialBody as MaterialBody } from "./interactive-material-body.tsx";
