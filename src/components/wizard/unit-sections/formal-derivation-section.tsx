"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ChevronLeft, ChevronRight} from "lucide-react";
import {materializeAtStep, type DerivationDocumentV1} from "@xue-learn/core/formal-derivation";
import {displayDocumentForNode} from "@xue-learn/core/display/catalog";
import {createDisplayClock} from "@xue-learn/core/display/runtime";
import {Button} from "@xue-learn/core/ui/button";
import {cn} from "@xue-learn/core/utils";
import {useT} from "@xue-learn/core/i18n";
import {DisplayDocumentHost} from "@/features/display/display-block-host";
import {AssistantChatMessage} from "@/components/wizard/conversation/assistant-chat-message";
import {MaterialBlockRenderer} from "@/components/wizard/interactive-material/material-block-renderer";
import {followLiveDerivationOrdinal} from "@/shared/domain/formal-derivation-view";
import {useDerivationMotion} from "@/features/teaching-derivation/use-derivation-motion";

/** Saved formal sections retain their learning cursor; their artwork is the
 * same clocked plugin used for exported video and newly authored displays. */
export function FormalDerivationSection({document, onContinue, busy = false, generating = false,
  persistedCursor, onCursorChange, assistantName, assistantAvatarSrc}: {
  document: DerivationDocumentV1; onContinue: () => void; busy?: boolean; generating?: boolean;
  persistedCursor?: number; onCursorChange?: (cursor: number) => void;
  assistantName: string; assistantAvatarSrc: string;
}) {
  const t = useT();
  const maxOrdinal = document.steps.length;
  const [ordinal, setOrdinal] = useState(() => Math.max(1, Math.min(maxOrdinal || 1, persistedCursor ?? 1)));
  const [furthest, setFurthest] = useState(ordinal);
  const motion = useDerivationMotion(ordinal);
  const previousStepCountRef = useRef(maxOrdinal);
  const documentIdRef = useRef(document.id);
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  useEffect(() => {
    const previousCount = previousStepCountRef.current;
    previousStepCountRef.current = maxOrdinal;
    const replaced = documentIdRef.current !== document.id;
    documentIdRef.current = document.id;
    const followed = replaced ? persistedCursor ?? 1 : generating ? followLiveDerivationOrdinal(ordinal, previousCount, maxOrdinal) : ordinal;
    const next = Math.max(1, Math.min(maxOrdinal || 1, followed));
    setFurthest(value => replaced ? next : Math.max(next, Math.min(maxOrdinal || 1, value)));
    if (next !== ordinal) {setOrdinal(next); onCursorChangeRef.current?.(next);}
  }, [document.id, generating, maxOrdinal, ordinal, persistedCursor]);
  const display = useMemo(() => displayDocumentForNode({id: "saved-formal-derivation", kind: "math:formal-derivation", version: 1,
    payload: {document, fromStep: motion.from, toStep: ordinal, progress: motion.progress}}), [document, ordinal, motion.from, motion.progress]);
  const narration = useMemo(() => {
    try {return materializeAtStep(document, ordinal).presentation.narration?.map(item => item.text.trim()).filter(Boolean).join("\n") ?? "";}
    catch {return "";}
  }, [document, ordinal]);
  const jumpTo = useCallback((next: number) => {
    const clamped = Math.max(1, Math.min(maxOrdinal || 1, next));
    setOrdinal(clamped); setFurthest(current => Math.max(current, clamped)); onCursorChange?.(clamped);
  }, [maxOrdinal, onCursorChange]);
  const atEnd = ordinal >= maxOrdinal && maxOrdinal > 0;
  const handleNext = useCallback(() => {
    if (busy) return;
    if (atEnd) {if (!generating) onContinue(); return;}
    jumpTo(ordinal + 1);
  }, [atEnd, busy, generating, jumpTo, onContinue, ordinal]);
  const handleBack = useCallback(() => {if (!busy && ordinal > 1) jumpTo(ordinal - 1);}, [busy, jumpTo, ordinal]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select, [role=slider]")) return;
      if (event.key === "ArrowLeft") {event.preventDefault(); handleBack();}
      if (event.key === "ArrowRight") {event.preventDefault(); handleNext();}
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [handleBack, handleNext]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-0.5 pb-2">
      <DisplayDocumentHost document={display} clock={createDisplayClock(motion.progress * 39, 60)} controls={false}/>
      {narration ? <AssistantChatMessage avatarSrc={assistantAvatarSrc} name={assistantName} showName bubbleClassName="space-y-3 text-base leading-7 text-[var(--course-content)]">
        <MaterialBlockRenderer block={{type: "paragraph", text: narration}} blockIndex={0} highlights={new Map()}/>
      </AssistantChatMessage> : null}
    </div>
      <div
        data-learning-scene-controls
        className="sticky bottom-0 z-10 mt-3 bg-linear-to-t from-background from-65% via-background/92 to-transparent px-0.5 pb-[calc(0.65rem+env(safe-area-inset-bottom,0px))] pt-4"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            className="min-w-0 text-muted-foreground hover:text-foreground sm:min-w-24"
            disabled={ordinal <= 1 || busy || maxOrdinal === 0}
            onClick={handleBack}
          >
            <ChevronLeft aria-hidden />
            {t("learningScene.derivationBack")}
          </Button>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[0.6875rem] font-medium tabular-nums text-[var(--course-content-muted)]">
              {t("learningScene.derivationProgress", {
                current: Math.max(1, ordinal),
                total: Math.max(1, maxOrdinal),
              })}
            </span>
            {maxOrdinal > 1 ? (
              <div className="flex max-w-full items-center justify-center gap-1.5 overflow-x-auto px-1">
                {document.steps.map((item, index) => {
                  const stepOrdinal = index + 1;
                  const available = stepOrdinal <= furthest;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!available || busy}
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        stepOrdinal === ordinal
                          ? "bg-foreground"
                          : available
                            ? "bg-[color-mix(in_srgb,var(--foreground)_28%,transparent)]"
                            : "bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]",
                      )}
                      aria-label={t("learningScene.derivationOpenStep", {
                        current: stepOrdinal,
                        total: maxOrdinal,
                      })}
                      onClick={() => available && jumpTo(stepOrdinal)}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            className="min-w-0 sm:min-w-28"
            disabled={busy || maxOrdinal === 0 || (generating && atEnd)}
            onClick={handleNext}
          >
            {atEnd
              ? generating
                ? t("learningScene.derivationWritingMore")
                : t("learningScene.completeSection")
              : t("learningScene.derivationNext")}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>;
}
