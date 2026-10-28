import { BoardText } from "./board-text.js";
import { useMemo } from "react";
import {
  teachingBoardTransition,
  teachingBlockFrame,
  teachingExplanationFrame,
} from "../../../libs/teaching-derivation/src/index.js";
import type {
  TeachingDerivationDocumentV1,
  TeachingDerivationDerivedV1,
} from "../../../libs/teaching-derivation/src/index.js";
import { TeachingFormulaRenderer } from "./teaching-formula-renderer.js";
import { useT } from "../../shared/i18n/index.js";
import { cn } from "../../shared/utils.js";
import { TeachingCompanion } from "./teaching-companion.js";

export function TeachingDerivationBoard({
  document,
  derived,
  ordinal,
  fromOrdinal,
  progress,
  classroom = false,
  cueId,
  focused = true,
}: {
  document: TeachingDerivationDocumentV1;
  derived: TeachingDerivationDerivedV1;
  ordinal: number;
  fromOrdinal: number;
  progress: number;
  classroom?: boolean;
  cueId?: string;
  focused?: boolean;
}) {
  const t = useT();
  const step = document.steps[ordinal - 1];
  const cards = useMemo(
    () =>
      teachingBoardTransition(document, derived, fromOrdinal, ordinal).map(
        (track) => ({
          ...track,
          origin: track.source
            ? derived.steps[track.source.stepIndex - 1]?.formulas.find(
                (item) => item.key === track.source!.formulaKey,
              )?.analysis
            : undefined,
        }),
      ),
    [document, derived, fromOrdinal, ordinal],
  );
  if (!step) return null;
  const explanation = teachingExplanationFrame(document, step, cueId);
  const givens = focused ? explanation.givens : document.givens;
  const referenceKeys = new Set([step.focusFormulaKey, ...(step.targets ?? []).filter(target =>
    explanation.cue?.targetIds.includes(target.id)).map(target => target.formulaKey)]);
  const visibleReferences = cards.filter(card => card.formula.role === "reference" &&
    (!focused || !step.cues?.length || Boolean(step.presentationFallback) || referenceKeys.has(card.formula.key)));
  const renderCard = (card: (typeof cards)[number]) => {
    const { formula, after, before, source, origin, transition } = card;
    const reference = formula.role === "reference";
    const cardProgress = reference ? 1 : progress;
    if (!after || (card.state === "exit" && cardProgress >= 1)) return null;
    const block = teachingBlockFrame(card, cardProgress);
    return (
      <article
        key={card.id}
        style={{
          opacity: block.opacity,
          transform: `translateY(${block.offsetY}px)`,
        }}
        className={cn(
          "min-w-0 rounded-2xl px-5 py-4",
          reference
            ? "border border-current/10"
            : "bg-[var(--course-content-surface,#fff)]",
          formula.key === step.focusFormulaKey &&
            "ring-1 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]",
        )}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--course-content-muted,#64748b)]">
          <span className="min-w-0 font-medium">
            <BoardText text={formula.title} />
          </span>
          <span>
            {source
              ? t(
                  reference
                    ? "teachingDerivation.referenceStep"
                    : "teachingDerivation.fromStep",
                  { step: source.stepIndex },
                )
              : t(
                  reference
                    ? "teachingDerivation.referenceFormula"
                    : ordinal === 1
                      ? "teachingDerivation.start"
                      : "teachingDerivation.introduced",
                )}
          </span>
        </header>
        {!reference && origin && source && source.stepIndex !== ordinal - 1 ? (
          <div className="mt-3 border-b border-current/10 pb-2">
            <p className="text-xs text-[var(--course-content-muted,#64748b)]">
              {t("teachingDerivation.resume")}
            </p>
            <TeachingFormulaRenderer
              after={origin}
              progress={1}
              className="text-base"
            />
          </div>
        ) : null}
        <TeachingFormulaRenderer
          after={after}
          emphasis={derived.steps[ordinal - 1]?.presentation?.targets.filter(target => target.formulaKey === formula.key && (step.cues?.find(cue => cue.id === cueId)?.targetIds.includes(target.id) ?? false))}
          before={before}
          transition={transition}
          cancelledNodeIds={card.cancelledNodeIds}
          progress={cardProgress}
          className={
            classroom
              ? "text-[2.1rem]"
              : reference
                ? "text-lg"
                : "text-[1.55rem] sm:text-[1.9rem]"
          }
        />
      </article>
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {givens.length ? (
        <aside className="rounded-xl border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
          <h3 className="mb-2 font-medium">
            {t("teachingDerivation.premises")}
          </h3>
          {givens.map((given, index) => (
            <p key={index}>
              <BoardText text={given} />
            </p>
          ))}
        </aside>
      ) : null}
      <h3 className="text-sm font-medium">{t("teachingDerivation.current")}</h3>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1 font-medium">
          {t(`teachingDerivation.relation.${step.relation}`)}
        </span>
        {step.conditions ? (
          <span>
            {t("teachingDerivation.condition")}
            <BoardText text={step.conditions} />
          </span>
        ) : null}
      </div>
      <div className={cn("grid min-w-0 gap-4", step.visual && "lg:grid-cols-2")}>
        {step.visual ? <div className="teaching-reading-companion">
          <TeachingCompanion document={document} visual={step.visual} targetIds={explanation.visualTargetIds} previousTargetIds={explanation.previousVisualTargetIds} />
        </div> : null}
        <div className="flex min-w-0 flex-col gap-3">
        {cards
          .filter((card) => card.formula.role === "primary")
          .map(renderCard)}
        </div>
      </div>
      <div className="border-l-2 border-[var(--accent)] pl-4 text-sm leading-relaxed">
        <p className="mb-1 text-xs text-[var(--course-content-muted,#64748b)]">
          {t(focused ? "teachingDerivation.currentExplanation" : "teachingDerivation.reason")}
        </p>
        <p>
          <BoardText text={focused ? explanation.text : step.justification} />
        </p>
      </div>
      {visibleReferences.length ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-[var(--course-content-muted,#64748b)]">
            {t("teachingDerivation.references")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleReferences.map(renderCard)}
          </div>
        </section>
      ) : null}
      {focused ? <details className="rounded-xl border px-4 py-3 text-sm leading-relaxed">
        <summary className="cursor-pointer font-medium">{t("teachingDerivation.fullContext")}</summary>
        {document.givens.length ? <div className="mt-3 space-y-2">
          <h4 className="font-medium">{t("teachingDerivation.premises")}</h4>
          {document.givens.map((given, index) => <p key={index}><BoardText text={given} /></p>)}
        </div> : null}
        <div className="mt-3"><h4 className="font-medium">{t("teachingDerivation.reason")}</h4><p><BoardText text={step.justification} /></p></div>
        {cards.filter(card => card.formula.role === "reference").map(renderCard)}
      </details> : null}
    </div>
  );
}
