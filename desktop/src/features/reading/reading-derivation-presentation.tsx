import {useCallback, useEffect, useMemo} from "react";
import {BookOpenText, ChevronLeft, ChevronRight} from "lucide-react";
import {derivationDisplayDocument} from "@xue-learn/core/display/catalog";
import {createDisplayClock} from "@xue-learn/core/display/runtime";
import {useT} from "@xue-learn/core/i18n";
import {resolveTeachingDerivationDerived, type TeachingDerivationDocumentV1} from "@xue-learn/core/teaching-derivation";
import {Button} from "@xue-learn/core/ui/button";
import {DialogClose, DialogContent, DialogDescription, DialogTitle} from "@xue-learn/core/ui/dialog";
import {DisplayDocumentHost} from "@/features/display/display-block-host";
import {DERIVATION_MOTION_MS, useDerivationMotion} from "@/features/teaching-derivation/use-derivation-motion";

/** The learner owns the step cursor; only the transition between steps runs. */
export function ReadingDerivationPresentation({document, ordinal, onOrdinalChange}: {
  document: TeachingDerivationDocumentV1; ordinal: number; onOrdinalChange: (ordinal: number) => void;
}) {
  const t = useT();
  const motion = useDerivationMotion(ordinal);
  const animating = motion.progress < 1;
  const derived = useMemo(() => resolveTeachingDerivationDerived(document), [document]);
  const display = useMemo(() => derivationDisplayDocument({
    id: `${document.id}-reading-presentation`, document, derived, focused: true,
    fromStep: motion.from, toStep: ordinal, progress: motion.progress,
    layoutProgress: motion.progress, contextProgress: motion.progress, visualProgress: motion.progress,
  }), [document, derived, motion.from, ordinal, motion.progress]);
  const move = useCallback((direction: -1 | 1) => {
    if (!animating) onOrdinalChange(Math.max(1, Math.min(document.steps.length, ordinal + direction)));
  }, [animating, document.steps.length, ordinal, onOrdinalChange]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || target.isContentEditable || target.closest("input, textarea, select, [role=slider]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    // Disabling a button during its animation can move browser focus to body.
    // Capture shortcuts while this modal is mounted, including that interval.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [move]);
  return <DialogContent className="reading-workspace reading-derivation-dialog reading-no-print"
    showCloseButton={false} overlayClassName="reading-derivation-backdrop">
    <header className="reading-derivation-presentation-heading">
      <DialogTitle>{document.title}</DialogTitle>
      <DialogClose render={<Button variant="outline" />}>
        <BookOpenText aria-hidden />{t("reading.showSteps")}
      </DialogClose>
    </header>
    <DialogDescription className="sr-only">{t("teachingDerivation.steps")}</DialogDescription>
    <div className="reading-derivation-stage" data-animating={animating}>
      <DisplayDocumentHost document={display} controls={false}
        clock={createDisplayClock(motion.progress * DERIVATION_MOTION_MS / 1000 * 60, 60, {playing: animating})} />
    </div>
    <nav className="reading-derivation-navigation" aria-label={t("teachingDerivation.steps")}>
      <Button variant="outline" disabled={ordinal <= 1 || animating} onClick={() => move(-1)}>
        <ChevronLeft aria-hidden />{t("learningScene.derivationBack")}
      </Button>
      <span role="status" aria-live="polite">{t("learningScene.derivationProgress", {current: ordinal, total: document.steps.length})}</span>
      <Button disabled={ordinal >= document.steps.length || animating} onClick={() => move(1)}>
        {t("learningScene.derivationNext")}<ChevronRight aria-hidden />
      </Button>
    </nav>
  </DialogContent>;
}
