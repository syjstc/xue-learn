import { useT, translateCurrent } from "@xue-learn/core/i18n";
import type { ReactNode } from "react";
import { UnderlineTab, UnderlineTabList } from "@/components/ui/underline-tabs";

export type PracticeTab = "flashcards" | "quiz";

type PracticeHubProps = {
  activeTab: PracticeTab;
  onTabChange: (tab: PracticeTab) => void;
  flashcards: ReactNode;
  quiz: ReactNode;
  /** Hide the hosted deck/generation surface when the runtime lacks it. */
  showFlashcards?: boolean;
};

export function PracticeHub({
  activeTab,
  onTabChange,
  flashcards,
  quiz,
  showFlashcards = true,
}: PracticeHubProps) {
  useT();
  const TABS: { id: PracticeTab; label: string }[] = [
    {
      id: "quiz",
      get label() {
        return translateCurrent("cognitiveMap.evidence.quiz");
      },
    },
    {
      id: "flashcards",
      get label() {
        return translateCurrent("cognitiveMap.evidence.flashcard");
      },
    },
  ];
  const tabs = showFlashcards
    ? TABS
    : TABS.filter((tab) => tab.id !== "flashcards");
  const renderedTab =
    !showFlashcards && activeTab === "flashcards" ? "quiz" : activeTab;

  return (
    <div className="space-y-4">
      <UnderlineTabList className="border-border">
        {tabs.map((tab) => (
          <UnderlineTab
            key={tab.id}
            label={tab.label}
            active={renderedTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            activeClassName="font-semibold text-primary"
            inactiveClassName="font-medium text-muted-foreground hover:text-foreground"
            indicatorClassName="bg-primary"
          />
        ))}
      </UnderlineTabList>
      <div role="tabpanel">
        {renderedTab === "flashcards" ? flashcards : quiz}
      </div>
    </div>
  );
}
