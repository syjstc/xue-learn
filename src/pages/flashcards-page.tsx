import { useMainline } from "@/features/learning-mainline/provider";
import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Clock3,
  CreditCard,
  Edit3,
  ExternalLink,
  Layers3,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FlashcardDeckPicker } from "@/components/flashcards/flashcard-deck-picker";
import { FlashcardSourceDialog } from "@/components/flashcards/flashcard-source-dialog";
import { FlashcardStudySession } from "@/components/flashcards/flashcard-study-session";
import {
  useDeleteFlashcardCard,
  useDeleteFlashcardDeck,
  useFlashcardDeckCards,
  useFlashcardDecks,
  useFlashcardDueSummary,
  useUpdateFlashcardCard,
} from "@/hooks/use-flashcards";
import { useConfirm } from "@/hooks/use-confirm";
import { useI18n, useT, type TranslationKey } from "@xue-learn/core/i18n";
import type {
  FlashCardDeckListItem,
  FlashCardDto,
  FlashcardReviewScope,
} from "@/shared/domain/flashcards";
import { cn } from "@xue-learn/core/utils";
import { AiGeneratedNotice } from "@/components/ui/ai-generated-notice";

function formatDate(
  value: string | null,
  locale: string,
  empty: string,
): string {
  if (!value) return empty;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stateLabel(state: string, t: (key: TranslationKey) => string): string {
  switch (state) {
    case "New":
      return t("flashcards.stateNew");
    case "Learning":
      return t("flashcards.stateLearning");
    case "Review":
      return t("flashcards.stateReview");
    case "Relearning":
      return t("flashcards.stateRelearning");
    default:
      return state;
  }
}

function scopeMatchesDeck(
  scope: FlashcardReviewScope,
  deck: FlashCardDeckListItem,
): boolean {
  if (scope.type === "all") return true;
  if (scope.type === "goal") return deck.goalId === scope.goalId;
  return deck.unitId === scope.unitId;
}

function EditCardDialog({
  card,
  open,
  onOpenChange,
}: {
  card: FlashCardDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const updateCard = useUpdateFlashcardCard();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  useEffect(() => {
    setFront(card?.front ?? "");
    setBack(card?.back ?? "");
  }, [card]);

  async function save() {
    if (!card) return;
    await updateCard.mutateAsync({ cardId: card.id, front, back });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("flashcards.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("flashcards.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("flashcards.front")}</span>
            <Textarea
              value={front}
              onChange={(e) => setFront(e.target.value)}
              className="min-h-24"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("flashcards.back")}</span>
            <Textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              className="min-h-28"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={updateCard.isPending || !front.trim() || !back.trim()}
          >
            {updateCard.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FlashcardsPage({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const mainline = useMainline();
  const [params] = useSearchParams();
  const mainlineUnit =
    mainline?.current?.reviewSource === "flashcards"
      ? params.get("mainlineUnit")
      : null;
  const decksQuery = useFlashcardDecks();
  const [scope, setScope] = useState<FlashcardReviewScope>(() =>
    mainlineUnit ? { type: "unit", unitId: mainlineUnit } : { type: "all" },
  );
  const summaryQuery = useFlashcardDueSummary(scope);
  const [studying, setStudying] = useState(Boolean(mainlineUnit));
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingCard, setEditingCard] = useState<FlashCardDto | null>(null);
  const [sourceCardId, setSourceCardId] = useState<string | null>(null);
  const deckCardsQuery = useFlashcardDeckCards(selectedDeckId);
  const deleteDeck = useDeleteFlashcardDeck();
  const deleteCard = useDeleteFlashcardCard();
  const { confirm } = useConfirm();

  const decks = decksQuery.data ?? [];
  const visibleDecks = useMemo(
    () => decks.filter((deck) => scopeMatchesDeck(scope, deck)),
    [decks, scope],
  );
  const selectedDeck =
    decks.find((deck) => deck.deckId === selectedDeckId) ?? null;

  useEffect(() => {
    if (!selectedDeckId && visibleDecks[0]) {
      setSelectedDeckId(visibleDecks[0].deckId);
    } else if (
      selectedDeckId &&
      !visibleDecks.some((deck) => deck.deckId === selectedDeckId)
    ) {
      setSelectedDeckId(visibleDecks[0]?.deckId ?? null);
    }
  }, [selectedDeckId, visibleDecks]);

  const totals = useMemo(
    () =>
      visibleDecks.reduce(
        (acc, deck) => ({
          due: acc.due + deck.dueCount,
          newCards: acc.newCards + deck.newCount,
          learning: acc.learning + deck.learningCount,
          review: acc.review + deck.reviewCount,
          total: acc.total + deck.totalCount,
        }),
        { due: 0, newCards: 0, learning: 0, review: 0, total: 0 },
      ),
    [visibleDecks],
  );

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { goalTitle: string; decks: FlashCardDeckListItem[] }
    >();
    for (const deck of visibleDecks) {
      const current = map.get(deck.goalId) ?? {
        goalTitle: deck.goalTitle,
        decks: [],
      };
      current.decks.push(deck);
      map.set(deck.goalId, current);
    }
    return [...map.entries()].map(([goalId, group]) => ({ goalId, ...group }));
  }, [visibleDecks]);

  const filteredCards = useMemo(() => {
    const cards = deckCardsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (card) =>
        card.front.toLowerCase().includes(q) ||
        card.back.toLowerCase().includes(q),
    );
  }, [deckCardsQuery.data, search]);

  async function handleDeleteDeck(deck: FlashCardDeckListItem) {
    const ok = await confirm({
      title: t("flashcards.deleteDeck"),
      description: t("flashcards.deleteDeckDescription", {
        title: deck.unitTitle,
        count: deck.totalCount,
      }),
      variant: "destructive",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await deleteDeck.mutateAsync({ deckId: deck.deckId });
    if (selectedDeckId === deck.deckId) setSelectedDeckId(null);
  }

  async function handleDeleteCard(card: FlashCardDto) {
    const isLastCard =
      selectedDeck?.totalCount === 1 ||
      (deckCardsQuery.data?.length ?? 0) === 1;
    const message = isLastCard
      ? t("flashcards.deleteLastCardDescription")
      : t("flashcards.deleteCardDescription");
    const ok = await confirm({
      title: t("flashcards.deleteCard"),
      description: message,
      variant: "destructive",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    const result = await deleteCard.mutateAsync({ cardId: card.id });
    if (result.deckDeleted) setSelectedDeckId(null);
  }

  if (studying) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <AiGeneratedNotice />
        {mainlineUnit && mainline?.current?.returnActivityId ? (
          <Button
            variant="outline"
            onClick={() =>
              void mainline.returnToSource().catch(() => undefined)
            }
          >
            {t("mainline.return")}
          </Button>
        ) : null}
        <FlashcardStudySession
          mode="global"
          scope={scope}
          onExit={() => setStudying(false)}
          onSessionComplete={() => setStudying(false)}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", !embedded && "mx-auto max-w-6xl")}>
      <AiGeneratedNotice kind="partial" />
      {mainlineUnit && mainline?.current?.returnActivityId ? (
        <Button
          onClick={() => void mainline.returnToSource().catch(() => undefined)}
        >
          {t("mainline.return")}
        </Button>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className={embedded ? "sr-only" : undefined}>
          {embedded ? (
            <h2>{t("flashcards.title")}</h2>
          ) : (
            <h1 className="text-2xl font-bold text-foreground">
              {t("flashcards.title")}
            </h1>
          )}
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("flashcards.description")}
          </p>
        </div>
        <Button
          className="gap-2"
          disabled={(summaryQuery.data?.due ?? 0) === 0}
          onClick={() => setStudying(true)}
        >
          <Play className="size-4" />
          {t("flashcards.reviewDue")}
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: t("flashcards.due"),
            value: summaryQuery.data?.due ?? totals.due,
            icon: Clock3,
          },
          {
            label: t("flashcards.newCards"),
            value: totals.newCards,
            icon: CreditCard,
          },
          {
            label: t("flashcards.learning"),
            value: totals.learning,
            icon: Layers3,
          },
          {
            label: t("flashcards.totalCards"),
            value: totals.total,
            icon: BookOpen,
          },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {item.value}
                </p>
              </div>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon className="size-5" />
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <FlashcardDeckPicker decks={decks} value={scope} onChange={setScope} />
        <p className="text-sm text-muted-foreground">
          {t("flashcards.scopeSummary", {
            decks: visibleDecks.length,
            cards: totals.review,
          })}
        </p>
      </section>

      {decksQuery.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t("flashcards.loadingDecks")}
        </p>
      ) : decks.length === 0 ? (
        <Card className="p-6">
          <CardTitle>{t("flashcards.emptyTitle")}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("flashcards.emptyDescription")}
          </p>
          <Link to="/goals">
            <Button className="mt-4" variant="outline">
              {t("flashcards.openGoals")}
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <section className="space-y-5">
            {groups.map((group) => (
              <div key={group.goalId} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {group.goalTitle}
                </h2>
                <div className="grid gap-3">
                  {group.decks.map((deck) => (
                    <Card
                      key={deck.deckId}
                      className={cn(
                        "p-4 transition hover:border-primary/40",
                        selectedDeckId === deck.deckId && "border-primary/50",
                      )}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="truncate text-base">
                              {deck.unitTitle}
                            </CardTitle>
                            {deck.stale && (
                              <Badge variant="destructive">
                                {t("flashcards.regenerateSuggested")}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("flashcards.generated", {
                              date: formatDate(
                                deck.generatedAt,
                                locale,
                                t("common.notAvailable"),
                              ),
                            })}{" "}
                            ·{" "}
                            {t("flashcards.lastReviewed", {
                              date: formatDate(
                                deck.lastReviewAt,
                                locale,
                                t("common.notAvailable"),
                              ),
                            })}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline">
                              {t("flashcards.dueCount", {
                                count: deck.dueCount,
                              })}
                            </Badge>
                            <Badge variant="outline">
                              {t("flashcards.newCount", {
                                count: deck.newCount,
                              })}
                            </Badge>
                            <Badge variant="outline">
                              {t("flashcards.learningCount", {
                                count: deck.learningCount,
                              })}
                            </Badge>
                            <Badge variant="outline">
                              {t("flashcards.totalCount", {
                                count: deck.totalCount,
                              })}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setScope({ type: "unit", unitId: deck.unitId });
                              setStudying(true);
                            }}
                            disabled={deck.dueCount === 0}
                          >
                            {t("flashcards.review")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedDeckId(deck.deckId)}
                          >
                            {t("flashcards.manage")}
                          </Button>
                          <Link
                            to={`/goals/${deck.goalId}/units/${deck.unitId}`}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                            >
                              <ExternalLink className="size-3.5" />
                              {t("flashcards.course")}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteDeck.isPending}
                            onClick={() => void handleDeleteDeck(deck)}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">
                              {t("flashcards.deleteDeck")}
                            </span>
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="min-w-0">
            <Card className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-hidden p-4">
              {selectedDeck ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {selectedDeck.goalTitle}
                      </p>
                      <CardTitle className="mt-1 text-base">
                        {selectedDeck.unitTitle}
                      </CardTitle>
                    </div>
                    <Link
                      to={`/goals/${selectedDeck.goalId}/units/${selectedDeck.unitId}`}
                    >
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <ExternalLink className="size-3.5" />
                        {t("flashcards.course")}
                      </Button>
                    </Link>
                  </div>

                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("flashcards.searchPlaceholder")}
                      className="pl-9"
                    />
                  </div>

                  <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {deckCardsQuery.isPending ? (
                      <p className="text-sm text-muted-foreground">
                        {t("flashcards.loadingCards")}
                      </p>
                    ) : filteredCards.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("flashcards.noMatchingCards")}
                      </p>
                    ) : (
                      filteredCards.map((card) => (
                        <div
                          key={card.id}
                          className="rounded-lg border border-border bg-background p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <Badge variant="secondary">
                              {stateLabel(card.state, t)}
                            </Badge>
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSourceCardId(card.id)}
                              >
                                {t("flashcards.source")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingCard(card)}
                              >
                                <Edit3 className="size-4" />
                                <span className="sr-only">
                                  {t("flashcards.editTitle")}
                                </span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                disabled={deleteCard.isPending}
                                onClick={() => void handleDeleteCard(card)}
                              >
                                <Trash2 className="size-4" />
                                <span className="sr-only">
                                  {t("flashcards.deleteCard")}
                                </span>
                              </Button>
                            </div>
                          </div>
                          <p className="mt-3 text-sm font-medium text-foreground">
                            {card.front}
                          </p>
                          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                            {card.back}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>
                              {t("flashcards.dueDate", {
                                date: formatDate(
                                  card.due,
                                  locale,
                                  t("common.notAvailable"),
                                ),
                              })}
                            </span>
                            <span>
                              {t("flashcards.reviewedTimes", {
                                count: card.reps,
                              })}
                            </span>
                            <span>
                              {t("flashcards.lapses", { count: card.lapses })}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("flashcards.selectDeck")}
                </p>
              )}
            </Card>
          </section>
        </div>
      )}

      <EditCardDialog
        card={editingCard}
        open={Boolean(editingCard)}
        onOpenChange={(open) => {
          if (!open) setEditingCard(null);
        }}
      />
      <FlashcardSourceDialog
        cardId={sourceCardId}
        open={Boolean(sourceCardId)}
        onOpenChange={(open) => {
          if (!open) setSourceCardId(null);
        }}
      />
    </div>
  );
}
