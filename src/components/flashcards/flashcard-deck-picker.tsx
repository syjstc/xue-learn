import { useEffect, useState } from "react";
import type {
  FlashCardDeckListItem,
  FlashcardReviewScope,
} from "@/shared/domain/flashcards";
import {
  FLASHCARD_SCOPE_STORAGE_KEY,
  parseScopeFromQuery,
} from "@/shared/domain/flashcards";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { canUseBrowserPersistentStorage } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

type FlashcardDeckPickerProps = {
  decks: FlashCardDeckListItem[];
  value: FlashcardReviewScope;
  onChange: (scope: FlashcardReviewScope) => void;
};

function scopeLabel(
  scope: FlashcardReviewScope,
  decks: FlashCardDeckListItem[],
  t: (key: TranslationKey) => string,
): string {
  if (scope.type === "all") return t("flashcards.allDecks");
  if (scope.type === "goal") {
    const deck = decks.find((d) => d.goalId === scope.goalId);
    return deck ? `${deck.goalTitle}` : t("flashcards.goalDecks");
  }
  const deck = decks.find((d) => d.unitId === scope.unitId);
  return deck
    ? `${deck.goalTitle} · ${deck.unitTitle}`
    : t("flashcards.unitDecks");
}

export function FlashcardDeckPicker({
  decks,
  value,
  onChange,
}: FlashcardDeckPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!canUseBrowserPersistentStorage()) return;
    try {
      const raw = localStorage.getItem(FLASHCARD_SCOPE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as FlashcardReviewScope;
      onChange(parsed);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load persisted scope once
  }, []);

  function select(scope: FlashcardReviewScope) {
    onChange(scope);
    if (canUseBrowserPersistentStorage()) {
      localStorage.setItem(FLASHCARD_SCOPE_STORAGE_KEY, JSON.stringify(scope));
    }
    setOpen(false);
  }

  const goals = [
    ...new Map(decks.map((d) => [d.goalId, d.goalTitle])).entries(),
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary/40"
      >
        <span>{scopeLabel(value, decks, t)}</span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-72 w-72 overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => select({ type: "all" })}
          >
            {t("flashcards.allDecks")}
          </button>
          {goals.map(([goalId, goalTitle]) => {
            const goalDecks = decks.filter((d) => d.goalId === goalId);
            const due = goalDecks.reduce((s, d) => s + d.dueCount, 0);
            return (
              <button
                key={goalId}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => select({ type: "goal", goalId })}
              >
                {goalTitle}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t("flashcards.dueCount", { count: due })}
                </span>
              </button>
            );
          })}
          <div className="my-1 border-t border-border" />
          {decks.map((deck) => (
            <button
              key={deck.deckId}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => select({ type: "unit", unitId: deck.unitId })}
            >
              <span className="text-muted-foreground">{deck.goalTitle} · </span>
              {deck.unitTitle}
              <span className="ml-2 text-xs text-muted-foreground">
                {deck.dueCount}/{deck.newCount}/{deck.totalCount}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function loadStoredFlashcardScope(): FlashcardReviewScope {
  if (!canUseBrowserPersistentStorage()) return { type: "all" };
  try {
    const raw = localStorage.getItem(FLASHCARD_SCOPE_STORAGE_KEY);
    if (!raw) return { type: "all" };
    const parsed = JSON.parse(raw) as FlashcardReviewScope;
    return parseScopeFromQuery(
      parsed.type,
      parsed.type === "goal" ? parsed.goalId : undefined,
      parsed.type === "unit" ? parsed.unitId : undefined,
    );
  } catch {
    return { type: "all" };
  }
}
