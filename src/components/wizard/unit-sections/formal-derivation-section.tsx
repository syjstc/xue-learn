"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { decompileAuthoringTree } from "@xue-learn/core/source/libs/formal-expression-core/src/index.ts";
import {
  materializeAtStep,
  notationFindingsForTree,
  type DerivationDocumentV1,
  type MaterializedDerivationStateV1,
} from "@xue-learn/core/source/libs/formal-derivation/src/index.ts";
import { FormalMotionRenderer } from "@xue-learn/core/source/libs/formal-expression-motion/src/index.ts";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { AssistantChatMessage } from "@/components/wizard/conversation/assistant-chat-message";
import { MaterialBlockRenderer } from "@/components/wizard/interactive-material/material-block-renderer";
import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import {
  currentStepFormulaIds,
  followLiveDerivationOrdinal,
  formulaCaptionMap,
  formulaFocus,
  formulaHighlights,
  formulaHasTeachingEmphasis,
  isFormulaLevelEmphasized,
  splitVisibleFormulas,
  stableFormulaIds,
  visibleFormulaTitle,
} from "@/shared/domain/formal-derivation-view";

const EMPTY_HIGHLIGHTS = new Map<string, TextHighlightSpan[]>();
const FORMULA_MOTION_DELAY_MS = 500;
const NARRATION_EXIT_MS = 240;

function DerivationNarrationBody({ text }: { text: string }) {
  const [leaving, setLeaving] = useState<string | null>(null);
  const currentRef = useRef(text);
  useLayoutEffect(() => {
    if (text === currentRef.current) return;
    const previous = currentRef.current;
    currentRef.current = text;
    setLeaving(previous);
    const timer = window.setTimeout(() => setLeaving(null), NARRATION_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <div className="relative overflow-hidden">
      {leaving ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 derivation-narration-exit"
          aria-hidden
        >
          <MaterialBlockRenderer
            block={{ type: "paragraph", text: leaving }}
            blockIndex={0}
            highlights={EMPTY_HIGHLIGHTS}
          />
        </div>
      ) : null}
      <div key={text} className="derivation-narration-enter">
        <MaterialBlockRenderer
          block={{ type: "paragraph", text }}
          blockIndex={0}
          highlights={EMPTY_HIGHLIGHTS}
        />
      </div>
    </div>
  );
}

function CompactFormula({
  formulaId,
  index,
  state,
  previousState,
  captions,
  motionScale,
  prominence = "working",
}: {
  formulaId: string;
  index: number;
  state: MaterializedDerivationStateV1;
  previousState: MaterializedDerivationStateV1 | null;
  captions: Record<string, string>;
  motionScale: number;
  prominence?: "working" | "stable";
}) {
  const t = useT();
  const formula = state.formulas[formulaId];
  if (!formula) return null;
  const previousFormula = previousState?.formulas[formulaId];
  const focusedFormula = formulaHasTeachingEmphasis(state, formulaId);
  const formulaLevelEmphasis = isFormulaLevelEmphasized(state, formulaId);
  const notationIssue = notationFindingsForTree(
    decompileAuthoringTree(formula.document),
    formulaId,
  ).find((finding) =>
    ["malformed_quantifier", "opaque_teaching_notation"].includes(finding.code),
  );
  return (
    <article
      className={cn(
        "min-w-0",
        prominence === "working"
          ? "py-1"
          : "rounded-lg border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-[color-mix(in_srgb,var(--bg-200)_35%,var(--bg-50))]",
        focusedFormula && prominence === "working" && "text-foreground",
      )}
    >
      <header
        className={cn(
          "flex items-baseline gap-2 text-[var(--course-content-muted)]",
          prominence === "working"
            ? "px-0 pb-2 text-[0.75rem]"
            : "px-2.5 py-1 text-[0.6875rem]",
        )}
      >
        <strong className="truncate font-medium text-foreground">
          {visibleFormulaTitle(
            formulaId,
            state,
            captions,
            index,
            t("learningScene.derivationFormula", { index: index + 1 }),
          )}
        </strong>
      </header>
      <div
        className={cn(
          prominence === "working"
            ? "grid h-[14rem] min-h-[14rem] overflow-x-auto overflow-y-visible rounded-2xl bg-[var(--course-content-surface)] px-5 py-6 text-[1.55rem] leading-none sm:h-[16rem] sm:min-h-[16rem] sm:px-8 sm:py-8 sm:text-[1.9rem]"
            : "overflow-x-auto overflow-y-visible px-3 py-2 text-[0.95rem] leading-none",
        )}
      >
        {notationIssue ? (
          <p className="text-sm text-destructive">
            {t("learningScene.derivationFormulaInvalid")}
          </p>
        ) : (
          <FormalMotionRenderer
            snapshot={formula.document}
            previousSnapshot={previousFormula?.document}
            selected={formulaFocus(state, formulaId)}
            highlights={formulaHighlights(state, formulaId)}
            dimOthers={
              state.presentation.dimOthers === true && !formulaLevelEmphasis
            }
            showDebug={false}
            motionScale={motionScale}
            maxEm={prominence === "working" ? 32 : 22}
            className={
              prominence === "working"
                ? "h-full w-full min-h-0"
                : "min-h-[3.25rem] w-full"
            }
          />
        )}
      </div>
    </article>
  );
}

export function FormalDerivationSection({
  document,
  onContinue,
  busy = false,
  generating = false,
  persistedCursor,
  onCursorChange,
  assistantName,
  assistantAvatarSrc,
}: {
  document: DerivationDocumentV1;
  onContinue: () => void;
  busy?: boolean;
  generating?: boolean;
  persistedCursor?: number;
  onCursorChange?: (cursor: number) => void;
  assistantName: string;
  assistantAvatarSrc: string;
}) {
  const t = useT();
  const maxOrdinal = document.steps.length;
  const [ordinal, setOrdinal] = useState(() =>
    persistedCursor != null
      ? Math.max(1, Math.min(maxOrdinal, persistedCursor))
      : 1,
  );
  const [furthest, setFurthest] = useState(ordinal);
  const previousStepCountRef = useRef(maxOrdinal);
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  useEffect(() => {
    const previousCount = previousStepCountRef.current;
    previousStepCountRef.current = maxOrdinal;
    if (!generating) return;
    setOrdinal((current) => {
      const next = followLiveDerivationOrdinal(
        current,
        previousCount,
        maxOrdinal,
      );
      if (next !== current) onCursorChangeRef.current?.(next);
      return next;
    });
  }, [generating, maxOrdinal]);
  const captions = useMemo(() => formulaCaptionMap(document), [document]);
  const [formulaOrdinal, setFormulaOrdinal] = useState(ordinal);
  useEffect(() => {
    if (formulaOrdinal === ordinal) return;
    const timer = window.setTimeout(() => {
      setFormulaOrdinal(ordinal);
    }, FORMULA_MOTION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [formulaOrdinal, ordinal]);
  const materialized = useMemo(() => {
    try {
      return {
        state: materializeAtStep(document, ordinal),
        error: null as string | null,
      };
    } catch (cause) {
      return {
        state: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [document, ordinal]);
  const formulaMaterialized = useMemo(() => {
    if (formulaOrdinal === ordinal) return materialized;
    try {
      return {
        state: materializeAtStep(document, formulaOrdinal),
        error: null as string | null,
      };
    } catch (cause) {
      return {
        state: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [document, formulaOrdinal, materialized, ordinal]);
  const state = materialized.state;
  const formulaState = formulaMaterialized.state;
  const previousStateRef = useRef<MaterializedDerivationStateV1 | null>(null);
  const previousFormulaOrdinalRef = useRef(formulaOrdinal);
  const previousState = previousStateRef.current;
  const motionScale =
    Math.abs(formulaOrdinal - previousFormulaOrdinalRef.current) > 1 ? 0.45 : 1;
  useLayoutEffect(() => {
    previousStateRef.current = formulaState;
    previousFormulaOrdinalRef.current = formulaOrdinal;
  }, [formulaState, formulaOrdinal]);

  const jumpTo = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.min(maxOrdinal || 1, next));
      setOrdinal(clamped);
      setFurthest((current) => Math.max(current, clamped));
      onCursorChange?.(clamped);
    },
    [maxOrdinal, onCursorChange],
  );

  const step = document.steps[ordinal - 1];
  const formulaStep = document.steps[formulaOrdinal - 1];
  const activeFormulaIds = formulaState
    ? currentStepFormulaIds(formulaState, formulaStep)
    : [];
  const stableIds = formulaState
    ? stableFormulaIds(formulaState, activeFormulaIds, captions)
    : [];
  const workingIds = activeFormulaIds.filter((id) => !stableIds.includes(id));
  const stagedState = formulaState
    ? {
        ...formulaState,
        presentation: {
          ...formulaState.presentation,
          visibleFormulaIds: workingIds,
        },
      }
    : null;
  const stableState = formulaState
    ? {
        ...formulaState,
        presentation: {
          ...formulaState.presentation,
          visibleFormulaIds: stableIds,
          focus: [],
          highlight: [],
          dimOthers: false,
        },
      }
    : null;
  const split = stagedState
    ? splitVisibleFormulas(stagedState, captions)
    : { boardIds: [] as string[], companionIds: [] as string[] };
  const narration =
    state?.presentation.narration
      ?.map((item) => item.text.trim())
      .filter(Boolean)
      .join("\n") ?? "";
  const atEnd = ordinal >= maxOrdinal && maxOrdinal > 0;

  const handleNext = useCallback(() => {
    if (busy) return;
    if (atEnd) {
      if (generating) return;
      onContinue();
      return;
    }
    jumpTo(ordinal + 1);
  }, [atEnd, busy, generating, jumpTo, onContinue, ordinal]);
  const handleBack = useCallback(() => {
    if (busy || ordinal <= 1) return;
    jumpTo(ordinal - 1);
  }, [busy, jumpTo, ordinal]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleBack();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack, handleNext]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-0.5 pb-2">
        {materialized.error ? (
          <p className="text-sm text-destructive">{materialized.error}</p>
        ) : null}
        {stableState && stableIds.length ? (
          <section
            className="mx-auto w-full max-w-[56rem] px-1 py-1"
            aria-label={t("learningScene.derivationContext")}
          >
            <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
              <p className="text-[0.6875rem] font-semibold tracking-wide text-[var(--course-content-muted)]">
                {t("learningScene.derivationContext")}
              </p>
            </div>
            <div className="grid gap-2 pb-0.5 sm:grid-cols-2">
              {stableIds.map((formulaId, index) => (
                <div key={formulaId} className="min-w-0">
                  <CompactFormula
                    formulaId={formulaId}
                    index={index}
                    state={stableState}
                    previousState={previousState}
                    captions={captions}
                    motionScale={motionScale}
                    prominence="stable"
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {stagedState ? (
          <section className="mx-auto w-full max-w-[56rem] space-y-4">
            <div className="grid gap-3">
              {[...split.boardIds, ...split.companionIds].map(
                (formulaId, index) => (
                  <CompactFormula
                    key={formulaId}
                    formulaId={formulaId}
                    index={index}
                    state={stagedState}
                    previousState={previousState}
                    captions={captions}
                    motionScale={motionScale}
                    prominence="working"
                  />
                ),
              )}
            </div>
            {narration ? (
              <AssistantChatMessage
                avatarSrc={assistantAvatarSrc}
                name={assistantName}
                showName
                bubbleClassName="space-y-3 text-base leading-7 text-[var(--course-content)]"
              >
                <DerivationNarrationBody text={narration} />
              </AssistantChatMessage>
            ) : null}
          </section>
        ) : null}
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
    </div>
  );
}
