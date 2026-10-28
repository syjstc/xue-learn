import { useState, type ReactNode } from 'react';
import { Button } from "@xue-learn/core/ui/button";
import { Card } from '@/components/ui/card';
import { FlashcardStudySession } from '@/components/flashcards/flashcard-study-session';
import {
  useFlashcardDeck,
  useGenerateFlashcards,
} from '@/hooks/use-flashcards';
import { useConfirm } from '@/hooks/use-confirm';
import { useT } from "@xue-learn/core/i18n";

type UnitFlashcardPanelProps = {
  unitId: string;
  sessionBusy?: boolean;
  generating?: boolean;
  genStream?: ReactNode;
  onGenerateViaSession?: () => void;
};

export function UnitFlashcardPanel({
  unitId,
  sessionBusy,
  generating: generatingExternal,
  genStream,
  onGenerateViaSession,
}: UnitFlashcardPanelProps) {
  const deckQuery = useFlashcardDeck(unitId);
  const generateMutation = useGenerateFlashcards(unitId);
  const { confirm } = useConfirm();
  const t = useT();
  const [studying, setStudying] = useState(false);

  const deck = deckQuery.data;
  const generating =
    generateMutation.isPending || sessionBusy || generatingExternal;

  async function handleGenerate(regenerate = false) {
    if (regenerate && deck) {
      const ok = await confirm({
        title: t("wizard.flashcards.regenerateTitle"),
        description: t("wizard.flashcards.regenerateDescription"),
        variant: "destructive",
      });
      if (!ok) return;
    }
    if (onGenerateViaSession) {
      onGenerateViaSession();
      return;
    }
    await generateMutation.mutateAsync();
  }

  if (studying && deck) {
    return (
      <FlashcardStudySession
        mode="unit"
        scope={{ type: 'unit', unitId }}
        onExit={() => setStudying(false)}
        onSessionComplete={() => setStudying(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {genStream}
      {!deck ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            {t("wizard.flashcards.emptyDescription")}
          </p>
          <Button
            className="mt-4"
            onClick={() => void handleGenerate(false)}
            disabled={generating}
          >
            {generating ? t("wizard.flashcards.generating") : t("wizard.flashcards.generate")}
          </Button>
        </Card>
      ) : (
        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {t("wizard.flashcards.stats", { total: deck.stats.total, due: deck.stats.due, newCount: deck.stats.new })}
            </p>
            {deck.stale && (
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {t("wizard.flashcards.stale")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setStudying(true)}
              disabled={deck.stats.due === 0 && deck.stats.new === 0}
            >
              {t("wizard.flashcards.startReview")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleGenerate(true)}
              disabled={generating}
            >
              {generating ? t("wizard.flashcards.regenerating") : t("wizard.flashcards.regenerate")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
