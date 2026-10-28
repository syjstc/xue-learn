import { useEffect, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { InteractiveMaterialBody } from "@/components/wizard/interactive-material-body";
import { LlmMarkdown } from "@/components/markdown/llm-markdown";
import { useFlashcardSource } from "@/hooks/use-flashcards";
import {
  buildSourceExcerptHighlights,
  contentKeyForAnchor,
} from "@xue-learn/core/shared/domain/material-highlight";
import { useT } from "@xue-learn/core/i18n";

type FlashcardSourceDialogProps = {
  cardId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FlashcardSourceDialog({
  cardId,
  open,
  onOpenChange,
}: FlashcardSourceDialogProps) {
  const t = useT();
  const sourceQuery = useFlashcardSource(cardId, open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const source = sourceQuery.data;

  const emphasizeContentKey = useMemo(() => {
    if (!source?.material) return undefined;
    return (
      source.highlightKey ??
      contentKeyForAnchor(source.material, source.anchor) ??
      undefined
    );
  }, [source]);

  const sourceHighlights = useMemo(() => {
    if (!source?.material) return undefined;
    const map = buildSourceExcerptHighlights(
      source.material,
      source.anchor,
      source.excerpt,
    );
    return map.size > 0 ? map : undefined;
  }, [source]);

  useEffect(() => {
    if (!open || !emphasizeContentKey || !source?.material) return;
    const timer = window.setTimeout(() => {
      const root = scrollRef.current;
      if (!root) return;
      const target =
        root.querySelector(`[data-content-key="${emphasizeContentKey}"]`) ??
        root.querySelector(`[data-block-index="${source.blockIndex ?? ""}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, emphasizeContentKey, source?.blockIndex, source?.material]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("flashcards.learningMaterial")} ·{" "}
            {source?.label ?? t("flashcards.original")}
          </DialogTitle>
          <DialogDescription>
            {source?.unitTitle ?? t("common.loading")}
            {source?.stale ? ` · ${t("flashcards.contentMayBeUpdated")}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
          {sourceQuery.isPending ? (
            <p className="text-sm text-muted-foreground">
              {t("flashcards.loadingMaterial")}
            </p>
          ) : source?.material ? (
            <InteractiveMaterialBody
              material={source.material}
              compact
              revealAnswers
              emphasizeContentKey={emphasizeContentKey}
              sourceHighlights={sourceHighlights}
            />
          ) : (
            <LlmMarkdown
              content={source?.excerpt ?? t("flashcards.noMaterial")}
              variant="compact"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
