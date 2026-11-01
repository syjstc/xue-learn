"use client";
import { translateCurrent } from "@xue-learn/core/i18n";

import { useT, countVariant } from "@xue-learn/core/i18n";

import { useEffect, useState } from "react";
import { ChevronDown, List } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/ui/sheet";
import { QuizSetList } from "./quiz-set-list.tsx";
import type { QuizSetSummary } from "@/shared/domain/quiz-sets";
import { cn } from "@xue-learn/core/utils";

const MOBILE_MAX_WIDTH = 1023;

function useIsMobile(breakpoint = MOBILE_MAX_WIDTH) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return mobile;
}

function activeSetLabel(
  sets: QuizSetSummary[],
  activeQuizSetId: string | null,
): string {
  if (!activeQuizSetId) {
    return sets.length > 0
      ? translateCurrent("desktop.i18n.quizSetsCount", { count: sets.length })
      : translateCurrent("desktop.ui.quizSetDrawer.practiceSets");
  }
  const index = sets.findIndex((set) => set.id === activeQuizSetId);
  if (index === -1)
    return translateCurrent("desktop.ui.quizSetDrawer.practiceSets");
  return translateCurrent("desktop.i18n.quizSet", {
    number: sets.length - index,
  });
}

function QuizSetTrigger({
  label,
  activeSet,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  activeSet?: QuizSetSummary;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("max-w-full gap-1.5", className)}
      {...props}
    >
      <List className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      {activeSet && (
        <span className="hidden truncate text-muted-foreground sm:inline">
          ·{" "}
          {t(
            `desktop.i18n.questionCount.${countVariant(activeSet.questionCount)}`,
            { count: activeSet.questionCount },
          )}
        </span>
      )}
      <ChevronDown
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  );
}

export function QuizSetDrawer({
  sets,
  loading,
  activeQuizSetId,
  onSelect,
  onSelectAttempt,
  className,
}: {
  sets: QuizSetSummary[];
  loading?: boolean;
  activeQuizSetId?: string | null;
  onSelect: (set: QuizSetSummary) => void;
  onSelectAttempt?: (set: QuizSetSummary) => void;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const activeSet = sets.find((set) => set.id === activeQuizSetId);
  const label = activeSetLabel(sets, activeQuizSetId ?? null);

  const handleSelect = (set: QuizSetSummary) => {
    onSelect(set);
    setOpen(false);
  };

  const handleSelectAttempt = onSelectAttempt
    ? (set: QuizSetSummary) => {
        onSelectAttempt(set);
        setOpen(false);
      }
    : undefined;

  const list = (
    <QuizSetList
      sets={sets}
      loading={loading}
      activeQuizSetId={activeQuizSetId}
      onSelect={handleSelect}
      onSelectAttempt={handleSelectAttempt}
    />
  );

  if (isMobile) {
    return (
      <>
        <QuizSetTrigger
          label={label}
          activeSet={activeSet}
          className={className}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="h-[100dvh] max-h-[100dvh] w-full max-w-none gap-0 rounded-none border-0 p-0"
          >
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle>
                {t("desktop.ui.quizSetDrawer.practiceSets")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t("desktop.ui.quizSetDrawer.chooseAPracticeSetToAnswerOr")}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{list}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={className}
        render={
          <QuizSetTrigger
            label={label}
            activeSet={activeSet}
            aria-haspopup="listbox"
            aria-expanded={open}
          />
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 max-h-[min(24rem,var(--available-height))] overflow-y-auto p-2"
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}
