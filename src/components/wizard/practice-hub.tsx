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

const TABS: { id: PracticeTab; label: string }[] = [
  { id: "quiz", label: "测验" },
  { id: "flashcards", label: "闪卡" },
];

export function PracticeHub({
  activeTab,
  onTabChange,
  flashcards,
  quiz,
  showFlashcards = true,
}: PracticeHubProps) {
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
