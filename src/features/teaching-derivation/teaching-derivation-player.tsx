"use client";

import { TeachingPresentationControls } from "./presentation-controls.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDerivationMotion } from "./use-derivation-motion.ts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  resolveTeachingDerivationDerived,
  type TeachingDerivationDerivedV1,
  type TeachingDerivationDocumentV1,
} from "@xue-learn/core/teaching-derivation";
import { Button } from "@xue-learn/core/ui/button";
import { AssistantChatMessage } from "@/components/wizard/conversation/assistant-chat-message";
import { MaterialBlockRenderer } from "@/components/wizard/interactive-material/material-block-renderer";
import {derivationDisplayDocument} from "@xue-learn/core/display/catalog";
import {createDisplayClock} from "@xue-learn/core/display/runtime";
import {DisplayDocumentHost} from "@/features/display/display-block-host";
import { FormulaTreeDebug } from "@/features/teaching-derivation/formula-tree-debug";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import { useT } from "@xue-learn/core/i18n";
import { EMPTY_HIGHLIGHTS } from "@/features/teaching-derivation/empty-highlights";

export function TeachingDerivationPlayer({
  document,
  derived: storedDerived,
  onContinue,
  busy = false,
  generating = false,
  persistedCursor,
  onCursorChange,
  assistantName,
  assistantAvatarSrc,
  presentationContext,
}: {
  document: TeachingDerivationDocumentV1;
  derived?: TeachingDerivationDerivedV1 | null;
  onContinue: () => void;
  busy?: boolean;
  generating?: boolean;
  persistedCursor?: number;
  onCursorChange?: (cursor: number) => void;
  assistantName: string;
  assistantAvatarSrc: string;
  presentationContext?: { unitId: string; sectionId: string; revision: number; onUpdated: () => Promise<void> };
}) {
  const t = useT();
  const maxOrdinal = document.steps.length;
  const [ordinal, setOrdinal] = useState(() =>
    persistedCursor != null
      ? Math.max(1, Math.min(maxOrdinal || 1, persistedCursor))
      : 1,
  );
  const [cueIndex, setCueIndex] = useState(0);
  const [focused, setFocused] = useState(true);
  const documentIdRef = useRef(document.id);
  const activeStep = document.steps[ordinal - 1];
  const activeCue = activeStep?.cues?.[cueIndex];
  const trigger = activeStep?.cues?.findIndex(cue => cue.startTransform) ?? -1;
  const phase = trigger >= 0 ? cueIndex < trigger ? "before" : "after" : undefined;
  const motion = useDerivationMotion(ordinal, phase);
  const animating = motion.progress < 1 && phase !== "before";
  const derived = useMemo(
    () => {try {return resolveTeachingDerivationDerived(document, storedDerived);} catch {return undefined;}},
    [document, storedDerived],
  );
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  useEffect(() => {
    const replaced = documentIdRef.current !== document.id;
    documentIdRef.current = document.id;
    setOrdinal(current => Math.max(1, Math.min(maxOrdinal || 1, replaced ? persistedCursor ?? 1 : current)));
    if (replaced) setCueIndex(0);
  }, [document.id, maxOrdinal, persistedCursor]);
  useEffect(() => {
    setCueIndex(current => Math.max(0, Math.min(Math.max(0, (activeStep?.cues?.length ?? 1) - 1), current)));
  }, [activeStep?.cues?.length]);
  useEffect(() => {
    onCursorChangeRef.current?.(ordinal);
  }, [ordinal]);
  const step = document.steps[ordinal - 1];
  const stepDerived = derived?.steps[ordinal - 1];
  const go = (next: number, segment = 0) => {
    const clamped = Math.max(1, Math.min(maxOrdinal || 1, next));
    setCueIndex(segment);
    setOrdinal(clamped);
  };
  const cueCount = Math.max(1, step?.cues?.length ?? 0);
  const move = (direction: -1 | 1) => {
    const nextCue = cueIndex + direction;
    if (nextCue >= 0 && nextCue < cueCount) setCueIndex(nextCue);
    else if (direction > 0) go(ordinal + 1);
    else go(ordinal - 1, Math.max(0, (document.steps[ordinal - 2]?.cues?.length ?? 1) - 1));
  };

  if (!step) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("wizard.section.preparingDerivation")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-explanation-mode={focused ? "focused" : "complete"}>
      {isDesktopLocalRuntime() && presentationContext && document.status === "complete" ? <TeachingPresentationControls {...presentationContext} disabled={busy || generating} canRestore={Boolean(document.presentationBackup)} /> : null}
      <header className="space-y-3">
        <div className="flex gap-2" role="group" aria-label={t("teachingDerivation.viewMode")}>
          <Button type="button" size="sm" variant={focused ? "default" : "outline"} aria-pressed={focused} onClick={() => setFocused(true)}>{t("teachingDerivation.focusedView")}</Button>
          <Button type="button" size="sm" variant={focused ? "outline" : "default"} aria-pressed={!focused} onClick={() => setFocused(false)}>{t("teachingDerivation.completeView")}</Button>
        </div>
        <p className="text-sm text-[var(--course-content-muted)]">
          {document.teachingGoal}
        </p>
        <nav
          aria-label={t("teachingDerivation.steps")}
          className="flex flex-wrap gap-2"
        >
          {document.steps.map((item) => (
            <button
              key={item.index}
              type="button"
              disabled={busy || animating}
              aria-current={item.index === ordinal ? "step" : undefined}
              aria-label={t("teachingDerivation.step", { step: item.index })}
              title={item.justification}
              onClick={() => go(item.index)}
              className="h-8 min-w-8 rounded-full border px-2 text-xs aria-[current=step]:bg-[var(--accent)] aria-[current=step]:text-white"
            >
              {item.index}
            </button>
          ))}
        </nav>
      </header>
      {step.presentationFallback ? <p className="text-sm text-amber-800">{t("teachingDerivation.fallback")}</p> : null}
      <DisplayDocumentHost
        document={derivationDisplayDocument({document, derived, focused, toStep: ordinal, fromStep: motion.from,
          cueId: activeCue?.id, progress: motion.progress})}
        clock={createDisplayClock(motion.progress * 60, 60)} controls={false}
      />
      <div className="space-y-2 text-sm">
        <AssistantChatMessage
          name={assistantName}
          avatarSrc={assistantAvatarSrc}
        >
          <MaterialBlockRenderer
            block={{ type: "paragraph", text: focused ? activeCue?.text ?? step.narration : step.narration }}
            blockIndex={0}
            highlights={EMPTY_HIGHLIGHTS}
          />
        </AssistantChatMessage>
      </div>
      {step.cues?.length ? (
        <nav className="flex flex-wrap gap-2" aria-label={t("teachingDerivation.explanations")}>
          {step.cues.map((cue, index) => <button type="button" key={cue.id}
            disabled={busy || animating} aria-current={index === cueIndex ? "step" : undefined}
            className="rounded-full border px-3 py-1 text-sm aria-[current=step]:bg-emerald-100"
            onClick={() => setCueIndex(index)}>{index + 1}</button>)}
        </nav>
      ) : null}
      {isDesktopLocalRuntime() ? (
        <FormulaTreeDebug
          analysis={
            stepDerived?.formulas.find(
              (item) => item.key === step.focusFormulaKey,
            )?.analysis
          }
        />
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={(ordinal <= 1 && cueIndex === 0) || busy || animating}
          onClick={() => move(-1)}
        >
          <ChevronLeft aria-hidden />
          {t(cueIndex > 0 ? "teachingDerivation.previousCue" : "learningScene.derivationBack")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("learningScene.derivationProgress", {
            current: ordinal,
            total: maxOrdinal || 1,
          })}
          {cueCount > 1 ? ` · ${t("teachingDerivation.cueProgress", { current: cueIndex + 1, total: cueCount })}` : ""}
        </span>
        {ordinal < maxOrdinal || cueIndex < cueCount - 1 ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || animating}
            onClick={() => move(1)}
          >
            {t(cueIndex < cueCount - 1 ? "teachingDerivation.nextCue" : "learningScene.derivationNext")}
            <ChevronRight aria-hidden />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={busy || animating || generating}
            onClick={onContinue}
          >
            {t("learningScene.completeSection")}
          </Button>
        )}
      </div>
    </div>
  );
}
